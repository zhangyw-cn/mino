package watcher

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/fsnotify/fsnotify"

	"mino/internal/catalog"
)

// Watcher keeps a catalog synchronized with filesystem changes.
type Watcher struct {
	fs        *fsnotify.Watcher
	cat       *catalog.Catalog
	onEvents  func([]catalog.Event)
	root      string
	done      chan struct{}
	closeOnce sync.Once
	wg        sync.WaitGroup
}

// Start recursively watches root and applies filesystem changes to cat.
func Start(root string, cat *catalog.Catalog, onEvents func([]catalog.Event)) (*Watcher, error) {
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}

	fsw, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	w := &Watcher{
		fs:       fsw,
		cat:      cat,
		onEvents: onEvents,
		root:     absRoot,
		done:     make(chan struct{}),
	}
	if err := w.addTree(absRoot); err != nil {
		_ = fsw.Close()
		return nil, err
	}

	w.wg.Add(1)
	go w.run()
	return w, nil
}

// Close stops watching and waits for the event loop to exit.
func (w *Watcher) Close() error {
	var err error
	w.closeOnce.Do(func() {
		close(w.done)
		err = w.fs.Close()
		w.wg.Wait()
	})
	return err
}

func (w *Watcher) run() {
	defer w.wg.Done()
	for {
		select {
		case <-w.done:
			return
		case event, ok := <-w.fs.Events:
			if !ok {
				return
			}
			w.handle(event)
		case _, ok := <-w.fs.Errors:
			if !ok {
				return
			}
		}
	}
}

func (w *Watcher) handle(event fsnotify.Event) {
	removed := event.Has(fsnotify.Remove) || event.Has(fsnotify.Rename)
	changed := event.Has(fsnotify.Create) || event.Has(fsnotify.Write)
	if !removed && !changed {
		return
	}

	if event.Has(fsnotify.Create) {
		info, err := os.Lstat(event.Name)
		if err == nil && info.IsDir() && info.Mode()&os.ModeSymlink == 0 {
			_ = w.addTree(event.Name)
		}
	}

	events := w.cat.ApplyFSChange(event.Name, removed)
	if len(events) > 0 && w.onEvents != nil {
		w.onEvents(events)
	}
}

func (w *Watcher) addTree(root string) error {
	return filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if !entry.IsDir() {
			return nil
		}
		if path != w.root && w.isBuiltinIgnored(path) {
			return fs.SkipDir
		}
		return w.fs.Add(path)
	})
}

func (w *Watcher) isBuiltinIgnored(path string) bool {
	rel, err := filepath.Rel(w.root, path)
	if err != nil {
		return false
	}
	for _, part := range strings.Split(filepath.ToSlash(rel), "/") {
		switch part {
		case ".mino", ".git", ".hg", ".svn", "node_modules":
			return true
		}
	}
	return false
}
