import { describe, expect, it } from "vitest";
import { score, filter } from "./fuzzy";

describe("fuzzy", () => {
  it("empty query returns no rows and does not score", () => {
    expect(filter("", ["tools/timer.html", "hello.html"])).toEqual([]);
    expect(score("", "hello.html")).toBe(null);
  });

  it("whitespace-only query returns no rows and does not score", () => {
    expect(filter("   ", ["tools/timer.html"])).toEqual([]);
    expect(score("  ", "hello.html")).toBe(null);
  });

  it("case-insensitive subsequence ttr matches tools/timer.html", () => {
    const hit = score("ttr", "tools/timer.html");
    expect(hit).toBeTruthy();
    expect(hit!.matches).toEqual([0, 6, 10]);
    const rows = filter("TTR", ["hello.html", "tools/timer.html"]);
    expect(rows.length).toBe(1);
    expect(rows[0].path).toBe("tools/timer.html");
  });

  it("basename matches rank above directory-only matches", () => {
    const rows = filter("tools", ["tools/other.html", "src/tools.html"]);
    expect(rows[0].path).toBe("src/tools.html");
    expect(rows[1].path).toBe("tools/other.html");
    expect(rows[0].score).toBeGreaterThan(rows[1].score);
  });

  it("compact consecutive match outranks leftmost scatter on the same path", () => {
    const hit = score("ab", "a_foo_ab.html");
    expect(hit).toBeTruthy();
    expect(hit!.matches).toEqual([6, 7]);
  });

  it("multi-token query matches tools/timer.html", () => {
    const hit = score("tools timer", "tools/timer.html");
    expect(hit).toBeTruthy();
    const rows = filter("tools timer", ["hello.html", "tools/timer.html"]);
    expect(rows.length).toBe(1);
    expect(rows[0].path).toBe("tools/timer.html");
  });

  it("a token that matches nothing excludes the path", () => {
    expect(score("tools zzz", "tools/timer.html")).toBe(null);
    expect(filter("tools zzz", ["tools/timer.html"])).toEqual([]);
  });

  it("recents boost reorders equal token scores", () => {
    const paths = ["hello.html", "world.html"];
    const plain = filter("html", paths);
    expect(plain[0].path).toBe("hello.html");
    const boosted = filter("html", paths, ["world.html"]);
    expect(boosted[0].path).toBe("world.html");
    expect(boosted[0].score).toBeGreaterThan(boosted[1].score);
  });

  it("consecutive basename match outranks a recent scattered directory match", () => {
    const rows = filter("abc", ["a-b-c/other.html", "src/abc.html"], [
      "a-b-c/other.html",
    ]);
    expect(rows[0].path).toBe("src/abc.html");
    expect(rows[0].score).toBeGreaterThan(rows[1].score);
  });

  it("no subsequence match is excluded", () => {
    expect(score("zzz", "hello.html")).toBe(null);
    expect(filter("zzz", ["hello.html", "tools/timer.html"])).toEqual([]);
  });

  it("filter caps at 50 and breaks ties by path ascending", () => {
    const paths = [];
    for (let i = 0; i < 60; i++) {
      paths.push(`f${String(i).padStart(2, "0")}.html`);
    }
    const rows = filter("f", paths);
    expect(rows.length).toBe(50);
    expect(rows[0].path).toBe("f00.html");
    expect(rows[49].path).toBe("f49.html");
  });
});
