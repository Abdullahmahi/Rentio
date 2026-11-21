import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { RentioMark } from "@/components/rentio/rentio-mark";
import { RequireRole } from "@/components/rentio/require-role";
import { QueryState, RowsSkeleton } from "@/components/rentio/query-state";
import { StatusBadge } from "@/components/rentio/status-badge";
import { ApplicationForm, applicationStatusVariant } from "@/components/rentio/application-form";
import { useAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/format";
import i18n from "@/lib/i18n";
import { pageTitle } from "@/lib/brand";

export const Route = createFileRoute("/apply/status")({
  head: () => ({ meta: [{ title: pageTitle(i18n.t("applications.dashboard.title")) }] }),
  component: () => (
    <RequireRole allow="applicant">
      <StatusPage />
    </RequireRole>
  ),
});

/**
 * The applicant's home: each application with where it stands, and the
 * form itself while one is still a draft. Once the lease activates the
 * login becomes a tenant and homeFor() sends it to /portal instead (the
 * server caches a profile for up to 60s, so allow a minute).
 */
function StatusPage() {
  const { t } = useTranslation();
  const { signOut } = useAuth();
  const mine = useQuery({
    queryKey: ["my-applications"],
    queryFn: async () => {
      const { data, error } = await db
        .from("applications")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const draft = mine.data?.find((row) => row.status === "draft");

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <RentioMark subtitle={null} />
        <Button variant="ghost" size="sm" onClick={() => void signOut()}>
          {t("actions.signOut")}
        </Button>
      </header>
      <main className="mx-auto max-w-2xl space-y-6 px-4 py-6">
        <h1 className="text-2xl font-semibold">{t("applications.dashboard.title")}</h1>
        <QueryState
          isLoading={mine.isLoading}
          error={mine.error}
          isEmpty={(mine.data ?? []).length === 0}
          onRetry={() => void mine.refetch()}
          skeleton={<RowsSkeleton count={2} />}
          empty={
            <p className="text-sm text-muted-foreground">{t("applications.dashboard.empty")}</p>
          }
        >
          <ul className="space-y-3">
            {(mine.data ?? []).map((row) => (
              <li key={row.id} className="rounded-xl border border-border bg-surface p-4">
                <div className="flex items-center justify-between gap-3">
                  <StatusBadge
                    status={t(`applications.status.${row.status}`)}
                    variant={applicationStatusVariant(row.status)}
                  />
                  {row.submitted_at ? (
                    <span className="text-xs text-muted-foreground">
                      {t("applications.dashboard.submittedOn", {
                        date: formatDate(row.submitted_at),
                      })}
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-sm">{t(`applications.statusHint.${row.status}`)}</p>
              </li>
            ))}
          </ul>
        </QueryState>
        {draft ? (
          <section className="rounded-xl border border-border bg-surface p-4 sm:p-6">
            <ApplicationForm id={draft.id} />
          </section>
        ) : null}
      </main>
    </div>
  );
}
