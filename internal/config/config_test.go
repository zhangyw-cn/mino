package config_test

import (
	"os"
	"path/filepath"
	"testing"

	"mino/internal/config"
)

func TestLoadCreatesDefaultConfig(t *testing.T) {
	root := t.TempDir()
	cfg, err := config.Load(root)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Host != "127.0.0.1" {
		t.Fatalf("host: got %q", cfg.Host)
	}
	if cfg.Port != 0 {
		t.Fatalf("port: got %d", cfg.Port)
	}
	if cfg.Name != filepath.Base(root) {
		t.Fatalf("name: got %q want %q", cfg.Name, filepath.Base(root))
	}
	path := filepath.Join(root, ".mino", "config.toml")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("expected config file: %v", err)
	}

	// The written file must round-trip: a second Load reads it instead of
	// recreating defaults, so the fields have to survive on disk.
	reloaded, err := config.Load(root)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.Name != cfg.Name || reloaded.Port != cfg.Port || reloaded.Host != cfg.Host {
		t.Fatalf("reloaded = %+v, want %+v", reloaded, cfg)
	}
	if len(reloaded.Ignore) != 0 {
		t.Fatalf("reloaded ignore = %v, want empty", reloaded.Ignore)
	}
}

func TestLoadReadsExistingConfig(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, ".mino")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	content := "name = \"demo\"\nport = 7529\nhost = \"127.0.0.1\"\nignore = [\"tmp/**\"]\n"
	if err := os.WriteFile(filepath.Join(dir, "config.toml"), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg, err := config.Load(root)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Name != "demo" || cfg.Port != 7529 || len(cfg.Ignore) != 1 || cfg.Ignore[0] != "tmp/**" {
		t.Fatalf("unexpected cfg: %+v", cfg)
	}
}

func TestLoadCorruptConfigFails(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, ".mino")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "config.toml"), []byte("port = [\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := config.Load(root)
	if err == nil {
		t.Fatal("expected error")
	}
}
