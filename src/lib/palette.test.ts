import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { DEFAULT_PALETTE, PALETTES, PRE_PAINT_SCRIPT } from "@/lib/palette";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

test("every non-default palette has a light and a dark block in styles.css", () => {
  for (const { id } of PALETTES.filter((palette) => palette.id !== DEFAULT_PALETTE)) {
    expect(css).toContain(`:root[data-palette="${id}"] {`);
    expect(css).toContain(`:root.dark[data-palette="${id}"] {`);
  }
});

test("picker swatches match the CSS primary for each palette", () => {
  for (const palette of PALETTES) {
    expect(css).toContain(`--primary: oklch(from ${palette.primary} l c h);`);
  }
});

test("pre-paint script only accepts known palette ids", () => {
  expect(PRE_PAINT_SCRIPT).toContain('"mesa"');
  expect(PRE_PAINT_SCRIPT).not.toContain('"harbor"');
});
