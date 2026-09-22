import { describe, expect, it } from "vitest";
import {
  collectDirPaths,
  pruneExpandedPaths,
  type TreeNode,
} from "./api";

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
        {
          name: "api",
          path: "docs/api",
          type: "dir",
          children: [
            { name: "spec.md", path: "docs/api/spec.md", type: "file", children: [] },
          ],
        },
        { name: "sample.md", path: "docs/sample.md", type: "file", children: [] },
      ],
    },
    { name: "hello.html", path: "hello.html", type: "file", children: [] },
  ],
};

describe("collectDirPaths", () => {
  it("returns nested directories and excludes the virtual root and files", () => {
    expect(collectDirPaths(root)).toEqual(["docs", "docs/api"]);
  });

  it("returns an empty list for null", () => {
    expect(collectDirPaths(null)).toEqual([]);
    expect(collectDirPaths(undefined)).toEqual([]);
  });
});

describe("pruneExpandedPaths", () => {
  it("keeps the virtual root, keeps live dirs, and drops missing dirs", () => {
    expect(pruneExpandedPaths(["", "docs", "gone", "docs/api"], ["docs", "docs/api"])).toEqual(
      new Set(["", "docs", "docs/api"]),
    );
  });

  it("always includes the virtual root even when expanded was empty", () => {
    expect(pruneExpandedPaths([], ["docs"])).toEqual(new Set([""]));
  });
});
