(function () {
  const HTML_ESCAPE = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (ch) => HTML_ESCAPE[ch]);
  }

  // Keep TeX from being re-parsed as Markdown once it is wrapped in HTML.
  function escapeTex(tex) {
    return escapeHtml(tex).replace(/[_*`[\]\\~]/g, (ch) => "&#" + ch.charCodeAt(0) + ";");
  }

  function isFenceOpen(source, i) {
    if (i !== 0 && source[i - 1] !== "\n") {
      return 0;
    }
    let pos = i;
    let indent = 0;
    while (pos < source.length && indent < 4 && (source[pos] === " " || source[pos] === "\t")) {
      indent += source[pos] === "\t" ? 4 : 1;
      pos++;
    }
    if (indent >= 4) {
      return 0;
    }
    const ch = source[pos];
    if (ch !== "`" && ch !== "~") {
      return 0;
    }
    let len = 0;
    while (pos + len < source.length && source[pos + len] === ch) {
      len++;
    }
    return len >= 3 ? pos - i + len : 0;
  }

  function findFenceClose(source, from, fenceChar, fenceLen) {
    let i = from;
    while (i < source.length) {
      if (i !== from && source[i - 1] !== "\n") {
        i++;
        continue;
      }
      let pos = i;
      let indent = 0;
      while (pos < source.length && indent < 4 && (source[pos] === " " || source[pos] === "\t")) {
        indent += source[pos] === "\t" ? 4 : 1;
        pos++;
      }
      if (indent >= 4 || source[pos] !== fenceChar) {
        i++;
        continue;
      }
      let len = 0;
      while (pos + len < source.length && source[pos + len] === fenceChar) {
        len++;
      }
      if (len < fenceLen) {
        i++;
        continue;
      }
      let end = pos + len;
      while (end < source.length && source[end] !== "\n") {
        if (source[end] !== " " && source[end] !== "\t") {
          end = -1;
          break;
        }
        end++;
      }
      if (end === -1) {
        i++;
        continue;
      }
      return end < source.length ? end + 1 : end;
    }
    return source.length;
  }

  function protectSegments(source) {
    const stash = [];
    const protect = (chunk) => {
      const key = "\0P" + stash.length + "\0";
      stash.push(chunk);
      return key;
    };

    let out = "";
    let i = 0;
    const n = source.length;
    while (i < n) {
      const fenceSkip = isFenceOpen(source, i);
      if (fenceSkip) {
        let pos = i;
        while (source[pos] === " " || source[pos] === "\t") {
          pos++;
        }
        const fenceChar = source[pos];
        let fenceLen = 0;
        while (source[pos + fenceLen] === fenceChar) {
          fenceLen++;
        }
        let lineEnd = pos + fenceLen;
        while (lineEnd < n && source[lineEnd] !== "\n") {
          lineEnd++;
        }
        const closeAt = findFenceClose(source, lineEnd < n ? lineEnd + 1 : lineEnd, fenceChar, fenceLen);
        out += protect(source.slice(i, closeAt));
        i = closeAt;
        continue;
      }

      if (source[i] === "`") {
        let ticks = 0;
        while (i + ticks < n && source[i + ticks] === "`") {
          ticks++;
        }
        const closer = source.indexOf("`".repeat(ticks), i + ticks);
        if (closer !== -1) {
          out += protect(source.slice(i, closer + ticks));
          i = closer + ticks;
          continue;
        }
      }

      out += source[i];
      i++;
    }
    return { text: out, stash };
  }

  function replaceMath(text) {
    text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) =>
      '<div class="math-display">' + escapeTex(tex) + "</div>"
    );
    text = text.replace(/\\\[([\s\S]+?)\\\]/g, (_, tex) =>
      '<div class="math-display">' + escapeTex(tex) + "</div>"
    );
    text = text.replace(/\$([^\s$](?:[^$\n]*[^\s$])?)\$/g, (_, tex) =>
      '<span class="math-inline">' + escapeTex(tex) + "</span>"
    );
    text = text.replace(/\\\(([\s\S]+?)\\\)/g, (_, tex) =>
      '<span class="math-inline">' + escapeTex(tex) + "</span>"
    );
    return text;
  }

  function preprocessMath(source) {
    const { text, stash } = protectSegments(source);
    return replaceMath(text).replace(/\0P(\d+)\0/g, (_, idx) => stash[Number(idx)]);
  }

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
      mermaid.initialize({ startOnLoad: false, theme: "dark" });
      for (const block of mermaidBlocks) {
        const pre = block.parentElement;
        const div = document.createElement("div");
        div.className = "mermaid";
        div.textContent = block.textContent;
        pre.replaceWith(div);
      }
      try {
        await mermaid.run({ nodes: content.querySelectorAll(".mermaid") });
      } catch (_) {
        content.querySelectorAll(".mermaid").forEach((n) => {
          n.classList.add("render-error");
          n.textContent = "Diagram render failed";
        });
      }
    }
  }

  render();
})();
