package main

import (
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

	window, err := readTextWindow(f, 0, 1024, false)
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
}
