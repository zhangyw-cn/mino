export function slugify(text: unknown): string {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function uniqueId(base: string, used: Set<string>): string {
  const id = base || "heading";
  if (!used.has(id)) {
    used.add(id);
    return id;
  }
  let n = 2;
  for (;;) {
    const candidate = id + "-" + n;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
    n++;
  }
}

function headingLevel(el: { tagName?: string }): number {
  const m = /^H([1-6])$/i.exec(el.tagName || "");
  return m ? Number(m[1]) : 0;
}

export type TocItem = { id: string; level: number; text: string };

export type HeadingElement = {
  id: string;
  tagName: string;
  textContent: string | null;
};

export function ensureHeadingIds(
  headings: HeadingElement[],
  used?: Set<string>
): TocItem[] {
  const set = used || new Set<string>();
  const items: TocItem[] = [];
  for (const el of headings) {
    const text = String(el.textContent || "").trim();
    const existing = String(el.id || "").trim();
    const id = uniqueId(existing || slugify(text), set);
    if (el.id !== id) {
      el.id = id;
    }
    const level = headingLevel(el);
    if (level >= 1 && level <= 3) {
      items.push({ id, level, text });
    }
  }
  return items;
}
