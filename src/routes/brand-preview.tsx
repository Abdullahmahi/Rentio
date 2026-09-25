import { useState } from "react";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { BarChart3, Building2, CarFront, DoorClosed, FileText, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/rentio/status-badge";
import { MoneyText } from "@/components/rentio/money-text";
import { cn } from "@/lib/utils";

/**
 * THROWAWAY. Deleted by prompt 44 once a direction is chosen.
 *
 * Dev-only in two ways, because one is not enough: the route throws notFound()
 * in a production build so it cannot be reached even if the chunk ships, and
 * the whole module is behind import.meta.env.DEV so it is tree-shaken out.
 *
 * Each column overrides the CSS variables locally through [data-brand], so the
 * three directions render simultaneously in one page against the SAME real
 * components the app uses — not mock-ups. That is the only way to judge the
 * risk that matters here: whether a clay primary reads as a danger state when
 * an overdue row is sitting next to it.
 */
export const Route = createFileRoute("/brand-preview")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  component: BrandPreviewPage,
});

type Mode = "light" | "dark";

const DIRECTIONS = [
  {
    id: "evergreen",
    name: "A · Evergreen",
    note: "evolve the current green",
    heading: '"Source Serif 4 Variable", Georgia, serif',
    radius: "0.625rem",
    light: {
      background: "#faf9f7",
      surface: "#ffffff",
      foreground: "#1c1a17",
      "muted-foreground": "#6b655c",
      border: "#e7e3dd",
      muted: "#f3f0ec",
      secondary: "#f3f0ec",
      primary: "#174a3c",
      "primary-foreground": "#ffffff",
      accent: "#c2703d",
      success: "#26724d",
      warning: "#805c03",
      danger: "#b3261e",
      info: "#2b5d8a",
    },
    dark: {
      background: "#14110f",
      surface: "#1c1917",
      foreground: "#f5f2ed",
      "muted-foreground": "#a8a199",
      border: "#2e2a26",
      muted: "#25211e",
      secondary: "#25211e",
      primary: "#46a684",
      "primary-foreground": "#14110f",
      accent: "#c2703d",
      success: "#6db78e",
      warning: "#d5a138",
      danger: "#ff7f6f",
      info: "#7cb0e2",
    },
  },
  {
    id: "ledger",
    name: "B · Ledger",
    note: "trust navy, premium gold",
    heading: '"Archivo Variable", Inter, sans-serif',
    radius: "0.5rem",
    light: {
      background: "#f7f8fa",
      surface: "#ffffff",
      foreground: "#14181f",
      "muted-foreground": "#5b6472",
      border: "#e3e7ee",
      muted: "#eef1f5",
      secondary: "#eef1f5",
      primary: "#14325c",
      "primary-foreground": "#ffffff",
      accent: "#8a6a12",
      success: "#1f6b4a",
      warning: "#7a5803",
      danger: "#b02418",
      info: "#255a87",
    },
    dark: {
      background: "#0d1117",
      surface: "#151b24",
      foreground: "#eef1f6",
      "muted-foreground": "#9aa4b4",
      border: "#232b37",
      muted: "#1b2330",
      secondary: "#1b2330",
      primary: "#7fb0e8",
      "primary-foreground": "#0d1117",
      accent: "#d8b45c",
      success: "#5fb98d",
      warning: "#d6a43c",
      danger: "#ff8375",
      info: "#8ebcea",
    },
  },
  {
    id: "frontera",
    name: "C · Frontera",
    note: "clay and desert",
    heading: '"Bricolage Grotesque Variable", Inter, sans-serif',
    radius: "0.75rem",
    light: {
      background: "#faf7f4",
      surface: "#fffdfb",
      foreground: "#1f1a16",
      "muted-foreground": "#6e6257",
      border: "#ece4dc",
      muted: "#f5efe8",
      secondary: "#f5efe8",
      primary: "#8f3a24",
      "primary-foreground": "#ffffff",
      accent: "#2f5c86",
      success: "#2a6f4d",
      warning: "#7a5a05",
      danger: "#a8281c",
      info: "#2f5c86",
    },
    dark: {
      background: "#16120f",
      surface: "#1f1916",
      foreground: "#f6f1ec",
      "muted-foreground": "#ab9f94",
      border: "#2f2723",
      muted: "#271f1b",
      secondary: "#271f1b",
      primary: "#e8927a",
      "primary-foreground": "#16120f",
      accent: "#84b4e4",
      success: "#6fba90",
      warning: "#d9a742",
      danger: "#ff8a79",
      info: "#84b4e4",
    },
  },
] as const;

