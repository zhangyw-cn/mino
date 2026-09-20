package ui

import "embed"

// FS contains the built browser interface (Vite output under dist/).
//
//go:embed all:dist viewer_template.html
var FS embed.FS
