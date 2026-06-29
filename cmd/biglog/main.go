package main

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"embed"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	htmlstd "html"
	"io"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	pathpkg "path"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/tm-LBenson/big-log-viewer/internal/indexer"
)

const defaultRoot = "./logs"
const hugeWindowBytes int64 = 1 << 20
const hugeMaxWindowBytes int64 = 8 << 20
const hugeMaxLineBytes int64 = 2 << 20
const hugeWindowMaxRows = 2500
const hugeSearchBytes int64 = 256 << 20
const idhubLogDefaultPageSize int64 = 5_000_000
const idhubLogMaxPageSize int64 = 50_000_000
const idhubLogDefaultMaxPages = 20_000

var (
	rootDir string
	current *indexer.File

	mu sync.RWMutex

	defaultExt = []string{
		".log", ".txt", ".html", ".htm", ".csv", ".tsv",
		".json", ".jsonl", ".ndjson", ".xml", ".md", ".js", ".css",
	}
	extSet = make(map[string]struct{})
	extMu  sync.RWMutex
)

//go:embed dist/*
var dist embed.FS

func main() {
	addr := flag.String("addr", "127.0.0.1:8844", "listen address")
	flag.StringVar(&rootDir, "logdir", defaultRoot, "folder containing text logs")
	flag.Parse()

	abs, _ := filepath.Abs(rootDir)
	rootDir = abs
	_ = os.MkdirAll(rootDir, 0o755)

	setExtensions(defaultExt, "replace")

	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		log.Fatalf("embed: %v", err)
	}
	http.Handle("/", http.FileServer(http.FS(sub)))

	http.HandleFunc("/api/list", listDir)
	http.HandleFunc("/api/file-info", fileInfo)
	http.HandleFunc("/api/file-info/reveal", revealFile)
	http.HandleFunc("/api/open", openFile)
	http.HandleFunc("/api/chunk", chunk)
	http.HandleFunc("/api/window", textWindow)
	http.HandleFunc("/api/raw-window", rawWindow)
	http.HandleFunc("/api/raw", raw)
	http.HandleFunc("/api/search", searchLines)
	http.HandleFunc("/api/root", getRoot)
	http.HandleFunc("/api/root/set", setRoot)
	http.HandleFunc("/api/range", rangeLines)
	http.HandleFunc("/api/extensions", extensionsHandler)
	http.HandleFunc("/api/update/status", updateStatusHandler)
	http.HandleFunc("/api/update/check", updateCheckHandler)
	http.HandleFunc("/api/update/apply", updateApplyHandler)
	http.HandleFunc("/api/idhub/connect/start", idhubConnectStart)
	http.HandleFunc("/api/idhub/connect/status", idhubConnectStatus)
	http.HandleFunc("/api/idhub/connect/disconnect", idhubConnectDisconnect)
	http.HandleFunc("/api/idhub/sources", idhubSources)
	http.HandleFunc("/api/idhub/sinks", idhubSinks)
	http.HandleFunc("/api/idhub/jobs", idhubJobs)
	http.HandleFunc("/api/idhub/log", idhubLog)

	fmt.Println("serving http://" + *addr)
	srv := &http.Server{
		Addr:         *addr,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 5 * time.Minute,
		IdleTimeout:  60 * time.Second,
		Handler:      nil,
	}
	log.Fatal(srv.ListenAndServe())
}

func listDir(w http.ResponseWriter, r *http.Request) {
	type listedFile struct {
		Path    string `json:"path"`
		Size    int64  `json:"size"`
		ModTime int64  `json:"modTime"`
	}
	details := r.URL.Query().Get("details") == "1"
	var out []string
	var detailed []listedFile

	extMu.RLock()
	curExtSet := cloneExtSet()
	allowAllText := hasWildcard(curExtSet)
	extMu.RUnlock()

	filepath.WalkDir(rootDir, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if shouldIncludeFile(p, curExtSet, allowAllText) {
			rel, _ := filepath.Rel(rootDir, p)
			rel = filepath.ToSlash(rel)
			if details {
				info, infoErr := d.Info()
				if infoErr != nil {
					return nil
				}
				detailed = append(detailed, listedFile{
					Path:    rel,
					Size:    info.Size(),
					ModTime: info.ModTime().UnixMilli(),
				})
			} else {
				out = append(out, rel)
			}
		}
		return nil
	})
	if details {
		writeJSON(w, struct {
			Files []listedFile `json:"files"`
		}{detailed})
		return
	}
	writeJSON(w, out)
}

type extensionsReq struct {
	Extensions []string `json:"extensions"`
	Mode       string   `json:"mode"`
}

type extensionsResp struct {
	Extensions []string `json:"extensions"`
	Defaults   []string `json:"defaults"`
}

