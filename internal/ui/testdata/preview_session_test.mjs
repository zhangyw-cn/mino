import { createRequire } from "node:module";
import assert from "node:assert/strict";
import test from "node:test";

const {
  kindId,
  inPlace,
  decidePreviewAction,
  previewNavigateMessage,
  previewReloadMessage,
  previewReadyMessage,
  previewErrorMessage,
  parsePreviewMessage,
} = createRequire(import.meta.url)("../preview-session.js");

test("kindId matches extensions", () => {
  assert.equal(kindId("docs/sample.md"), "markdown");
  assert.equal(kindId("docs/SAMPLE.MD"), "markdown");
  assert.equal(kindId("hello.html"), "html");
  assert.equal(kindId("notes/a.htm"), "html");
  assert.equal(kindId("App.HTML"), "html");
  assert.equal(kindId("notes/a.txt"), "document");
  assert.equal(kindId(""), "document");
  assert.equal(kindId(null), "document");
});

test("inPlace is markdown only", () => {
  assert.equal(inPlace("docs/sample.md"), true);
  assert.equal(inPlace("hello.html"), false);
  assert.equal(inPlace("notes/a.txt"), false);
});

function decide(partial) {
  return decidePreviewAction(
    Object.assign(
      {
        fromPath: "",
        toPath: "",
        force: false,
        displayedPath: "",
        navigatePending: false,
      },
      partial
    )
  );
}

test("decide skip when same path and not force", () => {
  assert.equal(
    decide({ fromPath: "docs/a.md", toPath: "docs/a.md" }),
    "skip"
  );
  assert.equal(
    decide({ fromPath: "hello.html", toPath: "hello.html" }),
    "skip"
  );
});

test("decide force same markdown displayed is in-place", () => {
  assert.equal(
    decide({
      fromPath: "docs/a.md",
      toPath: "docs/a.md",
      force: true,
      displayedPath: "docs/a.md",
    }),
    "in-place"
  );
});

test("decide force same html displayed is navigate", () => {
  assert.equal(
    decide({
      fromPath: "hello.html",
      toPath: "hello.html",
      force: true,
      displayedPath: "hello.html",
    }),
    "navigate"
  );
});

test("decide markdown to markdown is in-place", () => {
  assert.equal(
    decide({
      fromPath: "docs/a.md",
      toPath: "docs/b.md",
      displayedPath: "docs/a.md",
    }),
    "in-place"
  );
});

test("decide html to html, html to md, empty displayed navigate", () => {
  assert.equal(
    decide({
      fromPath: "a.html",
      toPath: "b.html",
      displayedPath: "a.html",
    }),
    "navigate"
  );
  assert.equal(
    decide({
      fromPath: "a.html",
      toPath: "docs/a.md",
      displayedPath: "a.html",
    }),
    "navigate"
  );
  assert.equal(
    decide({ fromPath: "", toPath: "docs/a.md" }),
    "navigate"
  );
});

test("decide navigatePending forces navigate even for md to md", () => {
  assert.equal(
    decide({
      fromPath: "docs/a.md",
      toPath: "docs/b.md",
      displayedPath: "docs/a.md",
      navigatePending: true,
    }),
    "navigate"
  );
});

const ORIGIN = "http://127.0.0.1:1";

test("message builders trim path", () => {
  assert.deepEqual(previewNavigateMessage("  docs/a.md  "), {
    source: "mino",
    type: "preview-navigate",
    path: "docs/a.md",
  });
  assert.deepEqual(previewReloadMessage("docs/a.md"), {
    source: "mino",
    type: "preview-reload",
    path: "docs/a.md",
  });
  assert.deepEqual(previewReadyMessage("docs/a.md"), {
    source: "mino",
    type: "preview-ready",
    path: "docs/a.md",
  });
  assert.deepEqual(previewErrorMessage("docs/a.md"), {
    source: "mino",
    type: "preview-error",
    path: "docs/a.md",
  });
});

test("parsePreviewMessage accepts four types", () => {
  for (const type of [
    "preview-navigate",
    "preview-reload",
    "preview-ready",
    "preview-error",
  ]) {
    assert.deepEqual(
      parsePreviewMessage(
        { source: "mino", type, path: "docs/a.md" },
        ORIGIN,
        ORIGIN
      ),
      { type, path: "docs/a.md" }
    );
  }
});

test("parsePreviewMessage rejects bad envelopes", () => {
  const good = { source: "mino", type: "preview-ready", path: "docs/a.md" };
  assert.equal(parsePreviewMessage(good, "http://evil", ORIGIN), null);
  assert.equal(
    parsePreviewMessage({ type: "preview-ready", path: "docs/a.md" }, ORIGIN, ORIGIN),
    null
  );
  assert.equal(
    parsePreviewMessage({ source: "mino", type: "nope", path: "docs/a.md" }, ORIGIN, ORIGIN),
    null
  );
  assert.equal(
    parsePreviewMessage({ source: "mino", type: "preview-ready", path: "  " }, ORIGIN, ORIGIN),
    null
  );
  assert.equal(
    parsePreviewMessage({ source: "mino", type: "preview-ready" }, ORIGIN, ORIGIN),
    null
  );
  assert.equal(parsePreviewMessage(null, ORIGIN, ORIGIN), null);
});
