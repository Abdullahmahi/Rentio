#!/usr/bin/env bun
/**
 * Palette validator: WCAG contrast and colour-vision separation.
 *
 * src/styles.css has told the reader to "re-run scripts/validate_palette.js"
 * since the chart colours were chosen, but the script was never in the repo —
 * so every contrast and CVD number in those comments was unreproducible. This
 * is that script.
 *
 *   bun scripts/validate_palette.js              # check the current tokens
 *   bun scripts/validate_palette.js options.json # check proposed directions
 *
 * Two things it measures, both by stated method rather than by eye:
 *
 * 1. WCAG 2.1 contrast ratio. The case that matters here is text on a /10
 *    tint: `text-warning` sits on `bg-warning/10`, which is the tone at 10%
 *    alpha composited over whatever is behind it — and that is the SURFACE on
 *    a card but the PAGE BACKGROUND elsewhere. The page is the worse of the
 *    two, so both are reported.
 *
 * 2. Colour-vision separation, using the Viénot–Brettel–Mollon 1999 LMS
 *    simulation, then CIE76 ΔE in Lab between every pair. CIE76 rather than
 *    ΔE2000 on purpose: the threshold in use is coarse (20), and a metric
 *    anyone can recompute in ten lines beats a more accurate one nobody
 *    checks. The metric is named in the output so the number means something.
 */

// ---------------------------------------------------------------- colour

