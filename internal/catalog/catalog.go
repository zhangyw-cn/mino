package catalog

import (
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"mino/internal/ignore"
)

type EventKind string

const (
	EventAdded   EventKind = "added"
	EventRemoved EventKind = "removed"
	EventChanged EventKind = "changed"
)

type Event struct {
	Kind EventKind
	Path string
}

type Node struct {
	Name     string
	Path     string
	Type     string
	Children []*Node
}

type Catalog struct {
	mu      sync.RWMutex
	root    string
	matcher *ignore.Matcher
	files   map[string]struct{}
	dirs    map[string]struct{}
}

func New(root string, matcher *ignore.Matcher) *Catalog {
	absRoot, err := filepath.Abs(root)
	if err == nil {
		root = absRoot
	}
	return &Catalog{
		root:    root,
		matcher: matcher,
		files:   make(map[string]struct{}),
		dirs:    make(map[string]struct{}),
	}
}

func (c *Catalog) Scan() error {
	files := make(map[string]struct{})
	dirs := make(map[string]struct{})

	err := filepath.WalkDir(c.root, func(filePath string, entry fs.DirEntry, walkErr error) error {
		return c.scanEntry(files, dirs, filePath, entry, walkErr)
	})
	if err != nil {
		return err
	}

	c.mu.Lock()
	c.files = files
	c.dirs = dirs
	c.mu.Unlock()
	return nil
}

func (c *Catalog) scanEntry(files, dirs map[string]struct{}, filePath string, entry fs.DirEntry, walkErr error) error {
	if walkErr != nil {
		// An unreadable root is fatal; anything below it is skipped so a single
		// restricted entry cannot make the whole scan fail.
		if filePath == c.root {
			return walkErr
		}
		if entry != nil && entry.IsDir() {
			return fs.SkipDir
		}
		return nil
	}

	rel, err := filepath.Rel(c.root, filePath)
	if err != nil {
		return err
	}
	rel, err = NormalizeRel(rel)
	if err != nil {
		return err
	}
	if rel == "" {
		return nil
	}
	if c.ignored(rel) {
		if entry.IsDir() {
			return fs.SkipDir
		}
		return nil
	}
	if entry.IsDir() {
		dirs[rel] = struct{}{}
	} else if entry.Type().IsRegular() && IsHTML(entry.Name()) {
		files[rel] = struct{}{}
	}
	return nil
}

func (c *Catalog) Tree() *Node {
	c.mu.RLock()
	dirs := sortedKeys(c.dirs)
	files := sortedKeys(c.files)
	c.mu.RUnlock()

	root := &Node{Name: ".", Path: "", Type: "dir"}
	nodes := map[string]*Node{"": root}

	ensureDir := func(rel string) *Node {
		if node, ok := nodes[rel]; ok {
			return node
		}
		parts := strings.Split(rel, "/")
		parent := root
		var current string
		for _, part := range parts {
			if current == "" {
				current = part
			} else {
				current += "/" + part
			}
			node, ok := nodes[current]
			if !ok {
				node = &Node{Name: part, Path: current, Type: "dir"}
				nodes[current] = node
				parent.Children = append(parent.Children, node)
			}
			parent = node
		}
		return parent
	}

	for _, rel := range dirs {
		ensureDir(rel)
	}
	for _, rel := range files {
		parent := root
		if parentPath := path.Dir(rel); parentPath != "." {
			parent = ensureDir(parentPath)
		}
		parent.Children = append(parent.Children, &Node{
			Name: path.Base(rel),
			Path: rel,
			Type: "file",
		})
	}

	var sortTree func(*Node)
	sortTree = func(node *Node) {
		sort.Slice(node.Children, func(i, j int) bool {
			return node.Children[i].Name < node.Children[j].Name
		})
		for _, child := range node.Children {
			if child.Type == "dir" {
				sortTree(child)
			}
		}
	}
	sortTree(root)
	return root
}

func (c *Catalog) Search(q string) []string {
	q = strings.ToLower(q)
	c.mu.RLock()
	results := make([]string, 0, len(c.files))
	for rel := range c.files {
		if strings.Contains(strings.ToLower(rel), q) {
			results = append(results, rel)
		}
	}
	c.mu.RUnlock()
	sort.Strings(results)
	return results
}

func (c *Catalog) Has(rel string) bool {
	rel, err := NormalizeRel(rel)
	if err != nil {
		return false
	}
	c.mu.RLock()
	_, ok := c.files[rel]
	c.mu.RUnlock()
	return ok
}

// Ignored reports whether a root-relative path is excluded from the catalog.
func (c *Catalog) Ignored(rel string) bool {
	rel, err := NormalizeRel(rel)
	if err != nil {
		return true
	}
	return c.ignored(rel)
}

func (c *Catalog) ApplyFSChange(absPath string, removed bool) []Event {
	rel, err := filepath.Rel(c.root, absPath)
	if err != nil {
		return nil
	}
	rel, err = NormalizeRel(rel)
	if err != nil || c.ignored(rel) {
		return nil
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	if removed {
		return c.removeLocked(rel)
	}

	info, err := os.Lstat(absPath)
	if err != nil {
		return nil
	}
	if info.IsDir() {
		return c.addDirsLocked(rel)
	}
	if !info.Mode().IsRegular() || !IsHTML(info.Name()) {
		return c.removeLocked(rel)
	}

	events := c.addDirsLocked(path.Dir(rel))
	if _, exists := c.files[rel]; exists {
		return append(events, Event{Kind: EventChanged, Path: rel})
	}
	c.files[rel] = struct{}{}
	return append(events, Event{Kind: EventAdded, Path: rel})
}

func (c *Catalog) ignored(rel string) bool {
	return c.matcher != nil && c.matcher.Match(rel)
}

func (c *Catalog) addDirsLocked(rel string) []Event {
	if rel == "" || rel == "." {
		return nil
	}

	var missing []string
	for current := rel; current != "" && current != "."; current = path.Dir(current) {
		if _, exists := c.dirs[current]; !exists {
			missing = append(missing, current)
		}
	}

	events := make([]Event, 0, len(missing))
	for i := len(missing) - 1; i >= 0; i-- {
		current := missing[i]
		c.dirs[current] = struct{}{}
		events = append(events, Event{Kind: EventAdded, Path: current})
	}
	return events
}

func (c *Catalog) removeLocked(rel string) []Event {
	var removedPaths []string
	for file := range c.files {
		if hasPathPrefix(file, rel) {
			delete(c.files, file)
			removedPaths = append(removedPaths, file)
		}
	}
	for dir := range c.dirs {
		if hasPathPrefix(dir, rel) {
			delete(c.dirs, dir)
			removedPaths = append(removedPaths, dir)
		}
	}
	sort.Strings(removedPaths)

	events := make([]Event, len(removedPaths))
	for i, removedPath := range removedPaths {
		events[i] = Event{Kind: EventRemoved, Path: removedPath}
	}
	return events
}

func hasPathPrefix(candidate, prefix string) bool {
	return prefix == "" || candidate == prefix || strings.HasPrefix(candidate, prefix+"/")
}

func sortedKeys(items map[string]struct{}) []string {
	keys := make([]string, 0, len(items))
	for item := range items {
		keys = append(keys, item)
	}
	sort.Strings(keys)
	return keys
}
