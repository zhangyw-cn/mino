package ui

import "embed"

// FS contains the browser interface served by the HTTP server.
//
//go:embed index.html app.js style.css md/*
var FS embed.FS
