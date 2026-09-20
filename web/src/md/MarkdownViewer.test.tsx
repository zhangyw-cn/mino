import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  previewNavigateMessage,
  previewReadyMessage,
} from "../lib/preview-session";
import { previewWidthMessage } from "../lib/preview-width";
import { MarkdownViewer } from "./MarkdownViewer";

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
});
