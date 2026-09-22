import { Download, Filter } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Container } from "@/components/marketing/ui/container";
import { MagicCard } from "@/components/marketing/ui/magic-card";
import { StatusBadge } from "@/components/rentio/status-badge";

/**
 * Ported from Vetra's `analysis.tsx`, which despite its name holds no charts —
 * two MagicCards, each containing a hand-built miniature dashboard in JSX.
 *
 * Kept as JSX rather than captured as screenshots for two reasons: it stays
 * crisp at any resolution, and a mock built from invented rows cannot leak a
 * real tenant's name, unit or balance the way a screenshot can.
 *
 * The badges are the product's own StatusBadge, so the mock cannot drift from
 * how the app actually looks.
 */
const ROWS = ["a", "b", "c"] as const;

/** A flat sparkline, drawn rather than plotted — it illustrates the shape of
 *  the interface, not a data series. */
function Sparkline({ points, className }: { points: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 120 32"
      className={className}
      fill="none"
      aria-hidden
      preserveAspectRatio="none"
    >
      <polyline
        points={points}
        stroke="var(--chart-collected)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MiniDashboard({
  ns,
  columns,
  sparkline,
  statusOf,
}: {
  ns: "rentRoll" | "queue";
  columns: readonly string[];
  sparkline: string;
  statusOf?: ((row: string) => "success" | "danger" | "info" | "neutral") | undefined;
}) {
  const { t } = useTranslation("marketing");

  return (
    <MagicCard className="p-5 lg:rounded-3xl lg:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-muted-foreground">{t(`proof.${ns}.title`)}</h3>
          <p className="numeric mt-1 text-2xl font-semibold">{t(`proof.${ns}.figure`)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t(`proof.${ns}.figureNote`)}</p>
        </div>
        {/* Ghost affordances, as in the original — they signal a real screen
            without pretending to be operable. */}
        <div className="flex shrink-0 gap-1.5" aria-hidden>
          <span className="grid size-7 place-items-center rounded-md border border-border text-muted-foreground">
            <Filter className="size-3.5" />
          </span>
          <span className="grid size-7 place-items-center rounded-md border border-border text-muted-foreground">
            <Download className="size-3.5" />
          </span>
        </div>
      </div>

      <Sparkline points={sparkline} className="mt-4 h-8 w-full" />

      <table className="mt-4 w-full border-collapse text-left text-xs">
        <thead className="text-muted-foreground">
          <tr>
            {columns.map((column) => (
              <th key={column} className="border-b border-border py-2 font-medium">
                {t(`proof.${ns}.columns.${column}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row} className="border-b border-border last:border-b-0">
              {columns.map((column) => {
                const value = t(`proof.${ns}.rows.${row}.${column}`);
                const isStatus = column === "status";
                return (
                  <td
                    key={column}
                    className={`py-2.5 ${column === "rent" || column === "age" ? "numeric" : ""}`}
                  >
                    {isStatus && statusOf ? (
                      <StatusBadge status={value} variant={statusOf(row)} />
                    ) : (
                      value
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </MagicCard>
  );
}

export function Proof() {
  const { t } = useTranslation("marketing");

  return (
    <section className="relative flex w-full flex-col items-center justify-center py-16 lg:py-24">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <Container>
          <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
            <h2 className="text-balance font-heading text-2xl font-medium !leading-snug md:text-4xl lg:text-5xl">
              {t("proof.headingLead")}{" "}
              <span className="font-subheading italic">{t("proof.headingEmphasis")}</span>
            </h2>
            <p className="mt-5 text-balance text-base text-muted-foreground md:text-lg">
              {t("proof.subhead")}
            </p>
          </div>
        </Container>

        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <Container
            delay={0.1}
            className="rounded-2xl border border-border/60 bg-card lg:rounded-3xl"
          >
            <MiniDashboard
              ns="rentRoll"
              columns={["unit", "tenant", "rent", "status"]}
              sparkline="0,26 20,22 40,24 60,16 80,12 100,9 120,4"
              statusOf={(row) => (row === "b" ? "danger" : "success")}
            />
          </Container>
          <Container
            delay={0.2}
            className="rounded-2xl border border-border/60 bg-card lg:rounded-3xl"
          >
            <MiniDashboard
              ns="queue"
              columns={["unit", "issue", "source", "age"]}
              sparkline="0,10 20,14 40,11 60,18 80,15 100,21 120,17"
            />
          </Container>
        </div>

        <Container delay={0.3}>
          <p className="mt-6 text-center text-xs text-muted-foreground">{t("proof.disclaimer")}</p>
        </Container>
      </div>
    </section>
  );
}
