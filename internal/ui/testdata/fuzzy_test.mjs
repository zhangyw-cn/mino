import { createRequire } from "node:module";
import assert from "node:assert/strict";
import test from "node:test";

const { score, filter } = createRequire(import.meta.url)("../fuzzy.js");

test("empty query returns no rows and does not score", () => {
  assert.deepEqual(filter("", ["tools/timer.html", "hello.html"]), []);
  assert.equal(score("", "hello.html"), null);
});

test("whitespace-only query returns no rows and does not score", () => {
  assert.deepEqual(filter("   ", ["tools/timer.html"]), []);
  assert.equal(score("  ", "hello.html"), null);
});

test("case-insensitive subsequence ttr matches tools/timer.html", () => {
  const hit = score("ttr", "tools/timer.html");
  assert.ok(hit);
  assert.deepEqual(hit.matches, [0, 6, 10]);
  const rows = filter("TTR", ["hello.html", "tools/timer.html"]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].path, "tools/timer.html");
});

test("basename matches rank above directory-only matches", () => {
  const rows = filter("tools", ["tools/other.html", "src/tools.html"]);
  assert.equal(rows[0].path, "src/tools.html");
  assert.equal(rows[1].path, "tools/other.html");
  assert.ok(rows[0].score > rows[1].score);
});

test("compact consecutive match outranks leftmost scatter on the same path", () => {
  const hit = score("ab", "a_foo_ab.html");
  assert.ok(hit);
  assert.deepEqual(hit.matches, [6, 7]);
});

test("multi-token query matches tools/timer.html", () => {
  const hit = score("tools timer", "tools/timer.html");
  assert.ok(hit);
  const rows = filter("tools timer", ["hello.html", "tools/timer.html"]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].path, "tools/timer.html");
});

test("a token that matches nothing excludes the path", () => {
  assert.equal(score("tools zzz", "tools/timer.html"), null);
  assert.deepEqual(filter("tools zzz", ["tools/timer.html"]), []);
});

test("recents boost reorders equal token scores", () => {
  const paths = ["hello.html", "world.html"];
  const plain = filter("html", paths);
  assert.equal(plain[0].path, "hello.html");
  const boosted = filter("html", paths, ["world.html"]);
  assert.equal(boosted[0].path, "world.html");
  assert.ok(boosted[0].score > boosted[1].score);
});

test("consecutive basename match outranks a recent scattered directory match", () => {
  const rows = filter("abc", ["a-b-c/other.html", "src/abc.html"], ["a-b-c/other.html"]);
  assert.equal(rows[0].path, "src/abc.html");
  assert.ok(rows[0].score > rows[1].score);
});

test("no subsequence match is excluded", () => {
  assert.equal(score("zzz", "hello.html"), null);
  assert.deepEqual(filter("zzz", ["hello.html", "tools/timer.html"]), []);
});

test("filter caps at 50 and breaks ties by path ascending", () => {
  const paths = [];
  for (let i = 0; i < 60; i++) {
    paths.push(`f${String(i).padStart(2, "0")}.html`);
  }
  const rows = filter("f", paths);
  assert.equal(rows.length, 50);
  assert.equal(rows[0].path, "f00.html");
  assert.equal(rows[49].path, "f49.html");
});
