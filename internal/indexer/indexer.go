package indexer

import (
	"bufio"
	"fmt"
	"io"
	"os"
)

type File struct {
	Path    string
	File    *os.File
	Offsets []int64
}

func Open(path string) (*File, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}

	var offs []int64
	var pos int64
	r := bufio.NewReaderSize(f, 1<<20) 

	for {
		line, err := r.ReadBytes('\n')
		offs = append(offs, pos)
		pos += int64(len(line))

		if err == io.EOF {
			break
		}
		if err != nil {
			f.Close()
			return nil, err
		}
	}

	return &File{
		Path:    path,
		File:    f,
		Offsets: offs,
	}, nil
}

func (lf *File) Lines(start, count int) ([]string, error) {
	if start < 0 || start >= len(lf.Offsets) {
		return nil, fmt.Errorf("start out of range")
	}
	end := start + count
	if end > len(lf.Offsets) {
		end = len(lf.Offsets)
	}
	out := make([]string, end-start)

	for i := start; i < end; i++ {
		beg := lf.Offsets[i]
		var nxt int64
		if i+1 < len(lf.Offsets) {
			nxt = lf.Offsets[i+1]
		} else { // last line
			var err error
			if nxt, err = lf.File.Seek(0, io.SeekEnd); err != nil {
				return nil, err
			}
		}
		buf := make([]byte, nxt-beg)
		if _, err := lf.File.ReadAt(buf, beg); err != nil {
			return nil, err
		}
		out[i-start] = string(buf)
	}
	return out, nil
}
