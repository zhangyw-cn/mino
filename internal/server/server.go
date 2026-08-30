package server

import (
	"encoding/json"
	"html/template"
	"io"
	"net"
	"net/http"
	"os"
	"path"
	"strings"
	"sync"

	"github.com/zhangyw-cn/mino/internal/asset"
	"github.com/zhangyw-cn/mino/internal/catalog"
	"github.com/zhangyw-cn/mino/internal/ui"
)

// loopbackHosts are always accepted regardless of the configured listen host.
var loopbackHosts = []string{"127.0.0.1", "localhost", "[::1]", "::1"}

type Server struct {
	root     string
	cfgName  string
	cat      *catalog.Catalog
	hub      *Hub
	mdViewer *template.Template

	mu           sync.RWMutex
	watchEnabled bool
	allowedHosts map[string]struct{}
}

func New(root string, cfgName string, host string, cat *catalog.Catalog, hub *Hub) *Server {
	if hub == nil {
		hub = NewHub()
	}
	s := &Server{
		root:     root,
		cfgName:  cfgName,
		cat:      cat,
		hub:      hub,
		mdViewer: template.Must(template.ParseFS(ui.FS, "md/viewer.html")),
	}
	s.SetConfiguredHost(host)
	return s
}

// SetConfiguredHost allows requests addressed to the configured listen host in
// addition to the loopback names, blocking DNS rebinding from other names.
func (s *Server) SetConfiguredHost(host string) {
	allowed := make(map[string]struct{}, len(loopbackHosts)+1)
	for _, name := range loopbackHosts {
		allowed[name] = struct{}{}
	}
	if host = strings.ToLower(strings.TrimSpace(host)); host != "" {
		allowed[host] = struct{}{}
		allowed[strings.Trim(host, "[]")] = struct{}{}
	}
	s.mu.Lock()
	s.allowedHosts = allowed
	s.mu.Unlock()
}

func (s *Server) hostAllowed(requestHost string) bool {
	hostname := requestHost
	if host, _, err := net.SplitHostPort(requestHost); err == nil {
		hostname = host
	}
	hostname = strings.ToLower(strings.Trim(hostname, "[]"))
	s.mu.RLock()
	_, ok := s.allowedHosts[hostname]
	s.mu.RUnlock()
	return ok
}

func (s *Server) checkHost(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.hostAllowed(r.Host) {
			http.Error(w, "forbidden host", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/tree", s.treeHandler)
	mux.HandleFunc("GET /api/search", s.searchHandler)
	mux.Handle("GET /api/events", s.hub)
	mux.HandleFunc("GET /api/meta", s.metaHandler)
	mux.HandleFunc("GET /api/raw/", s.rawHandler)
	mux.HandleFunc("GET /apps/", s.appsHandler)
	mux.HandleFunc("GET /md/", s.mdAssetHandler)
	mux.HandleFunc("GET /app.js", embeddedAssetHandler("app.js", "text/javascript; charset=utf-8"))
	mux.HandleFunc("GET /fuzzy.js", embeddedAssetHandler("fuzzy.js", "text/javascript; charset=utf-8"))
	mux.HandleFunc("GET /open-path.js", embeddedAssetHandler("open-path.js", "text/javascript; charset=utf-8"))
	mux.HandleFunc("GET /preview-session.js", embeddedAssetHandler("preview-session.js", "text/javascript; charset=utf-8"))
	mux.HandleFunc("GET /style.css", embeddedAssetHandler("style.css", "text/css; charset=utf-8"))
	mux.HandleFunc("GET /{$}", s.indexHandler)
	return s.checkHost(mux)
}

func (s *Server) SetWatchEnabled(enabled bool) {
	s.mu.Lock()
	s.watchEnabled = enabled
	s.mu.Unlock()
}

func (s *Server) treeHandler(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, treeResponse(s.cat.Tree()))
}

func (s *Server) searchHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, struct {
		Results []string `json:"results"`
	}{Results: s.cat.Search(r.URL.Query().Get("q"))})
}

func (s *Server) metaHandler(w http.ResponseWriter, _ *http.Request) {
	s.mu.RLock()
	enabled := s.watchEnabled
	s.mu.RUnlock()
	writeJSON(w, struct {
		Name         string `json:"name"`
		WatchEnabled bool   `json:"watchEnabled"`
	}{
		Name:         s.cfgName,
		WatchEnabled: enabled,
	})
}

