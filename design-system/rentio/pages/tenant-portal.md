# Tenant portal — overrides MASTER.md

Tenants, mobile-first, Spanish default, one thumb, often a poor connection.
Many users will read this on a phone in a hallway.

## Density
- Spacing scale 16/24/32/48 — spacious, the opposite of the internal portal.
- Touch targets ≥ 44px; primary actions `h-12`.
- Respect `env(safe-area-inset-bottom)` on the bottom tab bar.

## Hierarchy
- The balance card is the dominant element, in all three states: owed (danger
  tint), under review (chip), up to date (success).
- "Reportar pago" is unmistakably the primary action.
- The disabled "Pagar en línea" uses the quiet variant, after the caption.

## Typography
- Screen titles: `--font-heading`. Balances and amounts: Inter, `numeric`.
- Source Serif 4 is wider than Inter. Re-check at 375px in es-MX:
  "Depósito en garantía", "Pendiente de confirmación",
  "Pagos en línea próximamente", and the how-to-pay CopyRow labels.
  Fix by wrapping — never by truncating or shrinking a touch target.

## Performance
The heading font must not block first paint. Preload the Latin subset only.

## Breakpoints to check
375px, es-MX, light and dark. Every screen.
