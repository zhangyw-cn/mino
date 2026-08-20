package server_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"mino/internal/catalog"
	"mino/internal/ignore"
	"mino/internal/server"
)

func newTestServer(t *testing.T) (*server.Server, *httptest.Server) {
	t.Helper()

	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "notes"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "notes", "a.html"), []byte("<h1>hi</h1>"), 0o644); err != nil {
		t.Fatal(err)
	}
	matcher, err := ignore.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	cat := catalog.New(root, matcher)
	if err := cat.Scan(); err != nil {
		t.Fatal(err)
	}

	srv := server.New(root, "demo", cat, server.NewHub())
	return srv, httptest.NewServer(srv.Handler())
}

func TestTreeSearchAndApps(t *testing.T) {
	_, ts := newTestServer(t)
	defer ts.Close()

	res, err := http.Get(ts.URL + "/api/tree")
	if err != nil {
		t.Fatal(err)
	}
	var tree struct {
		Name     string `json:"name"`
		Path     string `json:"path"`
		Type     string `json:"type"`
		Children []struct {
			Name string `json:"name"`
		} `json:"children"`
	}
	if err := json.NewDecoder(res.Body).Decode(&tree); err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatal(res.Status)
	}
	if tree.Name != "." || tree.Path != "" || tree.Type != "dir" || len(tree.Children) != 1 {
		t.Fatalf("unexpected tree: %+v", tree)
	}

	res, err = http.Get(ts.URL + "/api/search?q=a.html")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if !strings.Contains(string(body), "notes/a.html") {
		t.Fatalf("%s", body)
	}

	res, err = http.Get(ts.URL + "/apps/notes/a.html")
	if err != nil {
		t.Fatal(err)
	}
	body, _ = io.ReadAll(res.Body)
	res.Body.Close()
	if !strings.Contains(string(body), "<h1>hi</h1>") {
		t.Fatalf("%s", body)
	}

	res, err = http.Get(ts.URL + "/apps/../notes/a.html")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNotFound && res.StatusCode != http.StatusForbidden {
		t.Fatalf("status %d", res.StatusCode)
	}

	res, err = http.Get(ts.URL + "/apps/missing.html")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("status %d", res.StatusCode)
	}
}

func TestMetaAndIndex(t *testing.T) {
	srv, ts := newTestServer(t)
	defer ts.Close()

	assertMeta := func(want bool) {
		t.Helper()
		res, err := http.Get(ts.URL + "/api/meta")
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var meta struct {
			Name         string `json:"name"`
			WatchEnabled bool   `json:"watchEnabled"`
		}
		if err := json.NewDecoder(res.Body).Decode(&meta); err != nil {
			t.Fatal(err)
		}
		if meta.Name != "demo" || meta.WatchEnabled != want {
			t.Fatalf("unexpected meta: %+v", meta)
		}
	}

	assertMeta(false)
	srv.SetWatchEnabled(true)
	assertMeta(true)

	res, err := http.Get(ts.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if string(body) != "<!doctype html><title>mino</title><p>ok</p>" {
		t.Fatalf("unexpected index: %q", body)
	}
}
