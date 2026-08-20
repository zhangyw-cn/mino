package config

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/BurntSushi/toml"
)

type Config struct {
	Name   string   `toml:"name"`
	Port   int      `toml:"port"`
	Host   string   `toml:"host"`
	Ignore []string `toml:"ignore"`
}

func defaultConfig(root string) Config {
	return Config{
		Name:   filepath.Base(root),
		Port:   0,
		Host:   "127.0.0.1",
		Ignore: nil,
	}
}

func Load(root string) (Config, error) {
	dir := filepath.Join(root, ".mino")
	path := filepath.Join(dir, "config.toml")
	if _, err := os.Stat(path); os.IsNotExist(err) {
		cfg := defaultConfig(root)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return Config{}, err
		}
		f, err := os.Create(path)
		if err != nil {
			return Config{}, err
		}
		defer f.Close()
		if err := toml.NewEncoder(f).Encode(cfg); err != nil {
			return Config{}, err
		}
		return cfg, nil
	} else if err != nil {
		return Config{}, err
	}

	var cfg Config
	meta, err := toml.DecodeFile(path, &cfg)
	if err != nil {
		return Config{}, fmt.Errorf("invalid config %s: %w", path, err)
	}
	_ = meta
	if cfg.Host == "" {
		cfg.Host = "127.0.0.1"
	}
	if cfg.Name == "" {
		cfg.Name = filepath.Base(root)
	}
	return cfg, nil
}
