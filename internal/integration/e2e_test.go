package integration_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"mino/internal/catalog"
	"mino/internal/ignore"
	"mino/internal/server"
	"mino/internal/watcher"
)

func TestE2ELiveUpdate(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "a.html"), []byte("v1"), 0o644); err != nil {
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

	hub := server.NewHub()
	srv := server.New(root, "e2e", cat, hub)
	w, err := watcher.Start(root, cat, func(events []catalog.Event) {
		for _, event := range events {
			hub.Publish(event)
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := w.Close(); err != nil {
			t.Errorf("close watcher: %v", err)
		}
	})
	srv.SetWatchEnabled(true)

	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)

	var search struct {
		Results []string `json:"results"`
	}
	getJSON(t, ts.URL+"/api/search?q=a.html", &search)
	if !slices.Contains(search.Results, "a.html") {
		t.Fatalf("search results = %v, want a.html", search.Results)
	}

	if err := os.WriteFile(filepath.Join(root, "b.html"), []byte("b"), 0o644); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for !cat.Has("b.html") && time.Now().Before(deadline) {
		time.Sleep(25 * time.Millisecond)
	}
	if !cat.Has("b.html") {
		t.Fatal("watcher did not add b.html to catalog")
	}

	assertBody(t, ts.URL+"/apps/a.html", "v1")
	assertBody(t, ts.URL+"/apps/b.html", "b")
}

func getJSON(t *testing.T, url string, target any) {
	t.Helper()
	response, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("GET %s: status = %d, want %d", url, response.StatusCode, http.StatusOK)
	}
	if err := json.NewDecoder(response.Body).Decode(target); err != nil {
		t.Fatal(err)
	}
}

func assertBody(t *testing.T, url, want string) {
	t.Helper()
	response, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK {
		t.Fatalf("GET %s: status = %d, want %d; body = %q", url, response.StatusCode, http.StatusOK, body)
	}
	if string(body) != want {
		t.Fatalf("GET %s: body = %q, want %q", url, body, want)
	}
}
