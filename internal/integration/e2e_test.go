package integration_test

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"mino/internal/catalog"
	"mino/internal/ignore"
	"mino/internal/server"
	"mino/internal/watcher"
)

// startStack wires a catalog, watcher, hub, and HTTP server over a temp root
// holding a.html and doc.md, mirroring how mino runs.
func startStack(t *testing.T) (root string, cat *catalog.Catalog, ts *httptest.Server) {
	t.Helper()

	root = t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "a.html"), []byte("v1"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "doc.md"), []byte("# doc"), 0o644); err != nil {
		t.Fatal(err)
	}

	matcher, err := ignore.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	cat = catalog.New(root, matcher)
	if err := cat.Scan(); err != nil {
		t.Fatal(err)
	}

	hub := server.NewHub()
	srv := server.New(root, "e2e", "", cat, hub)
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

	ts = httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)
	return root, cat, ts
}

func TestE2ELiveUpdate(t *testing.T) {
	root, cat, ts := startStack(t)

	assertTreeContains(t, ts.URL+"/api/tree", "a.html", "doc.md")
	assertBody(t, ts.URL+"/api/raw/doc.md", "# doc")
	assertBodyContains(t, ts.URL+"/apps/doc.md", `data-path="doc.md"`)

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

	assertTreeContains(t, ts.URL+"/api/tree", "a.html", "b.html", "doc.md")

	assertBody(t, ts.URL+"/apps/a.html", "v1")
	assertBody(t, ts.URL+"/apps/b.html", "b")
	assertBody(t, ts.URL+"/api/raw/doc.md", "# doc")
	assertBodyContains(t, ts.URL+"/apps/doc.md", `data-path="doc.md"`)
}

func TestE2ESSEAnnouncesNewFile(t *testing.T) {
	root, _, ts := startStack(t)

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, ts.URL+"/api/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Accept", "text/event-stream")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/events: status = %d, want %d", res.StatusCode, http.StatusOK)
	}
	if contentType := res.Header.Get("Content-Type"); !strings.HasPrefix(contentType, "text/event-stream") {
		t.Fatalf("content type = %q, want text/event-stream", contentType)
	}

	lines := make(chan string)
	readErrs := make(chan error, 1)
	go func() {
		defer close(lines)
		scanner := bufio.NewScanner(res.Body)
		for scanner.Scan() {
			select {
			case lines <- scanner.Text():
			case <-ctx.Done():
				return
			}
		}
		if err := scanner.Err(); err != nil {
			readErrs <- err
		}
	}()

	// The stream is live once headers arrive, so events for later writes are seen.
	if err := os.WriteFile(filepath.Join(root, "c.html"), []byte("c"), 0o644); err != nil {
		t.Fatal(err)
	}

	timeout := time.After(10 * time.Second)
	var sawAdded bool
	var payload string
	for !sawAdded || payload == "" {
		select {
		case line, ok := <-lines:
			if !ok {
				t.Fatal("event stream closed before added event")
			}
			switch {
			case line == "event: added":
				sawAdded = true
			case sawAdded && strings.HasPrefix(line, "data: "):
				payload = strings.TrimPrefix(line, "data: ")
			}
		case err := <-readErrs:
			t.Fatalf("read event stream: %v", err)
		case <-timeout:
			t.Fatal("timed out waiting for added event on /api/events")
		}
	}

	var event struct {
		Path string `json:"path"`
	}
	if err := json.Unmarshal([]byte(payload), &event); err != nil {
		t.Fatalf("decode event data %q: %v", payload, err)
	}
	if event.Path != "c.html" {
		t.Fatalf("event path = %q, want c.html", event.Path)
	}
}

func assertTreeContains(t *testing.T, url string, wantFiles ...string) {
	t.Helper()
	var tree struct {
		Name     string `json:"name"`
		Path     string `json:"path"`
		Type     string `json:"type"`
		Children []struct {
			Name string `json:"name"`
			Type string `json:"type"`
		} `json:"children"`
	}
	getJSON(t, url, &tree)
	if tree.Name != "." || tree.Path != "" || tree.Type != "dir" {
		t.Fatalf("tree root = %+v, want dir at .", tree)
	}
	names := make([]string, len(tree.Children))
	for i, child := range tree.Children {
		names[i] = child.Name
	}
	for _, want := range wantFiles {
		if !slices.Contains(names, want) {
			t.Fatalf("tree children = %v, want %q", names, want)
		}
	}
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
	body := getOKBody(t, url)
	if string(body) != want {
		t.Fatalf("GET %s: body = %q, want %q", url, body, want)
	}
}

func assertBodyContains(t *testing.T, url, want string) {
	t.Helper()
	body := getOKBody(t, url)
	if !strings.Contains(string(body), want) {
		t.Fatalf("GET %s: body = %q, want substring %q", url, body, want)
	}
}

func getOKBody(t *testing.T, url string) []byte {
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
	return body
}
