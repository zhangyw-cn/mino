import { cleanup, render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TreeNode } from "../../lib/api";
import { ExplorerTree } from "./ExplorerTree";

const root: TreeNode = {
  name: "",
  path: "",
  type: "dir",
  children: [
    {
      name: "docs",
      path: "docs",
      type: "dir",
      children: [
        { name: "sample.md", path: "docs/sample.md", type: "file", children: [] },
      ],
    },
    { name: "hello.html", path: "hello.html", type: "file", children: [] },
  ],
};

afterEach(() => cleanup());

describe("ExplorerTree", () => {
  it("opens file on click", async () => {
    const user = userEvent.setup();
    const onOpenPath = vi.fn();
    const view = render(
      <ExplorerTree
        root={root}
        expandedPaths={new Set(["", "docs"])}
        selectedPath=""
        onToggleExpand={() => {}}
        onOpenPath={onOpenPath}
      />,
    );
    const fileBtn = within(view.container).getByRole("button", { name: "hello.html" });
    expect(fileBtn.className).toContain("mino-list-row");
    await user.click(fileBtn);
    expect(onOpenPath).toHaveBeenCalledWith("hello.html");
  });

  it("toggles directory expand", async () => {
    const user = userEvent.setup();
    const onToggleExpand = vi.fn();
    const view = render(
      <ExplorerTree
        root={root}
        expandedPaths={new Set([""])}
        selectedPath=""
        onToggleExpand={onToggleExpand}
        onOpenPath={() => {}}
      />,
    );
    await user.click(
      within(view.container).getByRole("button", { name: "docs", expanded: false }),
    );
    expect(onToggleExpand).toHaveBeenCalledWith("docs", true);
  });

  it("indents nested rows by 16px columns", () => {
    const view = render(
      <ExplorerTree
        root={root}
        expandedPaths={new Set(["", "docs"])}
        selectedPath=""
        onToggleExpand={() => {}}
        onOpenPath={() => {}}
      />,
    );
    const top = within(view.container).getByRole("button", { name: "docs" });
    const nested = within(view.container).getByRole("button", { name: "sample.md" });
    expect(top.style.paddingLeft).toBe("8px");
    expect(nested.style.paddingLeft).toBe("24px");
  });

  it("does not use a unicode twistie", () => {
    const view = render(
      <ExplorerTree
        root={root}
        expandedPaths={new Set(["", "docs"])}
        selectedPath=""
        onToggleExpand={() => {}}
        onOpenPath={() => {}}
      />,
    );
    expect(view.container.textContent).not.toContain("▶");
  });

  it("does not render children when a folder is collapsed", () => {
    const view = render(
      <ExplorerTree
        root={root}
        expandedPaths={new Set([""])}
        selectedPath=""
        onToggleExpand={() => {}}
        onOpenPath={() => {}}
      />,
    );
    expect(within(view.container).queryByRole("button", { name: "sample.md" })).toBeNull();
  });

  it("highlights the selected file", () => {
    const view = render(
      <ExplorerTree
        root={root}
        expandedPaths={new Set(["", "docs"])}
        selectedPath="docs/sample.md"
        onToggleExpand={() => {}}
        onOpenPath={() => {}}
      />,
    );
    const selected = within(view.container).getByRole("button", { name: "sample.md" });
    expect(selected.className).toContain("mino-list-row");
    expect(selected.className).toContain("mino-selected");
    const other = within(view.container).getByRole("button", { name: "hello.html" });
    expect(other.className).toContain("mino-list-row");
    expect(other.className).not.toContain("mino-selected");
    const folder = within(view.container).getByRole("button", { name: "docs" });
    expect(folder.className).toContain("mino-list-row");
    expect(folder.className).not.toContain("mino-selected");
  });
});
