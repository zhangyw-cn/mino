import { createRequire } from "node:module";
import assert from "node:assert/strict";
import test from "node:test";

const { slugify, uniqueId, ensureHeadingIds } = createRequire(import.meta.url)("../md/toc.js");

test("slugify ascii and spaces", () => {
  assert.equal(slugify("  Hello World  "), "hello-world");
});

test("slugify keeps unicode letters", () => {
  assert.equal(slugify("中文 标题"), "中文-标题");
});

test("slugify strips punctuation", () => {
  assert.equal(slugify("Foo: Bar!"), "foo-bar");
});

test("uniqueId dedupes", () => {
  const used = new Set();
  assert.equal(uniqueId("hello", used), "hello");
  assert.equal(uniqueId("hello", used), "hello-2");
  assert.equal(uniqueId("hello", used), "hello-3");
});

test("uniqueId empty falls back to heading", () => {
  const used = new Set();
  assert.equal(uniqueId("", used), "heading");
  assert.equal(uniqueId(slugify("---"), used), "heading-2");
});

test("ensureHeadingIds reuses existing id", () => {
  const used = new Set();
  const el = {
    id: "custom",
    tagName: "H2",
    textContent: "Ignored",
  };
  const items = ensureHeadingIds([el], used);
  assert.deepEqual(items, [{ id: "custom", level: 2, text: "Ignored" }]);
  assert.equal(el.id, "custom");
  assert.ok(used.has("custom"));
});

test("ensureHeadingIds assigns slug and dedupes", () => {
  const used = new Set();
  const a = { id: "", tagName: "H1", textContent: "Same" };
  const b = { id: "", tagName: "H2", textContent: "Same" };
  const items = ensureHeadingIds([a, b], used);
  assert.equal(a.id, "same");
  assert.equal(b.id, "same-2");
  assert.deepEqual(items.map((x) => x.id), ["same", "same-2"]);
});
