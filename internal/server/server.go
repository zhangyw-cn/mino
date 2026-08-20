package server

import (
	"encoding/json"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"

	"mino/internal/catalog"
	"mino/internal/ui"
)

// loopbackHosts are always accepted regardless of the configured listen host.
var loopbackHosts = []string{"127.0.0.1", "localhost", "[::1]", "::1"}

type Server struct {
	root    string
	cfgName string
	cat     *catalog.Catalog
	hub     *Hub

	mu           sync.RWMutex
	watchEnabled bool
	allowedHosts map[string]struct{}
}

func New(root string, cfgName string, host string, cat *catalog.Catalog, hub *Hub) *Server {
	if hub == nil {
		hub = NewHub()
	}
	s := &Server{
		root:    root,
		cfgName: cfgName,
		cat:     cat,
		hub:     hub,
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
	mux.HandleFunc("GET /apps/", s.appsHandler)
	mux.HandleFunc("GET /app.js", embeddedAssetHandler("app.js", "text/javascript; charset=utf-8"))
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
	if err != nil || rel == "" || !catalog.IsHTML(rel) || !s.cat.Has(rel) {
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
	http.ServeContent(w, r, rel, info.ModTime(), file)
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
