import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, fileIconName } from "../components/Icon";
import { ExplorerTree } from "../features/explorer/ExplorerTree";
import {
  PreviewPane,
  type PreviewOpenSignal,
  type PreviewPaneHandle,
} from "../features/preview/PreviewPane";
import { QuickOpen, isQuickOpenHotkey } from "../features/quick-open/QuickOpen";
import {
  StatusBar,
  readInitialPreviewWidth,
} from "../features/status-bar/StatusBar";
import { useWatchEvents } from "../features/watch/useWatchEvents";
import {
  ancestorPaths,
  collectDirPaths,
  fetchMeta,
  fetchTree,
  flattenFiles,
  pruneExpandedPaths,
  type TreeNode,
} from "../lib/api";
import {
  clearOpenPath,
  createOpenPathRestore,
  writeOpenPath,
} from "../lib/open-path";
import type { PreviewWidth } from "../lib/preview-width";

function rememberRecent(recents: string[], path: string) {
  return [path, ...recents.filter((item) => item !== path)].slice(0, 10);
}

function sessionStore(): Storage | null {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
}

export type WorkbenchAppProps = {
  onOpenPath?: (path: string) => void;
};

export function WorkbenchApp({ onOpenPath }: WorkbenchAppProps = {}) {
  const commandCenterRef = useRef<HTMLButtonElement>(null);
  const previewRef = useRef<PreviewPaneHandle>(null);
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);
  const openPathRestoreRef = useRef(createOpenPathRestore());
  const openNonceRef = useRef(0);
  const listingRequestId = useRef(0);
  const listingAbortRef = useRef<AbortController | null>(null);

  const [workspaceName, setWorkspaceName] = useState("mino");
  const [watchEnabled, setWatchEnabled] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [treeRoot, setTreeRoot] = useState<TreeNode | null>(null);
  const [fileIndex, setFileIndex] = useState<string[]>([]);
  const [treeStatus, setTreeStatus] = useState<string | null>("Loading files…");
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set([""]));
  const [selectedPath, setSelectedPath] = useState("");
  const [recents, setRecents] = useState<string[]>([]);
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);
  const [quickOpenFocusToken, setQuickOpenFocusToken] = useState(0);
  const [previewWidth, setPreviewWidth] = useState<PreviewWidth>(() =>
    readInitialPreviewWidth(),
  );
  const [openSignal, setOpenSignal] = useState<PreviewOpenSignal>(() => ({
    path: "",
    force: false,
    nonce: 0,
  }));
  const selectedPathRef = useRef(selectedPath);
  selectedPathRef.current = selectedPath;

  const bumpPreviewOpen = useCallback((path: string, force = false) => {
    openNonceRef.current += 1;
    setOpenSignal({
      path,
      force,
      nonce: openNonceRef.current,
    });
  }, []);

  const loadTree = useCallback(async () => {
    listingAbortRef.current?.abort();
    const controller = new AbortController();
    listingAbortRef.current = controller;
    const requestId = ++listingRequestId.current;
    try {
      const root = await fetchTree(controller.signal);
      if (requestId !== listingRequestId.current) return;
      setTreeRoot(root);
      const index = flattenFiles(root, []);
      setFileIndex(index);
      setRecents((prev) => prev.filter((path) => index.includes(path)));
      setTreeStatus(null);

      const dirPaths = collectDirPaths(root);
      const restored = openPathRestoreRef.current(sessionStore(), index);
      setExpandedPaths((prev) => {
        const next = pruneExpandedPaths(prev, dirPaths);
        if (restored) {
          for (const ancestor of ancestorPaths(restored)) next.add(ancestor);
        }
        return next;
      });
      if (restored) {
        setRecents((prev) => rememberRecent(prev, restored));
        setSelectedPath(restored);
        writeOpenPath(sessionStore(), restored);
        bumpPreviewOpen(restored, false);
        onOpenPath?.(restored);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      if (requestId !== listingRequestId.current) return;
      console.error("Failed to load tree", error);
      setTreeStatus("Could not load files.");
    }
  }, [bumpPreviewOpen, onOpenPath]);

  useEffect(() => {
    void loadTree();
    return () => {
      listingAbortRef.current?.abort();
    };
  }, [loadTree]);

  useEffect(() => {
    const controller = new AbortController();
    fetchMeta(controller.signal)
      .then((meta) => {
        const name = meta.name || "mino";
        setWorkspaceName(name);
        setWatchEnabled(meta.watchEnabled);
        document.title = `${name} · mino`;
      })
      .catch((error) => {
        console.error("Failed to load metadata", error);
        setWatchEnabled(false);
      });
    return () => controller.abort();
  }, []);

  const openQuickOpen = useCallback(() => {
    setQuickOpenOpen(true);
    setQuickOpenFocusToken((token) => token + 1);
  }, []);

  const closeQuickOpen = useCallback(() => {
    setQuickOpenOpen(false);
    commandCenterRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isQuickOpenHotkey(event)) {
        event.preventDefault();
        openQuickOpen();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [openQuickOpen]);

  const clearPreview = useCallback(() => {
    setSelectedPath("");
    clearOpenPath(sessionStore());
    bumpPreviewOpen("", false);
  }, [bumpPreviewOpen]);

  const handleOpenPath = useCallback(
    (path: string, force = false) => {
      if (!fileIndex.includes(path)) {
        setRecents((prev) => prev.filter((item) => item !== path));
        return;
      }
      setRecents((prev) => rememberRecent(prev, path));
      setSelectedPath(path);
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        for (const ancestor of ancestorPaths(path)) next.add(ancestor);
        return next;
      });
      writeOpenPath(sessionStore(), path);
      bumpPreviewOpen(path, force);
      onOpenPath?.(path);
    },
    [bumpPreviewOpen, fileIndex, onOpenPath],
  );

  const handleOpenPathRef = useRef(handleOpenPath);
  handleOpenPathRef.current = handleOpenPath;
  const clearPreviewRef = useRef(clearPreview);
  clearPreviewRef.current = clearPreview;
  const loadTreeRef = useRef(loadTree);
  loadTreeRef.current = loadTree;

  const onFileEvent = useCallback(
    (kind: "added" | "removed" | "changed", payload: { path: string }) => {
      if (kind === "removed") {
        setRecents((prev) => prev.filter((item) => item !== payload.path));
      }
      void loadTreeRef.current();
      const current = selectedPathRef.current;
      if (payload.path !== current) return;
      if (kind === "changed") handleOpenPathRef.current(current, true);
      if (kind === "removed") clearPreviewRef.current();
    },
    [],
  );

  const onAssetEvent = useCallback(
    (_kind: "asset-changed" | "asset-removed", payload: { path: string }) => {
      previewRef.current?.noteAssetEvent(payload.path);
    },
    [],
  );

  useWatchEvents({
    onFileEvent,
    onAssetEvent,
  });

  const toggleExpand = useCallback((path: string, expanded: boolean) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (expanded) next.add(path);
      else next.delete(path);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setExpandedPaths(new Set(["", ...collectDirPaths(treeRoot)]));
  }, [treeRoot]);

  const collapseAll = useCallback(() => {
    setExpandedPaths(new Set([""]));
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((c) => !c);
  }, []);

  const collapseSidebar = useCallback(() => {
    setSidebarCollapsed(true);
  }, []);

  const getPreviewWindow = useCallback(
    () => previewIframeRef.current?.contentWindow ?? null,
    [],
  );

  const gridCols = sidebarCollapsed
    ? "grid-cols-[48px_0px_1fr]"
    : "grid-cols-[48px_min(280px,32vw)_1fr]";

  const dirPaths = collectDirPaths(treeRoot);
  const expandAllDisabled =
    Boolean(treeStatus) ||
    dirPaths.length === 0 ||
    dirPaths.every((path) => expandedPaths.has(path));
  const collapseAllDisabled =
    Boolean(treeStatus) ||
    dirPaths.length === 0 ||
    !dirPaths.some((path) => expandedPaths.has(path));

  return (
    <div className="flex min-h-screen min-w-[680px] flex-col bg-[#181818] text-[#cccccc]">
      <header className="relative z-10 grid h-[35px] shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-4 border-b border-[#2b2b2b] px-3">
        <div className="flex min-w-0 items-center gap-2 justify-self-start">
          <span
            className="grid h-[22px] w-[22px] place-items-center rounded border border-[#3c3c3c] font-mono text-[11px] font-bold"
            aria-hidden
          >
            M
          </span>
          <h1 className="sr-only">{workspaceName}</h1>
        </div>
        <div className="relative w-[min(600px,70vw)] justify-self-center">
          <button
            ref={commandCenterRef}
            type="button"
            title={workspaceName}
            aria-haspopup="dialog"
            aria-expanded={quickOpenOpen}
            className="mino-chrome-button relative h-6 w-full overflow-hidden rounded-[5px] border border-[#3c3c3c] bg-[#252526] px-6 text-center text-[13px] leading-[22px] text-[#cccccc]"
            onClick={openQuickOpen}
          >
            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2">
              <Icon name="search" size={14} className="text-[#6e6e6e]" />
            </span>
            <span className="block truncate">{workspaceName}</span>
          </button>
          <QuickOpen
            open={quickOpenOpen}
            focusToken={quickOpenFocusToken}
            fileIndex={fileIndex}
            recents={recents}
            onClose={closeQuickOpen}
            onOpen={handleOpenPath}
          />
        </div>
      </header>

      {!watchEnabled ? (
        <div
          className="border-b border-[#8a7326] bg-[#5c4b1f] px-3 py-1.5 text-center text-[12px] text-[#f5e6a8]"
          role="status"
        >
          Live reload unavailable — refresh manually
        </div>
      ) : null}

      <main className={`grid min-h-0 flex-1 ${gridCols}`}>
        <nav className="flex flex-col border-r border-[#2b2b2b] bg-[#181818]" aria-label="Activity">
          <button
            type="button"
            className={`mino-icon-button grid h-12 w-12 place-items-center border-l-2 ${
              sidebarCollapsed
                ? "border-transparent text-[#6e6e6e] hover:text-[#cccccc]"
                : "border-[#0078d4] bg-[#2a2d2e] text-white"
            }`}
            aria-label="Explorer"
            aria-expanded={!sidebarCollapsed}
            title="Explorer"
            onClick={toggleSidebar}
          >
            <Icon name="explorer" size={24} />
          </button>
        </nav>

        <aside
          className={`overflow-hidden border-r border-[#2b2b2b] bg-[#1f1f1f] ${
            sidebarCollapsed ? "invisible w-0 border-r-0 p-0" : "min-w-0"
          }`}
          aria-label="Explorer"
          aria-hidden={sidebarCollapsed}
          inert={sidebarCollapsed}
        >
          <div className="flex h-9 items-center justify-between px-3 text-[11px] font-semibold uppercase tracking-wide text-[#cccccc]">
            <span>Explorer</span>
            <div className="flex items-center">
              <button
                type="button"
                className="mino-icon-button grid h-6 w-6 place-items-center rounded text-[#cccccc]"
                aria-label="Expand all"
                title="Expand all"
                disabled={expandAllDisabled}
                onClick={expandAll}
              >
                <Icon name="expand-all" size={16} />
              </button>
              <button
                type="button"
                className="mino-icon-button grid h-6 w-6 place-items-center rounded text-[#cccccc]"
                aria-label="Collapse all"
                title="Collapse all"
                disabled={collapseAllDisabled}
                onClick={collapseAll}
              >
                <Icon name="collapse-all" size={16} />
              </button>
              <span className="mx-0.5 h-4 w-px bg-[#2b2b2b]" aria-hidden />
              <button
                type="button"
                className="mino-icon-button grid h-6 w-6 place-items-center rounded text-[#cccccc]"
                aria-label="Collapse explorer"
                title="Collapse explorer"
                onClick={collapseSidebar}
              >
                <Icon name="collapse" size={16} />
              </button>
            </div>
          </div>
          <nav className="overflow-y-auto pb-4" aria-label="File tree">
            <ExplorerTree
              root={treeRoot}
              expandedPaths={expandedPaths}
              selectedPath={selectedPath}
              onToggleExpand={toggleExpand}
              onOpenPath={handleOpenPath}
              statusMessage={treeStatus}
            />
          </nav>
        </aside>

        <section className="flex min-w-0 flex-col bg-[#1e1e1e]">
          <div className="flex h-9 shrink-0 items-center border-b border-[#2b2b2b] px-3 text-[13px]">
            {selectedPath ? (
              <span className="flex min-w-0 items-center gap-2 truncate">
                <Icon name={fileIconName(selectedPath)} size={16} />
                {selectedPath.split("/").join(" / ")}
              </span>
            ) : (
              <span className="text-[#6e6e6e]">No file selected</span>
            )}
          </div>
          <div className="flex min-h-0 flex-1 flex-col bg-[#1e1e1e]">
            <PreviewPane
              ref={previewRef}
              openSignal={openSignal}
              previewWidth={previewWidth}
              onQuickOpenHotkey={openQuickOpen}
              onIframeRef={(node) => {
                previewIframeRef.current = node;
              }}
            />
          </div>
        </section>
      </main>

      <StatusBar
        currentPath={selectedPath}
        previewWidth={previewWidth}
        onPreviewWidthChange={setPreviewWidth}
        getPreviewWindow={getPreviewWindow}
      />
    </div>
  );
}
