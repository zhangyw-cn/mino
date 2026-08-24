package ui

import "embed"

// FS contains the browser interface served by the HTTP server.
//
//go:embed index.html app.js style.css fuzzy.js
//go:embed md/viewer.html md/viewer.js md/viewer.css md/preprocess.js md/toc.js
//go:embed md/vendor
var FS embed.FS
