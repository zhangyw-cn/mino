package server_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"mino/internal/catalog"
	"mino/internal/ignore"
	"mino/internal/server"
)

func newTestServer(t *testing.T) (*server.Server, *httptest.Server, string) {
	t.Helper()

	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "notes"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "notes", "a.html"), []byte("<h1>hi</h1>"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "notes", "readme.md"), []byte("# Hello\n"), 0o644); err != nil {
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

	srv := server.New(root, "demo", "", cat, server.NewHub())
	return srv, httptest.NewServer(srv.Handler()), root
}

func TestTreeSearchAndApps(t *testing.T) {
	_, ts, _ := newTestServer(t)
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

func TestMDVendorAssetsServed(t *testing.T) {
	_, ts, _ := newTestServer(t)
	defer ts.Close()

	for _, path := range []string{
		"/md/vendor/marked.min.js",
		"/md/vendor/purify.min.js",
		"/md/vendor/highlight.min.js",
		"/md/vendor/highlight.min.css",
		"/md/vendor/katex.min.js",
		"/md/vendor/mermaid.min.js",
		"/md/vendor/katex.min.css",
		"/md/viewer.css",
		"/md/preprocess.js",
		"/md/vendor/fonts/KaTeX_Main-Regular.woff2",
	} {
		res, err := http.Get(ts.URL + path)
		if err != nil {
			t.Fatalf("%s: %v", path, err)
		}
		body, err := io.ReadAll(res.Body)
		res.Body.Close()
		if err != nil {
			t.Fatalf("%s: %v", path, err)
		}
		if res.StatusCode != http.StatusOK {
			t.Fatalf("%s: status %d", path, res.StatusCode)
		}
		if len(body) == 0 {
			t.Fatalf("%s: empty body", path)
		}
		if string(body) == "\n" {
			t.Fatalf("%s: still the single-newline stub", path)
		}
		if path == "/md/vendor/katex.min.css" {
			css := string(body)
			if !strings.Contains(css, "url(/md/vendor/fonts/") {
				t.Fatal("katex.min.css missing rewritten font URLs")
			}
			if strings.Contains(css, "url(fonts/") {
				t.Fatal("katex.min.css still has relative font URLs")
			}
			if strings.Contains(css, ".woff)") || strings.Contains(css, ".ttf)") {
				t.Fatal("katex.min.css still references woff/ttf fallbacks")
			}
		}
	}

	res, err := http.Get(ts.URL + "/md/preprocess_test.mjs")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("test artifact status %d, want 404", res.StatusCode)
	}
}

func TestViewerPipelineMarkers(t *testing.T) {
	_, ts, _ := newTestServer(t)
	defer ts.Close()

	res, err := http.Get(ts.URL + "/md/viewer.js")
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(res.Body)
	res.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status %d", res.StatusCode)
	}
	js := string(body)
	for _, marker := range []string{
		"DOMPurify",
		"mermaid",
		"katex",
		"/api/raw/",
		`cache: "no-store"`,
		"MinoMDPreprocess",
		`securityLevel: "strict"`,
		"nodes: [node]",
	} {
		if !strings.Contains(js, marker) {
			t.Fatalf("viewer.js missing %q", marker)
		}
	}
}

func TestMarkdownAppsAndRaw(t *testing.T) {
	_, ts, _ := newTestServer(t)
	defer ts.Close()

	res, err := http.Get(ts.URL + "/apps/notes/readme.md")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status %d", res.StatusCode)
	}
	if ct := res.Header.Get("Content-Type"); !strings.Contains(ct, "text/html") {
		t.Fatalf("Content-Type %q", ct)
	}
	html := string(body)
	if !strings.Contains(html, `data-path="notes/readme.md"`) {
		t.Fatalf("missing data-path: %s", body)
	}
	if !strings.Contains(html, "/md/viewer.js") {
		t.Fatalf("missing viewer.js: %s", body)
	}
	if !strings.Contains(html, "/md/preprocess.js") {
		t.Fatalf("missing preprocess.js: %s", body)
	}

	res, err = http.Get(ts.URL + "/md/viewer.js")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("viewer.js status %d", res.StatusCode)
	}

	res, err = http.Get(ts.URL + "/md/vendor/marked.min.js")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("marked.min.js status %d", res.StatusCode)
	}

	res, err = http.Get(ts.URL + "/api/raw/notes/readme.md")
	if err != nil {
		t.Fatal(err)
	}
	body, _ = io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status %d", res.StatusCode)
	}
	if ct := res.Header.Get("Content-Type"); !strings.Contains(ct, "text/plain") {
		t.Fatalf("Content-Type %q", ct)
	}
	if cc := res.Header.Get("Cache-Control"); cc != "no-store" {
		t.Fatalf("Cache-Control %q, want no-store", cc)
	}
	if string(body) != "# Hello\n" {
		t.Fatalf("raw body %q", body)
	}

	res, err = http.Get(ts.URL + "/api/raw/notes/a.html")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("status %d", res.StatusCode)
	}

	res, err = http.Get(ts.URL + "/api/raw/../notes/readme.md")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNotFound && res.StatusCode != http.StatusForbidden {
		t.Fatalf("status %d", res.StatusCode)
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

	res, err = http.Get(ts.URL + "/api/search?q=readme")
	if err != nil {
		t.Fatal(err)
	}
	body, _ = io.ReadAll(res.Body)
	res.Body.Close()
	if !strings.Contains(string(body), "notes/readme.md") {
		t.Fatalf("%s", body)
	}
}

