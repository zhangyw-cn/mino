package asset

import (
	"path"
	"strings"

	"github.com/zhangyw-cn/mino/internal/catalog"
)

var allowExt = map[string]struct{}{
	".png": {}, ".jpg": {}, ".jpeg": {}, ".gif": {}, ".webp": {}, ".svg": {},
	".ico": {}, ".css": {}, ".js": {}, ".mjs": {}, ".woff": {}, ".woff2": {},
	".ttf": {}, ".otf": {}, ".json": {}, ".wasm": {},
}

// Allowed reports whether rel may be served as a companion asset.
// Existence is not checked. ignored, if non-nil, is called with the normalized rel.
func Allowed(rel string, ignored func(string) bool) bool {
	rel, err := catalog.NormalizeRel(rel)
	if err != nil || rel == "" {
		return false
	}
	if hasDotSegment(rel) {
		return false
	}
	ext := strings.ToLower(path.Ext(rel))
	if _, ok := allowExt[ext]; !ok {
		return false
	}
	if ignored != nil && ignored(rel) {
		return false
	}
	return true
}

func hasDotSegment(rel string) bool {
	for _, part := range strings.Split(rel, "/") {
		if strings.HasPrefix(part, ".") {
			return true
		}
	}
	return false
}
