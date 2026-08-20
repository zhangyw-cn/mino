package ignore_test

import (
	"testing"

	"mino/internal/ignore"
)

func TestBuiltinIgnores(t *testing.T) {
	m, err := ignore.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	cases := []string{".mino", ".mino/config.toml", ".git/HEAD", "node_modules/x", "a/.git/x"}
	for _, c := range cases {
		if !m.Match(c) {
			t.Fatalf("expected ignore %q", c)
		}
	}
	if m.Match("notes/a.html") {
		t.Fatal("should not ignore notes/a.html")
	}
}

func TestExtraGlobs(t *testing.T) {
	m, err := ignore.New([]string{"tmp/**", "drafts/*.html"})
	if err != nil {
		t.Fatal(err)
	}
	if !m.Match("tmp/x.html") {
		t.Fatal("expected tmp ignore")
	}
	if !m.Match("drafts/a.html") {
		t.Fatal("expected drafts ignore")
	}
	if m.Match("drafts/nested/a.html") {
		t.Fatal("nested drafts should not match drafts/*.html")
	}
}
