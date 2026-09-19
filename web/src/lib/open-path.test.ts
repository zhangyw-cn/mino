import { describe, expect, it } from "vitest";
import {
  STORAGE_KEY,
  parseOpenPath,
  readOpenPath,
  writeOpenPath,
  clearOpenPath,
  resolveOpenPath,
  createOpenPathRestore,
} from "./open-path";

function memoryStorage(initial?: Record<string, string>) {
  const store = new Map(Object.entries(initial || {}));
  return {
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
    removeItem(key: string) {
      store.delete(key);
    },
  };
}

describe("open-path", () => {
  it("STORAGE_KEY", () => {
    expect(STORAGE_KEY).toBe("mino-open-path");
  });

  it("parseOpenPath trims and rejects empty", () => {
    expect(parseOpenPath("docs/sample.md")).toBe("docs/sample.md");
    expect(parseOpenPath("  docs/sample.md  ")).toBe("docs/sample.md");
    expect(parseOpenPath("")).toBe("");
    expect(parseOpenPath("   ")).toBe("");
    expect(parseOpenPath(null)).toBe("");
    expect(parseOpenPath(undefined)).toBe("");
    expect(parseOpenPath(0)).toBe("");
  });

  it("readOpenPath reads parsed path", () => {
    const storage = memoryStorage({ "mino-open-path": "  docs/sample.md  " });
    expect(readOpenPath(storage)).toBe("docs/sample.md");
  });

  it("readOpenPath empty when missing or storage throws", () => {
    expect(readOpenPath(memoryStorage())).toBe("");
    expect(
      readOpenPath({
        getItem() {
          throw new Error("denied");
        },
        setItem() {},
        removeItem() {},
      }),
    ).toBe("");
    expect(readOpenPath(null)).toBe("");
  });

  it("writeOpenPath stores trimmed path", () => {
    const storage = memoryStorage();
    expect(writeOpenPath(storage, "docs/sample.md")).toBe("docs/sample.md");
    expect(storage.getItem("mino-open-path")).toBe("docs/sample.md");
    expect(writeOpenPath(storage, "  notes/a.html  ")).toBe("notes/a.html");
    expect(storage.getItem("mino-open-path")).toBe("notes/a.html");
  });

  it("writeOpenPath clears on empty candidate", () => {
    const storage = memoryStorage({ "mino-open-path": "docs/sample.md" });
    expect(writeOpenPath(storage, "   ")).toBe("");
    expect(storage.getItem("mino-open-path")).toBe(null);
  });

  it("writeOpenPath swallows setItem throw", () => {
    expect(
      writeOpenPath(
        {
          getItem() {
            return null;
          },
          setItem() {
            throw new Error("quota");
          },
          removeItem() {},
        },
        "docs/sample.md",
      ),
    ).toBe("docs/sample.md");
  });

  it("writeOpenPath with null storage still returns parsed path", () => {
    expect(writeOpenPath(null, "docs/sample.md")).toBe("docs/sample.md");
    expect(writeOpenPath(null, "  notes/a.html  ")).toBe("notes/a.html");
    expect(writeOpenPath(null, "   ")).toBe("");
  });

  it("clearOpenPath removes key and swallows throw", () => {
    const storage = memoryStorage({ "mino-open-path": "docs/sample.md" });
    clearOpenPath(storage);
    expect(storage.getItem("mino-open-path")).toBe(null);
    clearOpenPath({
      getItem() {
        return null;
      },
      setItem() {},
      removeItem() {
        throw new Error("denied");
      },
    });
    clearOpenPath(null);
  });

  it("resolveOpenPath requires membership in fileIndex", () => {
    const index = ["hello.html", "docs/sample.md"];
    expect(resolveOpenPath("docs/sample.md", index)).toBe("docs/sample.md");
    expect(resolveOpenPath("  docs/sample.md  ", index)).toBe("docs/sample.md");
    expect(resolveOpenPath("gone.md", index)).toBe("");
    expect(resolveOpenPath("", index)).toBe("");
    expect(resolveOpenPath("docs/sample.md", [])).toBe("");
    expect(resolveOpenPath("docs/sample.md", null)).toBe("");
    expect(resolveOpenPath("../secret.md", index)).toBe("");
  });

  it("createOpenPathRestore returns catalog path once", () => {
    const storage = memoryStorage({ "mino-open-path": "  docs/sample.md  " });
    const take = createOpenPathRestore();
    const index = ["hello.html", "docs/sample.md"];
    expect(take(storage, index)).toBe("docs/sample.md");
    expect(storage.getItem("mino-open-path")).toBe("  docs/sample.md  ");
    expect(take(storage, index)).toBe("");
  });

  it("createOpenPathRestore clears missing path and stays spent", () => {
    const storage = memoryStorage({ "mino-open-path": "gone.md" });
    const take = createOpenPathRestore();
    expect(take(storage, ["docs/sample.md"])).toBe("");
    expect(storage.getItem("mino-open-path")).toBe(null);
    storage.setItem("mino-open-path", "docs/sample.md");
    expect(take(storage, ["docs/sample.md"])).toBe("");
  });

  it("createOpenPathRestore instances do not share the one-shot flag", () => {
    const storage = memoryStorage({ "mino-open-path": "docs/sample.md" });
    const first = createOpenPathRestore();
    const second = createOpenPathRestore();
    const index = ["docs/sample.md"];
    expect(first(storage, index)).toBe("docs/sample.md");
    expect(second(storage, index)).toBe("docs/sample.md");
  });

  it("createOpenPathRestore never called leaves the key", () => {
    const storage = memoryStorage({ "mino-open-path": "docs/sample.md" });
    createOpenPathRestore();
    expect(storage.getItem("mino-open-path")).toBe("docs/sample.md");
  });
});
