package indexer

import (
	"bufio"
	"compress/gzip"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"strings"
)

const Group = 256
const MaxIndexedBytes int64 = 4 << 30
const MaxIndexedLineBytes int64 = 4 << 20
const ByteChunkSize int64 = 8 << 10

const (
	ModeLine = "line"
	ModeByte = "byte"
)

type File struct {
	Path           string
	File           *os.File
	Base           []int64
	Lines          int
	Size           int64
	Mode           string
	ChunkSize      int64
	TempPath       string
	Compressed     bool
	CompressedSize int64
}

func Open(path string) (*File, error) {
	if IsGzipPath(path) {
		return openGzip(path)
	}

	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	info, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, err
	}
	return openPlain(path, f, info.Size())
}

func IsGzipPath(path string) bool {
	return strings.EqualFold(filepath.Ext(path), ".gz")
}

func openGzip(path string) (*File, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	tempPath, cleanup, err := DecompressGzipToTemp(path)
	if err != nil {
		return nil, err
	}
	f, err := os.Open(tempPath)
	if err != nil {
		cleanup()
		return nil, err
	}
	tempInfo, err := f.Stat()
	if err != nil {
		f.Close()
		cleanup()
		return nil, err
	}
	lf, err := openPlain(path, f, tempInfo.Size())
	if err != nil {
		cleanup()
		return nil, err
	}
	lf.TempPath = tempPath
	lf.Compressed = true
	lf.CompressedSize = info.Size()
	return lf, nil
}

func DecompressGzipToTemp(path string) (string, func(), error) {
	src, err := os.Open(path)
	if err != nil {
		return "", nil, err
	}
	defer src.Close()

	gz, err := gzip.NewReader(src)
	if err != nil {
		return "", nil, err
	}
	defer gz.Close()

	base := filepath.Base(path)
	suffix := filepath.Ext(strings.TrimSuffix(base, filepath.Ext(base)))
	tmp, err := os.CreateTemp("", "biglog-gzip-*"+suffix)
	if err != nil {
		return "", nil, err
	}
	tempPath := tmp.Name()
	cleanup := func() { _ = os.Remove(tempPath) }
	if _, err := io.Copy(tmp, gz); err != nil {
		tmp.Close()
		cleanup()
		return "", nil, err
	}
	if err := tmp.Close(); err != nil {
		cleanup()
		return "", nil, err
	}
	return tempPath, cleanup, nil
}

func openPlain(path string, f *os.File, size int64) (*File, error) {
	if size > MaxIndexedBytes {
		return byteModeFile(path, f, size), nil
	}

	base := make([]int64, 0, 1024)
	r := bufio.NewReaderSize(f, 1<<20)

	var pos int64
	var lineStart int64
	var lineBytes int64
	var n int
	var lineStarted bool

	for {
		b, err := r.ReadSlice('\n')
		if len(b) > 0 {
			if !lineStarted {
				if n%Group == 0 {
					base = append(base, lineStart)
				}
				lineStarted = true
			}
			pos += int64(len(b))
			lineBytes += int64(len(b))
			if lineBytes > MaxIndexedLineBytes {
				return byteModeFile(path, f, size), nil
			}
		}
		if err == bufio.ErrBufferFull {
			continue
		}
		if err == io.EOF {
			if lineStarted {
				n++
			}
			break
		}
		if err != nil {
			f.Close()
			return nil, err
		}
		if lineStarted {
			n++
		}
		lineStarted = false
		lineBytes = 0
		lineStart = pos
	}

	return &File{
		Path:      path,
		File:      f,
		Base:      base,
		Lines:     n,
		Size:      size,
		Mode:      ModeLine,
		ChunkSize: 0,
	}, nil
}

func byteModeFile(path string, f *os.File, size int64) *File {
	lines := 0
	if size > 0 {
		lines = int((size + ByteChunkSize - 1) / ByteChunkSize)
	}
	return &File{
		Path:      path,
		File:      f,
		Lines:     lines,
		Size:      size,
		Mode:      ModeByte,
		ChunkSize: ByteChunkSize,
	}
}

