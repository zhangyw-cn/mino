import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  previewNavigateMessage,
  previewReadyMessage,
} from "../lib/preview-session";
import { previewWidthMessage } from "../lib/preview-width";
import { MarkdownViewer } from "./MarkdownViewer";

const mermaidFinishByGen = new Map<number, () => void>();
let holdMermaidPaint = false;

vi.mock("./MermaidBlock", () => ({
  replaceMermaidBlocksIn: vi.fn((_container: HTMLElement, gen: number) => {
    if (!holdMermaidPaint) return Promise.resolve();
    return new Promise<void>((resolve) => {
      mermaidFinishByGen.set(gen, resolve);
    });
  }),
}));

beforeEach(() => {
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }));
});

afterEach(() => {
  cleanup();
  holdMermaidPaint = false;
  mermaidFinishByGen.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function dispatchParentMessage(data: unknown) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data,
      origin: window.location.origin,
    }),
  );
}

describe("MarkdownViewer", () => {
  it("applies md-preview-width on documentElement", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("skip load")));
    render(<MarkdownViewer initialPath="docs/a.md" />);
    dispatchParentMessage(previewWidthMessage("full"));
    expect(document.documentElement.getAttribute("data-md-width")).toBe("full");
  });

  it("drops stale navigate when a newer path wins", async () => {
    const postMessage = vi.fn();
    vi.stubGlobal("parent", { postMessage });

    let resolveSlow: (value: Response) => void;
    const slow = new Promise<Response>((resolve) => {
      resolveSlow = resolve;
    });

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("slow.md")) {
        return slow;
      }
      if (url.includes("fast.md")) {
        return Promise.resolve(
          new Response("# Fast", { status: 200, headers: { "Content-Type": "text/plain" } }),
        );
      }
      return Promise.resolve(new Response("", { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MarkdownViewer initialPath="docs/slow.md" />);

    dispatchParentMessage(previewNavigateMessage("docs/fast.md"));

    resolveSlow!(
      new Response("# Slow", { status: 200, headers: { "Content-Type": "text/plain" } }),
    );

    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        previewReadyMessage("docs/fast.md"),
        window.location.origin,
      );
    });

    const readyPaths = postMessage.mock.calls
      .filter((c) => (c[0] as { type?: string }).type === "preview-ready")
      .map((c) => (c[0] as { path: string }).path);
    expect(readyPaths).not.toContain("docs/slow.md");
  });

  it("ignores stale mermaid paint completion for a newer navigate", async () => {
    holdMermaidPaint = true;
    const postMessage = vi.fn();
    vi.stubGlobal("parent", { postMessage });

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("slow.md")) {
        return Promise.resolve(
          new Response("```mermaid\ngraph TD\n  Slow-->A\n```", {
            status: 200,
            headers: { "Content-Type": "text/plain" },
          }),
        );
      }
      if (url.includes("fast.md")) {
        return Promise.resolve(
          new Response("# Fast\n\n```mermaid\ngraph TD\n  Fast-->B\n```", {
            status: 200,
            headers: { "Content-Type": "text/plain" },
          }),
        );
      }
      return Promise.resolve(new Response("", { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MarkdownViewer initialPath="docs/slow.md" />);

    await waitFor(() => expect(mermaidFinishByGen.has(1)).toBe(true));

    dispatchParentMessage(previewNavigateMessage("docs/fast.md"));
    await waitFor(() => expect(mermaidFinishByGen.has(2)).toBe(true));

    mermaidFinishByGen.get(1)!();

    await new Promise((r) => setTimeout(r, 20));
    const readyBeforeCurrent = postMessage.mock.calls
      .filter((c) => (c[0] as { type?: string }).type === "preview-ready")
      .map((c) => (c[0] as { path: string }).path);
    expect(readyBeforeCurrent).not.toContain("docs/fast.md");

    mermaidFinishByGen.get(2)!();

    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        previewReadyMessage("docs/fast.md"),
        window.location.origin,
      );
    });
  });

  it("renders GFM table and task list into #content", async () => {
    const source = [
      "| Feature | Status |",
      "| --- | --- |",
      "| Preview | ok |",
      "",
      "- [x] done",
      "- [ ] todo",
    ].join("\n");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(source, {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        }),
      ),
    );
    const view = render(<MarkdownViewer initialPath="docs/gfm.md" />);
    await waitFor(() => {
      const content = view.container.querySelector("#content");
      expect(content?.querySelector("table")).toBeTruthy();
      expect(content?.querySelectorAll('input[type="checkbox"]').length).toBeGreaterThan(0);
    });
  });

  it("sanitizes script tags out of rendered markdown", async () => {
    const source = '# Safe\n\n<script>alert("xss")</script>\n\npara';
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(source, {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        }),
      ),
    );
    const view = render(<MarkdownViewer initialPath="docs/xss.md" />);
    await waitFor(() => {
      expect(view.container.querySelector("#content")?.textContent).toMatch(/Safe/);
    });
    expect(view.container.querySelector("#content script")).toBeNull();
    expect(view.container.querySelector("#content")?.innerHTML.toLowerCase()).not.toContain(
      "<script",
    );
  });
});
