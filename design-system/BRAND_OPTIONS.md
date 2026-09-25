# Brand directions — Rentio

Three directions for the visual rebrand. **Nothing has been applied.** Pick one,
or name the parts you want combined, and prompt 44 applies it.

Every contrast number below is **measured**, not estimated, by
`scripts/validate_palette.js` against the exact hex values in
`design-system/brand-options.json`. Reproduce any of them with:

```sh
bun scripts/validate_palette.js design-system/brand-options.json
```

Preview all three on real components at `/brand-preview` (dev only).

---

## Two findings that affect the choice

### 1. The design skill could not drive this

REBRAND.md warned that UI UX Pro Max defaults to generic SaaS. For this product
it was worse than that, and it is worth knowing before you weigh the options:

| Query | What it returned | Usable? |
|---|---|---|
| `--design-system` | Style "Exaggerated Minimalism" — *for fashion, architecture, luxury brands*; effects `font-size: clamp(3rem 10vw 12rem)`, `font-weight: 900` | No. That is display typography for a landing page, not a ledger. |
| `--domain typography` | **Noto Sans Hebrew**, then Noto Naskh Arabic | No. It reads "bilingual" as *RTL script support*, not Spanish/English. |
| `--domain ux` | "design mobile-first", "set viewport meta", "tables overflow on mobile" | Already done months ago. |
| `--domain chart` | Scatter plots and heatmaps | Wrong chart families for status categories. |
| `--domain color` | **Banking/Traditional Finance** — trust navy + premium gold, with a documented WCAG adjustment; and a warm terracotta/green pairing | **Yes.** These are the anchors for directions B and C. |

So: the colour anchors for B and C came from the skill. The typography, the
neutral ramps, the dark-theme values and every contrast number did not — they
are mine, measured. Saying otherwise would misattribute the work.

### 2. The chart palette already fails colour-vision separation

`styles.css` claims the chart colours were "validated with the dataviz skill's
six checks", and points at `scripts/validate_palette.js` — **a file that was not
in the repo**. The claim was unreproducible. It is now, and the current palette
does not pass the bar REBRAND.md sets (ΔE ≥ 20 under every simulation):

| Simulation | Worst pair | ΔE | |
|---|---|---|---|
| normal | maintenance vs vacant | 43.8 | ok |
| deuteranopia (~6% of men) | occupied vs vacant | 21.0 | ok |
| protanopia (~1% of men) | occupied vs vacant | **10.3** | fails |
| tritanopia (~0.01%) | occupied vs reserved | **5.0** | fails |

I then searched 240 four-colour sets that also clear 3:1 on both themes. **The
best possible is ΔE 14.8**, capped by tritanopia. Even Okabe-Ito — the canonical
colour-blind-safe palette — reaches only 14.2.

**ΔE ≥ 20 under every simulation is not achievable with four hue-coded fills.**
Tritanopia collapses the blue–yellow axis, so green and blue converge whatever
you pick. Prompt 44 cannot deliver that requirement as written. The real fix is
the one the dataviz guidance already gives: stop relying on colour alone. Add a
second channel to the unit-status bar — direct labels or pattern fills — and
take the hue separation as far as it goes. That is a decision for prompt 44; the
number is here so it is not discovered late.

This is a pre-existing defect, not something the rebrand introduces. Severity is
moderate: the common deficiency (deuteranopia) passes today.

---

## A · Evergreen — evolve, don't replace

Keeps the deep-green family the app already wears, and fixes the neutrals and
typography around it. The green reads as ledger-stable rather than eco.

**Rationale.** The product's argument is "the system your tenants can actually
read". Nothing about the current green undermines that, and a landlord who has
seen a demo will not experience a repaint as progress. This spends the rebrand
budget on the heading face, density and the mark instead of on hue.

| Token | Light | Dark |
|---|---|---|
| background | `#faf9f7` | `#14110f` |
| surface | `#ffffff` | `#1c1917` |
| foreground | `#1c1a17` | `#f5f2ed` |
| muted-foreground | `#6b655c` | `#a8a199` |
| border | `#e7e3dd` | `#2e2a26` |
| **primary** | `#174a3c` | `#46a684` |
| primary-foreground | `#ffffff` | `#14110f` |
| accent | `#c2703d` | `#c2703d` |
| success | `#26724d` | `#6db78e` |
| warning | `#805c03` | `#d5a138` |
| danger | `#b3261e` | `#ff7f6f` |
| info | `#2b5d8a` | `#7cb0e2` |

