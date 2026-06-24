package main

import (
	"bufio"
	"bytes"
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
	"path/filepath"
	"regexp"
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

var (
	rootDir string
	current *indexer.File

	mu sync.RWMutex

	defaultExt = []string{
		".log", ".txt", ".html", ".htm", ".csv", ".tsv",
		".json", ".ndjson", ".xml", ".md", ".js", ".css",
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
	http.HandleFunc("/api/idhub/connect/token", idhubConnectToken)
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
	var out []string

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
			out = append(out, rel)
		}
		return nil
	})
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
	if allowAllText {
		return isTextBySniff(p)
	}
	return false
}

func openFile(w http.ResponseWriter, r *http.Request) {
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
	if f.Mode == indexer.ModeByte {
		resp, err := searchHugeFile(r, f, q, limit)
		mu.RUnlock()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, resp)
		return
	}
	needle := bytes.ToLower([]byte(q))
	matches := make([]int, 0, limit)
	for g := 0; g*indexer.Group < f.Lines && len(matches) < limit; g++ {
		start := g * indexer.Group
		lines, err := f.LinesSlice(start, indexer.Group)
		if err != nil {
			break
		}
		for i, ln := range lines {
			if bytes.Contains(bytes.ToLower([]byte(ln)), needle) {
				matches = append(matches, start+i)
				if len(matches) == limit {
					break
				}
			}
		}
	}
	mu.RUnlock()
	writeJSON(w, struct{ Matches []int }{matches})
}

var (
	htmlScriptRe = regexp.MustCompile(`(?is)<script[^>]*>.*?</script>`)
	htmlStyleRe  = regexp.MustCompile(`(?is)<style[^>]*>.*?</style>`)
	htmlBreakRe  = regexp.MustCompile(`(?i)<br\s*/?>|</(?:p|div|tr|li|h[1-6]|font)>`)
	htmlTagRe    = regexp.MustCompile(`(?s)<[^>]*>`)
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

func searchHugeFile(r *http.Request, f *indexer.File, q string, limit int) (hugeSearchResp, error) {
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

	needle := strings.ToLower(q)
	items := make([]hugeSearchItem, 0, limit)
	lines, next, truncated, err := scanCleanRows(f, offset, maxBytes, limit, func(_ []byte, text string) bool {
		return strings.Contains(strings.ToLower(text), needle)
	}, false)
	if err != nil {
		return hugeSearchResp{}, err
	}
	offsets := make([]int64, 0, len(lines))
	for _, line := range lines {
		items = append(items, hugeSearchItem{
			Offset: line.Offset,
			Text:   line.Text,
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
			rows = append(rows, textWindowLine{Offset: offset, Text: part})
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
	size := strings.TrimSpace(r.URL.Query().Get("size"))
	if size == "" {
		size = "5000000"
	}
	page := strings.TrimSpace(r.URL.Query().Get("page"))
	if page == "" {
		page = "0"
	}

	u := fmt.Sprintf("%s/v1/tenants/%s/jobs/%s/logs?page[size]=%s&page[number]=%s",
		proxy.Base,
		url.PathEscape(proxy.Tenant),
		url.PathEscape(jobID),
		url.QueryEscape(size),
		url.QueryEscape(page),
	)

	req, _ := http.NewRequest(http.MethodGet, u, nil)
	req.Header.Set("Authorization", proxy.Auth)
	req.Header.Set("Accept", "text/plain,application/json,text/plain")

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		http.Error(w, "upstream error", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		w.Header().Set("Content-Type", resp.Header.Get("Content-Type"))
		w.WriteHeader(resp.StatusCode)
		_, _ = io.Copy(w, resp.Body)
		return
	}

	relDir := filepath.Join("idhub", sanitize(proxy.Tenant), "jobs")
	absDir := filepath.Join(rootDir, relDir)
	_ = os.MkdirAll(absDir, 0o755)
	fileName := sanitize(jobID) + ".log"
	absPath := filepath.Join(absDir, fileName)
	f, err := os.Create(absPath)
	if err != nil {
		http.Error(w, "failed to create log file", http.StatusInternalServerError)
		return
	}
	defer f.Close()

	if _, err := io.Copy(f, resp.Body); err != nil {
		http.Error(w, "failed to write log file", http.StatusInternalServerError)
		return
	}

	writeJSON(w, map[string]any{
		"path": filepath.ToSlash(filepath.Join(relDir, fileName)),
	})
}
