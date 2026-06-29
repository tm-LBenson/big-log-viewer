package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tm-LBenson/big-log-viewer/internal/indexer"
)

func TestReadTextWindowCleansHugeHTMLLog(t *testing.T) {
	raw := strings.Join([]string{
		"\ufeff<html><body><pre>",
		`<font color="blue">2026/06/23 10:00:00 INFO Started &amp; ready</font>`,
		`<font color="red">2026/06/23 10:00:01 ERROR Needle failed</font>`,
		"</pre></body></html>",
	}, "\n")
	path := filepath.Join(t.TempDir(), "huge.html")
	if err := os.WriteFile(path, []byte(raw), 0o600); err != nil {
		t.Fatal(err)
	}
	handle, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer handle.Close()

	f := &indexer.File{
		Path: path,
		File: handle,
		Size: int64(len(raw)),
		Mode: indexer.ModeByte,
	}

	window, err := readTextWindow(f, 0, 1024, false, false)
	if err != nil {
		t.Fatal(err)
	}

	joined := ""
	for _, line := range window.Lines {
		joined += line.Text + "\n"
	}
	if strings.Contains(joined, "<font") || strings.Contains(joined, "</html>") {
		t.Fatalf("window still contains raw HTML tags: %q", joined)
	}
	if strings.Contains(joined, "\ufeff") || strings.Contains(joined, "\u00ef\u00bb\u00bf") {
		t.Fatalf("window still contains a byte order marker: %q", joined)
	}
	if !strings.Contains(joined, "Started & ready") {
		t.Fatalf("window did not decode text content: %q", joined)
	}
	if !strings.Contains(joined, "Needle failed") {
		t.Fatalf("window did not include later log text: %q", joined)
	}
	var foundInfo, foundError bool
	for _, line := range window.Lines {
		if strings.Contains(line.Text, "Started") && line.Tone == "info" {
			foundInfo = true
		}
		if strings.Contains(line.Text, "Needle failed") && line.Tone == "error" {
			foundError = true
		}
	}
	if !foundInfo || !foundError {
		t.Fatalf("window did not preserve expected row tones: %#v", window.Lines)
	}
}

func TestHugeSearchRowsKeepNearMatchOffsets(t *testing.T) {
	entry := `<font color="blue">2026/06/23 10:00:00 INFO Processing account output &amp; checkpoint</font>`
	needle := `<font color="red">2026/06/23 10:00:01 ERROR Needle failed here &amp; decoded</font>`
	raw := "<html><body><pre>" + strings.Repeat(entry, 20000) + needle + "</pre></body></html>"
	path := filepath.Join(t.TempDir(), "huge.html")
	if err := os.WriteFile(path, []byte(raw), 0o600); err != nil {
		t.Fatal(err)
	}
	handle, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer handle.Close()

	f := &indexer.File{
		Path: path,
		File: handle,
		Size: int64(len(raw)),
		Mode: indexer.ModeByte,
	}

	rows, _, _, err := scanCleanRows(f, 0, f.Size, 1, func(_ []byte, text string) bool {
		return strings.Contains(text, "Needle failed here")
	}, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected one search row, got %d", len(rows))
	}
	needleAt := int64(strings.Index(raw, "Needle failed here"))
	if rows[0].Offset <= 0 || rows[0].Offset > needleAt {
		t.Fatalf("row offset %d should be before needle at %d", rows[0].Offset, needleAt)
	}
	if delta := needleAt - rows[0].Offset; delta > 256 {
		t.Fatalf("row offset %d is too far from needle at %d", rows[0].Offset, needleAt)
	}
}

