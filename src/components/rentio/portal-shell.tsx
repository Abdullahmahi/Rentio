import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { UserRound, WalletCards, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PORTAL_DEFAULT_LANGUAGE } from "@/lib/i18n";
import { useLanguagePreference } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { BRAND_NAME } from "@/lib/brand";

/**
 * Payment and maintenance request, as the owner asked. Receipts open from the
 * Pagos page (§92.011 wants them reachable), profile from the header icon;
 * contracts keep their route.
 */
const tenantItems = [
  ["payments", "/portal", WalletCards],
  ["serviceRequests", "/portal/maintenance", Wrench],
] as const;

export function PortalShell() {
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  useLanguagePreference(PORTAL_DEFAULT_LANGUAGE);
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-surface">
        <div className="mx-auto grid h-16 max-w-6xl grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
              R
            </div>
            <div className="min-w-0">
              <div className="truncate font-semibold">{BRAND_NAME}</div>
              <div className="truncate text-xs text-muted-foreground">{t("brand.tenant")}</div>
            </div>
          </div>
          <nav className="flex items-center gap-1">
            {tenantItems.map(([key, path, Icon]) => (
              <Link
                key={path}
                to={path}
                className={cn(
                  // The bottom bar carries these below md; the profile icon stays.
                  "hidden h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium md:flex",
                  pathname === path
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {t(`nav.${key}`)}
              </Link>
            ))}
            <Link
              to="/portal/profile"
              aria-label={t("nav.profile")}
              title={t("nav.profile")}
              className={cn(
                "grid size-9 place-items-center rounded-lg",
                pathname === "/portal/profile"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <UserRound className="size-4" />
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4 pb-24 sm:p-6 md:pb-6">
        <Outlet />
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-40 grid h-16 grid-cols-2 border-t border-border bg-surface md:hidden">
        {tenantItems.map(([key, path, Icon]) => (
          <Link
            key={path}
            to={path}
            className={cn(
              "flex min-w-0 flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium",
              pathname === path ? "text-primary" : "text-muted-foreground",
            )}
          >
            <Icon className="size-5 shrink-0" />
            <span className="max-w-full text-center leading-tight">{t(`nav.${key}`)}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
