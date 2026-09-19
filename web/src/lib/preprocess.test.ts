import { describe, expect, it } from "vitest";
import { preprocessMath } from "./preprocess";

function mathBodies(html: string): string[] {
  const out: string[] = [];
  const re =
    /<div class="math-display">([\s\S]*?)<\/div>|<span class="math-inline">([\s\S]*?)<\/span>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    out.push(m[1] ?? m[2]);
  }
  return out;
}

describe("preprocessMath", () => {
  it("fence-internal $ is not math", () => {
    const src = "```js\nconst x = $foo$\n```";
    const out = preprocessMath(src);
    expect(out).toBe(src);
    expect(out).not.toMatch(/math-inline|math-display/);
  });

  it("indented code $ is not math", () => {
    const src = "    const x = $foo$\n    return x;\n";
    const out = preprocessMath(src);
    expect(out).toBe(src);
    expect(out).not.toMatch(/math-inline|math-display/);
  });

  it("$ wrapping inline code with < does not emit raw < in math HTML", () => {
    const src = "$`a < b`$";
    const out = preprocessMath(src);
    for (const body of mathBodies(out)) {
      expect(body.includes("<")).toBe(false);
    }
    expect(out).not.toContain('<span class="math-inline">`a < b`</span>');
  });

  it("academic \\[1\\] is not display math", () => {
    const src = "See \\[1\\] for details.";
    const out = preprocessMath(src);
    expect(out).toBe(src);
    expect(out).not.toMatch(/math-display/);
  });

  it("standalone \\[ \\] display math still works", () => {
    const src = "Before\n\\[\nE = mc^2\n\\]\nAfter";
    const out = preprocessMath(src);
    expect(out).toMatch(/<div class="math-display">E = mc\^2<\/div>/);
    expect(out).toMatch(/^Before\n/);
    expect(out).toMatch(/\nAfter$/);
  });

  it("inline $a < b$ is escaped before marked", () => {
    const out = preprocessMath("$a < b$");
    expect(out).toMatch(/<span class="math-inline">a &lt; b<\/span>/);
    expect(out.includes("a < b")).toBe(false);
  });

  it("currency amounts are not math", () => {
    const src = "Costs $5 and $10 total.";
    const out = preprocessMath(src);
    expect(out).toBe(src);
    expect(out).not.toMatch(/math-inline|math-display/);
  });

  it("$$ display math still works", () => {
    const out = preprocessMath("$$x_1$$");
    expect(out).toMatch(/<div class="math-display">/);
    expect(out).toMatch(/x&#95;1/);
  });
});
