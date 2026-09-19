const MESSAGE_SOURCE = "mino";
const KIND_MARKDOWN = "markdown";
const KIND_HTML = "html";
const KIND_DOCUMENT = "document";
const PREVIEW_TYPES: Record<string, boolean> = {
  "preview-navigate": true,
  "preview-reload": true,
  "preview-ready": true,
  "preview-error": true,
};

function asPath(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parsePath(value: unknown): string {
  return asPath(value).trim();
}

export function kindId(path: unknown): "markdown" | "html" | "document" {
  const p = asPath(path);
  if (/\.md$/i.test(p)) return KIND_MARKDOWN;
  if (/\.html?$/i.test(p)) return KIND_HTML;
  return KIND_DOCUMENT;
}

export function inPlace(path: unknown): boolean {
  return kindId(path) === KIND_MARKDOWN;
}

export function decidePreviewAction(input: {
  fromPath?: unknown;
  toPath?: unknown;
  force?: boolean;
  displayedPath?: unknown;
  navigatePending?: boolean;
}): "skip" | "navigate" | "in-place" {
  const opts = input && typeof input === "object" ? input : {};
  const fromPath = asPath(opts.fromPath);
  const toPath = asPath(opts.toPath);
  const force = !!opts.force;
  const displayedPath = asPath(opts.displayedPath);
  const navigatePending = !!opts.navigatePending;
  if (toPath === fromPath && !force) return "skip";
  if (navigatePending) return "navigate";
  if (
    displayedPath &&
    kindId(toPath) === kindId(displayedPath) &&
    inPlace(toPath)
  ) {
    return "in-place";
  }
  return "navigate";
}

function previewMessage(type: string, path: unknown) {
  return {
    source: MESSAGE_SOURCE as "mino",
    type,
    path: parsePath(path),
  };
}

export function previewNavigateMessage(path: unknown) {
  return previewMessage("preview-navigate", path) as {
    source: "mino";
    type: "preview-navigate";
    path: string;
  };
}

export function previewReloadMessage(path: unknown) {
  return previewMessage("preview-reload", path) as {
    source: "mino";
    type: "preview-reload";
    path: string;
  };
}

export function previewReadyMessage(path: unknown) {
  return previewMessage("preview-ready", path) as {
    source: "mino";
    type: "preview-ready";
    path: string;
  };
}

export function previewErrorMessage(path: unknown) {
  return previewMessage("preview-error", path) as {
    source: "mino";
    type: "preview-error";
    path: string;
  };
}

export function parsePreviewMessage(
  data: unknown,
  origin: string,
  expectedOrigin: string,
): { type: string; path: string } | null {
  if (origin !== expectedOrigin) return null;
  if (
    !data ||
    typeof data !== "object" ||
    (data as { source?: string }).source !== MESSAGE_SOURCE
  )
    return null;
  const envelope = data as { type?: string; path?: unknown };
  if (!envelope.type || !PREVIEW_TYPES[envelope.type]) return null;
  const path = parsePath(envelope.path);
  if (!path) return null;
  return { type: envelope.type, path };
}
