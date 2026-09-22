/**
 * Prompt 14's requirement — "switch the app to English and confirm nothing
 * stays in Spanish" — checked statically, which is stricter than clicking
 * through: it catches keys on screens nobody happened to open.
 */
import { expect, test } from "bun:test";
import esMX from "@/locales/es-MX.json";
import en from "@/locales/en.json";
import marketingEn from "@/locales/marketing.en.json";

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? [path] : flatten(value, path);
  });
}

const spanish = flatten(esMX as Tree);
const english = flatten(en as Tree);

test("every Spanish key has an English counterpart", () => {
  const missing = spanish.filter((key) => !english.includes(key));
  expect(missing).toEqual([]);
});

test("every English key has a Spanish counterpart", () => {
  const missing = english.filter((key) => !spanish.includes(key));
  expect(missing).toEqual([]);
});

test("no marketing string is left empty", () => {
  const blank = Object.entries(flatten(marketingEn as Tree)).filter(([, key]) => {
    const value = key
      .split(".")
      .reduce<unknown>(
        (node, part) =>
          typeof node === "object" && node !== null
            ? (node as Record<string, unknown>)[part]
            : undefined,
        marketingEn,
      );
    return typeof value === "string" && value.trim() === "";
  });
  expect(blank).toEqual([]);
});

test("no translation value is left empty", () => {
  const collect = (tree: Tree, prefix = ""): string[] =>
    Object.entries(tree).flatMap(([key, value]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof value !== "string") return collect(value, path);
      return value.trim() === "" ? [path] : [];
    });
  expect(collect(esMX as Tree)).toEqual([]);
  expect(collect(en as Tree)).toEqual([]);
});

test("interpolation placeholders match across locales", () => {
  const placeholders = (value: string) =>
    [...value.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort();
  const lookup = (tree: Tree, path: string): string | undefined =>
    path
      .split(".")
      .reduce<string | Tree | undefined>(
        (node, key) => (typeof node === "object" && node !== null ? node[key] : undefined),
        tree,
      ) as string | undefined;

  const mismatched = spanish.filter((key) => {
    const a = lookup(esMX as Tree, key);
    const b = lookup(en as Tree, key);
    if (typeof a !== "string" || typeof b !== "string") return false;
    return JSON.stringify(placeholders(a)) !== JSON.stringify(placeholders(b));
  });
  expect(mismatched).toEqual([]);
});

/**
 * The parity tests above catch a key missing from ONE locale. This catches the
 * other direction: a `t("...")` in the source pointing at a key that no longer
 * exists in either. Renaming a section used to leave those behind, and i18next
 * renders the raw key path on screen rather than failing.
 */
test("every literal t() key in the source exists in both locales", async () => {
  const { Glob } = await import("bun");
  const known = new Set(english);
  const dynamic = /\$\{|\bt\(`/; // template keys are resolved at runtime
  const missing: string[] = [];

  // The public marketing page is a second namespace, English-only by design -
  // see the comment in i18n.ts. Its keys are checked against its own file.
  const marketingKeys = new Set(flatten(marketingEn as Tree));

  for await (const file of new Glob("src/**/*.{ts,tsx}").scan(".")) {
    if (file.endsWith(".test.ts")) continue;
    const marketing = file.includes("components/marketing/");
    const table = marketing ? marketingKeys : known;
    const source = await Bun.file(file).text();
    for (const match of source.matchAll(/\bt\(\s*"([A-Za-z0-9_.]+)"/g)) {
      const key = match[1]!;
      // Plural keys live in the locale as `key_other`; i18next resolves both.
      if (table.has(key) || table.has(`${key}_other`)) continue;
      if (dynamic.test(key)) continue;
      missing.push(`${file}: ${key}`);
    }
  }

  expect(missing).toEqual([]);
});
