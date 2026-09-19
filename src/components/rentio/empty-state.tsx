import type { LucideIcon } from "lucide-react";
import { Building2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  icon?: LucideIcon;
  message?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon: Icon = Building2, message, description, actionLabel, onAction }: EmptyStateProps) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-64 flex-col items-center justify-center border border-dashed border-border bg-surface px-6 py-12 text-center rounded-lg">
      <div className="grid size-10 place-items-center rounded-lg bg-muted text-muted-foreground"><Icon className="size-5" /></div>
      <h2 className="mt-4 text-base font-semibold text-foreground">{message ?? t("empty.title")}</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{description ?? t("empty.description")}</p>
      {actionLabel && onAction ? <Button className="mt-5" onClick={onAction}>{actionLabel}</Button> : null}
    </div>
  );
}
