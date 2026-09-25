import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Icon, fileIconName } from "../../components/Icon";
import { filter } from "../../lib/fuzzy";

export type PickerRow = { path: string; score: number; matches: number[] };

function basename(path: string) {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? path : path.slice(slash + 1);
}

function parentDir(path: string) {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash + 1);
}

function HighlightedText({
  text,
  matches,
  offset,
}: {
  text: string;
  matches: number[];
  offset: number;
}) {
  const local = useMemo(() => {
    const set = new Set<number>();
    for (const index of matches) {
      if (index >= offset && index < offset + text.length) set.add(index - offset);
    }
    return set;
  }, [matches, offset, text.length]);

  const nodes: ReactNode[] = [];
  let i = 0;
  while (i < text.length) {
    if (local.has(i)) {
      let j = i + 1;
      while (j < text.length && local.has(j)) j += 1;
      nodes.push(
        <mark key={`${i}-m`} className="rounded-sm bg-[#04395e] text-inherit">
          {text.slice(i, j)}
        </mark>,
      );
      i = j;
    } else {
      let j = i + 1;
      while (j < text.length && !local.has(j)) j += 1;
      nodes.push(text.slice(i, j));
      i = j;
    }
  }
  return <>{nodes}</>;
}

export type QuickOpenProps = {
  open: boolean;
  /** Bump while open to re-focus and select the input (parity with legacy Command Center / hotkey). */
  focusToken?: number;
  fileIndex: string[];
  recents: string[];
  onClose: () => void;
  onOpen: (path: string) => void;
};

export function QuickOpen({
  open,
  focusToken = 0,
  fileIndex,
  recents,
  onClose,
  onOpen,
}: QuickOpenProps) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const rows: PickerRow[] = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      return recents.map((path) => ({ path, score: 0, matches: [] }));
    }
    return filter(trimmed, fileIndex, recents);
  }, [query, fileIndex, recents]);

  const renderRows = useCallback(() => {
    if (!query.trim() && !recents.length) return null;
    if (query.trim() && !rows.length) return null;
    return rows;
  }, [query, recents.length, rows]);

  const visibleRows = renderRows();

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(0);
      return;
    }
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [open, focusToken]);

  const acceptPath = useCallback(
    (path: string) => {
      onOpen(path);
      if (fileIndex.includes(path)) onClose();
    },
    [fileIndex, onClose, onOpen],
  );

  const acceptActive = useCallback(() => {
    if (activeIndex < 0 || activeIndex >= rows.length) return;
    acceptPath(rows[activeIndex].path);
  }, [activeIndex, acceptPath, rows]);

  const moveActive = useCallback(
    (delta: number) => {
      if (!rows.length) return;
      const next = activeIndex + delta;
      if (next < 0 || next >= rows.length) return;
      setActiveIndex(next);
    },
    [activeIndex, rows.length],
  );

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  if (!open) return null;

  const emptyMessage = !query.trim()
    ? "Type to search files"
    : "No matching files.";

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/25"
        aria-hidden
        onPointerDown={(event) => {
          event.stopPropagation();
          onClose();
        }}
      />
      <div
        role="dialog"
        aria-label="Quick Open"
        className="fixed left-1/2 top-[35px] z-50 w-[min(600px,70vw)] -translate-x-1/2 overflow-hidden rounded-md border border-[#3c3c3c] bg-[#252526] shadow-lg"
      >
        <label className="flex items-center gap-2 border-b border-[#2b2b2b] px-3 py-2">
          <Icon name="search" size={14} className="text-[#6e6e6e]" />
          <input
            ref={inputRef}
            type="search"
            placeholder="Search files by name"
            autoComplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={visibleRows !== null}
            aria-controls={listId}
            aria-activedescendant={
              activeIndex >= 0 && visibleRows ? `${listId}-item-${activeIndex}` : undefined
            }
            className="min-w-0 flex-1 bg-transparent text-[13px] text-[#cccccc] outline-none placeholder:text-[#6e6e6e]"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                if (!rows.length) return;
                event.preventDefault();
                moveActive(1);
              } else if (event.key === "ArrowUp") {
                if (!rows.length) return;
                event.preventDefault();
                moveActive(-1);
              } else if (event.key === "Enter") {
                event.preventDefault();
                acceptActive();
              }
            }}
          />
        </label>
        <ul id={listId} role="listbox" className="max-h-[min(420px,50vh)] overflow-y-auto py-1">
          {!visibleRows ? (
            <li className="px-3 py-2 text-[13px] text-[#6e6e6e]" role="presentation">
              {emptyMessage}
            </li>
          ) : (
            visibleRows.map((row, index) => {
              const base = basename(row.path);
              const baseOffset = row.path.length - base.length;
              const parent = parentDir(row.path);
              const isActive = index === activeIndex;
              return (
                <li key={row.path} role="presentation">
                  <button
                    type="button"
                    id={`${listId}-item-${index}`}
                    role="option"
                    aria-selected={isActive}
                    tabIndex={-1}
                    className={`mino-list-row flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] ${
                      isActive ? "mino-selected" : "text-[#cccccc]"
                    }`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => acceptPath(row.path)}
                  >
                    <Icon name={fileIconName(row.path)} size={16} className="quick-open-icon" />
                    <span className="min-w-0 truncate">
                      <HighlightedText text={base} matches={row.matches} offset={baseOffset} />
                    </span>
                    {parent ? (
                      <span className="ml-auto min-w-0 truncate text-[12px] text-[#6e6e6e]">
                        <HighlightedText text={parent} matches={row.matches} offset={0} />
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </>
  );
}

export function isQuickOpenHotkey(event: KeyboardEvent | React.KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return false;
  const key = event.key;
  return key === "e" || key === "E" || key === "p" || key === "P";
}
