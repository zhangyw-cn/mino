import { useCallback, useEffect, useRef, useState } from "react";
import {
  isMarkdownPath,
  readPreviewWidth,
  WIDTH_LABELS,
  writePreviewWidth,
  previewWidthMessage,
  type PreviewWidth,
} from "../../lib/preview-width";

const WIDTH_OPTIONS: PreviewWidth[] = ["standard", "wide", "full"];

export type StatusBarProps = {
  currentPath: string;
  previewWidth: PreviewWidth;
  onPreviewWidthChange: (width: PreviewWidth) => void;
  getPreviewWindow: () => Window | null;
};

export function StatusBar({
  currentPath,
  previewWidth,
  onPreviewWidthChange,
  getPreviewWindow,
}: StatusBarProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const showWidth = isMarkdownPath(currentPath);

  const postWidthToPreview = useCallback(
    (width: PreviewWidth) => {
      const frame = getPreviewWindow();
      if (!frame) return;
      try {
        frame.postMessage(previewWidthMessage(width), window.location.origin);
      } catch {
        /* ignore */
      }
    },
    [getPreviewWindow],
  );

  const setPreviewWidth = useCallback(
    (mode: PreviewWidth) => {
      const value = writePreviewWidth(localStorage, mode);
      onPreviewWidthChange(value);
      postWidthToPreview(value);
      setMenuOpen(false);
    },
    [onPreviewWidthChange, postWidthToPreview],
  );

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (wrapRef.current?.contains(event.target as Node)) return;
      setMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  useEffect(() => {
    if (!showWidth) setMenuOpen(false);
  }, [showWidth]);

  return (
    <footer className="flex h-[22px] shrink-0 items-center justify-end gap-2 border-t border-[#2b2b2b] bg-[#007acc] px-2 text-[12px] text-white">
      {showWidth ? (
        <div ref={wrapRef} className="relative">
          <button
            type="button"
            className="rounded px-1.5 py-0.5 hover:bg-white/15"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpen((open) => !open);
            }}
          >
            {WIDTH_LABELS[previewWidth]}
          </button>
          {menuOpen ? (
            <ul
              role="menu"
              className="absolute bottom-full right-0 mb-1 min-w-[88px] rounded border border-[#2b2b2b] bg-[#252526] py-1 text-[#cccccc] shadow-lg"
            >
              {WIDTH_OPTIONS.map((mode) => (
                <li key={mode} role="none">
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={mode === previewWidth}
                    data-md-width={mode}
                    className="block w-full px-3 py-1 text-left hover:bg-[#2a2d2e]"
                    onClick={(event) => {
                      event.preventDefault();
                      setPreviewWidth(mode);
                    }}
                  >
                    {WIDTH_LABELS[mode]}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </footer>
  );
}

export function useInitialPreviewWidth(): PreviewWidth {
  return readPreviewWidth(localStorage);
}
