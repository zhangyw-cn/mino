import { describe, expect, it } from "vitest";
import {
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
} from "./preview-width";

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

describe("preview-width", () => {
  it("constants", () => {
    expect(STORAGE_KEY).toBe("mino-md-preview-width");
    expect(DEFAULT_WIDTH).toBe("wide");
    expect(WIDTH_LABELS).toEqual({ standard: "标宽", wide: "较宽", full: "全宽" });
  });

  it("parsePreviewWidth accepts three modes", () => {
    expect(parsePreviewWidth("standard")).toBe("standard");
    expect(parsePreviewWidth("wide")).toBe("wide");
    expect(parsePreviewWidth("full")).toBe("full");
  });

  it("parsePreviewWidth defaults invalid values to wide", () => {
    expect(parsePreviewWidth("")).toBe("wide");
    expect(parsePreviewWidth(null)).toBe("wide");
    expect(parsePreviewWidth("WIDE")).toBe("wide");
    expect(parsePreviewWidth("narrow")).toBe("wide");
  });

  it("parsePreviewWidth ignores Object.prototype keys", () => {
    expect(parsePreviewWidth("constructor")).toBe("wide");
    expect(parsePreviewWidth("toString")).toBe("wide");
  });

  it("isMarkdownPath", () => {
    expect(isMarkdownPath("docs/sample.md")).toBe(true);
    expect(isMarkdownPath("README.MD")).toBe(true);
    expect(isMarkdownPath("app.html")).toBe(false);
    expect(isMarkdownPath("note.md.html")).toBe(false);
    expect(isMarkdownPath("")).toBe(false);
  });

  it("readPreviewWidth reads and parses", () => {
    const storage = memoryStorage({ "mino-md-preview-width": "full" });
    expect(readPreviewWidth(storage)).toBe("full");
  });

  it("readPreviewWidth defaults when missing or storage throws", () => {
    expect(readPreviewWidth(memoryStorage())).toBe("wide");
    expect(
      readPreviewWidth({
        getItem() {
          throw new Error("denied");
        },
        setItem() {},
        removeItem() {},
      }),
    ).toBe("wide");
  });

  it("writePreviewWidth stores parsed mode", () => {
    const storage = memoryStorage();
    expect(writePreviewWidth(storage, "standard")).toBe("standard");
    expect(storage.getItem("mino-md-preview-width")).toBe("standard");
    expect(writePreviewWidth(storage, "nope")).toBe("wide");
    expect(storage.getItem("mino-md-preview-width")).toBe("wide");
  });

  it("writePreviewWidth swallows setItem throw", () => {
    expect(
      writePreviewWidth(
        {
          getItem() {
            return null;
          },
          setItem() {
            throw new Error("quota");
          },
          removeItem() {},
        },
        "full",
      ),
    ).toBe("full");
  });

  it("applyPreviewWidth sets data-md-width", () => {
    const el = {
      attrs: {} as Record<string, string>,
      setAttribute(name: string, value: string) {
        this.attrs[name] = value;
      },
    };
    expect(applyPreviewWidth(el, "standard")).toBe("standard");
    expect(el.attrs["data-md-width"]).toBe("standard");
    expect(applyPreviewWidth(null, "full")).toBe("full");
  });

  it("previewWidthMessage", () => {
    expect(previewWidthMessage("full")).toEqual({
      source: "mino",
      type: "md-preview-width",
      value: "full",
    });
    expect(previewWidthMessage("x").value).toBe("wide");
  });

  it("parsePreviewWidthMessage", () => {
    const origin = "http://127.0.0.1:9";
    expect(
      parsePreviewWidthMessage(
        { source: "mino", type: "md-preview-width", value: "full" },
        origin,
        origin,
      ),
    ).toBe("full");
    expect(
      parsePreviewWidthMessage(
        { source: "mino", type: "md-preview-width", value: "full" },
        "http://evil.example",
        origin,
      ),
    ).toBe(null);
    expect(
      parsePreviewWidthMessage(
        { type: "md-preview-width", value: "full" },
        origin,
        origin,
      ),
    ).toBe(null);
    expect(
      parsePreviewWidthMessage(
        { source: "mino", type: "md-preview-width", value: "narrow" },
        origin,
        origin,
      ),
    ).toBe(null);
  });
});
