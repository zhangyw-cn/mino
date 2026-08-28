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

	"github.com/zhangyw-cn/mino/internal/catalog"
	"github.com/zhangyw-cn/mino/internal/ignore"
	"github.com/zhangyw-cn/mino/internal/server"
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
		"/md/toc.js",
		"/md/preview-width.js",
		"/md/mermaid-block.js",
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
		"nodes: [inst.diagramEl]",
		"createMermaidBlock",
		"MinoMDMermaidBlock",
		"MinoMDToc",
		"ensureHeadingIds",
		"scrollIntoView",
		"On this page",
		"MinoMDPreviewWidth",
		"data-md-width",
		"parsePreviewWidthMessage",
		"MinoPreviewSession",
		"previewReadyMessage",
		"previewErrorMessage",
		"preview-navigate",
		"preview-reload",
		"requestGen",
		"scrollTo",
		"closeMermaidFullscreen",
	} {
		if !strings.Contains(js, marker) {
			t.Fatalf("viewer.js missing %q", marker)
		}
	}
	if strings.Count(js, "buildToc(content)") < 2 {
		t.Fatal("viewer.js must call buildToc(content) on path-change failure as well as successful paint")
	}

	cssRes, err := http.Get(ts.URL + "/md/viewer.css")
	if err != nil {
		t.Fatal(err)
	}
	cssBody, _ := io.ReadAll(cssRes.Body)
	cssRes.Body.Close()
	if cssRes.StatusCode != http.StatusOK {
		t.Fatalf("viewer.css status %d", cssRes.StatusCode)
	}
	css := string(cssBody)
	for _, marker := range []string{
		`html[data-md-width="standard"]`,
		`html[data-md-width="wide"]`,
		`html[data-md-width="full"]`,
		"max-width: 960px",
		"max-width: 1400px",
	} {
		if !strings.Contains(css, marker) {
			t.Fatalf("viewer.css missing %q", marker)
		}
	}
	if strings.Contains(css, "max-width: 860px") {
		t.Fatal("viewer.css must not keep the 860px article cap")
	}
	if strings.Contains(css, "max-width: 1120px") {
		t.Fatal("viewer.css must not keep the 1120px layout cap")
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
	if !strings.Contains(html, "/preview-session.js") {
		t.Fatalf("missing preview-session.js: %s", body)
	}
	if !strings.Contains(html, "/md/preprocess.js") {
		t.Fatalf("missing preprocess.js: %s", body)
	}
	if !strings.Contains(html, `id="toc"`) {
		t.Fatalf("missing toc shell: %s", body)
	}
	if !strings.Contains(html, "/md/toc.js") {
		t.Fatalf("missing toc.js: %s", body)
	}
	if !strings.Contains(html, "/md/preview-width.js") {
		t.Fatalf("missing preview-width.js: %s", body)
	}
	if !strings.Contains(html, "/md/mermaid-block.js") {
		t.Fatalf("missing mermaid-block.js: %s", body)
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
		`id="quick-open-backdrop"`,
		`role="dialog"`,
		`/fuzzy.js`,
		`/open-path.js`,
		`/preview-session.js`,
		`class="search-wrap"`,
	} {
		if !strings.Contains(html, marker) {
			t.Fatalf("index missing %q", marker)
		}
	}
	if strings.Contains(html, `id="search"`) {
		t.Fatal("index must not include top-bar #search")
	}
	openPathSrc := strings.Index(html, `src="/open-path.js"`)
	appSrc := strings.Index(html, `src="/app.js"`)
	if openPathSrc < 0 || appSrc < 0 || openPathSrc > appSrc {
		t.Fatal("index must load /open-path.js before /app.js")
	}
	sessionSrc := strings.Index(html, `src="/preview-session.js"`)
	if sessionSrc < 0 || sessionSrc > appSrc {
		t.Fatal("index must load /preview-session.js before /app.js")
	}
	if strings.Contains(html, `id="quick-open-footer"`) {
		t.Fatal("index must not include #quick-open-footer")
	}
	if strings.Contains(html, "recently opened") {
		t.Fatal("index must not include recently opened footer")
	}
	for _, marker := range []string{
		`data-icon="search"`,
		`data-icon="explorer"`,
		`data-icon="collapse"`,
		`data-icon="empty"`,
		`class="command-center-label"`,
		`class="quick-open-input-wrap"`,
		`<label class="quick-open-input-wrap"`,
		"Choose an HTML or Markdown file from the sidebar.",
	} {
		if !strings.Contains(html, marker) {
			t.Fatalf("index missing %q", marker)
		}
	}
	if strings.Contains(html, "☰") {
		t.Fatal("index must not include hamburger glyph")
	}
	if strings.Contains(html, "◇") {
		t.Fatal("index must not include diamond glyph")
	}
	if strings.Contains(html, "⟨") {
		t.Fatal("index must not include collapse chevron glyph")
	}
	if strings.Contains(html, "Choose an HTML file from the sidebar.") {
		t.Fatal("index must not use HTML-only empty copy")
	}
	for _, marker := range []string{
		`<footer class="status-bar">`,
		`id="md-width-wrap"`,
		`id="md-width-button"`,
		`id="md-width-menu"`,
		`aria-haspopup="menu"`,
		`data-md-width="standard"`,
		`data-md-width="wide"`,
		`data-md-width="full"`,
		"/md/preview-width.js",
		"标宽",
		"较宽",
		"全宽",
	} {
		if !strings.Contains(html, marker) {
			t.Fatalf("index missing %q", marker)
		}
	}
	if strings.Contains(html, "#007ACC") || strings.Contains(html, "#007acc") {
		t.Fatal("index must not use Default Dark+ status blue")
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

func TestOpenPathJSServed(t *testing.T) {
	_, ts, _ := newTestServer(t)
	defer ts.Close()

	res, err := http.Get(ts.URL + "/open-path.js")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status %d", res.StatusCode)
	}
	js := string(body)
	for _, marker := range []string{
		"MinoOpenPath",
		`"mino-open-path"`,
		"parseOpenPath",
		"readOpenPath",
		"writeOpenPath",
		"clearOpenPath",
		"resolveOpenPath",
		"createOpenPathRestore",
	} {
		if !strings.Contains(js, marker) {
			t.Fatalf("open-path.js missing %q", marker)
		}
	}
}

func TestPreviewSessionJSServed(t *testing.T) {
	_, ts, _ := newTestServer(t)
	defer ts.Close()

	res, err := http.Get(ts.URL + "/preview-session.js")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status %d", res.StatusCode)
	}
	js := string(body)
	for _, marker := range []string{
		"MinoPreviewSession",
		"kindId",
		"inPlace",
		"decidePreviewAction",
		"preview-navigate",
		"preview-reload",
		"preview-ready",
		"preview-error",
		"parsePreviewMessage",
	} {
		if !strings.Contains(js, marker) {
			t.Fatalf("preview-session.js missing %q", marker)
		}
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
		"quick-open-input",
		"command-center",
		"commandCenter.title",
		"tabIndex = -1",
		"quickOpenInput.blur()",
		`key === "e"`,
		`key === "p"`,
		"quickOpenBackdrop",
		`key === "Escape"`,
		`quickOpenBackdrop.addEventListener("pointerdown"`,
		"setPointerCapture",
		`doc.addEventListener("keydown", onQuickOpenHotkey`,
		"fileIconName",
		"fillIcons",
		"fillIcons();",
		"ICON_PATHS",
		`lastIndexOf(".")`,
		"command-center-label",
		`createElementNS`,
		`icon("folder")`,
		`icon("folder-open")`,
		"No HTML or Markdown files found.",
		"quick-open-icon",
		"MinoMDPreviewWidth",
		"syncMdWidthControl",
		"postMdWidthToPreview",
		"md-preview-width",
		"setMdWidthMenuOpen",
		"MinoOpenPath",
		"maybeRestoreOpenPath",
		"createOpenPathRestore",
		"takeOpenPathRestore",
		"sessionStore",
		"persistOpenPath",
		"forgetOpenPath",
		"revealSelectedFile",
		"scrollIntoView",
		"writeOpenPath",
		"clearOpenPath",
		"MinoPreviewSession",
		"decidePreviewAction",
		"displayedPath",
		"preview-pending",
		"setPreviewPending",
		"openFile(currentPath, true)",
		"previewNavigateMessage",
		"previewReloadMessage",
		"parsePreviewMessage",
		"preview-ready",
	} {
		if !strings.Contains(js, marker) {
			t.Fatalf("app.js missing contract %q", marker)
		}
	}
	if !strings.Contains(js, `parsed.type === "preview-ready"`) &&
		!strings.Contains(js, `parsed.type === 'preview-ready'`) {
		t.Fatal("app.js must reveal in-place kinds on preview-ready")
	}
	if strings.Contains(js, `"◇"`) || strings.Contains(js, "'◇'") {
		t.Fatal("app.js must not use diamond file glyphs")
	}
	if strings.Contains(js, "No HTML files found.") {
		t.Fatal("app.js must not use HTML-only empty tree copy")
	}
	if strings.Contains(js, "fileChipClass") {
		t.Fatal("app.js must not use fileChipClass")
	}
	if strings.Contains(js, "quick-open-chip") {
		t.Fatal("app.js must not use quick-open-chip")
	}
	if strings.Contains(js, "quickOpenFooter") {
		t.Fatal("app.js must not reference quickOpenFooter")
	}
	if strings.Contains(js, "recently opened") {
		t.Fatal("app.js must not include recently opened")
	}
	if strings.Contains(js, "commandCenter.textContent") {
		t.Fatal("app.js must not set commandCenter.textContent")
	}
	if strings.Contains(js, "writeOpenPath(localStorage") {
		t.Fatal("app.js must not persist the open path in localStorage")
	}
	if !strings.Contains(js, "writeOpenPath(sessionStore()") {
		t.Fatal("app.js must persist the open path through sessionStore()")
	}
	if strings.Contains(js, "history.pushState") || strings.Contains(js, "history.replaceState") {
		t.Fatal("app.js must not change history for the open path")
	}
	if strings.Contains(js, `if (kind === "changed") preview.src`) {
		t.Fatal("SSE changed must not assign preview.src directly")
	}
	loadTreeStart := strings.Index(js, "async function loadTree")
	loadMetaStart := strings.Index(js, "async function loadMeta")
	if loadTreeStart < 0 || loadMetaStart < 0 || loadTreeStart > loadMetaStart {
		t.Fatal("app.js must define loadTree before loadMeta")
	}
	loadTree := js[loadTreeStart:loadMetaStart]
	restoreCall := strings.Index(loadTree, "maybeRestoreOpenPath();")
	catchIdx := strings.Index(loadTree, "catch (error)")
	if restoreCall < 0 || catchIdx < 0 || restoreCall > catchIdx {
		t.Fatal("maybeRestoreOpenPath must run in loadTree try, not catch")
	}
	if strings.Contains(loadTree[catchIdx:], "maybeRestoreOpenPath();") {
		t.Fatal("loadTree catch must not call maybeRestoreOpenPath")
	}
	if strings.Contains(js, `"file-html": FILE_PATH,`) || strings.Contains(js, `"file-html": FILE_PATH}`) {
		t.Fatal("html icon must not reuse the generic file path")
	}
	if strings.Contains(js, `"file-md": FILE_PATH,`) || strings.Contains(js, `"file-md": FILE_PATH}`) {
		t.Fatal("markdown icon must not reuse the generic file path")
	}
	if !strings.Contains(js, `"file-html": FILE_PATH +`) {
		t.Fatal("html icon must add a type mark to the file silhouette")
	}
	if !strings.Contains(js, `"file-md": FILE_PATH +`) {
		t.Fatal("markdown icon must add a type mark to the file silhouette")
	}
	if !strings.Contains(js, `"file-html": "#e36e6e"`) {
		t.Fatal("html icon must use the document-chip red")
	}
	if !strings.Contains(js, `"file-md": "#519aba"`) {
		t.Fatal("markdown icon must use the document-chip blue")
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
		".quick-open-icon",
		"#quick-open-backdrop",
		"inset: 0",
		"min(600px, 70vw)",
		"min-height: 22px",
		"z-index: 40",
		"height: 24px",
		"line-height: 22px",
		".quick-open-input-wrap",
		".quick-open-input-wrap [data-icon]",
		"::-webkit-search-decoration",
		".command-center-label",
		".icon-folder-open",
		".breadcrumb",
		".status-bar",
		"height: 22px",
		"#md-width-menu",
		"#md-width-wrap",
		"#preview.preview-pending",
		"visibility: hidden",
	} {
		if !strings.Contains(css, marker) {
			t.Fatalf("style.css missing contract %q", marker)
		}
	}
	if strings.Contains(css, ".quick-open-chip") {
		t.Fatal("style.css must not include .quick-open-chip")
	}
	if strings.Contains(css, "background: #ffffff") {
		t.Fatal("style.css must not paint the iframe white")
	}
	statusIdx := strings.Index(css, ".status-bar {")
	if statusIdx < 0 {
		t.Fatal("style.css missing .status-bar block")
	}
	block := css[statusIdx:]
	if end := strings.Index(block, "\n}"); end >= 0 {
		block = block[:end]
	}
	if strings.Contains(block, "#007ACC") || strings.Contains(block, "#007acc") {
		t.Fatal("status bar must not use Default Dark+ blue")
	}
	if !strings.Contains(block, "var(--bg-shell)") {
		t.Fatal("status bar must use --bg-shell")
	}
}