func (s *Server) appsHandler(w http.ResponseWriter, r *http.Request) {
	raw := strings.TrimPrefix(r.URL.Path, "/apps/")
	rel, err := catalog.NormalizeRel(raw)
	if err != nil || rel == "" {
		http.NotFound(w, r)
		return
	}
	if s.cat.Has(rel) {
		switch {
		case catalog.IsHTML(rel):
			s.serveAppFile(w, r, rel)
		case catalog.IsMarkdown(rel):
			s.serveMarkdownViewer(w, r, rel)
		default:
			http.NotFound(w, r)
		}
		return
	}
	if asset.Allowed(rel, s.cat.Ignored) {
		s.serveAssetFile(w, r, rel)
		return
	}
	http.NotFound(w, r)
}

func (s *Server) statRegularRel(rel string) (os.FileInfo, error) {
	root, err := os.OpenRoot(s.root)
	if err != nil {
		return nil, err
	}
	defer root.Close()

	file, err := root.Open(rel)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		return nil, os.ErrNotExist
	}
	return info, nil
}

func (s *Server) serveAppFile(w http.ResponseWriter, r *http.Request, rel string) {
	root, err := os.OpenRoot(s.root)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer root.Close()

	file, err := root.Open(rel)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, rel, info.ModTime(), file)
}

func (s *Server) serveAssetFile(w http.ResponseWriter, r *http.Request, rel string) {
	root, err := os.OpenRoot(s.root)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer root.Close()

	file, err := root.Open(rel)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, rel, info.ModTime(), file)
}

func (s *Server) serveMarkdownViewer(w http.ResponseWriter, r *http.Request, rel string) {
	if _, err := s.statRegularRel(rel); err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_ = s.mdViewer.Execute(w, struct{ Path string }{Path: rel})
}

func (s *Server) rawHandler(w http.ResponseWriter, r *http.Request) {
	raw := strings.TrimPrefix(r.URL.Path, "/api/raw/")
	rel, err := catalog.NormalizeRel(raw)
	if err != nil || rel == "" || !catalog.IsMarkdown(rel) || !s.cat.Has(rel) {
		http.NotFound(w, r)
		return
	}
	root, err := os.OpenRoot(s.root)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer root.Close()

	file, err := root.Open(rel)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = io.Copy(w, file)
}

func (s *Server) mdAssetHandler(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/md/")
	if name == "" {
		http.NotFound(w, r)
		return
	}
	cleaned := path.Clean("/" + name)
	cleaned = strings.TrimPrefix(cleaned, "/")
	if cleaned == "" || cleaned == "." {
		http.NotFound(w, r)
		return
	}
	if strings.Contains(cleaned, "_test.") || strings.HasSuffix(cleaned, "VENDOR.md") {
		http.NotFound(w, r)
		return
	}
	data, err := ui.FS.ReadFile("md/" + cleaned)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", mdAssetContentType(cleaned))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if strings.HasPrefix(cleaned, "vendor/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	}
	_, _ = w.Write(data)
}

func mdAssetContentType(name string) string {
	switch strings.ToLower(path.Ext(name)) {
	case ".js":
		return "text/javascript; charset=utf-8"
	case ".css":
		return "text/css; charset=utf-8"
	case ".html":
		return "text/html; charset=utf-8"
	case ".woff2":
		return "font/woff2"
	case ".woff":
		return "font/woff"
	case ".ttf":
		return "font/ttf"
	case ".otf":
		return "font/otf"
	default:
		return "application/octet-stream"
	}
}

func (s *Server) indexHandler(w http.ResponseWriter, r *http.Request) {
	data, err := ui.FS.ReadFile("index.html")
	if err != nil {
		http.Error(w, "embedded UI unavailable", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(data)
}

func embeddedAssetHandler(name, contentType string) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		data, err := ui.FS.ReadFile(name)
		if err != nil {
			http.Error(w, "embedded UI unavailable", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", contentType)
		_, _ = w.Write(data)
	}
}

type treeNode struct {
	Name     string      `json:"name"`
	Path     string      `json:"path"`
	Type     string      `json:"type"`
	Children []*treeNode `json:"children"`
}

func treeResponse(node *catalog.Node) *treeNode {
	if node == nil {
		return nil
	}
	result := &treeNode{
		Name: node.Name,
		Path: node.Path,
		Type: node.Type,
	}
	for _, child := range node.Children {
		result.Children = append(result.Children, treeResponse(child))
	}
	return result
}

func writeJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(value)
}
