(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.MinoMDPreprocess = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const HTML_ESCAPE = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };

  const STASH_PLACEHOLDER = /\0P\d+\0/;

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

  function wrapMath(tag, cls) {
    return (match, tex) => {
      if (STASH_PLACEHOLDER.test(tex)) {
        return match;
      }
      return "<" + tag + ' class="' + cls + '">' + escapeTex(tex) + "</" + tag + ">";
    };
  }

  function replaceMath(text) {
    text = text.replace(/\$\$([\s\S]+?)\$\$/g, wrapMath("div", "math-display"));
    // Display \[...\] only when both delimiters sit on their own lines so
    // academic \[1\] is left as literal markdown, not a math wrapper.
    text = text.replace(
      /(^|\n)[ \t]*\\\[[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*\\\][ \t]*(?=\r?\n|$)/g,
      (match, lead, tex) => {
        if (STASH_PLACEHOLDER.test(tex)) {
          return match;
        }
        return lead + '<div class="math-display">' + escapeTex(tex) + "</div>";
      }
    );
    text = text.replace(/\$([^\s$](?:[^$\n]*[^\s$])?)\$/g, wrapMath("span", "math-inline"));
    text = text.replace(/\\\(([\s\S]+?)\\\)/g, wrapMath("span", "math-inline"));
    return text;
  }

  function preprocessMath(source) {
    const { text, stash } = protectSegments(source);
    return replaceMath(text).replace(/\0P(\d+)\0/g, (_, idx) => stash[Number(idx)]);
  }

  return { preprocessMath, escapeHtml, escapeTex };
});
