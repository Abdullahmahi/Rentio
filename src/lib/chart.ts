/**
 * Chart colours, read from the CSS tokens so light and dark stay in sync.
 *
 * The palette was validated with the dataviz skill's six checks in BOTH modes.
 * Two findings worth keeping in mind before changing anything here:
 *   - the brand green #1B4D3E is outside the lightness band for a chart fill
 *   - success-green against a neutral gray is ΔE 1.8 for a deuteranope, i.e.
 *     "ocupada" and "vacante" would be the same colour to them
 */
export const CHART = {
  occupied: "var(--chart-occupied)",
  maintenance: "var(--chart-maintenance)",
  reserved: "var(--chart-reserved)",
  vacant: "var(--chart-vacant)",
  collected: "var(--chart-collected)",
  track: "var(--chart-track)",
  grid: "var(--chart-grid)",
  axis: "var(--muted-foreground)",
} as const;

export const UNIT_STATUS_COLOR = {
  ocupada: CHART.occupied,
  vacante: CHART.vacant,
  mantenimiento: CHART.maintenance,
  reservada: CHART.reserved,
} as const;

/** Compact dollars for axis ticks — "$12.5k" keeps the axis narrow. */
export function compactMoney(value: number) {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${Math.round(value / 1_000)}k`;
  return `$${Math.round(value)}`;
}
