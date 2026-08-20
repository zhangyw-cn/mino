package catalog_test

import (
	"os"
	"path/filepath"
	"runtime"
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
	want := `notes\a.html`
	if runtime.GOOS == "windows" {
		want = "notes/a.html"
	}
	if err != nil || got != want {
		t.Fatalf("got %q err %v, want %q", got, err, want)
	}
}

func TestBackslashFilenameSurvivesNormalizeOnUnix(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("backslash is a path separator on Windows")
	}
	root := t.TempDir()
	name := `we\ird.html`
	if err := os.WriteFile(filepath.Join(root, name), []byte("x"), 0o644); err != nil {
		t.Skipf("filesystem rejects backslash in filenames: %v", err)
	}
	abs, err := catalog.ResolveUnderRoot(root, name)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(abs); err != nil {
		t.Fatalf("resolved path %q does not exist: %v", abs, err)
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