type fileInfoResp struct {
	Path           string `json:"path"`
	Name           string `json:"name"`
	AbsPath        string `json:"absPath"`
	Directory      string `json:"directory"`
	Size           int64  `json:"size"`
	ModTime        int64  `json:"modTime"`
	Extension      string `json:"extension"`
	InnerExtension string `json:"innerExtension,omitempty"`
	Compressed     bool   `json:"compressed"`
	Format         string `json:"format"`
	Hint           string `json:"hint,omitempty"`
	HugeHint       bool   `json:"hugeHint"`
}

func extensionsHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, extensionsResp{
			Extensions: getExtensions(),
			Defaults:   sortedCopy(defaultExt),
		})
	case http.MethodPost:
		var req extensionsReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "bad json", http.StatusBadRequest)
			return
		}
		mode := strings.ToLower(strings.TrimSpace(req.Mode))
		if mode != "replace" {
			mode = "merge"
		}
		setExtensions(req.Extensions, mode)
		writeJSON(w, extensionsResp{
			Extensions: getExtensions(),
			Defaults:   sortedCopy(defaultExt),
		})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func setExtensions(exts []string, mode string) {
	norm := normalizeExts(exts)

	extMu.Lock()
	defer extMu.Unlock()

	if mode == "replace" {
		clearMap(extSet)
		for _, e := range normalizeExts(defaultExt) {
			extSet[e] = struct{}{}
		}
		for _, e := range norm {
			extSet[e] = struct{}{}
		}
		return
	}

	for _, e := range norm {
		extSet[e] = struct{}{}
	}
}

func getExtensions() []string {
	extMu.RLock()
	defer extMu.RUnlock()
	out := make([]string, 0, len(extSet))
	for e := range extSet {
		out = append(out, e)
	}
	sort.Strings(out)
	return out
}

func cloneExtSet() map[string]struct{} {
	out := make(map[string]struct{}, len(extSet))
	for k, v := range extSet {
		out[k] = v
	}
	return out
}

func hasWildcard(m map[string]struct{}) bool {
	_, ok := m["*"]
	return ok
}

func clearMap(m map[string]struct{}) {
	for k := range m {
		delete(m, k)
	}
}

func normalizeExts(in []string) []string {
	out := make([]string, 0, len(in))
	for _, e := range in {
		e = strings.TrimSpace(strings.ToLower(e))
		if e == "" {
			continue
		}
		if e == "*" {
			out = append(out, "*")
			continue
		}
		if !strings.HasPrefix(e, ".") {
			e = "." + e
		}
		out = append(out, e)
	}
	return out
}

func sortedCopy(in []string) []string {
	cp := append([]string(nil), in...)
	sort.Strings(cp)
	return cp
}

func shouldIncludeFile(p string, curExtSet map[string]struct{}, allowAllText bool) bool {
	ext := strings.ToLower(filepath.Ext(p))
	if ext == "" {
		if allowAllText {
			return isTextBySniff(p)
		}
		return false
	}
	if _, ok := curExtSet[ext]; ok {
		return true
	}
	if ext == ".gz" {
		innerExt := strings.ToLower(filepath.Ext(strings.TrimSuffix(p, ext)))
		if innerExt != "" {
			if _, ok := curExtSet[innerExt]; ok {
				return true
			}
		}
	}
	if allowAllText {
		return isTextBySniff(p)
	}
	return false
}

func fileInfo(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if path == "" {
		http.Error(w, "path param required", http.StatusBadRequest)
		return
	}
	abs, err := resolveLogPath(path)
	if err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}
	info, err := os.Stat(abs)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	if info.IsDir() {
		http.Error(w, "path is a directory", http.StatusBadRequest)
		return
	}
	rel, _ := filepath.Rel(rootDir, abs)
	rel = filepath.ToSlash(rel)
	ext, innerExt, compressed := fileExtensions(abs)
	format := detectFileFormat(ext, innerExt)
	writeJSON(w, fileInfoResp{
		Path:           rel,
		Name:           filepath.Base(abs),
		AbsPath:        abs,
		Directory:      filepath.Dir(abs),
		Size:           info.Size(),
		ModTime:        info.ModTime().UnixMilli(),
		Extension:      ext,
		InnerExtension: innerExt,
		Compressed:     compressed,
		Format:         format,
		Hint:           formatHint(format),
		HugeHint:       !compressed && info.Size() > indexer.MaxIndexedBytes,
	})
}

func revealFile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	path := r.URL.Query().Get("path")
	if path == "" {
		http.Error(w, "path param required", http.StatusBadRequest)
		return
	}
	abs, err := resolveLogPath(path)
	if err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}
	if err := revealPath(abs); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, struct {
		OK bool `json:"ok"`
	}{true})
}

func revealPath(path string) error {
	name, args := revealCommand(runtime.GOOS, path)
	if name == "" {
		return errors.New("opening the containing folder is not supported on this platform")
	}
	return exec.Command(name, args...).Start()
}

