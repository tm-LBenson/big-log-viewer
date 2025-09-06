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
	"strings"
	"sync"

	"github.com/tm-LBenson/big-log-viewer/internal/indexer"
)

const defaultRoot = "./logs"

var (
	rootDir string
	current *indexer.File
	mu      sync.RWMutex
)

//go:embed dist/*
var dist embed.FS

func main() {
	flag.StringVar(&rootDir, "logdir", defaultRoot, "folder containing .html logs")
	flag.Parse()
	abs, _ := filepath.Abs(rootDir)
	rootDir = abs
	_ = os.MkdirAll(rootDir, 0o755)

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

	fmt.Println("serving http://localhost:8844")
	log.Fatal(http.ListenAndServe(":8844", nil))
}

func listDir(w http.ResponseWriter, r *http.Request) {
	var out []string
	filepath.WalkDir(rootDir, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if strings.HasSuffix(strings.ToLower(p), ".html") {
			rel, _ := filepath.Rel(rootDir, p)
			out = append(out, rel)
		}
		return nil
	})
	writeJSON(w, out)
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
	mu.RUnlock()
	if f == nil {
		http.Error(w, "no file", 400)
		return
	}
	start := atoi(r.URL.Query().Get("start"))
	count := atoi(r.URL.Query().Get("count"))
	if count == 0 {
		count = 400
	}
	lines, err := f.LinesSlice(start, count)
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
	if !withinRoot(abs) {
		http.Error(w, "path outside root", 403)
		return
	}
	http.ServeFile(w, r, abs)
}

func searchLines(w http.ResponseWriter, r *http.Request) {
	mu.RLock()
	f := current
	mu.RUnlock()
	if f == nil {
		http.Error(w, "open a file first", 400)
		return
	}
	q := r.URL.Query().Get("q")
	if q == "" {
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
		lines, _ := f.LinesSlice(start, indexer.Group)
		for i, ln := range lines {
			if bytes.Contains(bytes.ToLower([]byte(ln)), needle) {
				matches = append(matches, start+i)
				if len(matches) == limit {
					break
				}
			}
		}
	}
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
}

func rangeLines(w http.ResponseWriter, r *http.Request) {
	mu.RLock()
	f := current
	mu.RUnlock()
	if f == nil {
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

	if err := f.WriteRange(w, start, end); err != nil {
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
	rel, err := filepath.Rel(rootDir, abs)
	if err != nil {
		return false
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return false
	}
	return true
}