const NAV = [
  ["Dashboard", BarChart3],
  ["Properties", Building2],
  ["Units", DoorClosed],
  ["Parking", CarFront],
  ["Tenants", Users],
  ["Contracts", FileText],
] as const;

/** Five real payment rows, including the overdue one that makes the clay risk
 *  visible. Amounts are the seed's own numbers. */
const ROWS = [
  { tenant: "María Fernanda Ríos", unit: "301", amount: 468.5, status: "vencido" },
  { tenant: "Daniel Whitaker", unit: "102", amount: 1510.0, status: "pagado" },
  { tenant: "Ana Sofía Hernández", unit: "204", amount: 1075.0, status: "pendiente" },
  { tenant: "Rubén Darío Maldonado", unit: "101", amount: 1050.0, status: "pagado_parcial" },
  { tenant: "Rachel Goldstein", unit: "403", amount: 990.0, status: "pagado" },
] as const;

const BADGE: Record<string, { label: string; variant: "success" | "warning" | "danger" | "info" }> =
  {
    pagado: { label: "Paid", variant: "success" },
    vencido: { label: "Overdue", variant: "danger" },
    pendiente: { label: "Pending", variant: "warning" },
    pagado_parcial: { label: "Partial", variant: "info" },
  };

function BrandPreviewPage() {
  const [mode, setMode] = useState<Mode>("light");

  return (
    <div className="min-h-screen bg-neutral-100 p-6 dark:bg-neutral-900">
      <header className="mx-auto mb-6 flex max-w-[1600px] flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
            Brand directions — real components, not mock-ups
          </h1>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            Judge C on whether its primary button reads as a danger state next to the overdue row.
            Contrast is already measured and passing for all three — see BRAND_OPTIONS.md.
          </p>
        </div>
        <div className="flex rounded-lg border border-neutral-300 bg-white p-0.5 dark:border-neutral-700 dark:bg-neutral-800">
          {(["light", "dark"] as const).map((option) => (
            <button
              key={option}
              onClick={() => setMode(option)}
              aria-pressed={mode === option}
              className={cn(
                "h-8 rounded-md px-3 text-sm font-medium capitalize",
                mode === option
                  ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                  : "text-neutral-600 dark:text-neutral-300",
              )}
            >
              {option}
            </button>
          ))}
        </div>
      </header>

      <div className="mx-auto grid max-w-[1600px] gap-6 xl:grid-cols-3">
        {DIRECTIONS.map((direction) => (
          <Column key={direction.id} direction={direction} mode={mode} />
        ))}
      </div>
    </div>
  );
}

