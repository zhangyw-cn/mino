package catalog

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"testing"
)

// dirEntry is a minimal fs.DirEntry standing in for an entry WalkDir reports
// alongside a read error.
type dirEntry struct {
	name  string
	isDir bool
}

func (e dirEntry) Name() string { return e.name }
func (e dirEntry) IsDir() bool  { return e.isDir }
func (e dirEntry) Type() fs.FileMode {
	if e.isDir {
		return fs.ModeDir
	}
	return 0
}
func (e dirEntry) Info() (fs.FileInfo, error) { return nil, errors.New("not implemented") }

// Scan must survive read errors below the root; only an unreadable root is fatal.
func TestScanEntryWalkErrors(t *testing.T) {
	root := t.TempDir()
	c := New(root, nil)
	readErr := os.ErrPermission

	cases := []struct {
		name  string
		path  string
		entry fs.DirEntry
		want  error
	}{
		{"root", c.root, dirEntry{name: filepath.Base(c.root), isDir: true}, readErr},
		{"subdirectory", filepath.Join(c.root, "locked"), dirEntry{name: "locked", isDir: true}, fs.SkipDir},
		{"file", filepath.Join(c.root, "locked.html"), dirEntry{name: "locked.html"}, nil},
		{"unknown entry", filepath.Join(c.root, "gone"), nil, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			files := make(map[string]struct{})
			dirs := make(map[string]struct{})
			got := c.scanEntry(files, dirs, tc.path, tc.entry, readErr)
			if !errors.Is(got, tc.want) {
				t.Fatalf("scanEntry(%q) = %v, want %v", tc.path, got, tc.want)
			}
			if len(files) != 0 || len(dirs) != 0 {
				t.Fatalf("failed entry recorded: files=%v dirs=%v", files, dirs)
			}
		})
	}
}
