import type { StorageLike } from "./open-path";

export const STORAGE_KEY = "mino-md-preview-width";
export const DEFAULT_WIDTH = "wide";
const WIDTHS: Record<PreviewWidth, true> = {
  standard: true,
  wide: true,
  full: true,
};
export const WIDTH_LABELS: Record<"standard" | "wide" | "full", string> = {
  standard: "标宽",
  wide: "较宽",
  full: "全宽",
};
export type PreviewWidth = "standard" | "wide" | "full";

export function parsePreviewWidth(value: unknown): PreviewWidth {
  const v = String(value || "");
  return Object.hasOwn(WIDTHS, v) ? (v as PreviewWidth) : DEFAULT_WIDTH;
}

export function isMarkdownPath(path: unknown): boolean {
  return /\.md$/i.test(String(path || ""));
}

export function readPreviewWidth(
  storage: StorageLike | null | undefined,
): PreviewWidth {
  try {
    return parsePreviewWidth(storage?.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_WIDTH;
  }
}

export function writePreviewWidth(
  storage: StorageLike | null | undefined,
  mode: unknown,
): PreviewWidth {
  const value = parsePreviewWidth(mode);
  try {
    if (storage) storage.setItem(STORAGE_KEY, value);
  } catch {
    /* ignore quota / private mode */
  }
  return value;
}

export function applyPreviewWidth(
  root: { setAttribute(name: string, value: string): void } | null | undefined,
  mode: unknown,
): PreviewWidth {
  const value = parsePreviewWidth(mode);
  if (root && typeof root.setAttribute === "function") {
    root.setAttribute("data-md-width", value);
  }
  return value;
}

export function previewWidthMessage(value: unknown) {
  return {
    source: "mino" as const,
    type: "md-preview-width" as const,
    value: parsePreviewWidth(value),
  };
}

export function parsePreviewWidthMessage(
  data: unknown,
  origin: string,
  expectedOrigin: string,
): PreviewWidth | null {
  if (origin !== expectedOrigin) return null;
  if (
    !data ||
    typeof data !== "object" ||
    (data as { source?: string }).source !== "mino" ||
    (data as { type?: string }).type !== "md-preview-width"
  )
    return null;
  const v = (data as { value?: unknown }).value;
  if (typeof v !== "string" || !Object.hasOwn(WIDTHS, v)) return null;
  return v as PreviewWidth;
}
