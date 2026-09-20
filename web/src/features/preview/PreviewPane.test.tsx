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
});

describe("PreviewPane", () => {
  it("shows empty state when path is empty", () => {
    const signal: PreviewOpenSignal = { path: "", force: false, nonce: 1 };
    const view = render(
      <PreviewPane openSignal={signal} previewWidth="wide" />,
    );
    expect(view.getByText("No preview selected")).toBeTruthy();
  });
});
