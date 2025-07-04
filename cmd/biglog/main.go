package main

import (
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

	"github.com/tm-LBenson/big-log-viewer/internal/indexer"
)

const defaultRoot = "./logs"

var rootDir string
var current *indexer.File

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
	f, err := indexer.Open(path)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	current = f
	writeJSON(w, struct{ Lines int }{len(f.Offsets)})
}

func chunk(w http.ResponseWriter, r *http.Request) {
	if current == nil {
		http.Error(w, "no file", 400)
		return
	}
	start := atoi(r.URL.Query().Get("start"))
	count := atoi(r.URL.Query().Get("count"))
	if count == 0 {
		count = 400
	}
	lines, err := current.Lines(start, count)
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
	http.ServeFile(w, r, path)
}

func searchLines(w http.ResponseWriter, r *http.Request) {
	if current == nil {
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
	needle := strings.ToLower(q)
	m := make([]int, 0, limit)
	for i := range current.Offsets {
		if len(m) >= limit {
			break
		}
		line, _ := current.Lines(i, 1)
		if strings.Contains(strings.ToLower(line[0]), needle) {
			m = append(m, i)
		}
	}
	writeJSON(w, struct{ Matches []int }{m})
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
	if info, err := os.Stat(req.Path); err != nil || !info.IsDir() {
		http.Error(w, "folder not found", 400)
		return
	}
	abs, _ := filepath.Abs(req.Path)
	rootDir = abs
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
