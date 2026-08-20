package catalog_test

import (
	"os"
	"path/filepath"
	"testing"

	"mino/internal/catalog"
	"mino/internal/ignore"
)

func setupWorkspace(t *testing.T) (root string, c *catalog.Catalog) {
	t.Helper()
	root = t.TempDir()
	mustWrite := func(rel, body string) {
		p := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	mustWrite("notes/a.html", "<html>a</html>")
	mustWrite("tools/timer.html", "<html>t</html>")
	if err := os.MkdirAll(filepath.Join(root, "empty"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, ".git"), 0o755); err != nil {
		t.Fatal(err)
	}
	mustWrite(".git/nope.html", "x")
	m, err := ignore.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	c = catalog.New(root, m)
	if err := c.Scan(); err != nil {
		t.Fatal(err)
	}
	return root, c
}

func TestScanAndSearch(t *testing.T) {
	_, c := setupWorkspace(t)
	if !c.Has("notes/a.html") || c.Has(".git/nope.html") {
		t.Fatal("has mismatch")
	}
	got := c.Search("timer")
	if len(got) != 1 || got[0] != "tools/timer.html" {
		t.Fatalf("search: %v", got)
	}
	all := c.Search("")
	if len(all) != 2 {
		t.Fatalf("all: %v", all)
	}
}

func TestTreeIncludesEmptyDir(t *testing.T) {
	_, c := setupWorkspace(t)
	tree := c.Tree()
	var foundEmpty bool
	var walk func(n *catalog.Node)
	walk = func(n *catalog.Node) {
		if n.Path == "empty" && n.Type == "dir" {
			foundEmpty = true
		}
		for _, ch := range n.Children {
			walk(ch)
		}
	}
	walk(tree)
	if !foundEmpty {
		t.Fatal("empty dir missing from tree")
	}
}

func TestTreePlacesRootFileDirectlyUnderRoot(t *testing.T) {
	root, c := setupWorkspace(t)
	p := filepath.Join(root, "root.html")
	if err := os.WriteFile(p, []byte("root"), 0o644); err != nil {
		t.Fatal(err)
	}
	c.ApplyFSChange(p, false)

	tree := c.Tree()
	for _, child := range tree.Children {
		if child.Path == "." {
			t.Fatal("unexpected synthetic dot directory")
		}
	}
}

func TestApplyFSChange(t *testing.T) {
	root, c := setupWorkspace(t)
	p := filepath.Join(root, "notes", "b.html")
	if err := os.WriteFile(p, []byte("b"), 0o644); err != nil {
		t.Fatal(err)
	}
	evs := c.ApplyFSChange(p, false)
	if !c.Has("notes/b.html") {
		t.Fatal("expected add")
	}
	found := false
	for _, e := range evs {
		if e.Kind == catalog.EventAdded && e.Path == "notes/b.html" {
			found = true
		}
	}
	if !found {
		t.Fatalf("events: %+v", evs)
	}
	if err := os.Remove(p); err != nil {
		t.Fatal(err)
	}
	evs = c.ApplyFSChange(p, true)
	if c.Has("notes/b.html") {
		t.Fatal("expected remove")
	}
	_ = evs
}

func TestSymlinkHTMLIsNeverCataloged(t *testing.T) {
	makeLeak := func(t *testing.T, root string) string {
		t.Helper()
		outside := filepath.Join(t.TempDir(), "outside.html")
		if err := os.WriteFile(outside, []byte("secret"), 0o644); err != nil {
			t.Fatal(err)
		}
		leak := filepath.Join(root, "leak.html")
		if err := os.Symlink(outside, leak); err != nil {
			t.Fatal(err)
		}
		return leak
	}

	t.Run("scan", func(t *testing.T) {
		root, c := setupWorkspace(t)
		makeLeak(t, root)

		if err := c.Scan(); err != nil {
			t.Fatal(err)
		}
		if c.Has("leak.html") {
			t.Fatal("scan cataloged HTML symlink")
		}
	})

	t.Run("filesystem change", func(t *testing.T) {
		root, c := setupWorkspace(t)
		leak := makeLeak(t, root)

		events := c.ApplyFSChange(leak, false)
		if c.Has("leak.html") {
			t.Fatal("filesystem change cataloged HTML symlink")
		}
		if len(events) != 0 {
			t.Fatalf("unexpected events: %+v", events)
		}
	})
}

func TestApplyFSChangeRemovesCatalogedFileReplacedBySymlink(t *testing.T) {
	root, c := setupWorkspace(t)
	file := filepath.Join(root, "x.html")
	if err := os.WriteFile(file, []byte("cataloged"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := c.Scan(); err != nil {
		t.Fatal(err)
	}

	outside := filepath.Join(t.TempDir(), "outside.html")
	if err := os.WriteFile(outside, []byte("external"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(file); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, file); err != nil {
		t.Fatal(err)
	}

	events := c.ApplyFSChange(file, false)
	if c.Has("x.html") {
		t.Fatal("catalog retained regular file replaced by symlink")
	}
	if len(events) != 1 || events[0].Kind != catalog.EventRemoved || events[0].Path != "x.html" {
		t.Fatalf("events: %+v", events)
	}
}