func revealCommand(goos string, path string) (string, []string) {
	switch goos {
	case "windows":
		return "explorer.exe", []string{"/select," + path}
	case "darwin":
		return "open", []string{"-R", path}
	case "linux":
		return "xdg-open", []string{pathpkg.Dir(filepath.ToSlash(path))}
	default:
		return "", nil
	}
}

func fileExtensions(path string) (ext string, innerExt string, compressed bool) {
	ext = strings.ToLower(filepath.Ext(path))
	if ext == ".gz" {
		compressed = true
		innerExt = strings.ToLower(filepath.Ext(strings.TrimSuffix(path, ext)))
	}
	return ext, innerExt, compressed
}

func detectFileFormat(ext string, innerExt string) string {
	e := ext
	if innerExt != "" {
		e = innerExt
	}
	switch e {
	case ".html", ".htm":
		return "HTML"
	case ".json":
		return "JSON"
	case ".jsonl", ".ndjson":
		return "JSONL"
	case ".xml":
		return "XML"
	case ".csv":
		return "CSV"
	case ".tsv":
		return "TSV"
	case ".log":
		return "Log"
	case ".txt":
		return "Text"
	case ".md":
		return "Markdown"
	case ".js":
		return "JavaScript"
	case ".css":
		return "CSS"
	default:
		if e == "" {
			return "Text"
		}
		return strings.TrimPrefix(strings.ToUpper(e), ".")
	}
}

func formatHint(format string) string {
	switch format {
	case "JSONL":
		return "line-delimited records"
	case "JSON":
		return "structured document"
	case "XML":
		return "structured markup"
	case "CSV", "TSV":
		return "table data"
	case "HTML":
		return "rendered log"
	case "Log", "Text":
		return "plain text"
	default:
		return ""
	}
}

func openFile(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if path == "" {
		http.Error(w, "path param required", 400)
		return
	}
	abs, err := resolveLogPath(path)
	if err != nil {
		http.Error(w, err.Error(), 403)
		return
	}
	f, err := indexer.Open(abs)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	mu.Lock()
	if current != nil {
		_ = current.Close()
	}
	current = f
	mu.Unlock()
	writeJSON(w, struct {
		Lines     int    `json:"Lines"`
		Size      int64  `json:"Size"`
		Mode      string `json:"Mode"`
		ChunkSize int64  `json:"ChunkSize,omitempty"`
	}{f.Lines, f.Size, f.Mode, f.ChunkSize})
}

func chunk(w http.ResponseWriter, r *http.Request) {
	mu.RLock()
	f := current
	if f == nil {
		mu.RUnlock()
		http.Error(w, "no file", 400)
		return
	}
	start := atoi(r.URL.Query().Get("start"))
	count := atoi(r.URL.Query().Get("count"))
	if count <= 0 {
		count = 400
	}
	if f.Lines == 0 {
		mu.RUnlock()
		writeJSON(w, []string{})
		return
	}
	lines, err := f.LinesSlice(start, count)
	mu.RUnlock()
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeJSON(w, lines)
}

type textWindowLine struct {
	Offset int64  `json:"offset"`
	Text   string `json:"text"`
	Tone   string `json:"tone,omitempty"`
}

type textWindowResp struct {
	Offset     int64            `json:"offset"`
	PrevOffset int64            `json:"prevOffset"`
	NextOffset int64            `json:"nextOffset"`
	Size       int64            `json:"size"`
	Limit      int64            `json:"limit"`
	Lines      []textWindowLine `json:"lines"`
	Truncated  bool             `json:"truncated"`
}

type hugeSearchItem struct {
	Offset int64  `json:"offset"`
	Text   string `json:"text"`
	Tone   string `json:"tone,omitempty"`
}

type hugeSearchResp struct {
	Matches      []int            `json:"Matches"`
	Offsets      []int64          `json:"Offsets"`
	Items        []hugeSearchItem `json:"Items"`
	ScannedBytes int64            `json:"ScannedBytes"`
	NextOffset   int64            `json:"NextOffset"`
	More         bool             `json:"More"`
}

func textWindow(w http.ResponseWriter, r *http.Request) {
	mu.RLock()
	f := current
	if f == nil {
		mu.RUnlock()
		http.Error(w, "no file", http.StatusBadRequest)
		return
	}
	if f.Mode != indexer.ModeByte {
		mu.RUnlock()
		http.Error(w, "window mode is only available for huge files", http.StatusBadRequest)
		return
	}

	offset := clampInt64(atoi64(r.URL.Query().Get("offset")), 0, f.Size)
	limit := atoi64(r.URL.Query().Get("limit"))
	if limit <= 0 {
		limit = hugeWindowBytes
	}
	if limit > hugeMaxWindowBytes {
		limit = hugeMaxWindowBytes
	}
	align := r.URL.Query().Get("align") != "0"
	tail := r.URL.Query().Get("tail") == "1"
	resp, err := readTextWindow(f, offset, limit, align, tail)
	mu.RUnlock()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, resp)
}

