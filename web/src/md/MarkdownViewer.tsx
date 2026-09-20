import DOMPurify from "dompurify";
import hljs from "highlight.js";
import katex from "katex";
import { marked } from "marked";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { closeMermaidFullscreen } from "../lib/mermaid-block";
import { escapeHtml, preprocessMath } from "../lib/preprocess";
import {
  kindId,
  parsePreviewMessage,
  previewErrorMessage,
  previewReadyMessage,
} from "../lib/preview-session";
import {
  applyPreviewWidth,
  parsePreviewWidthMessage,
  readPreviewWidth,
} from "../lib/preview-width";
import { ensureHeadingIds, type TocItem } from "../lib/toc";
import { replaceMermaidBlocksIn } from "./MermaidBlock";
import { Toc } from "./Toc";

export function encodePath(p: string): string {
  return p.split("/").map(encodeURIComponent).join("/");
}

function languageName(lang: unknown): string {
  return String(lang || "")
    .trim()
    .split(/\s+/)[0];
}

marked.use({
  gfm: true,
  breaks: false,
  renderer: {
    code({ text, lang }) {
      const name = languageName(lang);
      const cls = name ? ' class="language-' + escapeHtml(name) + '"' : "";
      return "<pre><code" + cls + ">" + escapeHtml(text) + "</code></pre>\n";
    },
  },
});

function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["class", "id"],
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form"],
  });
}

function postPreview(
  message:
    | ReturnType<typeof previewReadyMessage>
    | ReturnType<typeof previewErrorMessage>
    | null,
) {
  if (!message) return;
  try {
    parent.postMessage(message, window.location.origin);
  } catch {
    /* cross-origin guard */
  }
}

function enhanceLinksAndCode(content: HTMLElement) {
  content.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href") || "";
    if (/^https?:\/\//i.test(href)) {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    }
  });

  content.querySelectorAll("pre code").forEach((block) => {
    if (block.classList.contains("language-mermaid")) return;
    try {
      hljs.highlightElement(block as HTMLElement);
    } catch {
      block.classList.add("render-error");
      block.textContent = "Highlight failed";
    }
  });

  content.querySelectorAll(".math-inline, .math-display").forEach((el) => {
    try {
      katex.render(el.textContent || "", el as HTMLElement, {
        throwOnError: false,
        displayMode: el.classList.contains("math-display"),
      });
    } catch {
      el.classList.add("render-error");
      el.textContent = "Math render failed";
    }
  });
}

type LoadMode = "initial" | "navigate" | "reload";

export function MarkdownViewer({ initialPath }: { initialPath: string }) {
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [html, setHtml] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [tocItems, setTocItems] = useState<TocItem[]>([]);
  const contentRef = useRef<HTMLElement>(null);
  const requestGen = useRef(0);
  const currentRel = useRef(initialPath);
  const paintGenRef = useRef(0);
  const paintDoneRef = useRef<(() => void) | null>(null);

  const syncTocFromContent = useCallback(() => {
    const content = contentRef.current;
    if (!content) {
      setTocItems([]);
      return;
    }
    const headings = Array.from(content.querySelectorAll("h1, h2, h3")) as HTMLElement[];
    setTocItems(ensureHeadingIds(headings));
  }, []);

  useLayoutEffect(() => {
    const gen = paintGenRef.current;
    const content = contentRef.current;
    const finish = () => {
      paintDoneRef.current?.();
      paintDoneRef.current = null;
    };

    if (!content || !html) {
      setTocItems([]);
      finish();
      return;
    }

    let cancelled = false;
    void (async () => {
      enhanceLinksAndCode(content);
      await replaceMermaidBlocksIn(content, gen, () => requestGen.current);
      if (!cancelled && gen === requestGen.current) syncTocFromContent();
      finish();
    })();

    return () => {
      cancelled = true;
    };
  }, [html, syncTocFromContent]);

  const failPathChange = useCallback((rel: string, msg: string) => {
    closeMermaidFullscreen();
    setHtml("");
    setError(msg);
    setCurrentPath(rel);
    currentRel.current = rel;
    setTocItems([]);
    window.scrollTo(0, 0);
    postPreview(previewReadyMessage(rel));
  }, []);

  const waitForPaint = useCallback((gen: number) => {
    return new Promise<void>((resolve) => {
      if (gen !== requestGen.current) {
        resolve();
        return;
      }
      paintDoneRef.current = resolve;
    });
  }, []);

  const prepareHtml = useCallback((source: string, gen: number) => {
    const parsed = marked.parse(preprocessMath(source)) as string;
    const clean = sanitizeHtml(parsed);
    if (gen !== requestGen.current) return false;
    closeMermaidFullscreen();
    paintGenRef.current = gen;
    setError(null);
    setHtml(clean);
    return true;
  }, []);

  const loadAndPaint = useCallback(
    async (rel: string, mode: LoadMode) => {
      const gen = ++requestGen.current;
      closeMermaidFullscreen();
      let source: string;
      try {
        const res = await fetch("/api/raw/" + encodePath(rel), { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        source = await res.text();
      } catch {
        if (gen !== requestGen.current) return;
        if (mode === "reload") {
          postPreview(previewErrorMessage(rel));
          return;
        }
        failPathChange(rel, "Failed to load markdown.");
        return;
      }
      if (gen !== requestGen.current) return;

      const scrollX = mode === "reload" ? window.scrollX : 0;
      const scrollY = mode === "reload" ? window.scrollY : 0;
      try {
        if (!prepareHtml(source, gen)) return;
        await waitForPaint(gen);
      } catch {
        if (gen !== requestGen.current) return;
        if (mode === "reload") {
          postPreview(previewErrorMessage(rel));
          return;
        }
        failPathChange(rel, "Failed to parse markdown.");
        return;
      }
      if (gen !== requestGen.current) return;
      setError(null);
      setCurrentPath(rel);
      currentRel.current = rel;
      if (mode === "reload") window.scrollTo(scrollX, scrollY);
      else window.scrollTo(0, 0);
      postPreview(previewReadyMessage(rel));
    },
    [failPathChange, prepareHtml, waitForPaint],
  );

  useEffect(() => {
    applyPreviewWidth(document.documentElement, readPreviewWidth(localStorage));
  }, []);

  useEffect(() => {
    void loadAndPaint(initialPath, "initial");
  }, [initialPath, loadAndPaint]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const width = parsePreviewWidthMessage(
        event.data,
        event.origin,
        window.location.origin,
      );
      if (width) {
        applyPreviewWidth(document.documentElement, width);
        return;
      }

      const parsed = parsePreviewMessage(
        event.data,
        event.origin,
        window.location.origin,
      );
      if (!parsed) return;
      if (parsed.type === "preview-navigate") {
        if (kindId(parsed.path) !== "markdown") return;
        void loadAndPaint(parsed.path, "navigate");
        return;
      }
      if (parsed.type === "preview-reload") {
        if (parsed.path !== currentRel.current) return;
        void loadAndPaint(parsed.path, "reload");
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [loadAndPaint]);

  return (
    <>
      <div className="md-layout flex items-start gap-6 mx-auto px-4">
        <main
          id="content"
          ref={contentRef}
          className="markdown-body flex-1 min-w-0"
          data-path={currentPath}
          dangerouslySetInnerHTML={{ __html: html }}
        />
        <Toc items={tocItems} contentVersion={html} />
      </div>
      {error ? (
        <p id="error" className="error mx-4">
          {error}
        </p>
      ) : null}
    </>
  );
}