- **Heading face:** Source Serif 4 Variable (`@fontsource-variable/source-serif-4`).
  A serif says *record*, which is what this product is. Full Latin Extended, so
  `ñ á é í ó ú ü ¿ ¡` are covered.
- **Radius** `0.625rem` (unchanged) · **shadow** unchanged · **density** unchanged.

**Measured contrast**

| Pair | Light | Dark |
|---|---|---|
| body on background | 16.50 | 16.84 |
| muted on surface | 5.77 | 6.85 |
| primary-fg on primary | 10.09 | 6.31 |
| focus ring on surface (≥3) | 10.09 | 5.87 |
| success on `/10` over page | 4.83 | 6.79 |
| warning on `/10` over page | 5.03 | 6.96 |
| danger on `/10` over page | 5.29 | 6.62 |
| info on `/10` over page | 5.67 | 7.06 |
| destructive button label | 6.54 | 7.63 |

**Risk.** It may not read as a rebrand at all. If the goal is to look different
in a sales conversation, this is the weakest option.

---

## B · Ledger — trust navy, premium gold

Navy primary with a restrained gold accent. The most institutional of the three:
this is what a bank's back office looks like.

**Rationale.** From the skill's *Banking/Traditional Finance* palette. The
product handles other people's rent and enforces statutory deadlines; navy is
the most direct way to say "this is a system of record, not an app".

| Token | Light | Dark |
|---|---|---|
| background | `#f7f8fa` | `#0d1117` |
| surface | `#ffffff` | `#151b24` |
| foreground | `#14181f` | `#eef1f6` |
| muted-foreground | `#5b6472` | `#9aa4b4` |
| border | `#e3e7ee` | `#232b37` |
| **primary** | `#14325c` | `#7fb0e8` |
| primary-foreground | `#ffffff` | `#0d1117` |
| accent (gold) | `#8a6a12` | `#d8b45c` |
| success | `#1f6b4a` | `#5fb98d` |
| warning | `#7a5803` | `#d6a43c` |
| danger | `#b02418` | `#ff8375` |
| info | `#255a87` | `#8ebcea` |

- **Heading face:** Archivo Variable (`@fontsource-variable/archivo`). A grotesque
  with enough weight range to hold a page title without going display-y, and it
  keeps the UI modern so navy+gold does not tip into "1990s bank".
- **Radius** `0.5rem` (tighter — institutional) · **shadow** flatter, borders do
  more work · **density** unchanged.

**Measured contrast**

| Pair | Light | Dark |
|---|---|---|
| body on background | 16.75 | 16.72 |
| muted on surface | 5.98 | 6.87 |
| primary-fg on primary | 12.80 | 8.36 |
| focus ring on surface (≥3) | 12.80 | 7.64 |
| success on `/10` over page | 5.26 | 6.86 |
| warning on `/10` over page | 5.32 | 7.17 |
| danger on `/10` over page | 5.40 | 6.92 |
| info on `/10` over page | 5.89 | 8.04 |
| destructive button label | 6.75 | 7.89 |

**Risks.** Two. Navy + gold is the single most generic "fintech trust" pairing —
it is safe and forgettable. And the gold accent sits close to `--warning` in hue;
an accent that reads as a caution state is a real hazard in a product whose whole
job is flagging overdue things. If you pick B, the accent must be used sparingly
and never adjacent to a warning badge.

---

## C · Frontera — clay and desert

Warm brick-clay primary against desert neutrals. The only direction with a sense
of place.

**Rationale.** El Paso first, tenants largely Spanish-speaking, adobe and
Chihuahuan desert as the visual vernacular. This is the option that looks like it
was made *for* the border rather than bought off a shelf — which matters for a
product whose pitch is that it respects the people who actually use it.

| Token | Light | Dark |
|---|---|---|
| background | `#faf7f4` | `#16120f` |
| surface | `#fffdfb` | `#1f1916` |
| foreground | `#1f1a16` | `#f6f1ec` |
| muted-foreground | `#6e6257` | `#ab9f94` |
| border | `#ece4dc` | `#2f2723` |
| **primary** | `#8f3a24` | `#e8927a` |
| primary-foreground | `#ffffff` | `#16120f` |
| accent (sky) | `#2f5c86` | `#84b4e4` |
| success | `#2a6f4d` | `#6fba90` |
| warning | `#7a5a05` | `#d9a742` |
| danger | `#a8281c` | `#ff8a79` |
| info | `#2f5c86` | `#84b4e4` |