func rawWindow(w http.ResponseWriter, r *http.Request) {
	mu.RLock()
	f := current
	if f == nil {
		mu.RUnlock()
		http.Error(w, "no file", http.StatusBadRequest)
		return
	}
	if f.Mode != indexer.ModeByte {
		mu.RUnlock()
		http.Error(w, "raw window mode is only available for huge files", http.StatusBadRequest)
		return
	}
	defer mu.RUnlock()

	offset := clampInt64(atoi64(r.URL.Query().Get("offset")), 0, f.Size)
	limit := atoi64(r.URL.Query().Get("limit"))
	if limit <= 0 {
		limit = hugeWindowBytes
	}
	if limit > hugeMaxWindowBytes {
		limit = hugeMaxWindowBytes
	}
	if remaining := f.Size - offset; limit > remaining {
		limit = remaining
	}
	reader := io.NewSectionReader(f.File, offset, limit)

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	if _, err := io.Copy(w, reader); err != nil {
		log.Printf("raw window copy failed: %v", err)
	}
}

func raw(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if path == "" {
		http.Error(w, "path param required", 400)
		return
	}
	if !filepath.IsAbs(path) {
		path = filepath.Join(rootDir, path)
	}
	abs, _ := filepath.Abs(path)
	abs, _ = filepath.EvalSymlinks(abs)
	if !withinRoot(abs) {
		http.Error(w, "path outside root", 403)
		return
	}
	if indexer.IsGzipPath(abs) && r.Method != http.MethodHead {
		tempPath, cleanup, err := indexer.DecompressGzipToTemp(abs)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer cleanup()
		http.ServeFile(w, r, tempPath)
		return
	}
	http.ServeFile(w, r, abs)
}

func searchLines(w http.ResponseWriter, r *http.Request) {
	mu.RLock()
	f := current
	if f == nil {
		mu.RUnlock()
		http.Error(w, "open a file first", 400)
		return
	}
	q := r.URL.Query().Get("q")
	if q == "" {
		mu.RUnlock()
		http.Error(w, "q param required", 400)
		return
	}
	limit := atoi(r.URL.Query().Get("limit"))
	if limit <= 0 {
		limit = 500
	}
	matcher, err := newTextMatcher(
		q,
		r.URL.Query().Get("regex") == "1",
		r.URL.Query().Get("case") == "1",
	)
	if err != nil {
		mu.RUnlock()
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if f.Mode == indexer.ModeByte {
		resp, err := searchHugeFile(r, f, matcher, limit)
		mu.RUnlock()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, resp)
		return
	}
	matches := make([]int, 0, limit)
	total := 0
	for g := 0; g*indexer.Group < f.Lines; g++ {
		start := g * indexer.Group
		lines, err := f.LinesSlice(start, indexer.Group)
		if err != nil {
			break
		}
		for i, ln := range lines {
			if matcher(ln) {
				total++
				if len(matches) < limit {
					matches = append(matches, start+i)
				}
			}
		}
	}
	mu.RUnlock()
	writeJSON(w, struct {
		Matches []int `json:"Matches"`
		Total   int   `json:"Total"`
	}{matches, total})
}

func newTextMatcher(q string, regexMode bool, caseSensitive bool) (func(string) bool, error) {
	if regexMode {
		pattern := q
		if !caseSensitive {
			pattern = "(?i)" + pattern
		}
		re, err := regexp.Compile(pattern)
		if err != nil {
			return nil, fmt.Errorf("invalid regex: %w", err)
		}
		return re.MatchString, nil
	}
	if caseSensitive {
		return func(text string) bool {
			return strings.Contains(text, q)
		}, nil
	}
	needle := strings.ToLower(q)
	return func(text string) bool {
		return strings.Contains(strings.ToLower(text), needle)
	}, nil
}

var (
	htmlScriptRe = regexp.MustCompile(`(?is)<script[^>]*>.*?</script>`)
	htmlStyleRe  = regexp.MustCompile(`(?is)<style[^>]*>.*?</style>`)
	htmlBreakRe  = regexp.MustCompile(`(?i)<br\s*/?>|</(?:p|div|tr|li|h[1-6]|font)>`)
	htmlTagRe    = regexp.MustCompile(`(?s)<[^>]*>`)
	errorToneRe  = regexp.MustCompile(`(?i)\b(fatal|panic|exception|error|failed|failure|severe|denied|timeout)\b`)
	warnToneRe   = regexp.MustCompile(`(?i)\b(warn|warning|retry|skipped|threshold)\b`)
	okToneRe     = regexp.MustCompile(`(?i)\b(success|succeeded|complete|completed|ok)\b`)
	infoToneRe   = regexp.MustCompile(`(?i)\b(info|debug|trace|started|processing)\b`)
)

