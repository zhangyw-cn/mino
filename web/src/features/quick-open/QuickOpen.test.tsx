import { cleanup, render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuickOpen } from "./QuickOpen";

const fileIndex = [
  "hello.html",
  "docs/sample.md",
  "docs/guide.html",
  "notes/readme.md",
];

afterEach(() => cleanup());

describe("QuickOpen", () => {
  it("lists recents when query is empty (max 10)", () => {
    const recents = Array.from({ length: 10 }, (_, i) => `file-${i}.html`);
    const view = render(
      <QuickOpen
        open
        fileIndex={fileIndex}
        recents={recents}
        onClose={() => {}}
        onOpen={() => {}}
      />,
    );
    const ui = within(view.container);
    for (const path of recents) {
      expect(ui.getByRole("option", { name: new RegExp(path.replace(".", "\\.")) })).toBeTruthy();
    }
    expect(ui.getAllByRole("option")).toHaveLength(10);
  });

  it("filters paths when typing", async () => {
    const user = userEvent.setup();
    const view = render(
      <QuickOpen
        open
        fileIndex={fileIndex}
        recents={[]}
        onClose={() => {}}
        onOpen={() => {}}
      />,
    );
    const ui = within(view.container);
    const input = ui.getByPlaceholderText("Search files by name");
    await user.type(input, "sample");
    expect(ui.getAllByRole("option")).toHaveLength(1);
    expect(ui.getByRole("option", { name: /sample/i })).toBeTruthy();
  });

  it("ArrowDown, Enter, and Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onOpen = vi.fn();
    const view = render(
      <QuickOpen
        open
        fileIndex={fileIndex}
        recents={["hello.html", "docs/sample.md"]}
        onClose={onClose}
        onOpen={onOpen}
      />,
    );
    const input = within(view.container).getByPlaceholderText("Search files by name");
    await user.click(input);
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledWith("docs/sample.md");
    expect(onClose).toHaveBeenCalled();

    onClose.mockClear();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("click row calls onOpen", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const view = render(
      <QuickOpen
        open
        fileIndex={fileIndex}
        recents={["docs/sample.md"]}
        onClose={() => {}}
        onOpen={onOpen}
      />,
    );
    await user.click(within(view.container).getByRole("option", { name: /sample\.md/i }));
    expect(onOpen).toHaveBeenCalledWith("docs/sample.md");
  });

  it("uses list-row variants for options and selection", async () => {
    const user = userEvent.setup();
    const view = render(
      <QuickOpen
        open
        fileIndex={fileIndex}
        recents={["hello.html", "docs/sample.md"]}
        onClose={() => {}}
        onOpen={() => {}}
      />,
    );
    const ui = within(view.container);
    const first = ui.getByRole("option", { name: /hello\.html/i });
    const second = ui.getByRole("option", { name: /sample\.md/i });
    expect(first.className).toContain("mino-list-row");
    expect(second.className).toContain("mino-list-row");
    expect(first.className).toContain("mino-selected");
    expect(second.className).not.toContain("mino-selected");

    await user.keyboard("{ArrowDown}");
    expect(first.className).not.toContain("mino-selected");
    expect(second.className).toContain("mino-selected");
  });

  it("focusToken re-focuses the input while already open", () => {
    const view = render(
      <QuickOpen
        open
        focusToken={0}
        fileIndex={fileIndex}
        recents={[]}
        onClose={() => {}}
        onOpen={() => {}}
      />,
    );
    const input = within(view.container).getByPlaceholderText(
      "Search files by name",
    ) as HTMLInputElement;
    input.blur();
    expect(document.activeElement).not.toBe(input);
    view.rerender(
      <QuickOpen
        open
        focusToken={1}
        fileIndex={fileIndex}
        recents={[]}
        onClose={() => {}}
        onOpen={() => {}}
      />,
    );
    expect(document.activeElement).toBe(input);
  });
});
