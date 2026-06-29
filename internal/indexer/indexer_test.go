package indexer

import (
	"compress/gzip"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestOpenLineMode(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sample.log")
	if err := os.WriteFile(path, []byte("alpha\nbeta\ngamma\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	f, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()

	if f.Mode != ModeLine {
		t.Fatalf("mode = %q, want %q", f.Mode, ModeLine)
	}
	if f.Lines != 3 {
		t.Fatalf("lines = %d, want 3", f.Lines)
	}

	lines, err := f.LinesSlice(1, 2)
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(lines, ""); got != "beta\ngamma\n" {
		t.Fatalf("slice = %q", got)
	}
}

func TestOpenGzipLineMode(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sample.html.gz")
	handle, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	gz := gzip.NewWriter(handle)
	if _, err := gz.Write([]byte("alpha\nbeta\n")); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	if err := handle.Close(); err != nil {
		t.Fatal(err)
	}

	f, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}

	if f.Mode != ModeLine {
		t.Fatalf("mode = %q, want %q", f.Mode, ModeLine)
	}
	if !f.Compressed {
		t.Fatalf("compressed = false, want true")
	}
	if f.CompressedSize <= 0 {
		t.Fatalf("compressed size = %d, want positive", f.CompressedSize)
	}
	if f.TempPath == "" {
		t.Fatal("temp path is empty")
	}

	lines, err := f.LinesSlice(0, 2)
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(lines, ""); got != "alpha\nbeta\n" {
		t.Fatalf("slice = %q", got)
	}

	tempPath := f.TempPath
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(tempPath); !os.IsNotExist(err) {
		t.Fatalf("temp file still exists or stat failed unexpectedly: %v", err)
	}
}

func TestOpenLongLineUsesByteMode(t *testing.T) {
	path := filepath.Join(t.TempDir(), "huge.html")
	longLine := strings.Repeat("x", int(MaxIndexedLineBytes)+1)
	if err := os.WriteFile(path, []byte(longLine), 0o600); err != nil {
		t.Fatal(err)
	}

	f, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()

	if f.Mode != ModeByte {
		t.Fatalf("mode = %q, want %q", f.Mode, ModeByte)
	}
	if f.ChunkSize != ByteChunkSize {
		t.Fatalf("chunk size = %d, want %d", f.ChunkSize, ByteChunkSize)
	}

	chunks, err := f.LinesSlice(0, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(chunks) != 1 {
		t.Fatalf("chunks = %d, want 1", len(chunks))
	}
	if len(chunks[0]) != int(ByteChunkSize) {
		t.Fatalf("first chunk length = %d, want %d", len(chunks[0]), ByteChunkSize)
	}
}