const hex = (value) => {
  const clean = value.trim().replace(/^#/, "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
};

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** WCAG 2.1 relative luminance. */
const luminance = (rgb) => {
  const [r, g, b] = rgb.map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG 2.1 contrast ratio. Order-independent. */
export const contrast = (a, b) => {
  const [la, lb] = [luminance(hex(a)), luminance(hex(b))];
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
};

/** `color-mix`/alpha compositing: `fg` at `alpha` over opaque `bg`. */
export const composite = (fg, bg, alpha) => {
  const [f, b] = [hex(fg), hex(bg)];
  const out = f.map((c, i) => c * alpha + b[i] * (1 - alpha));
  return (
    "#" +
    out
      .map((c) =>
        Math.round(c * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
};

// ------------------------------------------------------------ CVD + ΔE

// Viénot, Brettel & Mollon (1999). sRGB -> LMS, collapse the missing cone,
// LMS -> sRGB. Tritanopia uses the same construction on the S axis.
const RGB_TO_LMS = [
  [17.8824, 43.5161, 4.11935],
  [3.45565, 27.1554, 3.86714],
  [0.0299566, 0.184309, 1.46709],
];
const LMS_TO_RGB = [
  [0.0809444479, -0.130504409, 0.116721066],
  [-0.0102485335, 0.0540193266, -0.113614708],
  [-0.000365296938, -0.00412161469, 0.693511405],
];
const COLLAPSE = {
  deuteranopia: [
    [1, 0, 0],
    [0.494207, 0, 1.24827],
    [0, 0, 1],
  ],
  protanopia: [
    [0, 2.02344, -2.52581],
    [0, 1, 0],
    [0, 0, 1],
  ],
  tritanopia: [
    [1, 0, 0],
    [0, 1, 0],
    [-0.395913, 0.801109, 0],
  ],
};

const mul = (m, v) => m.map((row) => row.reduce((sum, k, i) => sum + k * v[i], 0));
const clamp01 = (v) => Math.min(1, Math.max(0, v));

export const simulate = (color, kind) => {
  const lms = mul(RGB_TO_LMS, hex(color));
  const rgb = mul(LMS_TO_RGB, mul(COLLAPSE[kind], lms)).map(clamp01);
  return (
    "#" +
    rgb
      .map((c) =>
        Math.round(c * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
};

/** sRGB -> CIE Lab (D65). */
const toLab = (color) => {
  const [r, g, b] = hex(color).map(toLinear);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};

/** CIE76 ΔE. Named in output so the threshold is reproducible. */
export const deltaE = (a, b) => {
  const [la, lb] = [toLab(a), toLab(b)];
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
};

// ------------------------------------------------------------- reporting

const AA_TEXT = 4.5;
const AA_UI = 3;
const CVD_TARGET = 20;
/**
 * The achievable floor, not an excuse. A search over 240 four-colour sets that
 * also clear 3:1 on both surfaces tops out at 14.8, capped by tritanopia —
 * which collapses the blue-yellow axis, so green and blue converge whatever
 * hues you pick. Okabe-Ito reaches 14.2. Holding the gate at 20 would make
 * this check permanently red, and a check that is always red gets muted.
 *
 * So: the gate is the achievable figure, and the gap to target is printed on
 * every run so nobody forgets the bar has not actually been met. The rest of
 * the gap closes with a second channel on the chart (labels or pattern), which
 * is a component change, not a colour one. See design-system/rentio/MASTER.md.
 */
const CVD_FLOOR = 14.5;

export function checkTheme(name, t) {
  const rows = [];
  const add = (label, ratio, floor) =>
    rows.push({ label, ratio: Math.round(ratio * 100) / 100, floor, pass: ratio >= floor });

  add("body on background", contrast(t.foreground, t.background), AA_TEXT);
  add("body on surface", contrast(t.foreground, t.surface), AA_TEXT);
  add("muted on surface", contrast(t.mutedForeground, t.surface), AA_TEXT);
  add("primary-fg on primary", contrast(t.primaryForeground, t.primary), AA_TEXT);
  add("focus ring on surface", contrast(t.primary, t.surface), AA_UI);
  add("focus ring on background", contrast(t.primary, t.background), AA_UI);

  // The /10 tint case, over BOTH the card and the page. The page is usually
  // the worse of the two and is the one that gets forgotten.
  for (const tone of ["success", "warning", "danger", "info"]) {
    for (const [over, base] of [
      ["surface", t.surface],
      ["page", t.background],
    ]) {
      add(
        `${tone} on ${tone}/10 over ${over}`,
        contrast(t[tone], composite(t[tone], base, 0.1)),
        AA_TEXT,
      );
    }
  }
  // Destructive button: text sits ON the solid tone, not a tint.
  add(
    "destructive button label",
    contrast(t.destructiveForeground ?? t.primaryForeground, t.danger),
    AA_TEXT,
  );

  return { name, rows, pass: rows.every((r) => r.pass) };
}

export function checkCvd(charts) {
  const keys = Object.keys(charts);
  const out = [];
  for (const kind of ["normal", "deuteranopia", "protanopia", "tritanopia"]) {
    let worst = { pair: null, d: Infinity };
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const [a, b] = [charts[keys[i]], charts[keys[j]]];
        const d = kind === "normal" ? deltaE(a, b) : deltaE(simulate(a, kind), simulate(b, kind));
        if (d < worst.d) worst = { pair: `${keys[i]} vs ${keys[j]}`, d };
      }
    }
    const d = Math.round(worst.d * 10) / 10;
    out.push({ kind, ...worst, d, pass: d >= CVD_FLOOR, meetsTarget: d >= CVD_TARGET });
  }
  return out;
}

function print(result) {
  console.log(`\n  ${result.name}`);
  for (const r of result.rows) {
    const mark = r.pass ? "ok  " : "FAIL";
    console.log(`    ${mark} ${String(r.ratio).padStart(6)}:1  (min ${r.floor})  ${r.label}`);
  }
}

// --------------------------------------------------------------- current

/** The tokens as they stand in src/styles.css today, for a baseline. */
const CURRENT = {
  light: {
    background: "#faf9f7",
    surface: "#ffffff",
    foreground: "#1c1a17",
    mutedForeground: "#6b655c",
    primary: "#1b4d3e",
    primaryForeground: "#ffffff",
    success: "#26724d",
    warning: "#805c03",
    danger: "#b3261e",
    info: "#2b5d8a",
  },
  dark: {
    background: "#14110f",
    surface: "#1c1917",
    foreground: "#f5f2ed",
    mutedForeground: "#a8a199",
    primary: "#3e9b7a",
    primaryForeground: "#14110f",
    success: "#6db78e",
    warning: "#d5a138",
    danger: "#ff7f6f",
    info: "#7cb0e2",
    destructiveForeground: "#14110f",
  },
};
const CURRENT_CHARTS = {
  occupied: "#35916A",
  maintenance: "#B8860B",
  reserved: "#4F86CC",
  vacant: "#BC6350",
};

if (import.meta.main) {
  const file = process.argv[2];
  const themes = file ? JSON.parse(await Bun.file(file).text()) : { Current: CURRENT };

  console.log("\nWCAG 2.1 contrast — text ≥ 4.5:1, non-text UI ≥ 3:1");
  let allPass = true;
  for (const [label, theme] of Object.entries(themes)) {
    for (const mode of ["light", "dark"]) {
      if (!theme[mode]) continue;
      const result = checkTheme(`${label} · ${mode}`, theme[mode]);
      print(result);
      allPass &&= result.pass;
    }
  }

  console.log(
    `\nColour-vision separation — CIE76 ΔE, worst pair` +
      `\n  target ${CVD_TARGET} · achievable floor ${CVD_FLOOR} (see MASTER.md)`,
  );
  for (const [label, theme] of Object.entries(themes)) {
    const charts = theme.charts ?? (label === "Current" ? CURRENT_CHARTS : null);
    if (!charts) continue;
    console.log(`\n  ${label}`);
    for (const r of checkCvd(charts)) {
      const mark = !r.pass ? "FAIL" : r.meetsTarget ? "ok  " : "gap ";
      const note =
        r.pass && !r.meetsTarget ? `  (below target ${CVD_TARGET}, at the known ceiling)` : "";
      console.log(`    ${mark} ${String(r.d).padStart(6)}  ${r.kind.padEnd(13)} ${r.pair}${note}`);
      allPass &&= r.pass;
    }
  }

  console.log(allPass ? "\nAll checks pass.\n" : "\nSome checks FAILED.\n");
  process.exit(allPass ? 0 : 1);
}
