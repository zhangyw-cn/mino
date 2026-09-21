import { cleanup, render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { previewWidthMessage } from "../../lib/preview-width";
import { previewURL } from "./preview-url";
import { PreviewPane, type PreviewOpenSignal } from "./PreviewPane";
import { StatusBar } from "../status-bar/StatusBar";

afterEach(() => cleanup());

describe("previewURL", () => {
  it("encodes path segments", () => {
    vi.stubGlobal("Date", { now: () => 1 });
    expect(previewURL("docs/sample.md")).toBe("/apps/docs/sample.md?t=1");
    vi.unstubAllGlobals();
  });
});

describe("StatusBar", () => {
  it("writes width to localStorage and posts message shape", async () => {
    const user = userEvent.setup();
    const storage = {
      store: {} as Record<string, string>,
      getItem(key: string) {
        return this.store[key] ?? null;
      },
      setItem(key: string, value: string) {
        this.store[key] = value;
      },
      removeItem(key: string) {
        delete this.store[key];
      },
    };
    vi.stubGlobal("localStorage", storage);

    const postMessage = vi.fn();
    const getPreviewWindow = () =>
      ({ postMessage }) as unknown as Window;

    const onPreviewWidthChange = vi.fn();
    const view = render(
      <StatusBar
        currentPath="docs/sample.md"
        previewWidth="wide"
        onPreviewWidthChange={onPreviewWidthChange}
        getPreviewWindow={getPreviewWindow}
      />,
    );

    await user.click(within(view.container).getByRole("button", { name: "较宽" }));
    await user.click(within(view.container).getByRole("menuitemradio", { name: "全宽" }));

    expect(storage.store["mino-md-preview-width"]).toBe("full");
    expect(onPreviewWidthChange).toHaveBeenCalledWith("full");
    expect(postMessage).toHaveBeenCalledWith(
      previewWidthMessage("full"),
      window.location.origin,
    );

    vi.unstubAllGlobals();
  });

  it("uses Dark Modern shell colors and forbids Default Dark+ blue", () => {
    const view = render(
      <StatusBar
        currentPath="docs/sample.md"
        previewWidth="wide"
        onPreviewWidthChange={() => {}}
        getPreviewWindow={() => null}
      />,
    );
    const footer = view.container.querySelector("footer");
    expect(footer).toBeTruthy();
    const cls = footer!.className;
    expect(cls).toContain("bg-[#181818]");
    expect(cls).toContain("text-[#cccccc]");
    expect(cls).toContain("border-[#2b2b2b]");
    expect(cls).toContain("h-[22px]");
    expect(cls.toLowerCase()).not.toContain("007acc");
    expect(cls).not.toContain("text-white");
  });

  it("hides width control for non-markdown but keeps the 22px bar", () => {
    const view = render(
      <StatusBar
        currentPath="apps/hello.html"
        previewWidth="wide"
        onPreviewWidthChange={() => {}}
        getPreviewWindow={() => null}
      />,
    );
    const footer = view.container.querySelector("footer");
    expect(footer).toBeTruthy();
    expect(footer!.className).toContain("h-[22px]");
    expect(within(view.container).queryByRole("button", { name: "较宽" })).toBeNull();
  });
});

describe("PreviewPane", () => {
  it("shows empty state when path is empty", () => {
    const signal: PreviewOpenSignal = { path: "", force: false, nonce: 1 };
    const view = render(
      <PreviewPane openSignal={signal} previewWidth="wide" />,
    );
    expect(view.getByText("No preview selected")).toBeTruthy();
  });

  it("binds Quick Open hotkeys on same-origin iframe load", async () => {
    const onQuickOpenHotkey = vi.fn();
    const listeners = new Map<string, EventListener>();
    const fakeDoc = {
      addEventListener(type: string, listener: EventListener) {
        listeners.set(type, listener);
      },
      removeEventListener(type: string) {
        listeners.delete(type);
      },
    };
    const fakeIframe = {
      contentDocument: fakeDoc,
      contentWindow: {
        postMessage: vi.fn(),
        location: { origin: window.location.origin, pathname: "/apps/hello.html" },
      },
    } as unknown as HTMLIFrameElement;

    const signal: PreviewOpenSignal = {
      path: "hello.html",
      force: false,
      nonce: 2,
    };
    const view = render(
      <PreviewPane
        openSignal={signal}
        previewWidth="wide"
        onQuickOpenHotkey={onQuickOpenHotkey}
        onIframeRef={(node) => {
          if (node) {
            Object.defineProperty(node, "contentDocument", {
              configurable: true,
              get: () => fakeDoc,
            });
            Object.defineProperty(node, "contentWindow", {
              configurable: true,
              get: () => fakeIframe.contentWindow,
            });
          }
        }}
      />,
    );

    const iframe = view.container.querySelector("iframe");
    expect(iframe).toBeTruthy();
    iframe?.dispatchEvent(new Event("load"));

    const keydown = listeners.get("keydown");
    expect(keydown).toBeTypeOf("function");
    const event = new KeyboardEvent("keydown", {
      key: "p",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    keydown?.(event);
    expect(onQuickOpenHotkey).toHaveBeenCalledTimes(1);
  });
});