func readTextWindow(f *indexer.File, offset, limit int64, align bool, tail bool) (textWindowResp, error) {
	start := clampInt64(offset, 0, f.Size)
	if tail {
		start = clampInt64(start-limit, 0, f.Size)
	}
	if align {
		start = lineStartAtOrBefore(f, start)
	}
	lines, next, truncated, err := scanCleanRows(f, start, limit, hugeWindowMaxRows, nil, tail)
	if err != nil {
		return textWindowResp{}, err
	}
	if next <= start && start < f.Size {
		next = clampInt64(start+limit, 0, f.Size)
	}
	return textWindowResp{
		Offset:     start,
		PrevOffset: clampInt64(start-limit, 0, f.Size),
		NextOffset: clampInt64(next, 0, f.Size),
		Size:       f.Size,
		Limit:      limit,
		Lines:      lines,
		Truncated:  truncated,
	}, nil
}

func searchHugeFile(r *http.Request, f *indexer.File, matcher func(string) bool, limit int) (hugeSearchResp, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	offset := lineStartAtOrBefore(f, clampInt64(atoi64(r.URL.Query().Get("offset")), 0, f.Size))
	maxBytes := atoi64(r.URL.Query().Get("maxBytes"))
	if maxBytes <= 0 {
		maxBytes = hugeSearchBytes
	}
	if maxBytes > 2<<30 {
		maxBytes = 2 << 30
	}
	items := make([]hugeSearchItem, 0, limit)
	lines, next, truncated, err := scanCleanRows(f, offset, maxBytes, limit, func(_ []byte, text string) bool {
		return matcher(text)
	}, false)
	if err != nil {
		return hugeSearchResp{}, err
	}
	offsets := make([]int64, 0, len(lines))
	for _, line := range lines {
		items = append(items, hugeSearchItem{
			Offset: line.Offset,
			Text:   line.Text,
			Tone:   line.Tone,
		})
		offsets = append(offsets, line.Offset)
	}
	return hugeSearchResp{
		Matches:      []int{},
		Offsets:      offsets,
		Items:        items,
		ScannedBytes: next - offset,
		NextOffset:   clampInt64(next, 0, f.Size),
		More:         truncated && next < f.Size,
	}, nil
}

func scanCleanRows(f *indexer.File, offset, limit int64, maxRows int, keep func([]byte, string) bool, tail bool) ([]textWindowLine, int64, bool, error) {
	if offset >= f.Size {
		return []textWindowLine{}, f.Size, false, nil
	}
	readLimit := limit + hugeMaxLineBytes
	if readLimit < limit {
		readLimit = limit
	}
	if remaining := f.Size - offset; readLimit > remaining {
		readLimit = remaining
	}

	sr := io.NewSectionReader(f.File, offset, readLimit)
	r := bufio.NewReaderSize(sr, 1<<20)
	rows := make([]textWindowLine, 0, 512)
	current := offset
	lineOffset := offset
	raw := make([]byte, 0, 16<<10)

	flush := func() {
		if len(raw) == 0 || (!tail && len(rows) >= maxRows) {
			raw = raw[:0]
			return
		}
		for _, row := range cleanLogRows(raw, lineOffset) {
			if keep != nil && !keep(raw, row.Text) {
				continue
			}
			rows = append(rows, row)
			if tail && len(rows) > maxRows {
				copy(rows, rows[len(rows)-maxRows:])
				rows = rows[:maxRows]
			}
			if !tail && len(rows) >= maxRows {
				break
			}
		}
		raw = raw[:0]
	}

	for current-offset < readLimit && (tail || len(rows) < maxRows) {
		part, err := r.ReadSlice('\n')
		if len(part) > 0 {
			raw = append(raw, part...)
			current += int64(len(part))
		}
		if err == bufio.ErrBufferFull {
			if len(raw) >= 64<<10 {
				flush()
				lineOffset = current
				if current-offset >= limit {
					break
				}
			}
			continue
		}
		if err != nil && err != io.EOF {
			return nil, current, false, err
		}
		flush()
		lineOffset = current
		if err == io.EOF || current-offset >= limit {
			break
		}
	}
	if len(raw) > 0 && len(rows) < maxRows {
		flush()
	}

	return rows, current, current < f.Size, nil
}

func cleanLogRows(raw []byte, baseOffset int64) []textWindowLine {
	s := string(raw)
	rows := make([]textWindowLine, 0, 16)
	appendSegment := func(segment string, offset int64) {
		cleaned := cleanLogText(segment)
		for _, part := range strings.Split(cleaned, "\n") {
			part = strings.TrimRight(part, " \t\r")
			if strings.TrimSpace(part) == "" {
				continue
			}
			rows = append(rows, textWindowLine{
				Offset: offset,
				Text:   part,
				Tone:   detectLogTone(segment, part),
			})
		}
	}

	matches := htmlBreakRe.FindAllStringIndex(s, -1)
	if len(matches) == 0 {
		appendSegment(s, baseOffset)
		return rows
	}

	start := 0
	for _, match := range matches {
		end := match[1]
		appendSegment(s[start:end], baseOffset+int64(start))
		start = end
	}
	if start < len(s) {
		appendSegment(s[start:], baseOffset+int64(start))
	}
	return rows
}

