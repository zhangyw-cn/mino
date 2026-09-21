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
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!showWidth) setMenuOpen(false);
  }, [showWidth]);

  return (
    <footer className="flex h-[22px] shrink-0 items-center justify-end gap-2 border-t border-[#2b2b2b] bg-[#181818] px-2 text-[12px] text-[#cccccc]">
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
              {WIDTH_OPTIONS.map((mode) => {
                const checked = mode === previewWidth;
                return (
                  <li key={mode} role="none">
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={checked}
                      data-md-width={mode}
                      className={
                        "block w-full py-1 text-left hover:bg-[#2a2d2e] " +
                        (checked ? "pl-7 pr-3 relative" : "px-3")
                      }
                      onClick={(event) => {
                        event.preventDefault();
                        setPreviewWidth(mode);
                      }}
                    >
                      {checked ? (
                        <span
                          aria-hidden="true"
                          className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-[#cccccc]"
                        >
                          ✓
                        </span>
                      ) : null}
                      {WIDTH_LABELS[mode]}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </footer>
  );
}

export function readInitialPreviewWidth(): PreviewWidth {
  return readPreviewWidth(localStorage);
}
