package asset_test

import (
	"testing"

	"github.com/zhangyw-cn/mino/internal/asset"
	"github.com/zhangyw-cn/mino/internal/ignore"
)

func TestAllowedExtensions(t *testing.T) {
	exts := []string{
		"png", "jpg", "jpeg", "gif", "webp", "svg", "ico",
		"css", "js", "mjs", "woff", "woff2", "ttf", "otf", "json", "wasm",
	}
	for _, ext := range exts {
		rel := "notes/file." + ext
		if !asset.Allowed(rel, nil) {
			t.Fatalf("Allowed(%q) = false, want true", rel)
		}
	}
	if !asset.Allowed("notes/file.PNG", nil) {
		t.Fatal("extension must be case-insensitive")
	}
	if !asset.Allowed("notes/file.CSS", nil) {
		t.Fatal("extension must be case-insensitive")
	}
}

func TestAllowedRejects(t *testing.T) {
	ignored := func(rel string) bool { return rel == "skip/app.css" }
	cases := []struct {
		rel  string
		fn   func(string) bool
		name string
	}{
		{"notes/a.html", nil, "html"},
		{"notes/a.htm", nil, "htm"},
		{"notes/a.md", nil, "md"},
		{"notes/secret.go", nil, "go"},
		{"notes/app.css.map", nil, "map"},
		{".env", nil, "dotfile"},
		{"dir/.secret.png", nil, "dot segment"},
		{"dir/.hidden/x.png", nil, "dot directory"},
		{"../outside.css", nil, "escape"},
		{"/abs.png", nil, "absolute"},
		{"skip/app.css", ignored, "ignored"},
	}
	for _, tc := range cases {
		if asset.Allowed(tc.rel, tc.fn) {
			t.Fatalf("%s: Allowed(%q) = true, want false", tc.name, tc.rel)
		}
	}
	if !asset.Allowed("notes/../file.css", nil) {
		t.Fatal("in-root .. after Clean must remain allowed")
	}
}

func TestAllowedUsesIgnoreMatcher(t *testing.T) {
	m, err := ignore.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	if asset.Allowed("node_modules/pkg.css", m.Match) {
		t.Fatal("node_modules css must be denied")
	}
	if !asset.Allowed("tools/app.css", m.Match) {
		t.Fatal("tools/app.css must be allowed")
	}
}
