(function () {
  const { preprocessMath, escapeHtml } = globalThis.MinoMDPreprocess;
  const { ensureHeadingIds } = globalThis.MinoMDToc;

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

  function setActiveTocLink(id) {
    document.querySelectorAll(".toc-link").forEach((a) => {
      a.classList.toggle("active", a.getAttribute("href") === "#" + id);
    });
  }

  function bindScrollSpy(content, items) {
    let ticking = false;
    const offset = 48;

    function update() {
      ticking = false;
      let current = items[0] && items[0].id;
      for (const item of items) {
        const el = document.getElementById(item.id);
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (top <= offset) current = item.id;
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
      { passive: true }
    );
    update();
  }

  function buildToc(content) {
    const toc = document.querySelector("#toc");
    const nav = document.querySelector("#toc-nav");
    const toggle = document.querySelector("#toc-toggle");
    if (!toc || !nav) return;

    const headings = content.querySelectorAll("h1, h2, h3");
    const items = ensureHeadingIds(headings);
    nav.replaceChildren();
    nav.setAttribute("aria-label", "On this page");

    if (!items.length) {
      toc.hidden = true;
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

    const narrow = window.matchMedia("(max-width: 959px)").matches;
    if (narrow && !toc.classList.contains("toc-user-toggled")) {
      toc.classList.add("toc-collapsed");
      if (toggle) {
        toggle.setAttribute("aria-expanded", "false");
        toggle.textContent = "Show";
      }
    }

    if (toggle && !toggle.dataset.bound) {
      toggle.dataset.bound = "1";
      toggle.addEventListener("click", () => {
        toc.classList.add("toc-user-toggled");
        const collapsed = toc.classList.toggle("toc-collapsed");
        toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
        toggle.textContent = collapsed ? "Show" : "Hide";
      });
    }

    bindScrollSpy(content, items);
  }

  async function render() {
    const content = document.querySelector("#content");
    const errorEl = document.querySelector("#error");
    const rel = content.getAttribute("data-path");

    function showError(msg) {
      errorEl.hidden = false;
      errorEl.textContent = msg;
    }

    function encodePath(p) {
      return p.split("/").map(encodeURIComponent).join("/");
    }

    let source;
    try {
      const res = await fetch("/api/raw/" + encodePath(rel), { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      source = await res.text();
    } catch (e) {
      showError("Failed to load markdown.");
      return;
    }

    let html;
    try {
      html = marked.parse(preprocessMath(source));
    } catch (e) {
      showError("Failed to parse markdown.");
      return;
    }

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
      for (const block of mermaidBlocks) {
        const pre = block.parentElement;
        const div = document.createElement("div");
        div.className = "mermaid";
        div.textContent = block.textContent;
        pre.replaceWith(div);
      }
      for (const node of content.querySelectorAll(".mermaid")) {
        try {
          await mermaid.run({ nodes: [node] });
        } catch (_) {
          node.classList.add("render-error");
          node.textContent = "Diagram render failed";
        }
      }
    }

    buildToc(content);
  }

  render();
})();
