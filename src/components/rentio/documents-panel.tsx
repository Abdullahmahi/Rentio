import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FileText, Trash2, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/rentio/empty-state";
import { QueryState, RowsSkeleton } from "@/components/rentio/query-state";
import { AdminOnly } from "@/lib/auth";
import { formatMexicoDate } from "@/lib/format";
import { logActivity, qk, useActorId, useToastMutation } from "@/lib/queries";
import { describeError, supabase } from "@/lib/supabase";
import { openSigned, uploadFile, type Bucket } from "@/lib/storage";

interface DocumentsPanelProps {
  ownerType: "property" | "unit" | "tenant" | "lease" | "work_order";
  ownerId: string;
  bucket: Bucket;
  /** Storage prefix, which the tenant-facing RLS policies scope on.
   *  Defaults to ownerId; leases must pass the lease id. */
  storageOwnerId?: string | undefined;
}

export function DocumentsPanel({
  ownerType,
  ownerId,
  bucket,
  storageOwnerId,
}: DocumentsPanelProps) {
  const { t } = useTranslation();
  const actorId = useActorId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const documents = useQuery({
    queryKey: qk.documents(ownerType, ownerId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("documents")
        .select("*")
        .eq("owner_type", ownerType)
        .eq("owner_id", ownerId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const remove = useToastMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("documents").delete().eq("id", id);
      if (error) throw error;
      await logActivity(actorId, "document", id, "delete", { ownerType, ownerId });
    },
    successKey: "documents.deleted",
    invalidate: [qk.documents(ownerType, ownerId)],
  });

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const path = await uploadFile(bucket, storageOwnerId ?? ownerId, file);
      const { error } = await supabase.from("documents").insert({
        owner_type: ownerType,
        owner_id: ownerId,
        name: file.name,
        url: path,
        uploaded_by: actorId,
      });
      if (error) throw error;
      await logActivity(actorId, "document", null, "upload", {
        ownerType,
        ownerId,
        name: file.name,
      });
      toast.success(t("documents.uploaded"));
      void documents.refetch();
    } catch (caught) {
      toast.error(t(describeError(caught)));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t("documents.hint")}</p>
        <div>
          <input
            ref={inputRef}
            type="file"
            className="sr-only"
            id={`upload-${ownerType}-${ownerId}`}
            onChange={(event) => void onPick(event.target.files?.[0])}
          />
          <Button asChild variant="outline" disabled={uploading}>
            <label htmlFor={`upload-${ownerType}-${ownerId}`} className="cursor-pointer">
              <Upload className="size-4" />
              {t(uploading ? "documents.uploading" : "documents.upload")}
            </label>
          </Button>
        </div>
      </div>

      <QueryState
        isLoading={documents.isLoading}
        error={documents.error}
        isEmpty={(documents.data?.length ?? 0) === 0}
        onRetry={() => void documents.refetch()}
        skeleton={<RowsSkeleton count={3} />}
        empty={
          <EmptyState
            icon={FileText}
            message={t("documents.emptyTitle")}
            description={t("documents.emptyDescription")}
          />
        }
      >
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {documents.data?.map((document) => (
            <li key={document.id} className="flex items-center gap-3 px-4 py-3">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{document.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatMexicoDate(document.created_at)}
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t("actions.download")}
                onClick={() =>
                  void openSigned(bucket, document.url).catch((caught) =>
                    toast.error(t(describeError(caught))),
                  )
                }
              >
                <Download className="size-4" />
              </Button>
              <AdminOnly>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t("actions.delete")}
                  onClick={() => remove.mutate(document.id)}
                >
                  <Trash2 className="size-4 text-danger" />
                </Button>
              </AdminOnly>
            </li>
          ))}
        </ul>
      </QueryState>
    </div>
  );
}
