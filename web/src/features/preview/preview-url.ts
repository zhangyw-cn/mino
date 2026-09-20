import { isMarkdownPath } from "../../lib/preview-width";

export function previewURL(path: string): string {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `/apps/${encoded}?t=${Date.now()}`;
}

export function catalogSourceURL(path: string): string {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  if (isMarkdownPath(path)) return `/api/raw/${encoded}`;
  return `/apps/${encoded}`;
}

export function loadedPreviewPath(
  iframe: HTMLIFrameElement | null,
  expectedOrigin: string,
): string {
  if (!iframe) return "";
  try {
    const loc = iframe.contentWindow?.location;
    if (!loc || loc.origin !== expectedOrigin) return "";
    const prefix = "/apps/";
    if (!loc.pathname.startsWith(prefix)) return "";
    const encoded = loc.pathname.slice(prefix.length);
    if (!encoded) return "";
    return encoded.split("/").map(decodeURIComponent).join("/");
  } catch {
    return "";
  }
}
