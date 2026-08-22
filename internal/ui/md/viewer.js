(function () {
  const { preprocessMath, escapeHtml } = globalThis.MinoMDPreprocess;

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
      const res = await fetch("/api/raw/" + encodePath(rel));
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
      ADD_ATTR: ["class"],
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
        /* ignore */
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
  }

  render();
})();
