import { describe, expect, it } from "vitest";
import { slugify, uniqueId, ensureHeadingIds } from "./toc";

describe("slugify", () => {
  it("ascii and spaces", () => {
    expect(slugify("  Hello World  ")).toBe("hello-world");
  });

  it("keeps unicode letters", () => {
    expect(slugify("中文 标题")).toBe("中文-标题");
  });

  it("strips punctuation", () => {
    expect(slugify("Foo: Bar!")).toBe("foo-bar");
  });
});

describe("uniqueId", () => {
  it("dedupes", () => {
    const used = new Set<string>();
    expect(uniqueId("hello", used)).toBe("hello");
    expect(uniqueId("hello", used)).toBe("hello-2");
    expect(uniqueId("hello", used)).toBe("hello-3");
  });

  it("empty falls back to heading", () => {
    const used = new Set<string>();
    expect(uniqueId("", used)).toBe("heading");
    expect(uniqueId(slugify("---"), used)).toBe("heading-2");
  });
});

describe("ensureHeadingIds", () => {
  it("reuses existing id", () => {
    const used = new Set<string>();
    const el = {
      id: "custom",
      tagName: "H2",
      textContent: "Ignored",
    };
    const items = ensureHeadingIds([el], used);
    expect(items).toEqual([{ id: "custom", level: 2, text: "Ignored" }]);
    expect(el.id).toBe("custom");
    expect(used.has("custom")).toBe(true);
  });

  it("assigns slug and dedupes", () => {
    const used = new Set<string>();
    const a = { id: "", tagName: "H1", textContent: "Same" };
    const b = { id: "", tagName: "H2", textContent: "Same" };
    const items = ensureHeadingIds([a, b], used);
    expect(a.id).toBe("same");
    expect(b.id).toBe("same-2");
    expect(items.map((x) => x.id)).toEqual(["same", "same-2"]);
  });

  it("uniquifies colliding existing ids", () => {
    const used = new Set<string>();
    const a = { id: "x", tagName: "H1", textContent: "A" };
    const b = { id: "x", tagName: "H2", textContent: "B" };
    const items = ensureHeadingIds([a, b], used);
    expect(a.id).toBe("x");
    expect(b.id).toBe("x-2");
    expect(items.map((x) => x.id)).toEqual(["x", "x-2"]);
  });
});
