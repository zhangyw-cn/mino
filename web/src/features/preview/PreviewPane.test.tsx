import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { previewURL } from "./preview-url";
import { PreviewPane, type PreviewOpenSignal } from "./PreviewPane";

afterEach(() => cleanup());

describe("previewURL", () => {
  it("encodes path segments", () => {
    vi.stubGlobal("Date", { now: () => 1 });
    expect(previewURL("docs/sample.md")).toBe("/apps/docs/sample.md?t=1");
    vi.unstubAllGlobals();
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
