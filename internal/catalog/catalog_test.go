package catalog_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/zhangyw-cn/mino/internal/catalog"
	"github.com/zhangyw-cn/mino/internal/ignore"
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

func TestScanIncludesMarkdown(t *testing.T) {
	root := t.TempDir()
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
	mustWrite("notes/readme.md", "# readme")
	mustWrite("notes/x.txt", "text")
	mustWrite("notes/y.markdown", "# markdown")

	m, err := ignore.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	c := catalog.New(root, m)
	if err := c.Scan(); err != nil {
		t.Fatal(err)
	}
	if !c.Has("notes/a.html") || !c.Has("notes/readme.md") {
		t.Fatal("expected html and md in catalog")
	}
	if c.Has("notes/x.txt") || c.Has("notes/y.markdown") {
		t.Fatal("non-entry files should not be cataloged")
	}
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

func TestScanSkipsUnreadableSubdirectory(t *testing.T) {
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

	m, err := ignore.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	c := catalog.New(root, m)
	if err := c.Scan(); err != nil {
		t.Fatalf("scan failed on unreadable subdirectory: %v", err)
	}
	if !c.Has("ok.html") {
		t.Fatal("expected ok.html in catalog")
	}
	if c.Has("locked/hidden.html") {
		t.Fatal("unreadable directory contents should not be cataloged")
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

func TestApplyFSChangeMarkdown(t *testing.T) {
	root, c := setupWorkspace(t)
	p := filepath.Join(root, "notes", "readme.md")
	if err := os.WriteFile(p, []byte("# hi"), 0o644); err != nil {
		t.Fatal(err)
	}
	evs := c.ApplyFSChange(p, false)
	if !c.Has("notes/readme.md") {
		t.Fatal("expected md add")
	}
	found := false
	for _, e := range evs {
		if e.Kind == catalog.EventAdded && e.Path == "notes/readme.md" {
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
	if c.Has("notes/readme.md") {
		t.Fatal("expected remove")
	}
	if len(evs) == 0 || evs[0].Kind != catalog.EventRemoved {
		t.Fatalf("events: %+v", evs)
	}
}

func TestScanIgnoresMarkdownUnderIgnoreGlob(t *testing.T) {
	root := t.TempDir()
	mustWrite := func(rel, body string) {
		p := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	mustWrite("archive/secret.md", "# secret")
	mustWrite("ok.md", "# ok")

	m, err := ignore.New([]string{"archive/**"})
	if err != nil {
		t.Fatal(err)
	}
	c := catalog.New(root, m)
	if err := c.Scan(); err != nil {
		t.Fatal(err)
	}
	if c.Has("archive/secret.md") {
		t.Fatal("ignored md should not be cataloged")
	}
	if !c.Has("ok.md") {
		t.Fatal("expected ok.md in catalog")
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
