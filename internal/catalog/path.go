package catalog

import (
	"fmt"
	"path"
	"path/filepath"
	"runtime"
	"strings"
)

func IsHTML(name string) bool {
	ext := strings.ToLower(filepath.Ext(name))
	return ext == ".html" || ext == ".htm"
}

func IsMarkdown(name string) bool {
	return strings.ToLower(filepath.Ext(name)) == ".md"
}

func IsEntry(name string) bool {
	return IsHTML(name) || IsMarkdown(name)
}

func NormalizeRel(p string) (string, error) {
	return normalizeRel(p, runtime.GOOS == "windows")
}

// normalizeRel converts p to a slash-separated relative path. Backslashes are
// only separators on Windows; elsewhere they are legal filename characters.
func normalizeRel(p string, backslashIsSeparator bool) (string, error) {
	if backslashIsSeparator {
		p = strings.ReplaceAll(p, `\`, "/")
	}
	if strings.HasPrefix(p, "/") {
		return "", fmt.Errorf("path must be relative: %q", p)
	}

	p = path.Clean(p)
	if p == ".." || strings.HasPrefix(p, "../") {
		return "", fmt.Errorf("path escapes root: %q", p)
	}
	if p == "." {
		return "", nil
	}
	return p, nil
}

func ResolveUnderRoot(root, rel string) (string, error) {
	rel, err := NormalizeRel(rel)
	if err != nil {
		return "", err
	}

	absRoot, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	abs, err := filepath.Abs(filepath.Join(absRoot, filepath.FromSlash(rel)))
	if err != nil {
		return "", err
	}

	within, err := filepath.Rel(absRoot, abs)
	if err != nil {
		return "", err
	}
	if within == ".." || strings.HasPrefix(within, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("path escapes root")
	}
	return abs, nil
}
