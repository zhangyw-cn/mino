package watcher_test

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"mino/internal/catalog"
	"mino/internal/ignore"
	"mino/internal/watcher"
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
