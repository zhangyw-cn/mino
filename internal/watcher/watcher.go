package watcher

import (
	"io/fs"
	"os"
	"path/filepath"
	"sync"

	"github.com/fsnotify/fsnotify"

	"github.com/zhangyw-cn/mino/internal/catalog"
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
	if err := w.addTree(absRoot, false); err != nil {
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
			_ = w.addTree(event.Name, true)
		}
	}

	events := w.cat.ApplyFSChange(event.Name, removed)
	if len(events) > 0 && w.onEvents != nil {
		w.onEvents(events)
	}
}

func (w *Watcher) addTree(root string, ingestFiles bool) error {
	return filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			// Only an unreadable root is fatal; restricted entries below it are
			// skipped so watching still covers the rest of the tree.
			if path == root {
				return walkErr
			}
			if entry != nil && entry.IsDir() {
				return fs.SkipDir
			}
			return nil
		}

		ignored, err := w.ignored(path)
		if err != nil {
			if entry.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if ignored {
			if entry.IsDir() {
				return fs.SkipDir
			}
			return nil
		}

		if entry.IsDir() {
			if err := w.fs.Add(path); err != nil {
				if path == root {
					return err
				}
				return fs.SkipDir
			}
			if ingestFiles {
				events := w.cat.ApplyFSChange(path, false)
				if len(events) > 0 && w.onEvents != nil {
					w.onEvents(events)
				}
			}
			return nil
		}
		if ingestFiles && entry.Type().IsRegular() {
			events := w.cat.ApplyFSChange(path, false)
			if len(events) > 0 && w.onEvents != nil {
				w.onEvents(events)
			}
		}
		return nil
	})
}

func (w *Watcher) ignored(path string) (bool, error) {
	rel, err := filepath.Rel(w.root, path)
	if err != nil {
		return false, err
	}
	rel, err = catalog.NormalizeRel(rel)
	if err != nil {
		return false, err
	}
	return w.cat.Ignored(rel), nil
}
