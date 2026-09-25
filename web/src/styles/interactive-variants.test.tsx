import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const indexCss = readFileSync(join(here, "index.css"), "utf8");

afterEach(() => cleanup());

describe("interactive variants CSS contract", () => {
  it("defines tokens and all four variants with disabled cursor rules", () => {
    expect(indexCss).toContain("--mino-focus: #0078d4");
    expect(indexCss).toContain("--mino-hover-bg: #2a2d2e");
    expect(indexCss).toContain("--mino-disabled-fg: #6e6e6e");
    for (const name of [
      "mino-icon-button",
      "mino-list-row",
      "mino-chrome-button",
      "mino-status-chip",
    ]) {
      expect(indexCss).toContain(`.${name}`);
    }
    expect(indexCss).toMatch(
      /\.mino-icon-button:disabled[\s\S]*?cursor:\s*not-allowed/,
    );
    expect(indexCss).toMatch(
      /\.mino-list-row:disabled[\s\S]*?cursor:\s*not-allowed/,
    );
    expect(indexCss).toContain(".mino-list-row.mino-selected");
    expect(indexCss).toContain(":focus-visible");
  });

  it("marks disabled icon buttons with the shared variant class", () => {
    const view = render(
      <button type="button" className="mino-icon-button" disabled aria-label="Expand all">
        Expand all
      </button>,
    );
    const btn = view.getByRole("button", { name: "Expand all" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.className).toContain("mino-icon-button");
  });
});
