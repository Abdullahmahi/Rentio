import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/rentio/empty-state";
import { PageHeader } from "@/components/rentio/page-header";

export function PlaceholderPage({ pageKey, icon }: { pageKey: string; icon: LucideIcon }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <PageHeader title={t(`pages.${pageKey}.title`)} description={t(`pages.${pageKey}.description`)} />
      <EmptyState icon={icon} />
    </div>
  );
}
