package main

import (
	"context"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"

	"mino/internal/catalog"
	"mino/internal/config"
	"mino/internal/ignore"
	"mino/internal/server"
	"mino/internal/watcher"
)

func main() {
	portFlag := flag.Int("port", -1, "override listen port")
	root := "."
	args := os.Args[1:]
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		root = args[0]
		args = args[1:]
	}
	if err := flag.CommandLine.Parse(args); err != nil {
		fail(err)
	}
	if root == "." && flag.NArg() > 0 {
		root = flag.Arg(0)
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		fail(err)
	}
	info, err := os.Stat(abs)
	if err != nil || !info.IsDir() {
		fail(fmt.Errorf("root must be an existing directory: %s", abs))
	}

	cfg, err := config.Load(abs)
	if err != nil {
		fail(err)
	}
	if *portFlag >= 0 {
		cfg.Port = *portFlag
	}

	matcher, err := ignore.New(cfg.Ignore)
	if err != nil {
		fail(err)
	}
	cat := catalog.New(abs, matcher)
	if err := cat.Scan(); err != nil {
		fail(err)
	}

	hub := server.NewHub()
	srv := server.New(abs, cfg.Name, cat, hub)
	watchEnabled := true
	w, err := watcher.Start(abs, cat, func(evs []catalog.Event) {
		for _, event := range evs {
			hub.Publish(event)
		}
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "mino: watcher disabled: %v\n", err)
		watchEnabled = false
	} else {
		defer w.Close()
	}
	srv.SetWatchEnabled(watchEnabled)

	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		fail(err)
	}
	fmt.Printf("http://%s/\n", ln.Addr().String())

	httpSrv := &http.Server{Handler: srv.Handler()}
	go func() {
		if err := httpSrv.Serve(ln); err != nil && err != http.ErrServerClosed {
			fail(err)
		}
	}()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	<-ctx.Done()
	_ = httpSrv.Shutdown(context.Background())
}

func fail(err error) {
	fmt.Fprintf(os.Stderr, "mino: %v\n", err)
	os.Exit(1)
}
