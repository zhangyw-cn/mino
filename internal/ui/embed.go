package ui

import "embed"

// FS contains the browser interface served by the HTTP server.
//
//go:embed index.html app.js style.css fuzzy.js open-path.js preview-session.js
//go:embed md/viewer.html md/viewer.js md/viewer.css md/preprocess.js md/toc.js md/mermaid-block.js md/preview-width.js
//go:embed md/vendor
var FS embed.FS
