package main

import (
	"bytes"
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/tm-LBenson/big-log-viewer/internal/indexer"
)

const defaultRoot = "./logs"

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
	http.HandleFunc("/api/raw", raw)
	http.HandleFunc("/api/search", searchLines)
	http.HandleFunc("/api/root", getRoot)
	http.HandleFunc("/api/root/set", setRoot)
	http.HandleFunc("/api/range", rangeLines)
	http.HandleFunc("/api/extensions", extensionsHandler)

	fmt.Println("serving http://" + *addr)
	srv := &http.Server{
		Addr:         *addr,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
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
	writeJSON(w, struct{ Lines int }{f.Lines})
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
