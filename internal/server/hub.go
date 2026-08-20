package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"

	"mino/internal/catalog"
)

type Hub struct {
	mu          sync.RWMutex
	subscribers map[chan catalog.Event]struct{}
}

func NewHub() *Hub {
	return &Hub{subscribers: make(map[chan catalog.Event]struct{})}
}

func (h *Hub) Publish(ev catalog.Event) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	for subscriber := range h.subscribers {
		select {
		case subscriber <- ev:
		default:
		}
	}
}

func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	subscriber := make(chan catalog.Event, 16)
	h.mu.Lock()
	h.subscribers[subscriber] = struct{}{}
	h.mu.Unlock()
	defer func() {
		h.mu.Lock()
		delete(h.subscribers, subscriber)
		h.mu.Unlock()
	}()

	flusher, canFlush := w.(http.Flusher)
	if canFlush {
		flusher.Flush()
	}

	for {
		select {
		case <-r.Context().Done():
			return
		case ev := <-subscriber:
			data, err := json.Marshal(struct {
				Path string `json:"path"`
			}{Path: ev.Path})
			if err != nil {
				continue
			}
			if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.Kind, data); err != nil {
				return
			}
			if canFlush {
				flusher.Flush()
			}
		}
	}
}