- **Heading face:** Bricolage Grotesque Variable
  (`@fontsource-variable/bricolage-grotesque`). Has regional character without
  being playful; the slightly irregular forms read as made-by-hand, which suits
  the positioning. Full Latin Extended.
- **Radius** `0.75rem` (softer) · **shadow** warmer, lower · **density** unchanged.

**Measured contrast**

| Pair | Light | Dark |
|---|---|---|
| body on background | 16.16 | 16.60 |
| muted on surface | 5.83 | 6.72 |
| primary-fg on primary | 7.50 | 7.83 |
| focus ring on surface (≥3) | 7.39 | 7.30 |
| success on `/10` over page | 4.91 | 6.92 |
| warning on `/10` over page | 5.18 | 7.21 |
| danger on `/10` over page | 5.60 | 6.98 |
| info on `/10` over page | 5.70 | 7.30 |
| destructive button label | 7.03 | 8.13 |

**Risk — and it is the serious one.** REBRAND.md named it: a clay primary sits in
the same hue neighbourhood as `--danger` (`#a8281c`) and not far from `--warning`.
In a product where red means *overdue rent* and amber means *statutory deadline*,
a primary button that is nearly the same family is a genuine misread risk. I have
pushed the primary darker and browner than the current `--accent` terracotta to
open the gap, and every tone still measures ≥4.5:1 — but contrast is not the same
as distinguishability. **Judge this one on the `/brand-preview` route**, where a
primary button sits beside a danger badge and an overdue row, not on the swatches.

---

## Side by side

| | A · Evergreen | B · Ledger | C · Frontera |
|---|---|---|---|
| Primary (light) | `#174a3c` | `#14325c` | `#8f3a24` |
| Heading face | Source Serif 4 | Archivo | Bricolage Grotesque |
| Radius | 0.625rem | 0.5rem | 0.75rem |
| Feels like | the current app, sharpened | a bank | a place |
| Lowest measured pair | 4.83 (success light) | 5.26 (success light) | 4.91 (success light) |
| All pairs ≥ floor | yes | yes | yes |
| Main risk | may not read as change | generic; gold ≈ warning | clay ≈ danger |

All three clear the WCAG floor everywhere, in both themes, on the first pass —
so **contrast does not decide this.** Pick on positioning and on the two risks.

## What the preview decided

I wrote a recommendation for **C · Frontera** before building `/brand-preview`,
on positioning: it is the only direction that argues for the product. The
preview disproved it, so that recommendation is withdrawn rather than left
standing.

**C fails the risk REBRAND.md named.** On the preview, in both themes:

- Light: primary `#8f3a24` sits beside destructive `#a8281c`. "Report a
  payment" and "Delete" read as the same colour family.
- Dark is worse: primary `#e8927a` against danger `#ff8a79` are barely
  separable. The "Reportar pago" CTA inside the overdue balance card is
  nearly the same hue as the `$3,017.00` it sits under.

Every one of those pairs passes WCAG — which is the point worth keeping.
**Contrast is not distinguishability.** A ratio says text is legible on its
background; it says nothing about whether a user can tell the safe action from
the dangerous one. That is why this route existed, and it is the only thing it
was needed for.

A and B both separate cleanly from danger in both themes.

### Recommendation: A · Evergreen

Not because it is safe, but because the rebrand's value is not in the hue.
Looking at the three rendered side by side, what actually dates this app is the
absence of a heading face, uniform density and a weak mark — none of which is a
colour problem. A spends the budget there and keeps a primary that is
unmistakably *not* a warning, in a product whose whole job is flagging overdue
money.

**B · Ledger** is the alternative if you want the rebrand to be visible in a
sales conversation. It reads more institutional than A and separates from danger
just as cleanly. Its cost is that navy-and-gold is the most common fintech
pairing there is, and the gold accent needs a rule: never adjacent to a warning
badge.

If you want C's sense of place, the way to get it without the misread is to keep
a green or navy primary and let clay be the **accent** — where it already lives
today as `--accent: #c2703d`. Say the word and I will measure that as a fourth
option before prompt 44.