func cleanLogText(s string) string {
	s = strings.ReplaceAll(s, "\x00", "")
	s = strings.TrimPrefix(s, "\ufeff")
	s = strings.TrimPrefix(s, "\u00ef\u00bb\u00bf")
	s = htmlScriptRe.ReplaceAllString(s, " ")
	s = htmlStyleRe.ReplaceAllString(s, " ")
	s = htmlBreakRe.ReplaceAllString(s, "\n")
	s = htmlTagRe.ReplaceAllString(s, "")
	s = htmlstd.UnescapeString(s)
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")
	return s
}

func detectLogTone(raw, text string) string {
	lowerRaw := strings.ToLower(raw)
	switch {
	case strings.Contains(lowerRaw, "color=\"red") ||
		strings.Contains(lowerRaw, "color='red") ||
		strings.Contains(lowerRaw, "color:red") ||
		strings.Contains(lowerRaw, "color: red") ||
		strings.Contains(lowerRaw, "#ff0000") ||
		strings.Contains(lowerRaw, "#f00"):
		return "error"
	case strings.Contains(lowerRaw, "color=\"orange") ||
		strings.Contains(lowerRaw, "color='orange") ||
		strings.Contains(lowerRaw, "color=\"yellow") ||
		strings.Contains(lowerRaw, "color='yellow") ||
		strings.Contains(lowerRaw, "color:orange") ||
		strings.Contains(lowerRaw, "color: orange") ||
		strings.Contains(lowerRaw, "color:yellow") ||
		strings.Contains(lowerRaw, "color: yellow"):
		return "warn"
	case strings.Contains(lowerRaw, "color=\"green") ||
		strings.Contains(lowerRaw, "color='green") ||
		strings.Contains(lowerRaw, "color:green") ||
		strings.Contains(lowerRaw, "color: green"):
		return "ok"
	case strings.Contains(lowerRaw, "color=\"blue") ||
		strings.Contains(lowerRaw, "color='blue") ||
		strings.Contains(lowerRaw, "color:blue") ||
		strings.Contains(lowerRaw, "color: blue") ||
		strings.Contains(lowerRaw, "color=\"gray") ||
		strings.Contains(lowerRaw, "color='gray"):
		return "info"
	case errorToneRe.MatchString(text):
		return "error"
	case warnToneRe.MatchString(text):
		return "warn"
	case okToneRe.MatchString(text):
		return "ok"
	case infoToneRe.MatchString(text):
		return "info"
	default:
		return ""
	}
}

func lineStartAtOrBefore(f *indexer.File, offset int64) int64 {
	if offset <= 0 {
		return 0
	}
	if offset > f.Size {
		offset = f.Size
	}
	pos := offset
	searched := int64(0)
	buf := make([]byte, 64<<10)
	for pos > 0 && searched < hugeMaxLineBytes {
		n := int64(len(buf))
		if pos < n {
			n = pos
		}
		if remaining := hugeMaxLineBytes - searched; remaining < n {
			n = remaining
		}
		start := pos - n
		readBuf := buf[:int(n)]
		_, err := f.File.ReadAt(readBuf, start)
		if err != nil && err != io.EOF {
			return offset
		}
		for i := len(readBuf) - 1; i >= 0; i-- {
			if readBuf[i] == '\n' {
				return start + int64(i) + 1
			}
		}
		pos = start
		searched += n
	}
	return pos
}

func getRoot(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, struct{ Path string }{rootDir})
}

func setRoot(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req struct{ Path string }
	if json.NewDecoder(r.Body).Decode(&req) != nil || req.Path == "" {
		http.Error(w, "bad json", 400)
		return
	}
	info, err := os.Stat(req.Path)
	if err != nil || !info.IsDir() {
		http.Error(w, "folder not found", 400)
		return
	}
	abs, _ := filepath.Abs(req.Path)
	mu.Lock()
	if current != nil {
		_ = current.Close()
		current = nil
	}
	rootDir = abs
	mu.Unlock()
	writeJSON(w, struct{ Path string }{rootDir})
}

