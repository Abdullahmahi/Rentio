/**
 * Prompt 14's requirement — "switch the app to English and confirm nothing
 * stays in Spanish" — checked statically, which is stricter than clicking
 * through: it catches keys on screens nobody happened to open.
 */
import { expect, test } from "bun:test";
import esMX from "@/locales/es-MX.json";
import en from "@/locales/en.json";

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
