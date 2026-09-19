import { describe, expect, it } from "vitest";
import { extractURLs, resolveRef, referencedPaths } from "./asset-refs";

describe("asset-refs", () => {
  it("resolveRef relative and parent", () => {
    expect(resolveRef("tools/timer.html", "./style.css")).toBe(
      "tools/style.css",
    );
    expect(resolveRef("tools/timer.html", "style.css")).toBe("tools/style.css");
    expect(resolveRef("docs/sample.md", "../shared/a.css")).toBe("shared/a.css");
    expect(resolveRef("docs/sample.md", "/apps/docs/a.png")).toBe("docs/a.png");
    expect(resolveRef("docs/sample.md", "/apps/docs/my%20pic.png")).toBe(
      "docs/my pic.png",
    );
  });

  it("resolveRef skips non-workspace", () => {
    expect(resolveRef("docs/a.md", "https://example.com/a.png")).toBe(null);
    expect(resolveRef("docs/a.md", "data:image/png;base64,xx")).toBe(null);
    expect(resolveRef("docs/a.md", "//cdn/x.png")).toBe(null);
    expect(resolveRef("docs/a.md", "#heading")).toBe(null);
    expect(resolveRef("docs/a.md", "/foo.png")).toBe(null);
    expect(resolveRef("docs/a.md", "../../../etc/passwd")).toBe(null);
    expect(resolveRef("docs/a.md", "mailto:a@b.c")).toBe(null);
    expect(resolveRef("docs/a.md", "javascript:alert(1)")).toBe(null);
  });

  it("resolveRef strips query and hash", () => {
    expect(resolveRef("tools/a.html", "style.css?v=1#x")).toBe(
      "tools/style.css",
    );
  });

  it("extractURLs finds attrs, url, import, markdown", () => {
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
    for (const want of [
      "a.css",
      "b.png",
      "c.jpg",
      "d.webp",
      "e.css",
      "f.css",
      "g.png",
      "h.js",
    ]) {
      expect(urls.includes(want), `missing ${want} in ${JSON.stringify(urls)}`).toBe(
        true,
      );
    }
    expect(urls.includes("")).toBe(false);
  });

  it("extractURLs ignores markdown fences", () => {
    const src = "See ![real](real.png)\n\n```md\n![fake](fake.png)\n```\n";
    const urls = extractURLs(src);
    expect(urls.includes("real.png")).toBe(true);
    expect(urls.includes("fake.png"), `fence leak: ${JSON.stringify(urls)}`).toBe(
      false,
    );
  });

  it("referencedPaths unique", () => {
    const paths = referencedPaths(
      "docs/a.md",
      '![x](pic.svg)\n<img src="./pic.svg">',
    );
    expect(paths).toEqual(["docs/pic.svg"]);
  });
});
