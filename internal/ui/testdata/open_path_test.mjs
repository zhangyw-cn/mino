import { createRequire } from "node:module";
import assert from "node:assert/strict";
import test from "node:test";

const {
  STORAGE_KEY,
  parseOpenPath,
  readOpenPath,
  writeOpenPath,
  clearOpenPath,
  resolveOpenPath,
  createOpenPathRestore,
} = createRequire(import.meta.url)("../open-path.js");

test("STORAGE_KEY", () => {
  assert.equal(STORAGE_KEY, "mino-open-path");
});

test("parseOpenPath trims and rejects empty", () => {
  assert.equal(parseOpenPath("docs/sample.md"), "docs/sample.md");
  assert.equal(parseOpenPath("  docs/sample.md  "), "docs/sample.md");
  assert.equal(parseOpenPath(""), "");
  assert.equal(parseOpenPath("   "), "");
  assert.equal(parseOpenPath(null), "");
  assert.equal(parseOpenPath(undefined), "");
  assert.equal(parseOpenPath(0), "");
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
    removeItem(key) {
      store.delete(key);
    },
  };
}

test("readOpenPath reads parsed path", () => {
  const storage = memoryStorage({ "mino-open-path": "  docs/sample.md  " });
  assert.equal(readOpenPath(storage), "docs/sample.md");
});

test("readOpenPath empty when missing or storage throws", () => {
  assert.equal(readOpenPath(memoryStorage()), "");
  assert.equal(
    readOpenPath({
      getItem() {
        throw new Error("denied");
      },
    }),
    ""
  );
  assert.equal(readOpenPath(null), "");
});

test("writeOpenPath stores trimmed path", () => {
  const storage = memoryStorage();
  assert.equal(writeOpenPath(storage, "docs/sample.md"), "docs/sample.md");
  assert.equal(storage.getItem("mino-open-path"), "docs/sample.md");
  assert.equal(writeOpenPath(storage, "  notes/a.html  "), "notes/a.html");
  assert.equal(storage.getItem("mino-open-path"), "notes/a.html");
});

test("writeOpenPath clears on empty candidate", () => {
  const storage = memoryStorage({ "mino-open-path": "docs/sample.md" });
  assert.equal(writeOpenPath(storage, "   "), "");
  assert.equal(storage.getItem("mino-open-path"), null);
});

test("writeOpenPath swallows setItem throw", () => {
  assert.equal(
    writeOpenPath(
      {
        setItem() {
          throw new Error("quota");
        },
      },
      "docs/sample.md"
    ),
    "docs/sample.md"
  );
});

test("writeOpenPath with null storage still returns parsed path", () => {
  assert.equal(writeOpenPath(null, "docs/sample.md"), "docs/sample.md");
  assert.equal(writeOpenPath(null, "  notes/a.html  "), "notes/a.html");
  assert.equal(writeOpenPath(null, "   "), "");
});

test("clearOpenPath removes key and swallows throw", () => {
  const storage = memoryStorage({ "mino-open-path": "docs/sample.md" });
  clearOpenPath(storage);
  assert.equal(storage.getItem("mino-open-path"), null);
  clearOpenPath({
    removeItem() {
      throw new Error("denied");
    },
  });
  clearOpenPath(null);
});

test("resolveOpenPath requires membership in fileIndex", () => {
  const index = ["hello.html", "docs/sample.md"];
  assert.equal(resolveOpenPath("docs/sample.md", index), "docs/sample.md");
  assert.equal(resolveOpenPath("  docs/sample.md  ", index), "docs/sample.md");
  assert.equal(resolveOpenPath("gone.md", index), "");
  assert.equal(resolveOpenPath("", index), "");
  assert.equal(resolveOpenPath("docs/sample.md", []), "");
  assert.equal(resolveOpenPath("docs/sample.md", null), "");
  assert.equal(resolveOpenPath("../secret.md", index), "");
});

test("createOpenPathRestore returns catalog path once", () => {
  const storage = memoryStorage({ "mino-open-path": "  docs/sample.md  " });
  const take = createOpenPathRestore();
  const index = ["hello.html", "docs/sample.md"];
  assert.equal(take(storage, index), "docs/sample.md");
  assert.equal(storage.getItem("mino-open-path"), "  docs/sample.md  ");
  assert.equal(take(storage, index), "");
});

test("createOpenPathRestore clears missing path and stays spent", () => {
  const storage = memoryStorage({ "mino-open-path": "gone.md" });
  const take = createOpenPathRestore();
  assert.equal(take(storage, ["docs/sample.md"]), "");
  assert.equal(storage.getItem("mino-open-path"), null);
  storage.setItem("mino-open-path", "docs/sample.md");
  assert.equal(take(storage, ["docs/sample.md"]), "");
});

test("createOpenPathRestore instances do not share the one-shot flag", () => {
  const storage = memoryStorage({ "mino-open-path": "docs/sample.md" });
  const first = createOpenPathRestore();
  const second = createOpenPathRestore();
  const index = ["docs/sample.md"];
  assert.equal(first(storage, index), "docs/sample.md");
  assert.equal(second(storage, index), "docs/sample.md");
});

test("createOpenPathRestore never called leaves the key", () => {
  const storage = memoryStorage({ "mino-open-path": "docs/sample.md" });
  createOpenPathRestore();
  assert.equal(storage.getItem("mino-open-path"), "docs/sample.md");
});
