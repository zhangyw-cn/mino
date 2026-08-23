package server_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/zhangyw-cn/mino/internal/catalog"
	"github.com/zhangyw-cn/mino/internal/server"
)

type flushRecorder struct {
	*httptest.ResponseRecorder
	mu sync.Mutex
}

func (r *flushRecorder) Write(p []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.ResponseRecorder.Write(p)
}

func (r *flushRecorder) Flush() {}

func (r *flushRecorder) body() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.Body.String()
}

func TestHubSSE(t *testing.T) {
	h := server.NewHub()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	req := httptest.NewRequestWithContext(ctx, http.MethodGet, "/api/events", nil)
	rr := &flushRecorder{ResponseRecorder: httptest.NewRecorder()}
	started := make(chan struct{})
	go func() {
		close(started)
		h.ServeHTTP(rr, req)
	}()
	<-started

	deadline := time.Now().Add(2 * time.Second)
	for {
		h.Publish(catalog.Event{Kind: catalog.EventAdded, Path: "a.html"})
		body := rr.body()
		if strings.Contains(body, "event: added") && strings.Contains(body, `data: {"path":"a.html"}`) {
			cancel()
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("missing event in %q", body)
		}
		time.Sleep(10 * time.Millisecond)
	}
}
