import { describe, expect, it } from "vitest";
import {
  kindId,
  inPlace,
  decidePreviewAction,
  previewNavigateMessage,
  previewReloadMessage,
  previewReadyMessage,
  previewErrorMessage,
  parsePreviewMessage,
} from "./preview-session";

function decide(partial: Parameters<typeof decidePreviewAction>[0]) {
  return decidePreviewAction({
    fromPath: "",
    toPath: "",
    force: false,
    displayedPath: "",
    navigatePending: false,
    ...partial,
  });
}

const ORIGIN = "http://127.0.0.1:1";

describe("preview-session", () => {
  it("kindId matches extensions", () => {
    expect(kindId("docs/sample.md")).toBe("markdown");
    expect(kindId("docs/SAMPLE.MD")).toBe("markdown");
    expect(kindId("hello.html")).toBe("html");
    expect(kindId("notes/a.htm")).toBe("html");
    expect(kindId("App.HTML")).toBe("html");
    expect(kindId("notes/a.txt")).toBe("document");
    expect(kindId("")).toBe("document");
    expect(kindId(null)).toBe("document");
  });

  it("inPlace is markdown only", () => {
    expect(inPlace("docs/sample.md")).toBe(true);
    expect(inPlace("hello.html")).toBe(false);
    expect(inPlace("notes/a.txt")).toBe(false);
  });

  it("decide skip when same path and not force", () => {
    expect(decide({ fromPath: "docs/a.md", toPath: "docs/a.md" })).toBe(
      "skip",
    );
    expect(decide({ fromPath: "hello.html", toPath: "hello.html" })).toBe(
      "skip",
    );
  });

  it("decide force same markdown displayed is in-place", () => {
    expect(
      decide({
        fromPath: "docs/a.md",
        toPath: "docs/a.md",
        force: true,
        displayedPath: "docs/a.md",
      }),
    ).toBe("in-place");
  });

  it("decide force same html displayed is navigate", () => {
    expect(
      decide({
        fromPath: "hello.html",
        toPath: "hello.html",
        force: true,
        displayedPath: "hello.html",
      }),
    ).toBe("navigate");
  });

  it("decide markdown to markdown is in-place", () => {
    expect(
      decide({
        fromPath: "docs/a.md",
        toPath: "docs/b.md",
        displayedPath: "docs/a.md",
      }),
    ).toBe("in-place");
  });

  it("decide html to html, html to md, empty displayed navigate", () => {
    expect(
      decide({
        fromPath: "a.html",
        toPath: "b.html",
        displayedPath: "a.html",
      }),
    ).toBe("navigate");
    expect(
      decide({
        fromPath: "a.html",
        toPath: "docs/a.md",
        displayedPath: "a.html",
      }),
    ).toBe("navigate");
    expect(decide({ fromPath: "", toPath: "docs/a.md" })).toBe("navigate");
  });

  it("decide navigatePending forces navigate even for md to md", () => {
    expect(
      decide({
        fromPath: "docs/a.md",
        toPath: "docs/b.md",
        displayedPath: "docs/a.md",
        navigatePending: true,
      }),
    ).toBe("navigate");
  });

  it("message builders trim path", () => {
    expect(previewNavigateMessage("  docs/a.md  ")).toEqual({
      source: "mino",
      type: "preview-navigate",
      path: "docs/a.md",
    });
    expect(previewReloadMessage("docs/a.md")).toEqual({
      source: "mino",
      type: "preview-reload",
      path: "docs/a.md",
    });
    expect(previewReadyMessage("docs/a.md")).toEqual({
      source: "mino",
      type: "preview-ready",
      path: "docs/a.md",
    });
    expect(previewErrorMessage("docs/a.md")).toEqual({
      source: "mino",
      type: "preview-error",
      path: "docs/a.md",
    });
  });

  it("parsePreviewMessage accepts four types", () => {
    for (const type of [
      "preview-navigate",
      "preview-reload",
      "preview-ready",
      "preview-error",
    ] as const) {
      expect(
        parsePreviewMessage(
          { source: "mino", type, path: "docs/a.md" },
          ORIGIN,
          ORIGIN,
        ),
      ).toEqual({ type, path: "docs/a.md" });
    }
  });

  it("parsePreviewMessage rejects bad envelopes", () => {
    const good = { source: "mino", type: "preview-ready", path: "docs/a.md" };
    expect(parsePreviewMessage(good, "http://evil", ORIGIN)).toBe(null);
    expect(
      parsePreviewMessage(
        { type: "preview-ready", path: "docs/a.md" },
        ORIGIN,
        ORIGIN,
      ),
    ).toBe(null);
    expect(
      parsePreviewMessage(
        { source: "mino", type: "nope", path: "docs/a.md" },
        ORIGIN,
        ORIGIN,
      ),
    ).toBe(null);
    expect(
      parsePreviewMessage(
        { source: "mino", type: "preview-ready", path: "  " },
        ORIGIN,
        ORIGIN,
      ),
    ).toBe(null);
    expect(
      parsePreviewMessage(
        { source: "mino", type: "preview-ready" },
        ORIGIN,
        ORIGIN,
      ),
    ).toBe(null);
    expect(parsePreviewMessage(null, ORIGIN, ORIGIN)).toBe(null);
  });
});
