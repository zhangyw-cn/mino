import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..");
const uiRoot = path.resolve(webRoot, "../internal/ui");
const distDir = path.join(uiRoot, "dist");
const manifestPath = path.join(distDir, ".vite/manifest.json");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const viewerKey = "md/viewer.html";
const viewerEntry = manifest[viewerKey];
if (!viewerEntry?.file) {
  throw new Error(`manifest missing ${viewerKey} entry with file`);
}

/** @param {string} key */
function entryFor(key) {
  const entry = manifest[key];
  if (!entry) {
    throw new Error(`manifest missing ${key}`);
  }
  return entry;
}

/** @param {Set<string>} out @param {string} key */
function collectCss(out, key) {
  const entry = entryFor(key);
  for (const href of entry.css ?? []) {
    out.add(href);
  }
  for (const imp of entry.imports ?? []) {
    collectCss(out, imp);
  }
}

const cssHrefs = new Set();
collectCss(cssHrefs, viewerKey);

const csp =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; font-src 'self';";

const cssTags = [...cssHrefs]
  .sort()
  .map((href) => `  <link rel="stylesheet" href="/${href}">`)
  .join("\n");

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>Markdown preview</title>
${cssTags}
  <script type="module" src="/${viewerEntry.file}"></script>
</head>
<body>
  <div id="root" data-path="{{.Path}}"></div>
</body>
</html>
`;

fs.writeFileSync(path.join(uiRoot, "viewer_template.html"), html, "utf8");
