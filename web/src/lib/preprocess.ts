const HTML_ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const STASH_PLACEHOLDER = /\0P\d+\0/;

export function escapeHtml(text: unknown): string {
  return String(text).replace(/[&<>"']/g, (ch) => HTML_ESCAPE[ch]);
}

// Keep TeX from being re-parsed as Markdown once it is wrapped in HTML.
export function escapeTex(tex: string): string {
  return escapeHtml(tex).replace(/[_*`[\]\\~]/g, (ch) => "&#" + ch.charCodeAt(0) + ";");
}

function isFenceOpen(source: string, i: number): number {
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

function findFenceClose(source: string, from: number, fenceChar: string, fenceLen: number): number {
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

function lineIndent(source: string, from: number): number {
  let pos = from;
  let indent = 0;
  while (pos < source.length && indent < 4 && (source[pos] === " " || source[pos] === "\t")) {
    indent += source[pos] === "\t" ? 4 : 1;
    pos++;
  }
  return indent;
}

// GFM indented code blocks (4+ leading spaces on a line).
function indentCodeExtent(source: string, i: number): number {
  if (i !== 0 && source[i - 1] !== "\n") {
    return 0;
  }
  if (lineIndent(source, i) < 4) {
    return 0;
  }
  let end = i;
  while (end < source.length) {
    if (end > i && source[end - 1] !== "\n") {
      break;
    }
    const lineEnd = source.indexOf("\n", end);
    const next = lineEnd === -1 ? source.length : lineEnd;
    const line = source.slice(end, next);
    if (line.trim() === "") {
      end = next === source.length ? next : next + 1;
      continue;
    }
    if (lineIndent(source, end) < 4) {
      break;
    }
    end = next === source.length ? next : next + 1;
  }
  return end - i;
}

function protectSegments(source: string): { text: string; stash: string[] } {
  const stash: string[] = [];
  const protect = (chunk: string) => {
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

    const indentSkip = indentCodeExtent(source, i);
    if (indentSkip) {
      out += protect(source.slice(i, i + indentSkip));
      i += indentSkip;
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

function wrapMath(tag: string, cls: string) {
  return (match: string, tex: string) => {
    if (STASH_PLACEHOLDER.test(tex)) {
      return match;
    }
    return "<" + tag + ' class="' + cls + '">' + escapeTex(tex) + "</" + tag + ">";
  };
}

function replaceMath(text: string): string {
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

export function preprocessMath(source: string): string {
  const { text, stash } = protectSegments(source);
  return replaceMath(text).replace(/\0P(\d+)\0/g, (_, idx) => stash[Number(idx)]);
}
