package watcher_test

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/zhangyw-cn/mino/internal/catalog"
	"github.com/zhangyw-cn/mino/internal/ignore"
	"github.com/zhangyw-cn/mino/internal/watcher"
)

func TestWatcherDetectsNewHTML(t *testing.T) {
	root := t.TempDir()
	cat := newCatalog(t, root)
	events := make(chan catalog.Event, 8)

	w, err := watcher.Start(root, cat, func(batch []catalog.Event) {
		for _, event := range batch {
			events <- event
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()

	path := filepath.Join(root, "x.html")
	if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	waitForEvent(t, events, catalog.Event{Kind: catalog.EventAdded, Path: "x.html"})
	if !cat.Has("x.html") {
		t.Fatal("catalog not updated")
	}
}

func TestWatcherTracksChangesRecursively(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "existing"), 0o755); err != nil {
		t.Fatal(err)
	}
	cat := newCatalog(t, root)
	events := make(chan catalog.Event, 16)

	w, err := watcher.Start(root, cat, func(batch []catalog.Event) {
		for _, event := range batch {
			events <- event
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()

	existing := filepath.Join(root, "existing", "a.html")
	if err := os.WriteFile(existing, []byte("a"), 0o644); err != nil {
		t.Fatal(err)
	}
	waitForEvent(t, events, catalog.Event{Kind: catalog.EventAdded, Path: "existing/a.html"})

	createdDir := filepath.Join(root, "created")
	if err := os.Mkdir(createdDir, 0o755); err != nil {
		t.Fatal(err)
	}
	waitForEvent(t, events, catalog.Event{Kind: catalog.EventAdded, Path: "created"})
	createdFile := filepath.Join(createdDir, "b.html")
	if err := os.WriteFile(createdFile, []byte("b"), 0o644); err != nil {
		t.Fatal(err)
	}
	waitForEvent(t, events, catalog.Event{Kind: catalog.EventAdded, Path: "created/b.html"})

	if err := os.WriteFile(createdFile, []byte("changed"), 0o644); err != nil {
		t.Fatal(err)
	}
	waitForEvent(t, events, catalog.Event{Kind: catalog.EventChanged, Path: "created/b.html"})

	if err := os.Remove(createdFile); err != nil {
		t.Fatal(err)
	}
	waitForEvent(t, events, catalog.Event{Kind: catalog.EventRemoved, Path: "created/b.html"})
	if cat.Has("created/b.html") {
		t.Fatal("catalog retained removed file")
	}
}

func TestWatcherIngestsHTMLFromMovedInDirectory(t *testing.T) {
	root := t.TempDir()
	cat := newCatalog(t, root)
	events := make(chan catalog.Event, 8)

	w, err := watcher.Start(root, cat, func(batch []catalog.Event) {
		for _, event := range batch {
			events <- event
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()

	staging := t.TempDir()
	movedDir := filepath.Join(staging, "subdir")
	if err := os.Mkdir(movedDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(movedDir, "a.html"), []byte("a"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(movedDir, filepath.Join(root, "subdir")); err != nil {
		t.Fatal(err)
	}

	waitForEvent(t, events, catalog.Event{Kind: catalog.EventAdded, Path: "subdir/a.html"})
	if !cat.Has("subdir/a.html") {
		t.Fatal("catalog did not ingest HTML from moved-in directory")
	}
}

func TestWatcherIngestsEmptyDirectoriesFromMovedInTree(t *testing.T) {
	root := t.TempDir()
	cat := newCatalog(t, root)
	events := make(chan catalog.Event, 8)

	w, err := watcher.Start(root, cat, func(batch []catalog.Event) {
		for _, event := range batch {
			events <- event
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()

	staging := t.TempDir()
	movedDir := filepath.Join(staging, "tree")
	if err := os.MkdirAll(filepath.Join(movedDir, "nested", "empty"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(movedDir, filepath.Join(root, "tree")); err != nil {
		t.Fatal(err)
	}

	waitForEvent(t, events, catalog.Event{Kind: catalog.EventAdded, Path: "tree/nested/empty"})
	if !treeHasPath(cat.Tree(), "tree/nested/empty") {
		t.Fatal("catalog tree did not include moved-in empty directory")
	}
}

func TestWatcherSkipsUnreadableSubdirectory(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("running as root: permission bits are not enforced")
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "ok.html"), []byte("ok"), 0o644); err != nil {
		t.Fatal(err)
	}
	locked := filepath.Join(root, "locked")
	if err := os.Mkdir(locked, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(locked, "hidden.html"), []byte("hidden"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(locked, 0o000); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(locked, 0o755) })

	cat := newCatalog(t, root)
	w, err := watcher.Start(root, cat, nil)
	if err != nil {
		t.Fatalf("start watcher with unreadable subdirectory: %v", err)
	}
	defer w.Close()

	if !cat.Has("ok.html") {
		t.Fatal("expected ok.html in catalog")
	}
	if cat.Has("locked/hidden.html") {
		t.Fatal("unreadable directory contents should not be cataloged")
	}
}

func newCatalog(t *testing.T, root string) *catalog.Catalog {
	t.Helper()
	matcher, err := ignore.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	cat := catalog.New(root, matcher)
	if err := cat.Scan(); err != nil {
		t.Fatal(err)
	}
	return cat
}

func treeHasPath(node *catalog.Node, want string) bool {
	if node.Path == want {
		return true
	}
	for _, child := range node.Children {
		if treeHasPath(child, want) {
			return true
		}
	}
	return false
}

func waitForEvent(t *testing.T, events <-chan catalog.Event, want catalog.Event) {
	t.Helper()
	timeout := time.NewTimer(5 * time.Second)
	defer timeout.Stop()
	for {
		select {
		case got := <-events:
			if got == want {
				return
			}
		case <-timeout.C:
			t.Fatalf("timeout waiting for %+v", want)
		}
	}
}

func TestWatcherEmitsAssetChangedWithoutCataloging(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "tools"), 0o755); err != nil {
		t.Fatal(err)
	}
	cat := newCatalog(t, root)
	events := make(chan catalog.Event, 16)

	w, err := watcher.Start(root, cat, func(batch []catalog.Event) {
		for _, event := range batch {
			events <- event
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()

	css := filepath.Join(root, "tools", "app.css")
	if err := os.WriteFile(css, []byte("a"), 0o644); err != nil {
		t.Fatal(err)
	}
	waitForEvent(t, events, catalog.Event{Kind: catalog.EventAssetChanged, Path: "tools/app.css"})
	if cat.Has("tools/app.css") {
		t.Fatal("css must not be a catalog entry")
	}

	if err := os.WriteFile(css, []byte("b"), 0o644); err != nil {
		t.Fatal(err)
	}
	waitForEvent(t, events, catalog.Event{Kind: catalog.EventAssetChanged, Path: "tools/app.css"})

	if err := os.Remove(css); err != nil {
		t.Fatal(err)
	}
	waitForEvent(t, events, catalog.Event{Kind: catalog.EventAssetRemoved, Path: "tools/app.css"})
}

func TestWatcherStillEmitsHTMLChanged(t *testing.T) {
	root := t.TempDir()
	html := filepath.Join(root, "a.html")
	if err := os.WriteFile(html, []byte("v1"), 0o644); err != nil {
		t.Fatal(err)
	}
	cat := newCatalog(t, root)
	events := make(chan catalog.Event, 8)

	w, err := watcher.Start(root, cat, func(batch []catalog.Event) {
		for _, event := range batch {
			events <- event
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()

	if err := os.WriteFile(html, []byte("v2"), 0o644); err != nil {
		t.Fatal(err)
	}
	waitForEvent(t, events, catalog.Event{Kind: catalog.EventChanged, Path: "a.html"})
}

func TestWatcherIgnoresNonAssets(t *testing.T) {
	root := t.TempDir()
	cat := newCatalog(t, root)
	events := make(chan catalog.Event, 8)

	w, err := watcher.Start(root, cat, func(batch []catalog.Event) {
		for _, event := range batch {
			events <- event
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()

	if err := os.WriteFile(filepath.Join(root, "main.go"), []byte("package m"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".env"), []byte("x=1"), 0o644); err != nil {
		t.Fatal(err)
	}

	timeout := time.NewTimer(300 * time.Millisecond)
	defer timeout.Stop()
	select {
	case got := <-events:
		t.Fatalf("unexpected event %+v", got)
	case <-timeout.C:
	}
}