func TestReadTextWindowTailKeepsEndRows(t *testing.T) {
	entry := `<font color="blue">2026/06/23 10:00:00 INFO Processing account output &amp; checkpoint</font>`
	tail := `<font color="green">2026/06/23 10:00:02 INFO Tail marker at end &amp; decoded</font>`
	raw := "<html><body><pre>" + strings.Repeat(entry, hugeWindowMaxRows+500) + tail + "</pre></body></html>"
	path := filepath.Join(t.TempDir(), "tail.html")
	if err := os.WriteFile(path, []byte(raw), 0o600); err != nil {
		t.Fatal(err)
	}
	handle, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer handle.Close()

	f := &indexer.File{
		Path: path,
		File: handle,
		Size: int64(len(raw)),
		Mode: indexer.ModeByte,
	}

	window, err := readTextWindow(f, f.Size, f.Size, false, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(window.Lines) != hugeWindowMaxRows {
		t.Fatalf("expected capped tail rows, got %d", len(window.Lines))
	}
	joined := ""
	for _, line := range window.Lines[len(window.Lines)-10:] {
		joined += line.Text + "\n"
	}
	if !strings.Contains(joined, "Tail marker at end & decoded") {
		t.Fatalf("tail window did not keep the final row: %q", joined)
	}
}

func TestShouldIncludeCompressedSupportedExt(t *testing.T) {
	allowed := map[string]struct{}{".html": {}}
	if !shouldIncludeFile("sample.html.gz", allowed, false) {
		t.Fatal("expected compressed html file to be included")
	}
	if shouldIncludeFile("sample.zip.gz", allowed, false) {
		t.Fatal("expected unsupported compressed extension to be excluded")
	}
}

func TestDefaultExtensionsIncludeJSONL(t *testing.T) {
	exts := normalizeExts(defaultExt)
	found := false
	for _, ext := range exts {
		if ext == ".jsonl" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("default extensions should include .jsonl")
	}
}

func TestNewTextMatcherHonorsRegexAndCase(t *testing.T) {
	matcher, err := newTextMatcher("alpha", false, false)
	if err != nil {
		t.Fatal(err)
	}
	if !matcher("Alpha") {
		t.Fatal("case-insensitive literal search did not match")
	}

	matcher, err = newTextMatcher("alpha", false, true)
	if err != nil {
		t.Fatal(err)
	}
	if matcher("Alpha") {
		t.Fatal("case-sensitive literal search matched different case")
	}

	matcher, err = newTextMatcher(`err.*42`, true, false)
	if err != nil {
		t.Fatal(err)
	}
	if !matcher("ERROR code 42") {
		t.Fatal("case-insensitive regex search did not match")
	}

	if _, err := newTextMatcher("[", true, false); err == nil {
		t.Fatal("invalid regex did not return an error")
	}
}

func TestListDirDetailsIncludesMetadata(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "sample.html"), []byte("hello\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	oldRoot := rootDir
	rootDir = dir
	setExtensions(defaultExt, "replace")
	t.Cleanup(func() {
		rootDir = oldRoot
		setExtensions(defaultExt, "replace")
	})

	req := httptest.NewRequest("GET", "/api/list?details=1", nil)
	rr := httptest.NewRecorder()
	listDir(rr, req)

	if rr.Code != 200 {
		t.Fatalf("status = %d, want 200; body=%s", rr.Code, rr.Body.String())
	}

	var resp struct {
		Files []struct {
			Path    string `json:"path"`
			Size    int64  `json:"size"`
			ModTime int64  `json:"modTime"`
		} `json:"files"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Files) != 1 {
		t.Fatalf("files = %d, want 1: %#v", len(resp.Files), resp.Files)
	}
	if resp.Files[0].Path != "sample.html" {
		t.Fatalf("path = %q, want sample.html", resp.Files[0].Path)
	}
	if resp.Files[0].Size != 6 {
		t.Fatalf("size = %d, want 6", resp.Files[0].Size)
	}
	if resp.Files[0].ModTime <= 0 {
		t.Fatalf("modTime = %d, want positive", resp.Files[0].ModTime)
	}
}

func TestFileInfoReportsCompressedFormat(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "sample.html.gz"), []byte("not a real gzip"), 0o600); err != nil {
		t.Fatal(err)
	}

	oldRoot := rootDir
	rootDir = dir
	t.Cleanup(func() {
		rootDir = oldRoot
	})

	req := httptest.NewRequest("GET", "/api/file-info?path=sample.html.gz", nil)
	rr := httptest.NewRecorder()
	fileInfo(rr, req)

	if rr.Code != 200 {
		t.Fatalf("status = %d, want 200; body=%s", rr.Code, rr.Body.String())
	}

	var resp fileInfoResp
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if resp.Path != "sample.html.gz" {
		t.Fatalf("path = %q, want sample.html.gz", resp.Path)
	}
	if !resp.Compressed {
		t.Fatal("expected compressed file")
	}
	if resp.Extension != ".gz" {
		t.Fatalf("extension = %q, want .gz", resp.Extension)
	}
	if resp.InnerExtension != ".html" {
		t.Fatalf("inner extension = %q, want .html", resp.InnerExtension)
	}
	if resp.Format != "HTML" {
		t.Fatalf("format = %q, want HTML", resp.Format)
	}
	if resp.Hint != "rendered log" {
		t.Fatalf("hint = %q, want rendered log", resp.Hint)
	}
	if resp.AbsPath == "" || resp.Directory == "" {
		t.Fatalf("expected absolute path metadata: %#v", resp)
	}
}

func TestFileInfoReportsJSONLHint(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "records.jsonl"), []byte(`{"ok":true}`+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	oldRoot := rootDir
	rootDir = dir
	t.Cleanup(func() {
		rootDir = oldRoot
	})

	req := httptest.NewRequest("GET", "/api/file-info?path=records.jsonl", nil)
	rr := httptest.NewRecorder()
	fileInfo(rr, req)

	if rr.Code != 200 {
		t.Fatalf("status = %d, want 200; body=%s", rr.Code, rr.Body.String())
	}

	var resp fileInfoResp
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if resp.Format != "JSONL" {
		t.Fatalf("format = %q, want JSONL", resp.Format)
	}
	if resp.Hint != "line-delimited records" {
		t.Fatalf("hint = %q, want line-delimited records", resp.Hint)
	}
}

func TestIDHubLogDownloadsAllPages(t *testing.T) {
	var requestedPages []string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.URL.Path; got != "/v1/tenants/t1/jobs/job-1/logs" {
			t.Fatalf("upstream path = %q", got)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer test-token" {
			t.Fatalf("authorization = %q", got)
		}
		page := r.URL.Query().Get("page[number]")
		requestedPages = append(requestedPages, page)
		switch page {
		case "0":
			_, _ = w.Write([]byte("abcde"))
		case "1":
			_, _ = w.Write([]byte("fg"))
		default:
			t.Fatalf("unexpected page %q", page)
		}
	}))
	defer upstream.Close()

	oldRoot := rootDir
	rootDir = t.TempDir()
	t.Cleanup(func() {
		rootDir = oldRoot
	})

	req := httptest.NewRequest("GET", "/api/idhub/log?base="+upstream.URL+"&tenant=t1&token=test-token&job=job-1&size=5", nil)
	rr := httptest.NewRecorder()
	idhubLog(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	if strings.Join(requestedPages, ",") != "0,1" {
		t.Fatalf("requested pages = %#v, want 0,1", requestedPages)
	}

	var resp struct {
		Path      string `json:"path"`
		Bytes     int64  `json:"bytes"`
		Pages     int    `json:"pages"`
		Truncated bool   `json:"truncated"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if resp.Path != "idhub/t1/jobs/job-1.log" {
		t.Fatalf("path = %q, want idhub/t1/jobs/job-1.log", resp.Path)
	}
	if resp.Bytes != 7 || resp.Pages != 2 || resp.Truncated {
		t.Fatalf("unexpected download metadata: %#v", resp)
	}
	body, err := os.ReadFile(filepath.Join(rootDir, filepath.FromSlash(resp.Path)))
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != "abcdefg" {
		t.Fatalf("downloaded log = %q, want abcdefg", body)
	}
}

func TestRevealCommand(t *testing.T) {
	name, args := revealCommand("windows", `C:\logs\sample.html`)
	if name != "explorer.exe" {
		t.Fatalf("windows command = %q, want explorer.exe", name)
	}
	if len(args) != 1 || args[0] != `/select,C:\logs\sample.html` {
		t.Fatalf("windows args = %#v", args)
	}

	name, args = revealCommand("darwin", "/tmp/sample.html")
	if name != "open" || len(args) != 2 || args[0] != "-R" || args[1] != "/tmp/sample.html" {
		t.Fatalf("darwin command = %q %#v", name, args)
	}

	name, args = revealCommand("linux", "/tmp/logs/sample.html")
	if name != "xdg-open" || len(args) != 1 || args[0] != "/tmp/logs" {
		t.Fatalf("linux command = %q %#v", name, args)
	}
}

func TestDetectLogToneFromText(t *testing.T) {
	tests := []struct {
		text string
		want string
	}{
		{"2026 ERROR request failed", "error"},
		{"WARN retrying account", "warn"},
		{"completed successfully", "ok"},
		{"INFO started job", "info"},
		{"plain row", ""},
	}
	for _, tt := range tests {
		if got := detectLogTone("", tt.text); got != tt.want {
			t.Fatalf("detectLogTone(%q) = %q, want %q", tt.text, got, tt.want)
		}
	}
}
