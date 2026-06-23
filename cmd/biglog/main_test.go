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
