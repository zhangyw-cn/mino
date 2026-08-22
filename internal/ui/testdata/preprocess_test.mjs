import { createRequire } from "node:module";
import assert from "node:assert/strict";
import test from "node:test";

const { preprocessMath } = createRequire(import.meta.url)("../md/preprocess.js");

function mathBodies(html) {
  const out = [];
  const re = /<div class="math-display">([\s\S]*?)<\/div>|<span class="math-inline">([\s\S]*?)<\/span>/g;
  let m;
  while ((m = re.exec(html))) {
    out.push(m[1] ?? m[2]);
  }
  return out;
}

test("fence-internal $ is not math", () => {
  const src = "```js\nconst x = $foo$\n```";
  const out = preprocessMath(src);
  assert.equal(out, src);
  assert.doesNotMatch(out, /math-inline|math-display/);
});

test("indented code $ is not math", () => {
  const src = "    const x = $foo$\n    return x;\n";
  const out = preprocessMath(src);
  assert.equal(out, src);
  assert.doesNotMatch(out, /math-inline|math-display/);
});

test("$ wrapping inline code with < does not emit raw < in math HTML", () => {
  const src = "$`a < b`$";
  const out = preprocessMath(src);
  for (const body of mathBodies(out)) {
    assert.ok(!body.includes("<"), `raw < inside math wrapper: ${JSON.stringify(body)}`);
  }
  assert.ok(!out.includes('<span class="math-inline">`a < b`</span>'));
});

test("academic \\[1\\] is not display math", () => {
  const src = "See \\[1\\] for details.";
  const out = preprocessMath(src);
  assert.equal(out, src);
  assert.doesNotMatch(out, /math-display/);
});

test("standalone \\[ \\] display math still works", () => {
  const src = "Before\n\\[\nE = mc^2\n\\]\nAfter";
  const out = preprocessMath(src);
  assert.match(out, /<div class="math-display">E = mc\^2<\/div>/);
  assert.match(out, /^Before\n/);
  assert.match(out, /\nAfter$/);
});

test("inline $a < b$ is escaped before marked", () => {
  const out = preprocessMath("$a < b$");
  assert.match(out, /<span class="math-inline">a &lt; b<\/span>/);
  assert.ok(!out.includes("a < b"));
});

test("currency amounts are not math", () => {
  const src = "Costs $5 and $10 total.";
  const out = preprocessMath(src);
  assert.equal(out, src);
  assert.doesNotMatch(out, /math-inline|math-display/);
});

test("$$ display math still works", () => {
  const out = preprocessMath("$$x_1$$");
  assert.match(out, /<div class="math-display">/);
  assert.match(out, /x&#95;1/);
});
