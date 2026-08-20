package ignore

import (
	"path"
	"strings"

	"github.com/bmatcuk/doublestar/v4"
)

var builtin = []string{
	".mino",
	".mino/**",
	".git",
	".git/**",
	".hg",
	".hg/**",
	".svn",
	".svn/**",
	"node_modules",
	"node_modules/**",
	"**/.git/**",
	"**/.hg/**",
	"**/.svn/**",
	"**/node_modules/**",
	"**/.mino/**",
}

type Matcher struct {
	patterns []string
}

func New(extra []string) (*Matcher, error) {
	patterns := append([]string{}, builtin...)
	patterns = append(patterns, extra...)
	for _, p := range patterns {
		if !doublestar.ValidatePattern(p) {
			return nil, doublestar.ErrBadPattern
		}
	}
	return &Matcher{patterns: patterns}, nil
}

func (m *Matcher) Match(rel string) bool {
	rel = path.Clean("/" + strings.ReplaceAll(rel, "\\", "/"))
	rel = strings.TrimPrefix(rel, "/")
	if rel == "." || rel == "" {
		return false
	}
	parts := strings.Split(rel, "/")
	// Match full path and each path prefix (so ignored dirs are skipped while walking).
	var acc string
	for i, part := range parts {
		if i == 0 {
			acc = part
		} else {
			acc = acc + "/" + part
		}
		for _, pat := range m.patterns {
			ok, err := doublestar.Match(pat, acc)
			if err == nil && ok {
				return true
			}
		}
	}
	return false
}
