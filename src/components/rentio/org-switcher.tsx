import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import { apiFetch, db } from "@/lib/db";

const ALL = "all";

/** PortfolioAI staff pick which company to act in. Everyone else never sees this. */
export function OrgSwitcher({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { isSuperAdmin, profile } = useAuth();
  const organizations = useQuery({
    queryKey: ["organizations"],
    enabled: isSuperAdmin,
    queryFn: async () => {
      const { data, error } = await db.from("organizations").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });
  if (!isSuperAdmin) return null;

  const choose = async (value: string) => {
    await apiFetch("/api/org", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ org_id: value === ALL ? null : value }),
    });
    // Every cached query belongs to the previous company; a reload is the
    // one sure way to drop them all.
    window.location.reload();
  };

  return (
    <Select value={profile?.org_id ?? ALL} onValueChange={(value) => void choose(value)}>
      <SelectTrigger className={className} aria-label={t("orgSwitcher.label")}>
        <SelectValue placeholder={t("orgSwitcher.label")} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{t("orgSwitcher.all")}</SelectItem>
        {(organizations.data ?? []).map((org) => (
          <SelectItem key={org.id} value={org.id}>
            {org.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