function Column({ direction, mode }: { direction: (typeof DIRECTIONS)[number]; mode: Mode }) {
  const tokens = direction[mode];
  // Local variable overrides. Written as inline custom properties so the whole
  // subtree — including every shadcn component inside it — resolves against
  // these instead of :root, with no global mutation.
  const style = {
    ...Object.fromEntries(Object.entries(tokens).map(([k, v]) => [`--${k}`, v])),
    "--radius": direction.radius,
    "--ring": tokens.primary,
    "--input": tokens.border,
    "--card": tokens.surface,
    "--popover": tokens.surface,
    "--destructive": tokens.danger,
    "--destructive-foreground": tokens["primary-foreground"],
    "--accent-foreground": mode === "light" ? "#ffffff" : tokens.background,
    backgroundColor: tokens.background,
    color: tokens.foreground,
  } as React.CSSProperties;

  return (
    <section data-brand={direction.id} style={style} className="overflow-hidden rounded-xl border">
      <div className="border-b px-4 py-3" style={{ borderColor: tokens.border }}>
        <h2 className="text-lg font-semibold" style={{ fontFamily: direction.heading }}>
          {direction.name}
        </h2>
        <p className="text-xs" style={{ color: tokens["muted-foreground"] }}>
          {direction.note} · heading face shown only if installed locally
        </p>
      </div>

      <div className="space-y-4 p-4">
        {/* sidebar nav, the three groups collapsed to one list for width */}
        <nav className="flex flex-wrap gap-1 rounded-lg p-2" style={{ background: tokens.secondary }}>
          {NAV.map(([label, Icon], index) => (
            <span
              key={label}
              className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium"
              style={
                index === 0
                  ? { background: tokens.primary, color: tokens["primary-foreground"] }
                  : { color: tokens["muted-foreground"] }
              }
            >
              <Icon className="size-3.5 shrink-0" />
              {label}
            </span>
          ))}
        </nav>

        <div className="space-y-4">
          {/* KPI tile + unit-status stacked bar */}
          <div
            className="rounded-lg border p-4"
            style={{ borderColor: tokens.border, background: tokens.surface }}
          >
            <p className="text-xs font-medium" style={{ color: tokens["muted-foreground"] }}>
              Collected this month
            </p>
            <p className="numeric mt-1 text-2xl font-semibold">$14,720.00</p>
            <div
              className="mt-3 flex h-2 overflow-hidden rounded-full"
              style={{ background: tokens.muted }}
            >
              {[
                [62, tokens.success],
                [18, tokens.warning],
                [12, tokens.info],
                [8, tokens.danger],
              ].map(([width, colour]) => (
                <span
                  key={String(colour)}
                  style={{ width: `${width}%`, background: String(colour) }}
                />
              ))}
            </div>
            <p className="mt-2 text-xs" style={{ color: tokens["muted-foreground"] }}>
              Occupied · Maintenance · Reserved · Vacant
            </p>
          </div>

          {/* payments table with money column and all four badge variants */}
          <div
            className="overflow-hidden rounded-lg border"
            style={{ borderColor: tokens.border, background: tokens.surface }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: tokens.muted }}>
                  <th className="px-3 py-2 text-left font-medium">Tenant</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => (
                  <tr key={row.tenant} className="border-t" style={{ borderColor: tokens.border }}>
                    <td className="px-3 py-2">
                      <span className="block truncate">{row.tenant}</span>
                      <span
                        className="numeric text-xs"
                        style={{ color: tokens["muted-foreground"] }}
                      >
                        Unit {row.unit}
                      </span>
                    </td>
                    <td className="numeric px-3 py-2 text-right">
                      <MoneyText value={row.amount} />
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge
                        status={BADGE[row.status]!.label}
                        variant={BADGE[row.status]!.variant}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* the risk shot: primary button beside a danger badge */}
          <div className="flex flex-wrap items-center gap-2">
            <Button>Report a payment</Button>
            <Button variant="outline">Cancel</Button>
            <Button variant="destructive">Delete</Button>
            <Button disabled>Pay online</Button>
          </div>
          <Input placeholder="Focus me" className="h-11" />

          {/* tenant balance card, es-MX, at 375px */}
          <div
            className="mx-auto w-[375px] max-w-full rounded-lg border p-4"
            style={{
              borderColor: tokens.danger,
              background: `color-mix(in oklab, ${tokens.danger} 10%, ${tokens.surface})`,
            }}
          >
            <p className="text-sm" style={{ color: tokens["muted-foreground"] }}>
              Saldo pendiente
            </p>
            <p className="numeric mt-1 text-3xl font-semibold" style={{ color: tokens.danger }}>
              $3,017.00
            </p>
            <p className="numeric mt-0.5 text-sm" style={{ color: tokens["muted-foreground"] }}>
              Vence el 09/01/2026
            </p>
            <Button className="mt-4 h-12 w-full text-base">Reportar pago</Button>
          </div>
        </div>
      </div>
    </section>
  );
}