func rangeLines(w http.ResponseWriter, r *http.Request) {
	mu.RLock()
	f := current
	if f == nil {
		mu.RUnlock()
		http.Error(w, "no file", 400)
		return
	}

	start := atoi(r.URL.Query().Get("start"))
	end := atoi(r.URL.Query().Get("end"))
	count := atoi(r.URL.Query().Get("count"))
	if count > 0 && end == 0 {
		end = start + count
	}
	if start < 0 {
		start = 0
	}
	if end <= 0 || end > f.Lines {
		end = f.Lines
	}
	if end < start {
		end = start
	}

	name := r.URL.Query().Get("name")
	if name == "" {
		name = fmt.Sprintf("lines_%d-%d.txt", start+1, end)
	}
	if r.URL.Query().Get("download") == "1" {
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", name))
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")

	err := f.WriteRange(w, start, end)
	mu.RUnlock()
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func resolveLogPath(path string) (string, error) {
	if !filepath.IsAbs(path) {
		path = filepath.Join(rootDir, path)
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	abs, err = filepath.EvalSymlinks(abs)
	if err != nil {
		return "", err
	}
	if !withinRoot(abs) {
		return "", errors.New("path outside root")
	}
	return abs, nil
}

func atoi(s string) int {
	var n int
	fmt.Sscanf(s, "%d", &n)
	return n
}

func atoi64(s string) int64 {
	n, _ := strconv.ParseInt(strings.TrimSpace(s), 10, 64)
	return n
}

func clampInt64(n, min, max int64) int64 {
	if n < min {
		return min
	}
	if n > max {
		return max
	}
	return n
}

func withinRoot(abs string) bool {
	rootReal, err := filepath.EvalSymlinks(rootDir)
	if err != nil {
		return false
	}
	pathReal, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return false
	}
	rel, err := filepath.Rel(rootReal, pathReal)
	if err != nil {
		return false
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return false
	}
	return true
}

func isTextBySniff(p string) bool {
	f, err := os.Open(p)
	if err != nil {
		return false
	}
	defer f.Close()
	buf := make([]byte, 512)
	n, _ := f.Read(buf)
	if n == 0 {
		return true
	}
	ctype := http.DetectContentType(buf[:n])
	if strings.HasPrefix(ctype, "text/") {
		return true
	}
	if strings.Contains(ctype, "json") || strings.Contains(ctype, "xml") || strings.Contains(ctype, "javascript") {
		return true
	}
	if bytes.IndexByte(buf[:n], 0x00) >= 0 {
		return false
	}
	return true
}

func getAuth(r *http.Request) (string, error) {
	auth := r.Header.Get("Authorization")
	if auth == "" {
		if t := strings.TrimSpace(r.URL.Query().Get("token")); t != "" {
			if strings.HasPrefix(strings.ToLower(t), "bearer ") {
				auth = t
			} else {
				auth = "Bearer " + t
			}
		}
	}
	if auth == "" {
		return "", errors.New("missing bearer token")
	}
	return auth, nil
}

func extractNextPageToken(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if strings.Contains(raw, "page[token]") || strings.Contains(raw, "=") || strings.Contains(raw, "&") {
		if !strings.HasPrefix(raw, "?") {
			raw = "?" + raw
		}
		u, err := url.Parse(raw)
		if err == nil {
			if token := strings.TrimSpace(u.Query().Get("page[token]")); token != "" {
				return token
			}
		}
	}
	return raw
}

func idhubJobs(w http.ResponseWriter, r *http.Request) {
	proxy, err := resolveIDHubProxyContext(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	source := strings.TrimSpace(r.URL.Query().Get("sourceId"))
	sink := strings.TrimSpace(r.URL.Query().Get("sinkId"))
	next := strings.TrimSpace(r.URL.Query().Get("next"))
	page := strings.TrimSpace(r.URL.Query().Get("page"))
	if page == "" {
		page = "0"
	}
	size := strings.TrimSpace(r.URL.Query().Get("size"))
	if size == "" {
		size = "20"
	}

	switch {
	case source == "" && sink == "":
		http.Error(w, "sourceId or sinkId is required", http.StatusBadRequest)
		return
	case source != "" && sink != "":
		http.Error(w, "provide either sourceId or sinkId, not both", http.StatusBadRequest)
		return
	}

	params := url.Values{}
	if source != "" {
		params.Set("sourceId", source)
	}
	if sink != "" {
		params.Set("sinkId", sink)
	}
	if token := extractNextPageToken(next); token != "" {
		params.Set("page[token]", token)
	} else {
		params.Set("page[size]", size)
		if sink == "" {
			params.Set("page[number]", page)
		}
	}

	u := fmt.Sprintf("%s/v1/tenants/%s/jobs?%s",
		proxy.Base,
		url.PathEscape(proxy.Tenant),
		params.Encode(),
	)

	req, _ := http.NewRequest(http.MethodGet, u, nil)
	req.Header.Set("Authorization", proxy.Auth)
	req.Header.Set("Accept", "application/json,text/plain")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		http.Error(w, "upstream error", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	w.Header().Set("Content-Type", resp.Header.Get("Content-Type"))
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

var safeRe = regexp.MustCompile(`[^a-zA-Z0-9._-]+`)

func sanitize(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return "x"
	}
	return safeRe.ReplaceAllString(s, "_")
}

func idhubLog(w http.ResponseWriter, r *http.Request) {
	proxy, err := resolveIDHubProxyContext(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	jobID := strings.TrimSpace(r.URL.Query().Get("job"))
	if jobID == "" {
		http.Error(w, "job is required", http.StatusBadRequest)
		return
	}
	pageSize := idhubLogPageSize(r.URL.Query().Get("size"))
	maxPages := idhubLogMaxPages(r.URL.Query().Get("maxPages"))

	relDir := filepath.Join("idhub", sanitize(proxy.Tenant), "jobs")
	absDir := filepath.Join(rootDir, relDir)
	_ = os.MkdirAll(absDir, 0o755)
	fileName := sanitize(jobID) + ".log"
	absPath := filepath.Join(absDir, fileName)
	tmp, err := os.CreateTemp(absDir, fileName+".*.download")
	if err != nil {
		http.Error(w, "failed to create log file", http.StatusInternalServerError)
		return
	}
	tmpPath := tmp.Name()
	complete := false
	defer func() {
		if !complete {
			_ = os.Remove(tmpPath)
		}
	}()

	client := &http.Client{Timeout: 5 * time.Minute}
	var totalBytes int64
	var pages int
	var firstHash []byte
	var firstBytes int64
	var truncated bool

	for page := 0; page < maxPages; page++ {
		req, err := newIDHubLogRequest(r, proxy, jobID, pageSize, page)
		if err != nil {
			_ = tmp.Close()
			http.Error(w, "failed to build upstream request", http.StatusInternalServerError)
			return
		}
		resp, err := client.Do(req)
		if err != nil {
			_ = tmp.Close()
			http.Error(w, "upstream error", http.StatusBadGateway)
			return
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			if page > 0 && totalBytes > 0 && (resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusRequestedRangeNotSatisfiable) {
				_, _ = io.Copy(io.Discard, resp.Body)
				resp.Body.Close()
				break
			}
			_ = tmp.Close()
			defer resp.Body.Close()
			if page == 0 {
				w.Header().Set("Content-Type", resp.Header.Get("Content-Type"))
				w.WriteHeader(resp.StatusCode)
				_, _ = io.Copy(w, resp.Body)
				return
			}
			body, _ := io.ReadAll(resp.Body)
			http.Error(w, fmt.Sprintf("failed to load IDHub log page %d: %s", page, strings.TrimSpace(string(body))), http.StatusBadGateway)
			return
		}

		hasher := sha256.New()
		n, copyErr := io.Copy(io.MultiWriter(tmp, hasher), resp.Body)
		resp.Body.Close()
		if copyErr != nil {
			_ = tmp.Close()
			http.Error(w, "failed to write log file", http.StatusInternalServerError)
			return
		}

		sum := hasher.Sum(nil)
		if page == 0 {
			firstBytes = n
			firstHash = append([]byte(nil), sum...)
		} else if n == firstBytes && bytes.Equal(sum, firstHash) {
			_ = tmp.Close()
			http.Error(w, "IDHub returned the same log page twice; refusing to save a repeated partial log", http.StatusBadGateway)
			return
		}

		totalBytes += n
		pages++
		if n < pageSize || n == 0 {
			break
		}
		if page == maxPages-1 {
			truncated = true
		}
	}

	if err := tmp.Close(); err != nil {
		http.Error(w, "failed to finish log file", http.StatusInternalServerError)
		return
	}
	_ = os.Remove(absPath)
	if err := os.Rename(tmpPath, absPath); err != nil {
		http.Error(w, "failed to save log file", http.StatusInternalServerError)
		return
	}
	complete = true

	writeJSON(w, map[string]any{
		"path":      filepath.ToSlash(filepath.Join(relDir, fileName)),
		"bytes":     totalBytes,
		"pages":     pages,
		"truncated": truncated,
	})
}

func idhubLogPageSize(raw string) int64 {
	size := atoi64(raw)
	if size <= 0 {
		return idhubLogDefaultPageSize
	}
	if size > idhubLogMaxPageSize {
		return idhubLogMaxPageSize
	}
	return size
}

func idhubLogMaxPages(raw string) int {
	n := atoi(raw)
	if n <= 0 || n > idhubLogDefaultMaxPages {
		return idhubLogDefaultMaxPages
	}
	return n
}

func newIDHubLogRequest(r *http.Request, proxy idhubProxyContext, jobID string, pageSize int64, page int) (*http.Request, error) {
	params := url.Values{}
	params.Set("page[size]", strconv.FormatInt(pageSize, 10))
	params.Set("page[number]", strconv.Itoa(page))
	u := fmt.Sprintf("%s/v1/tenants/%s/jobs/%s/logs?%s",
		proxy.Base,
		url.PathEscape(proxy.Tenant),
		url.PathEscape(jobID),
		params.Encode(),
	)
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", proxy.Auth)
	req.Header.Set("Accept", "text/plain,application/json")
	return req, nil
}
