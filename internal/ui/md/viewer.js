(function () {
  const { preprocessMath, escapeHtml } = globalThis.MinoMDPreprocess;
  const { ensureHeadingIds } = globalThis.MinoMDToc;
  const { createMermaidBlock } = globalThis.MinoMDMermaidBlock;
  const {
    readPreviewWidth,
    applyPreviewWidth,
    parsePreviewWidthMessage,
  } = globalThis.MinoMDPreviewWidth;
  const session = globalThis.MinoPreviewSession;

  // data-md-width is applied here so first paint and postMessage stay in sync.
  applyPreviewWidth(document.documentElement, readPreviewWidth(localStorage));

  window.addEventListener("message", (event) => {
    const mode = parsePreviewWidthMessage(
      event.data,
      event.origin,
      window.location.origin
    );
    if (!mode) return;
    applyPreviewWidth(document.documentElement, mode);
  });

  function languageName(lang) {
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

  const TOC_LABEL = "On this page";
  const TOC_NARROW_MQ = "(max-width: 959px)";
  const SCROLL_SPY_OFFSET = 48;

  let tocScrollAbort = null;
  let tocNarrowMq = null;

  function setActiveTocLink(id) {
    document.querySelectorAll(".toc-link").forEach((a) => {
      a.classList.toggle("active", a.getAttribute("href") === "#" + id);
    });
  }

  function setTocCollapsed(toc, toggle, collapsed) {
    toc.classList.toggle("toc-collapsed", collapsed);
    if (!toggle) return;
    toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    toggle.textContent = collapsed ? "Show" : "Hide";
  }

  function syncTocNarrowDefault(toc, toggle) {
    if (!toc || toc.hidden || toc.classList.contains("toc-user-toggled")) return;
    const narrow = window.matchMedia(TOC_NARROW_MQ).matches;
    setTocCollapsed(toc, toggle, narrow);
  }

  function bindScrollSpy(items) {
    if (tocScrollAbort) tocScrollAbort.abort();
    tocScrollAbort = new AbortController();

    let ticking = false;
    function update() {
      ticking = false;
      let current = items[0] && items[0].id;
      for (const item of items) {
        const el = document.getElementById(item.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= SCROLL_SPY_OFFSET) current = item.id;
      }
      if (current) setActiveTocLink(current);
    }

    window.addEventListener(
      "scroll",
      () => {
        if (!ticking) {
          ticking = true;
          requestAnimationFrame(update);
        }
      },
      { passive: true, signal: tocScrollAbort.signal }
    );
    update();
  }

  function bindTocChrome(toc, toggle) {
    if (toggle && !toggle.dataset.bound) {
      toggle.dataset.bound = "1";
      toggle.addEventListener("click", () => {
        toc.classList.add("toc-user-toggled");
        setTocCollapsed(toc, toggle, !toc.classList.contains("toc-collapsed"));
      });
    }

    if (!tocNarrowMq) {
      tocNarrowMq = window.matchMedia(TOC_NARROW_MQ);
      const onNarrowChange = () => {
        const el = document.querySelector("#toc");
        const btn = document.querySelector("#toc-toggle");
        syncTocNarrowDefault(el, btn);
      };
      if (typeof tocNarrowMq.addEventListener === "function") {
        tocNarrowMq.addEventListener("change", onNarrowChange);
      } else if (typeof tocNarrowMq.addListener === "function") {
        tocNarrowMq.addListener(onNarrowChange);
      }
    }
  }

  function buildToc(content) {
    const toc = document.querySelector("#toc");
    const nav = document.querySelector("#toc-nav");
    const toggle = document.querySelector("#toc-toggle");
    if (!toc || !nav) return;

    const headings = content.querySelectorAll("h1, h2, h3");
    const items = ensureHeadingIds(headings);
    nav.replaceChildren();
    nav.setAttribute("aria-label", TOC_LABEL);

    if (!items.length) {
      toc.hidden = true;
      if (tocScrollAbort) {
        tocScrollAbort.abort();
        tocScrollAbort = null;
      }
      return;
    }

    toc.hidden = false;
    for (const item of items) {
      const a = document.createElement("a");
      a.href = "#" + item.id;
      a.className = "toc-link toc-level-" + item.level;
      a.textContent = item.text || item.id;
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        const target = document.getElementById(item.id);
        if (!target) return;
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        history.replaceState(null, "", "#" + item.id);
        setActiveTocLink(item.id);
      });
      nav.appendChild(a);
    }

    bindTocChrome(toc, toggle);
    syncTocNarrowDefault(toc, toggle);
    bindScrollSpy(items);
  }

  const content = document.querySelector("#content");
  const errorEl = document.querySelector("#error");
  let requestGen = 0;
  let currentRel = content.getAttribute("data-path") || "";

  function showError(msg) {
    errorEl.hidden = false;
    errorEl.textContent = msg;
  }

  function hideError() {
    errorEl.hidden = true;
    errorEl.textContent = "";
  }

  function encodePath(p) {
    return p.split("/").map(encodeURIComponent).join("/");
  }

  function postPreview(message) {
    if (!session || !message) return;
    try {
      parent.postMessage(message, window.location.origin);
    } catch (_err) {}
  }

  function isMarkdownPath(path) {
    return session ? session.kindId(path) === "markdown" : /\.md$/i.test(path);
  }

  async function paintMarkdown(source) {
    const html = marked.parse(preprocessMath(source));
    const clean = DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
      ADD_ATTR: ["class", "id"],
      FORBID_TAGS: ["script", "iframe", "object", "embed", "form"],
    });
    content.innerHTML = clean;

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
        hljs.highlightElement(block);
      } catch (_) {
        block.classList.add("render-error");
        block.textContent = "Highlight failed";
      }
    });

    content.querySelectorAll(".math-inline, .math-display").forEach((el) => {
      try {
        katex.render(el.textContent, el, {
          throwOnError: false,
          displayMode: el.classList.contains("math-display"),
        });
      } catch (_) {
        el.classList.add("render-error");
        el.textContent = "Math render failed";
      }
    });

    const mermaidBlocks = content.querySelectorAll("pre code.language-mermaid");
    if (mermaidBlocks.length) {
      mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
      const instances = [];
      for (const block of mermaidBlocks) {
        const pre = block.parentElement;
        const inst = createMermaidBlock(block.textContent, escapeHtml);
        pre.replaceWith(inst.root);
        instances.push(inst);
      }
      for (const inst of instances) {
        try {
          await mermaid.run({ nodes: [inst.diagramEl] });
          inst.cacheBaseSize();
        } catch (_) {
          inst.setRenderFailed();
        }
      }
    }

    buildToc(content);
  }

  async function loadAndPaint(rel, mode) {
    const gen = ++requestGen;
    let source;
    try {
      const res = await fetch("/api/raw/" + encodePath(rel), { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      source = await res.text();
    } catch (_e) {
      if (gen !== requestGen) return;
      if (mode === "reload") {
        postPreview(session && session.previewErrorMessage(rel));
        return;
      }
      content.innerHTML = "";
      content.setAttribute("data-path", rel);
      currentRel = rel;
      showError("Failed to load markdown.");
      postPreview(session && session.previewReadyMessage(rel));
      return;
    }

    const scrollX = mode === "reload" ? window.scrollX : 0;
    const scrollY = mode === "reload" ? window.scrollY : 0;
    try {
      await paintMarkdown(source);
    } catch (_e) {
      if (gen !== requestGen) return;
      if (mode === "reload") {
        postPreview(session && session.previewErrorMessage(rel));
        return;
      }
      content.innerHTML = "";
      content.setAttribute("data-path", rel);
      currentRel = rel;
      showError("Failed to parse markdown.");
      postPreview(session && session.previewReadyMessage(rel));
      return;
    }
    if (gen !== requestGen) return;
    hideError();
    content.setAttribute("data-path", rel);
    currentRel = rel;
    if (mode === "reload") window.scrollTo(scrollX, scrollY);
    else window.scrollTo(0, 0);
    postPreview(session && session.previewReadyMessage(rel));
  }

  window.addEventListener("message", (event) => {
    if (!session) return;
    const parsed = session.parsePreviewMessage(
      event.data,
      event.origin,
      window.location.origin
    );
    if (!parsed) return;
    if (parsed.type === "preview-navigate") {
      if (!isMarkdownPath(parsed.path)) return;
      loadAndPaint(parsed.path, "navigate");
      return;
    }
    if (parsed.type === "preview-reload") {
      if (parsed.path !== currentRel) return;
      loadAndPaint(parsed.path, "reload");
    }
  });

  loadAndPaint(currentRel, "initial");
})();
