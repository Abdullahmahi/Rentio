import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/rentio/empty-state";
import { errorText } from "@/lib/db";

interface QueryStateProps {
  isLoading: boolean;
  error: unknown;
  isEmpty?: boolean | undefined;
  onRetry?: (() => void) | undefined;
  skeleton?: ReactNode | undefined;
  empty?: ReactNode | undefined;
  children: ReactNode;
}

export function CardsSkeleton({ count = 6, height = "h-36" }: { count?: number; height?: string }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, index) => (
        <Skeleton key={index} className={height} />
      ))}
    </div>
  );
}

export function RowsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, index) => (
        <Skeleton key={index} className="h-12" />
      ))}
    </div>
  );
}

function ErrorState({ error, onRetry }: { error: unknown; onRetry?: (() => void) | undefined }) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className="flex min-h-56 flex-col items-center justify-center rounded-lg border border-danger/25 bg-danger/5 px-6 py-12 text-center"
    >
      <div className="grid size-10 place-items-center rounded-lg bg-danger/10 text-danger">
        <AlertTriangle className="size-5" />
      </div>
      <h2 className="mt-4 text-base font-semibold text-foreground">{t("errors.loadFailed")}</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{errorText(t, error)}</p>
      {onRetry ? (
        <Button className="mt-5" variant="outline" onClick={onRetry}>
          {t("actions.retry")}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Every page routes its loading / error / empty states through here, so no
 * screen can ship as a blank page or an endless spinner.
 */
export function QueryState({
  isLoading,
  error,
  isEmpty,
  onRetry,
  skeleton,
  empty,
  children,
}: QueryStateProps) {
  if (error)
    return onRetry ? <ErrorState error={error} onRetry={onRetry} /> : <ErrorState error={error} />;
  if (isLoading) return <>{skeleton ?? <RowsSkeleton />}</>;
  if (isEmpty) return <>{empty ?? <EmptyState />}</>;
  return <>{children}</>;
}
