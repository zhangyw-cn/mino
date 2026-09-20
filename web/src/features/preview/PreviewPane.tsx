import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Icon } from "../../components/Icon";
import { referencedPaths } from "../../lib/asset-refs";
import {
  decidePreviewAction,
  inPlace,
  parsePreviewMessage,
  previewNavigateMessage,
  previewReloadMessage,
} from "../../lib/preview-session";
import { previewWidthMessage, type PreviewWidth } from "../../lib/preview-width";
import { isQuickOpenHotkey } from "../quick-open/QuickOpen";
import {
  catalogSourceURL,
  loadedPreviewPath,
  previewURL,
} from "./preview-url";

export type PreviewOpenSignal = {
  path: string;
  force?: boolean;
  nonce: number;
};

export type PreviewPaneHandle = {
  noteAssetEvent: (assetPath: string) => void;
};

export type PreviewPaneProps = {
  openSignal: PreviewOpenSignal;
  previewWidth: PreviewWidth;
  onIframeRef?: (iframe: HTMLIFrameElement | null) => void;
  /** Open Quick Open when Ctrl/Cmd+E|P is pressed inside the same-origin preview iframe. */
  onQuickOpenHotkey?: () => void;
};

export const PreviewPane = forwardRef<PreviewPaneHandle, PreviewPaneProps>(
  function PreviewPane(
    { openSignal, previewWidth, onIframeRef, onQuickOpenHotkey },
    ref,
  ) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const currentPathRef = useRef("");
    const displayedPathRef = useRef("");
    const navigatePendingRef = useRef(false);
    const [displayedPath, setDisplayedPath] = useState("");
    const [iframeSrc, setIframeSrc] = useState<string | undefined>(undefined);
    const [navigatePending, setNavigatePending] = useState(false);
    const [showEmpty, setShowEmpty] = useState(true);

    const assetScanGen = useRef(0);
    const referencedAssetsRef = useRef<Set<string>>(new Set());
    const assetScanPendingRef = useRef(false);
    const pendingAssetEventsRef = useRef<Set<string>>(new Set());

    const origin =
      typeof window !== "undefined" ? window.location.origin : "";

    navigatePendingRef.current = navigatePending;

    const setIframe = useCallback(
      (node: HTMLIFrameElement | null) => {
        iframeRef.current = node;
        onIframeRef?.(node);
      },
      [onIframeRef],
    );

    const revealPreviewIfCurrent = useCallback((path: string) => {
      if (path !== currentPathRef.current) return;
      displayedPathRef.current = path;
      setDisplayedPath(path);
      setNavigatePending(false);
    }, []);

    const postToFrame = useCallback(
      (message: { source: "mino"; type: string; path?: string; value?: string }) => {
        const frame = iframeRef.current?.contentWindow;
        if (!frame || !message) return;
        try {
          frame.postMessage(message, origin);
        } catch {
          /* cross-origin */
        }
      },
      [origin],
    );

    const postMdWidthToPreview = useCallback(() => {
      if (!/\.md$/i.test(currentPathRef.current)) return;
      postToFrame(previewWidthMessage(previewWidth));
    }, [postToFrame, previewWidth]);

    const applyOpenRef = useRef<(path: string, force: boolean) => void>(() => {});

    const flushPendingAssetEvents = useCallback((forPath: string) => {
      const pending = pendingAssetEventsRef.current;
      pendingAssetEventsRef.current = new Set();
      assetScanPendingRef.current = false;
      if (!forPath || forPath !== currentPathRef.current) return false;
      for (const assetPath of pending) {
        if (referencedAssetsRef.current.has(assetPath)) return true;
      }
      return false;
    }, []);

    const refreshAssetRefs = useCallback(
      (path: string) => {
        const gen = ++assetScanGen.current;
        pendingAssetEventsRef.current = new Set();
        if (!path) {
          referencedAssetsRef.current = new Set();
          assetScanPendingRef.current = false;
          return;
        }
        assetScanPendingRef.current = true;
        fetch(catalogSourceURL(path), { cache: "no-store" })
          .then((res) => (res.ok ? res.text() : Promise.reject()))
          .then((source) => {
            if (gen !== assetScanGen.current) return;
            referencedAssetsRef.current = new Set(referencedPaths(path, source));
            if (flushPendingAssetEvents(path)) {
              applyOpenRef.current(path, true);
            }
          })
          .catch(() => {
            if (gen !== assetScanGen.current) return;
            referencedAssetsRef.current = new Set();
            flushPendingAssetEvents(path);
          });
      },
      [flushPendingAssetEvents],
    );

    const applyOpen = useCallback(
      (path: string, force: boolean) => {
        const fromPath = currentPathRef.current;
        const action = decidePreviewAction({
          fromPath,
          toPath: path,
          force,
          displayedPath: displayedPathRef.current,
          navigatePending: navigatePendingRef.current,
        });

        currentPathRef.current = path;

        if (!path) {
          assetScanGen.current += 1;
          assetScanPendingRef.current = false;
          pendingAssetEventsRef.current = new Set();
          referencedAssetsRef.current = new Set();
          displayedPathRef.current = "";
          setDisplayedPath("");
          setNavigatePending(false);
          setIframeSrc(undefined);
          setShowEmpty(true);
          return;
        }

        setShowEmpty(false);

        if (action === "skip") return;

        refreshAssetRefs(path);

        if (action === "in-place") {
          const message =
            force &&
            path === fromPath &&
            displayedPathRef.current === path
              ? previewReloadMessage(path)
              : previewNavigateMessage(path);
          postToFrame(message);
          return;
        }

        setNavigatePending(true);
        setIframeSrc(previewURL(path));
      },
      [postToFrame, refreshAssetRefs],
    );

    applyOpenRef.current = applyOpen;

    useEffect(() => {
      applyOpen(openSignal.path, !!openSignal.force);
    }, [openSignal.nonce, openSignal.path, openSignal.force, applyOpen]);

    useImperativeHandle(
      ref,
      () => ({
        noteAssetEvent(assetPath: string) {
          if (!currentPathRef.current) return;
          if (referencedAssetsRef.current.has(assetPath)) {
            applyOpenRef.current(currentPathRef.current, true);
            return;
          }
          if (assetScanPendingRef.current) {
            pendingAssetEventsRef.current.add(assetPath);
          }
        },
      }),
      [],
    );

    useEffect(() => {
      function onMessage(event: MessageEvent) {
        const parsed = parsePreviewMessage(
          event.data,
          event.origin,
          origin,
        );
        if (parsed) {
          if (parsed.type === "preview-ready") {
            revealPreviewIfCurrent(parsed.path);
          }
          if (parsed.type === "preview-error") {
            if (parsed.path === currentPathRef.current) {
              setNavigatePending(false);
            }
          }
        }
      }
      window.addEventListener("message", onMessage);
      return () => window.removeEventListener("message", onMessage);
    }, [origin, revealPreviewIfCurrent]);

    useEffect(() => {
      postMdWidthToPreview();
    }, [postMdWidthToPreview, previewWidth, displayedPath]);

    const onQuickOpenHotkeyRef = useRef(onQuickOpenHotkey);
    onQuickOpenHotkeyRef.current = onQuickOpenHotkey;
    const previewKeyCleanupRef = useRef<(() => void) | null>(null);

    const bindPreviewHotkeys = useCallback(() => {
      previewKeyCleanupRef.current?.();
      previewKeyCleanupRef.current = null;
      if (!onQuickOpenHotkeyRef.current) return;
      try {
        const doc = iframeRef.current?.contentDocument;
        if (!doc) return;
        const onKeyDown = (event: KeyboardEvent) => {
          if (!isQuickOpenHotkey(event)) return;
          event.preventDefault();
          onQuickOpenHotkeyRef.current?.();
        };
        doc.addEventListener("keydown", onKeyDown, true);
        previewKeyCleanupRef.current = () => {
          doc.removeEventListener("keydown", onKeyDown, true);
        };
      } catch {
        /* cross-origin or unavailable document */
      }
    }, []);

    useEffect(() => {
      return () => {
        previewKeyCleanupRef.current?.();
        previewKeyCleanupRef.current = null;
      };
    }, []);

    const onIframeLoad = useCallback(() => {
      bindPreviewHotkeys();
      postMdWidthToPreview();
      const loaded = loadedPreviewPath(iframeRef.current, origin);
      if (inPlace(loaded)) return;
      revealPreviewIfCurrent(loaded);
    }, [
      bindPreviewHotkeys,
      origin,
      postMdWidthToPreview,
      revealPreviewIfCurrent,
    ]);

    const pendingClass = navigatePending ? "preview-pending" : "";

    return (
      <>
        {showEmpty ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-[#6e6e6e]">
            <Icon name="empty" size={34} />
            <strong className="text-[#cccccc]">No preview selected</strong>
            <span className="max-w-sm text-[13px]">
              Choose an HTML or Markdown file from the sidebar.
            </span>
          </div>
        ) : (
          <iframe
            ref={setIframe}
            title="Preview"
            className={`h-full w-full flex-1 border-0 bg-white ${pendingClass}`}
            src={iframeSrc}
            onLoad={onIframeLoad}
          />
        )}
      </>
    );
  },
);
