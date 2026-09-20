export type TreeNode = {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: TreeNode[];
};

export type WorkspaceMeta = {
  name: string;
  watchEnabled: boolean;
};

export function flattenFiles(node: TreeNode | null | undefined, out: string[] = []): string[] {
  if (!node) return out;
  if (node.type === "file" && node.path) out.push(node.path);
  for (const child of node.children || []) flattenFiles(child, out);
  return out;
}

export function ancestorPaths(path: string): string[] {
  const parts = path.split("/");
  const ancestors = [""];
  for (let i = 0; i < parts.length - 1; i += 1) {
    ancestors.push(parts.slice(0, i + 1).join("/"));
  }
  return ancestors;
}

export async function fetchTree(signal?: AbortSignal): Promise<TreeNode> {
  const response = await fetch("/api/tree", { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<TreeNode>;
}

export async function fetchMeta(signal?: AbortSignal): Promise<WorkspaceMeta> {
  const response = await fetch("/api/meta", { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<WorkspaceMeta>;
}