func TestRawRefusesCataloguedMdReplacedBySymlink(t *testing.T) {
	_, ts, root := newTestServer(t)
	defer ts.Close()

	outside := filepath.Join(t.TempDir(), "outside.txt")
	const outsideBody = "outside secret"
	if err := os.WriteFile(outside, []byte(outsideBody), 0o644); err != nil {
		t.Fatal(err)
	}

	md := filepath.Join(root, "notes", "readme.md")
	if err := os.Remove(md); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, md); err != nil {
		t.Fatal(err)
	}

	res, err := http.Get(ts.URL + "/api/raw/notes/readme.md")
	if err != nil {
		t.Fatal(err)
	}
	body, readErr := io.ReadAll(res.Body)
	res.Body.Close()
	if readErr != nil {
		t.Fatal(readErr)
	}
	if res.StatusCode == http.StatusOK && strings.Contains(string(body), outsideBody) {
		t.Fatalf("served outside symlink target: %q", body)
	}
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("status %d, want 404", res.StatusCode)
	}
}

func TestMarkdownViewer404WhenFileRemoved(t *testing.T) {
	srv, ts, root := newTestServer(t)
	defer ts.Close()

	md := filepath.Join(root, "notes", "readme.md")
	if err := os.Remove(md); err != nil {
		t.Fatal(err)
	}

	res, err := http.Get(ts.URL + "/apps/notes/readme.md")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("status %d, want 404 when file removed but catalog stale", res.StatusCode)
	}

	res, err = http.Get(ts.URL + "/api/raw/notes/readme.md")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("raw status %d, want 404 when file removed", res.StatusCode)
	}
	_ = srv
}

func TestMarkdownViewerDataPathEscapesQuotes(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "notes"), 0o755); err != nil {
		t.Fatal(err)
	}
	name := `we"ird.md`
	if err := os.WriteFile(filepath.Join(root, "notes", name), []byte("# x"), 0o644); err != nil {
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
	ts := httptest.NewServer(server.New(root, "demo", "", cat, server.NewHub()).Handler())
	defer ts.Close()

	res, err := http.Get(ts.URL + "/apps/notes/we%22ird.md")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status %d", res.StatusCode)
	}
	if !strings.Contains(string(body), `data-path="notes/we&#34;ird.md"`) &&
		!strings.Contains(string(body), `data-path="notes/we&quot;ird.md"`) {
		t.Fatalf("missing escaped data-path: %s", body)
	}
}

func TestAppsRefusesCataloguedFileReplacedBySymlink(t *testing.T) {
	_, ts, root := newTestServer(t)
	defer ts.Close()

	outside := filepath.Join(t.TempDir(), "outside.html")
	const outsideBody = "<h1>outside secret</h1>"
	if err := os.WriteFile(outside, []byte(outsideBody), 0o644); err != nil {
		t.Fatal(err)
	}

	app := filepath.Join(root, "notes", "a.html")
	if err := os.Remove(app); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, app); err != nil {
		t.Fatal(err)
	}

	res, err := http.Get(ts.URL + "/apps/notes/a.html")
	if err != nil {
		t.Fatal(err)
	}
	body, readErr := io.ReadAll(res.Body)
	res.Body.Close()
	if readErr != nil {
		t.Fatal(readErr)
	}
	if strings.Contains(string(body), outsideBody) {
		t.Fatalf("served outside symlink target with status %d: %q", res.StatusCode, body)
	}
}

func TestAppsServesFilenameWithBackslash(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("backslash is a path separator on Windows")
	}
	root := t.TempDir()
	const body = "<h1>weird</h1>"
	if err := os.WriteFile(filepath.Join(root, `we\ird.html`), []byte(body), 0o644); err != nil {
		t.Skipf("filesystem rejects backslash in filenames: %v", err)
	}
	matcher, err := ignore.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	cat := catalog.New(root, matcher)
	if err := cat.Scan(); err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(server.New(root, "demo", "", cat, server.NewHub()).Handler())
	defer ts.Close()

	res, err := http.Get(ts.URL + "/apps/we%5Cird.html")
	if err != nil {
		t.Fatal(err)
	}
	got, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusOK || string(got) != body {
		t.Fatalf("status = %d, body = %q, want %d and %q", res.StatusCode, got, http.StatusOK, body)
	}
}

