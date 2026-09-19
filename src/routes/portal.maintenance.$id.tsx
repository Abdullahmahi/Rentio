import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/rentio/empty-state";
import { PageHeader } from "@/components/rentio/page-header";
import { QueryState, RowsSkeleton } from "@/components/rentio/query-state";
import { WorkOrderPriorityBadge, WorkOrderStatusBadge } from "@/components/rentio/status";
import { formatMexicoDate } from "@/lib/format";
import { useMyPortal } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { signedUrl } from "@/lib/storage";

export const Route = createFileRoute("/portal/maintenance/$id")({ component: PortalRequestDetail });

function PortalRequestDetail() {
  const { id } = Route.useParams();
  const { t } = useTranslation();
  const portal = useMyPortal();
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);

  const order = portal.data?.workOrders.find((row) => row.id === id);

  /**
   * RLS returns only `is_internal = false` rows to a tenant, so this query
   * physically cannot surface an internal note.
   */
  const notes = useQuery({
    queryKey: ["portal-wo-notes", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_order_notes").select("*").eq("work_order_id", id).order("created_at");
      if (error) throw error;
      return data;
    },
  });

  const photos = useQuery({
    queryKey: ["portal-wo-photos", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("work_order_photos").select("*").eq("work_order_id", id);
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    let active = true;
    void (async () => {
      const urls = await Promise.all(
        (photos.data ?? []).map(async (photo) => {
          try { return await signedUrl("work-order-photos", photo.url); } catch { return ""; }
        }),
      );
      if (active) setPhotoUrls(urls.filter(Boolean));
    })();
    return () => { active = false; };
  }, [photos.data]);

  return (
    <div className="space-y-5">
      <Link to="/portal/maintenance" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />{t("maintenance.backToList")}
      </Link>

      <QueryState
        isLoading={portal.isLoading}
        error={portal.error}
        isEmpty={!order && !portal.isLoading}
        onRetry={() => void portal.refetch()}
        skeleton={<RowsSkeleton count={4} />}
        empty={<EmptyState icon={Wrench} message={t("maintenance.notFound")} description={t("maintenance.notFoundDescription")} />}
      >
        {order ? (
          <>
            <PageHeader
              title={order.title}
              description={`${order.folio ?? "—"} · ${formatMexicoDate(order.created_at)}`}
              actions={
                <div className="flex flex-wrap gap-2">
                  <WorkOrderStatusBadge value={order.status} />
                  <WorkOrderPriorityBadge value={order.priority} />
                </div>
              }
            />

            {order.description ? (
              <section className="rounded-lg border border-border bg-surface p-4">
                <p className="whitespace-pre-wrap text-sm">{order.description}</p>
              </section>
            ) : null}

            {photoUrls.length > 0 ? (
              <section className="grid grid-cols-2 gap-3">
                {photoUrls.map((url) => (
                  <img key={url} src={url} alt="" className="aspect-square w-full rounded-lg border border-border object-cover" />
                ))}
              </section>
            ) : null}

            <section className="rounded-lg border border-border bg-surface p-4">
              <h2 className="text-base font-semibold">{t("portal.updates")}</h2>
              {(notes.data?.length ?? 0) === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">{t("portal.noUpdates")}</p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {notes.data?.map((note) => (
                    <li key={note.id} className="rounded-lg border border-border bg-muted/40 px-3 py-2.5">
                      <p className="whitespace-pre-wrap text-sm">{note.body}</p>
                      <p className="numeric mt-1 text-xs text-muted-foreground">{formatMexicoDate(note.created_at)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {order.resolved_at ? (
              <p className="numeric rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-sm text-success">
                {t("maintenance.resolvedOn", { date: formatMexicoDate(order.resolved_at) })}
              </p>
            ) : null}
          </>
        ) : null}
      </QueryState>
    </div>
  );
}
