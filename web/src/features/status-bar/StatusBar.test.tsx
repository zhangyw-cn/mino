import { cleanup, render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { previewWidthMessage } from "../../lib/preview-width";
import { StatusBar } from "./StatusBar";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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
    const getPreviewWindow = () => ({ postMessage }) as unknown as Window;

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
  });

  it("uses Dark Modern shell colors and forbids Default Dark+ blue", async () => {
    const user = userEvent.setup();
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
    expect(cls).toContain("border-t");
    expect(cls).toContain("border-[#2b2b2b]");
    expect(cls).toContain("h-[22px]");
    expect(cls.toLowerCase()).not.toContain("007acc");
    expect(cls).not.toContain("text-white");

    const trigger = within(view.container).getByRole("button", { name: "较宽" });
    expect(trigger.className).toContain("mino-status-chip");
    expect(trigger.className).not.toContain("hover:bg-white/15");

    await user.click(trigger);
    const menu = within(view.container).getByRole("menu");
    expect(menu.className).toContain("bg-[#252526]");
    expect(menu.className).toContain("text-[#cccccc]");
    const item = within(view.container).getByRole("menuitemradio", { name: "标宽" });
    expect(item.className).toContain("mino-list-row");
    expect(item.className).not.toContain("hover:bg-[#2a2d2e]");
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

  it("marks the current width and closes the menu on Escape", async () => {
    const user = userEvent.setup();
    const view = render(
      <StatusBar
        currentPath="docs/sample.md"
        previewWidth="wide"
        onPreviewWidthChange={() => {}}
        getPreviewWindow={() => null}
      />,
    );

    await user.click(within(view.container).getByRole("button", { name: "较宽" }));
    const current = within(view.container).getByRole("menuitemradio", {
      name: "较宽",
    });
    expect(current.getAttribute("aria-checked")).toBe("true");
    expect(current.textContent).toContain("✓");

    await user.keyboard("{Escape}");
    expect(within(view.container).queryByRole("menu")).toBeNull();
  });
});
