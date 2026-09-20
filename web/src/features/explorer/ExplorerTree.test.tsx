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
    await user.click(within(view.container).getByRole("button", { name: "hello.html" }));
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
});
