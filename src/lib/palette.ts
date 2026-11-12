/**
 * Colour palettes. Harbor is the default and lives in `:root` in styles.css;
 * the others are `[data-palette="…"]` overrides there. Swatches here are only
 * for the picker and must match the CSS primary/background values.
 *
 * Stored per browser, like the light/dark choice.
 * ponytail: per-browser preference; move to `settings` (org-wide) when the
 * landlord's choice should also reach tenants on their own phones.
 */
export const PALETTE_STORAGE_KEY = "rentio-palette";
export const THEME_STORAGE_KEY = "rentio-theme";

export const PALETTES = [
  { id: "harbor", primary: "#1f4e79", background: "#f6f8fa", tint: "#dff0ee" },
  { id: "mesa", primary: "#3d4a8a", background: "#f8f5f0", tint: "#e6eee3" },
  { id: "juniper", primary: "#2d6a5a", background: "#f6f8f5", tint: "#e5ecf6" },
  { id: "graphite", primary: "#18181b", background: "#fafafa", tint: "#e3f3ef" },
] as const;

export type PaletteId = (typeof PALETTES)[number]["id"];
export const DEFAULT_PALETTE: PaletteId = "harbor";

export function isPaletteId(value: unknown): value is PaletteId {
  return PALETTES.some((palette) => palette.id === value);
}

export function readPalette(): PaletteId {
  try {
    const stored = window.localStorage.getItem(PALETTE_STORAGE_KEY);
    return isPaletteId(stored) ? stored : DEFAULT_PALETTE;
  } catch {
    return DEFAULT_PALETTE;
  }
}

export function applyPalette(id: PaletteId) {
  const root = document.documentElement;
  if (id === DEFAULT_PALETTE) delete root.dataset["palette"];
  else root.dataset["palette"] = id;
  try {
    window.localStorage.setItem(PALETTE_STORAGE_KEY, id);
  } catch {
    // Private mode: the choice still applies for this visit.
  }
}

/**
 * Runs inline in <head> before first paint, so neither the dark theme nor a
 * palette flashes in after hydration. Kept tiny and dependency-free on purpose.
 */
export const PRE_PAINT_SCRIPT = `try{var d=document.documentElement;if(localStorage.getItem("${THEME_STORAGE_KEY}")==="dark")d.classList.add("dark");var p=localStorage.getItem("${PALETTE_STORAGE_KEY}");if(${JSON.stringify(
  PALETTES.map((palette) => palette.id).filter((id) => id !== DEFAULT_PALETTE),
)}.indexOf(p)>-1)d.dataset.palette=p}catch(e){}`;
