package indexer

import (
	"bufio"
	"fmt"
	"io"
	"math"
	"os"
)

const Group = 256

type File struct {
	Path  string
	File  *os.File
	Base  []int64
	Lines int
}

func Open(path string) (*File, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}

	base := make([]int64, 0, 1024)
	r := bufio.NewReaderSize(f, 1<<20)

	var pos int64
	var n int

	for {
		b, err := r.ReadBytes('\n')
		if len(b) > 0 {
			if n%Group == 0 {
				base = append(base, pos)
			}
			pos += int64(len(b))
			n++
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			f.Close()
			return nil, err
		}
	}

	return &File{
		Path:  path,
		File:  f,
		Base:  base,
		Lines: n,
	}, nil
}

func (lf *File) Close() error {
	if lf.File != nil {
		return lf.File.Close()
	}
	return nil
}

func (lf *File) LinesSlice(start, count int) ([]string, error) {
	if start < 0 || start >= lf.Lines {
		return nil, fmt.Errorf("start out of range")
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

func (lf *File) WriteRange(w io.Writer, start, end int) error {
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
