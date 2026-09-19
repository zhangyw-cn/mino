import { createRequire } from "node:module";
import assert from "node:assert/strict";
import test from "node:test";

const { extractURLs, resolveRef, referencedPaths } = createRequire(import.meta.url)(
  "../asset-refs.js"
);

test("resolveRef relative and parent", () => {
  assert.equal(resolveRef("tools/timer.html", "./style.css"), "tools/style.css");
  assert.equal(resolveRef("tools/timer.html", "style.css"), "tools/style.css");
  assert.equal(resolveRef("docs/sample.md", "../shared/a.css"), "shared/a.css");
  assert.equal(resolveRef("docs/sample.md", "/apps/docs/a.png"), "docs/a.png");
  assert.equal(resolveRef("docs/sample.md", "/apps/docs/my%20pic.png"), "docs/my pic.png");
});

test("resolveRef skips non-workspace", () => {
  assert.equal(resolveRef("docs/a.md", "https://example.com/a.png"), null);
  assert.equal(resolveRef("docs/a.md", "data:image/png;base64,xx"), null);
  assert.equal(resolveRef("docs/a.md", "//cdn/x.png"), null);
  assert.equal(resolveRef("docs/a.md", "#heading"), null);
  assert.equal(resolveRef("docs/a.md", "/foo.png"), null);
  assert.equal(resolveRef("docs/a.md", "../../../etc/passwd"), null);
  assert.equal(resolveRef("docs/a.md", "mailto:a@b.c"), null);
});

test("resolveRef strips query and hash", () => {
  assert.equal(resolveRef("tools/a.html", "style.css?v=1#x"), "tools/style.css");
});

test("extractURLs finds attrs, url, import, markdown", () => {
  const src = `
<link href="a.css">
<img src='b.png' poster="c.jpg">
style="background:url(d.webp)"
@import "e.css";
@import url("f.css");
![x](g.png)
[label](h.js)
`;
  const urls = extractURLs(src);
  for (const want of ["a.css", "b.png", "c.jpg", "d.webp", "e.css", "f.css", "g.png", "h.js"]) {
    assert.ok(urls.includes(want), `missing ${want} in ${JSON.stringify(urls)}`);
  }
});

test("referencedPaths unique", () => {
  const paths = referencedPaths("docs/a.md", "![x](pic.svg)\n<img src=\"./pic.svg\">");
  assert.deepEqual(paths, ["docs/pic.svg"]);
});