func TestRejectsForeignHostHeader(t *testing.T) {
	_, ts, _ := newTestServer(t)
	defer ts.Close()

	do := func(host string) int {
		t.Helper()
		req, err := http.NewRequest(http.MethodGet, ts.URL+"/api/tree", nil)
		if err != nil {
			t.Fatal(err)
		}
		if host != "" {
			req.Host = host
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		return res.StatusCode
	}

	if got := do("evil.example.com"); got != http.StatusForbidden {
		t.Fatalf("foreign host: status = %d, want %d", got, http.StatusForbidden)
	}
	if got := do("evil.example.com:8080"); got != http.StatusForbidden {
		t.Fatalf("foreign host with port: status = %d, want %d", got, http.StatusForbidden)
	}
	for _, host := range []string{"", "localhost:1234", "127.0.0.1:1234", "[::1]:1234"} {
		if got := do(host); got != http.StatusOK {
			t.Fatalf("host %q: status = %d, want %d", host, got, http.StatusOK)
		}
	}
}

func TestAllowsConfiguredHost(t *testing.T) {
	root := t.TempDir()
	matcher, err := ignore.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	cat := catalog.New(root, matcher)
	if err := cat.Scan(); err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(server.New(root, "demo", "192.168.1.10", cat, server.NewHub()).Handler())
	defer ts.Close()

	req, err := http.NewRequest(http.MethodGet, ts.URL+"/api/tree", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Host = "192.168.1.10:8080"
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("configured host: status = %d, want %d", res.StatusCode, http.StatusOK)
	}
}

func TestMetaAndIndex(t *testing.T) {
	srv, ts, _ := newTestServer(t)
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
}

func TestIndexHTMLHasIframeAndAppJS(t *testing.T) {
	_, ts, _ := newTestServer(t)
	defer ts.Close()

	res, err := http.Get(ts.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status %d", res.StatusCode)
	}
	html := string(body)
	for _, marker := range []string{
		"<iframe",
		"/app.js",
		`<main class="workbench">`,
		`id="activity-files"`,
		`id="sidebar" class="sidebar"`,
		`id="sidebar-collapse"`,
		`id="breadcrumb"`,
		`class="activity-bar"`,
		`id="command-center"`,
		`id="quick-open"`,
		`id="quick-open-input"`,
		`id="quick-open-list"`,
		`id="quick-open-footer"`,
		`/fuzzy.js`,
		`class="search-wrap"`,
	} {
		if !strings.Contains(html, marker) {
			t.Fatalf("index missing %q", marker)
		}
	}
}

func TestFuzzyJSServed(t *testing.T) {
	_, ts, _ := newTestServer(t)
	defer ts.Close()

	res, err := http.Get(ts.URL + "/fuzzy.js")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status %d", res.StatusCode)
	}
	js := string(body)
	if !strings.Contains(js, "MinoFuzzy") {
		t.Fatal("fuzzy.js missing MinoFuzzy")
	}
	if !strings.Contains(js, "function filter") {
		t.Fatal("fuzzy.js missing filter")
	}
}

func TestAppJSWorkbenchContracts(t *testing.T) {
	_, ts, _ := newTestServer(t)
	defer ts.Close()

	res, err := http.Get(ts.URL + "/app.js")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status %d", res.StatusCode)
	}
	js := string(body)
	if strings.Contains(js, "sidebar.hidden =") {
		t.Fatal("app.js must not set sidebar.hidden (breaks workbench grid)")
	}
	if strings.Contains(js, "/api/search") {
		t.Fatal("app.js must not call /api/search")
	}
	if strings.Contains(js, `key !== "f"`) || strings.Contains(js, `key !== 'f'`) {
		t.Fatal("app.js must not intercept Ctrl/Cmd+F")
	}
	for _, marker := range []string{
		"sidebar.inert",
		"setBreadcrumb",
		"sidebar-collapsed",
		"preventDefault",
		"event.altKey",
		"event.shiftKey",
		"MinoFuzzy",
		"contentDocument",
		"Type to search files",
		"No matching files.",
		"recently opened",
		"quick-open-input",
		"command-center",
		"quickOpenInput.blur()",
		`key === "e"`,
		`key === "p"`,
	} {
		if !strings.Contains(js, marker) {
			t.Fatalf("app.js missing contract %q", marker)
		}
	}

	cssRes, err := http.Get(ts.URL + "/style.css")
	if err != nil {
		t.Fatal(err)
	}
	cssBody, _ := io.ReadAll(cssRes.Body)
	cssRes.Body.Close()
	if cssRes.StatusCode != http.StatusOK {
		t.Fatalf("style.css status %d", cssRes.StatusCode)
	}
	css := string(cssBody)
	for _, marker := range []string{
		".activity-item:focus-visible",
		".icon-button:focus-visible",
		"grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr)",
		"#command-center",
		"position: fixed",
		"#37373d",
		"#4fc1ff",
		".quick-open-chip",
	} {
		if !strings.Contains(css, marker) {
			t.Fatalf("style.css missing contract %q", marker)
		}
	}
}
