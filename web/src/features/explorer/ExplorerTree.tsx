import { Icon, fileIconName, type IconName } from "../../components/Icon";
import type { TreeNode } from "../../lib/api";

type ExplorerTreeProps = {
  root: TreeNode | null;
  expandedPaths: Set<string>;
  selectedPath: string;
  onToggleExpand: (path: string, expanded: boolean) => void;
  onOpenPath: (path: string) => void;
  statusMessage?: string | null;
};

function IndentGuides({ depth }: { depth: number }) {
  if (depth <= 0) return null;
  return (
    <span className="pointer-events-none absolute inset-y-0 left-0" aria-hidden>
      {Array.from({ length: depth }, (_, i) => (
        <span
          key={i}
          className="absolute inset-y-0 w-px bg-[#373737]"
          style={{ left: 8 + i * 16 + 8 }}
        />
      ))}
    </span>
  );
}

function TreeRow({
  node,
  expandedPaths,
  selectedPath,
  onToggleExpand,
  onOpenPath,
  depth,
}: {
  node: TreeNode;
  expandedPaths: Set<string>;
  selectedPath: string;
  onToggleExpand: (path: string, expanded: boolean) => void;
  onOpenPath: (path: string) => void;
  depth: number;
}) {
  const pad = 8 + depth * 16;

  if (node.type === "file") {
    const selected = node.path === selectedPath;
    return (
      <li>
        <button
          type="button"
          title={node.path}
          className={`relative flex w-full items-center gap-1 py-0.5 pr-2 text-left text-[13px] leading-[22px] ${
            selected ? "bg-[#04395e] text-white" : "text-[#cccccc] hover:bg-[#2a2d2e]"
          }`}
          style={{ paddingLeft: pad }}
          onClick={() => onOpenPath(node.path)}
        >
          <IndentGuides depth={depth} />
          <span className="inline-block w-4 shrink-0" aria-hidden />
          <Icon name={fileIconName(node.path)} size={16} />
          <span className="truncate">{node.name}</span>
        </button>
      </li>
    );
  }

  const expanded = expandedPaths.has(node.path);
  const folderIcon: IconName = expanded ? "folder-open" : "folder";

  return (
    <li>
      <button
        type="button"
        title={node.path || node.name}
        aria-expanded={expanded}
        className="relative flex w-full items-center gap-1 py-0.5 pr-2 text-left text-[13px] leading-[22px] text-[#cccccc] hover:bg-[#2a2d2e]"
        style={{ paddingLeft: pad }}
        onClick={() => onToggleExpand(node.path, !expanded)}
      >
        <IndentGuides depth={depth} />
        <span
          className={`inline-flex w-4 shrink-0 items-center justify-center text-[#6e6e6e] transition-transform ${
            expanded ? "rotate-90" : ""
          }`}
          aria-hidden
        >
          <Icon name="chevron" size={16} />
        </span>
        <Icon name={folderIcon} size={16} />
        <span className="truncate">{node.name}</span>
      </button>
      {expanded && node.children?.length ? (
        <ul>
          {node.children.map((child) => (
            <TreeRow
              key={child.path || child.name}
              node={child}
              expandedPaths={expandedPaths}
              selectedPath={selectedPath}
              onToggleExpand={onToggleExpand}
              onOpenPath={onOpenPath}
              depth={depth + 1}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function ExplorerTree({
  root,
  expandedPaths,
  selectedPath,
  onToggleExpand,
  onOpenPath,
  statusMessage,
}: ExplorerTreeProps) {
  if (statusMessage) {
    return <p className="px-3 py-2 text-[13px] text-[#6e6e6e]">{statusMessage}</p>;
  }
  if (!root?.children?.length) {
    return (
      <p className="px-3 py-2 text-[13px] text-[#6e6e6e]">No HTML or Markdown files found.</p>
    );
  }

  return (
    <ul className="py-1">
      {root.children.map((node) => (
        <TreeRow
          key={node.path || node.name}
          node={node}
          expandedPaths={expandedPaths}
          selectedPath={selectedPath}
          onToggleExpand={onToggleExpand}
          onOpenPath={onOpenPath}
          depth={0}
        />
      ))}
    </ul>
  );
}
