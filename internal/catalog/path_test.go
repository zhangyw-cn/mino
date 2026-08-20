package catalog_test

import (
	"path/filepath"
	"testing"

	"mino/internal/catalog"
)

func TestIsHTML(t *testing.T) {
	if !catalog.IsHTML("a.HTML") || !catalog.IsHTML("b.htm") || catalog.IsHTML("c.txt") {
		t.Fatal("IsHTML mismatch")
	}
}

func TestNormalizeRelRejectsTraversal(t *testing.T) {
	if _, err := catalog.NormalizeRel("../x"); err == nil {
		t.Fatal("expected error")
	}
	got, err := catalog.NormalizeRel(`notes\a.html`)
	if err != nil || got != "notes/a.html" {
		t.Fatalf("got %q err %v", got, err)
	}
}

func TestResolveUnderRoot(t *testing.T) {
	root := t.TempDir()
	abs, err := catalog.ResolveUnderRoot(root, "notes/a.html")
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(root, "notes", "a.html")
	if abs != want {
		t.Fatalf("got %q want %q", abs, want)
	}
	if _, err := catalog.ResolveUnderRoot(root, "../outside.html"); err == nil {
		t.Fatal("expected error")
	}
}
