import { createRequire } from "node:module";
import assert from "node:assert/strict";
import test from "node:test";

const {
  STORAGE_KEY,
  DEFAULT_WIDTH,
  WIDTH_LABELS,
  parsePreviewWidth,
  isMarkdownPath,
  readPreviewWidth,
  writePreviewWidth,
  applyPreviewWidth,
  previewWidthMessage,
  parsePreviewWidthMessage,
} = createRequire(import.meta.url)("../md/preview-width.js");

test("constants", () => {
  assert.equal(STORAGE_KEY, "mino-md-preview-width");
  assert.equal(DEFAULT_WIDTH, "wide");
  assert.deepEqual(WIDTH_LABELS, { standard: "标宽", wide: "较宽", full: "全宽" });
});

test("parsePreviewWidth accepts three modes", () => {
  assert.equal(parsePreviewWidth("standard"), "standard");
  assert.equal(parsePreviewWidth("wide"), "wide");
  assert.equal(parsePreviewWidth("full"), "full");
});

test("parsePreviewWidth defaults invalid values to wide", () => {
  assert.equal(parsePreviewWidth(""), "wide");
  assert.equal(parsePreviewWidth(null), "wide");
  assert.equal(parsePreviewWidth("WIDE"), "wide");
  assert.equal(parsePreviewWidth("narrow"), "wide");
});

test("parsePreviewWidth ignores Object.prototype keys", () => {
  assert.equal(parsePreviewWidth("constructor"), "wide");
  assert.equal(parsePreviewWidth("toString"), "wide");
});

test("isMarkdownPath", () => {
  assert.equal(isMarkdownPath("docs/sample.md"), true);
  assert.equal(isMarkdownPath("README.MD"), true);
  assert.equal(isMarkdownPath("app.html"), false);
  assert.equal(isMarkdownPath("note.md.html"), false);
  assert.equal(isMarkdownPath(""), false);
});

function memoryStorage(initial) {
  const store = new Map(Object.entries(initial || {}));
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
  };
}

test("readPreviewWidth reads and parses", () => {
  const storage = memoryStorage({ "mino-md-preview-width": "full" });
  assert.equal(readPreviewWidth(storage), "full");
});

test("readPreviewWidth defaults when missing or storage throws", () => {
  assert.equal(readPreviewWidth(memoryStorage()), "wide");
  assert.equal(
    readPreviewWidth({
      getItem() {
        throw new Error("denied");
      },
    }),
    "wide"
  );
});

test("writePreviewWidth stores parsed mode", () => {
  const storage = memoryStorage();
  assert.equal(writePreviewWidth(storage, "standard"), "standard");
  assert.equal(storage.getItem("mino-md-preview-width"), "standard");
  assert.equal(writePreviewWidth(storage, "nope"), "wide");
  assert.equal(storage.getItem("mino-md-preview-width"), "wide");
});

test("writePreviewWidth swallows setItem throw", () => {
  assert.equal(
    writePreviewWidth(
      {
        setItem() {
          throw new Error("quota");
        },
      },
      "full"
    ),
    "full"
  );
});

test("applyPreviewWidth sets data-md-width", () => {
  const el = {
    attrs: {},
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
  };
  assert.equal(applyPreviewWidth(el, "standard"), "standard");
  assert.equal(el.attrs["data-md-width"], "standard");
  assert.equal(applyPreviewWidth(null, "full"), "full");
});

test("previewWidthMessage", () => {
  assert.deepEqual(previewWidthMessage("full"), {
    source: "mino",
    type: "md-preview-width",
    value: "full",
  });
  assert.equal(previewWidthMessage("x").value, "wide");
});

test("parsePreviewWidthMessage", () => {
  const origin = "http://127.0.0.1:9";
  assert.equal(
    parsePreviewWidthMessage(
      { source: "mino", type: "md-preview-width", value: "full" },
      origin,
      origin
    ),
    "full"
  );
  assert.equal(
    parsePreviewWidthMessage(
      { source: "mino", type: "md-preview-width", value: "full" },
      "http://evil.example",
      origin
    ),
    null
  );
  assert.equal(
    parsePreviewWidthMessage({ type: "md-preview-width", value: "full" }, origin, origin),
    null
  );
  assert.equal(
    parsePreviewWidthMessage(
      { source: "mino", type: "md-preview-width", value: "narrow" },
      origin,
      origin
    ),
    null
  );
});
