package indexer

import (
	"bufio"
	"fmt"
	"io"
	"os"
)

const group = 256

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

	var base []int64
	var pos int64
	var n int
	r := bufio.NewReaderSize(f, 1<<20)

	for {
		line, err := r.ReadBytes('\n')
		if n%group == 0 {
			base = append(base, pos)
		}
		pos += int64(len(line))
		n++
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

func (lf *File) LinesSlice(start, count int) ([]string, error) {
	if start < 0 || start >= lf.Lines {
		return nil, fmt.Errorf("start out of range")
	}
	end := start + count
	if end > lf.Lines {
		end = lf.Lines
	}
	out := make([]string, end-start)

	grp := start / group
	pos := lf.Base[grp]
	if _, err := lf.File.Seek(pos, io.SeekStart); err != nil {
		return nil, err
	}
	r := bufio.NewReaderSize(lf.File, 1<<20)

	for i := grp * group; i < end; i++ {
		line, err := r.ReadBytes('\n')
		if err != nil && err != io.EOF {
			return nil, err
		}
		if i >= start {
			out[i-start] = string(line)
		}
		if err == io.EOF || i+1 == end {
			break
		}
	}
	return out, nil
}
