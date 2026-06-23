package indexer

import (
	"bufio"
	"fmt"
	"io"
	"math"
	"os"
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
	Path      string
	File      *os.File
	Base      []int64
	Lines     int
	Size      int64
	Mode      string
	ChunkSize int64
}

func Open(path string) (*File, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}

	info, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, err
	}
	size := info.Size()
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
	if lf.File != nil {
		return lf.File.Close()
	}
	return nil
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