func (lf *File) Close() error {
	var err error
	if lf.File != nil {
		err = lf.File.Close()
		lf.File = nil
	}
	if lf.TempPath != "" {
		if removeErr := os.Remove(lf.TempPath); err == nil {
			err = removeErr
		}
		lf.TempPath = ""
	}
	return err
}

func (lf *File) LinesSlice(start, count int) ([]string, error) {
	if lf.Mode == ModeByte {
		return lf.byteSlice(start, count)
	}
	if start < 0 || start > lf.Lines {
		return nil, fmt.Errorf("start out of range")
	}
	if start == lf.Lines {
		return []string{}, nil
	}
	end := start + count
	if end > lf.Lines {
		end = lf.Lines
	}
	out := make([]string, end-start)

	grp := start / Group
	if grp >= len(lf.Base) {
		return nil, fmt.Errorf("index out of range")
	}
	pos := lf.Base[grp]

	sr := io.NewSectionReader(lf.File, pos, math.MaxInt64)
	r := bufio.NewReaderSize(sr, 1<<20)

	for i := grp * Group; i < end; i++ {
		line, err := r.ReadBytes('\n')
		if err != nil && err != io.EOF {
			return nil, err
		}
		if i >= start {
			out[i-start] = string(line)
		}
		if err == io.EOF {
			break
		}
	}
	return out, nil
}

func (lf *File) byteSlice(start, count int) ([]string, error) {
	if start < 0 || start > lf.Lines {
		return nil, fmt.Errorf("start out of range")
	}
	if start == lf.Lines {
		return []string{}, nil
	}
	end := start + count
	if end > lf.Lines {
		end = lf.Lines
	}
	out := make([]string, end-start)
	for i := start; i < end; i++ {
		offset := int64(i) * lf.ChunkSize
		size := lf.ChunkSize
		if remaining := lf.Size - offset; remaining < size {
			size = remaining
		}
		if size <= 0 {
			out[i-start] = ""
			continue
		}
		buf := make([]byte, int(size))
		n, err := lf.File.ReadAt(buf, offset)
		if err != nil && err != io.EOF {
			return nil, err
		}
		out[i-start] = string(buf[:n])
	}
	return out, nil
}

func (lf *File) WriteRange(w io.Writer, start, end int) error {
	if lf.Mode == ModeByte {
		return lf.writeByteRange(w, start, end)
	}
	if start < 0 {
		start = 0
	}
	if end > lf.Lines {
		end = lf.Lines
	}
	if end < start {
		end = start
	}

	grp := start / Group
	if grp >= len(lf.Base) && !(start == 0 && len(lf.Base) == 0) {
		return fmt.Errorf("index out of range")
	}
	var pos int64
	if len(lf.Base) > 0 {
		pos = lf.Base[grp]
	}

	sr := io.NewSectionReader(lf.File, pos, math.MaxInt64)
	r := bufio.NewReaderSize(sr, 1<<20)

	for i := grp * Group; i < end; i++ {
		line, err := r.ReadBytes('\n')
		if err != nil && err != io.EOF {
			return err
		}
		if i >= start {
			if _, err := w.Write(line); err != nil {
				return err
			}
		}
		if err == io.EOF {
			break
		}
	}
	return nil
}

func (lf *File) writeByteRange(w io.Writer, start, end int) error {
	if start < 0 {
		start = 0
	}
	if end > lf.Lines {
		end = lf.Lines
	}
	if end < start {
		end = start
	}
	buf := make([]byte, lf.ChunkSize)
	for i := start; i < end; i++ {
		offset := int64(i) * lf.ChunkSize
		size := lf.ChunkSize
		if remaining := lf.Size - offset; remaining < size {
			size = remaining
		}
		if size <= 0 {
			continue
		}
		n, err := lf.File.ReadAt(buf[:int(size)], offset)
		if err != nil && err != io.EOF {
			return err
		}
		if _, err := w.Write(buf[:n]); err != nil {
			return err
		}
	}
	return nil
}
