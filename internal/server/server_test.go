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
	"github.com/zhangyw-cn/mino/internal/ui"
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

func TestCompanionAssets(t *testing.T) {
	_, ts, root := newTestServer(t)
	defer ts.Close()

	if err := os.WriteFile(filepath.Join(root, "notes", "app.css"), []byte("body{color:red}"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "notes", "secret.go"), []byte("package n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "notes", ".hidden"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "notes", ".hidden", "x.png"), []byte("png"), 0o644); err != nil {
		t.Fatal(err)
	}

	res, err := http.Get(ts.URL + "/apps/notes/app.css")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("app.css status %d", res.StatusCode)
	}
	if string(body) != "body{color:red}" {
		t.Fatalf("app.css body = %q", body)
	}
	if res.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", res.Header.Get("Cache-Control"))
	}
	if res.Header.Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("missing nosniff")
	}

	res, err = http.Get(ts.URL + "/apps/notes/a.html")
	if err != nil {
		t.Fatal(err)
	}
	body, _ = io.ReadAll(res.Body)
	res.Body.Close()
	if !strings.Contains(string(body), "<h1>hi</h1>") {
		t.Fatal("catalog HTML must still be served")
	}
	if res.Header.Get("Cache-Control") == "no-store" {
		t.Fatal("catalog HTML must not gain asset no-store")
	}

	res, err = http.Get(ts.URL + "/apps/notes/readme.md")
	if err != nil {
		t.Fatal(err)
	}
	body, _ = io.ReadAll(res.Body)
	res.Body.Close()
	if !strings.Contains(string(body), `data-path="notes/readme.md"`) {
		t.Fatal("markdown must remain the viewer")
	}

	for _, url := range []string{
		"/apps/notes/secret.go",
		"/apps/notes/.hidden/x.png",
		"/apps/missing.css",
	} {
		res, err = http.Get(ts.URL + url)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != http.StatusNotFound {
			t.Fatalf("%s status %d, want 404", url, res.StatusCode)
		}
	}

	res, err = http.Get(ts.URL + "/api/tree")
	if err != nil {
		t.Fatal(err)
	}
	treeBody, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if strings.Contains(string(treeBody), "app.css") {
		t.Fatal("tree must not list companion css")
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
	if !strings.Contains(html, `id="root"`) {
		t.Fatalf("missing viewer root: %s", body)
	}
	if !strings.Contains(html, `type="module"`) || !strings.Contains(html, `/assets/`) {
		t.Fatalf("missing bundled viewer assets: %s", body)
	}
	if !strings.Contains(html, "Content-Security-Policy") {
		t.Fatal("markdown viewer must set CSP")
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

func TestIndexServesViteDist(t *testing.T) {
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
	if !strings.Contains(html, `id="root"`) {
		t.Fatal("index must mount React at #root")
	}
	if !strings.Contains(html, `/assets/`) || !strings.Contains(html, `type="module"`) {
		t.Fatalf("index must reference hashed Vite assets: %s", html)
	}
}

func TestDistAssetsServed(t *testing.T) {
	_, ts, _ := newTestServer(t)
	defer ts.Close()

	res, err := http.Get(ts.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	indexHTML, _ := io.ReadAll(res.Body)
	res.Body.Close()

	const prefix = `src="/assets/`
	start := strings.Index(string(indexHTML), prefix)
	if start < 0 {
		t.Fatal("index.html missing /assets/ script")
	}
	start += len(`src="`)
	end := strings.Index(string(indexHTML)[start:], `"`)
	if end < 0 {
		t.Fatal("malformed script src")
	}
	assetPath := string(indexHTML)[start : start+end]

	res, err = http.Get(ts.URL + assetPath)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("%s status %d", assetPath, res.StatusCode)
	}
	if len(body) == 0 {
		t.Fatalf("%s empty body", assetPath)
	}
	if cc := res.Header.Get("Cache-Control"); !strings.Contains(cc, "immutable") {
		t.Fatalf("Cache-Control = %q, want immutable", cc)
	}
	if ct := res.Header.Get("Content-Type"); !strings.Contains(ct, "javascript") {
		t.Fatalf("Content-Type %q", ct)
	}
}

func TestEmbeddedHTMLAssetRefsExist(t *testing.T) {
	check := func(name, html string) {
		t.Helper()
		for _, attr := range []string{`src="/assets/`, `href="/assets/`} {
			rest := html
			for {
				i := strings.Index(rest, attr)
				if i < 0 {
					break
				}
				start := i + len(`src="`)
				if strings.HasPrefix(attr, "href") {
					start = i + len(`href="`)
				}
				end := strings.Index(rest[start:], `"`)
				if end < 0 {
					t.Fatalf("%s: malformed %s", name, attr)
				}
				rel := rest[start : start+end]
				if !strings.HasPrefix(rel, "/assets/") {
					t.Fatalf("%s: unexpected asset path %q", name, rel)
				}
				embedPath := "dist" + rel
				if _, err := ui.FS.ReadFile(embedPath); err != nil {
					t.Fatalf("%s references missing embed file %s: %v", name, embedPath, err)
				}
				rest = rest[start+end+1:]
			}
		}
	}

	index, err := ui.FS.ReadFile("dist/index.html")
	if err != nil {
		t.Fatal(err)
	}
	check("dist/index.html", string(index))

	viewer, err := ui.FS.ReadFile("viewer_template.html")
	if err != nil {
		t.Fatal(err)
	}
	check("viewer_template.html", string(viewer))
}

func TestLegacyStaticRoutesRemoved(t *testing.T) {
	_, ts, _ := newTestServer(t)
	defer ts.Close()

	for _, path := range []string{
		"/app.js",
		"/fuzzy.js",
		"/style.css",
		"/md/viewer.js",
		"/md/vendor/marked.min.js",
	} {
		res, err := http.Get(ts.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != http.StatusNotFound {
			t.Fatalf("%s status %d, want 404", path, res.StatusCode)
		}
	}
}
