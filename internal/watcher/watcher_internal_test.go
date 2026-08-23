package watcher

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/zhangyw-cn/mino/internal/catalog"
	"github.com/zhangyw-cn/mino/internal/ignore"
)

func TestWatcherDoesNotWatchCustomIgnoredDirectory(t *testing.T) {
	root := t.TempDir()
	ignoredDir := filepath.Join(root, "tmp")
	if err := os.Mkdir(ignoredDir, 0o755); err != nil {
		t.Fatal(err)
	}

	matcher, err := ignore.New([]string{"tmp/**"})
	if err != nil {
		t.Fatal(err)
	}
	cat := catalog.New(root, matcher)
	if err := cat.Scan(); err != nil {
		t.Fatal(err)
	}

	w, err := Start(root, cat, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()

	for _, watched := range w.fs.WatchList() {
		if watched == ignoredDir {
			t.Fatalf("custom ignored directory is watched: %s", watched)
		}
	}
}
