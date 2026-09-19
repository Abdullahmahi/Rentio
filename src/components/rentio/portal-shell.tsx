import { useEffect } from "react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { FileText, Home, ReceiptText, UserRound, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LANGUAGE_STORAGE_KEY } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const tenantItems = [
  ["home", "/portal", Home],
  ["receipts", "/portal/receipts", ReceiptText],
  ["contracts", "/portal/contracts", FileText],
  ["maintenance", "/portal/maintenance", Wrench],
  ["profile", "/portal/profile", UserRound],
] as const;

export function PortalShell() {
  const { t, i18n } = useTranslation();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  useEffect(() => {
    const storedLanguage = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    const language = storedLanguage === "en" ? "en" : "es-MX";
    const timer = window.setTimeout(() => {
      if (i18n.language !== language) void i18n.changeLanguage(language);
      document.documentElement.lang = language;
    }, 0);
    return () => window.clearTimeout(timer);
  }, [i18n]);
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-surface">
        <div className="mx-auto grid h-16 max-w-6xl grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
              R
            </div>
            <div className="min-w-0">
              <div className="truncate font-semibold">{t("brand.name")}</div>
              <div className="truncate text-xs text-muted-foreground">{t("brand.tenant")}</div>
            </div>
          </div>
          <nav className="hidden items-center gap-1 md:flex">
            {tenantItems.map(([key, path, Icon]) => (
              <Link
                key={path}
                to={path}
                className={cn(
                  "flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium",
                  pathname === path
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {t(`nav.${key}`)}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4 pb-24 sm:p-6 md:pb-6">
        <Outlet />
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-40 grid h-16 grid-cols-5 border-t border-border bg-surface md:hidden">
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
            <span className="max-w-full truncate">{t(`nav.${key}`)}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
