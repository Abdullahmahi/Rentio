import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { BRAND_NAME } from "@/lib/brand";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { UserRound, WalletCards, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { RentioMark } from "@/components/rentio/rentio-mark";
import i18n, { PORTAL_DEFAULT_LANGUAGE } from "@/lib/i18n";
import { useLanguagePreference, usePublicSettings } from "@/lib/queries";
import { signedUrl } from "@/lib/storage";
import { cn } from "@/lib/utils";

/**
 * Payment and maintenance request, as the owner asked. Receipts open from the
 * Pagos page (§92.011 wants them reachable), profile from the header icon;
 * contracts keep their route.
 */
const tenantItems = [
  ["payments", "/portal", WalletCards],
  ["serviceRequests", "/portal/maintenance", Wrench],
] as const;

/** Home is exact; everything else matches its section so detail pages count. */
const isActive = (pathname: string, path: string) =>
  path === "/portal"
    ? pathname === "/portal" ||
      pathname.startsWith("/portal/receipts") ||
      pathname.startsWith("/portal/report-payment")
    : pathname.startsWith(path);

export function PortalShell() {
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { setLanguage } = useLanguagePreference(PORTAL_DEFAULT_LANGUAGE);
  const other = i18n.language === "en" ? "es-MX" : "en";
  useCompanyTabTitle();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-surface">
        <div className="mx-auto grid h-16 max-w-6xl grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4">
          <CompanyMark />
          <nav className="flex items-center gap-1">
            {tenantItems.map(([key, path, Icon]) => (
              <Link
                key={path}
                to={path}
                className={cn(
                  // The bottom bar carries these below md; the profile icon stays.
                  "hidden h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium md:flex",
                  isActive(pathname, path)
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {t(`nav.${key}`)}
              </Link>
            ))}
            <button
              type="button"
              onClick={() => setLanguage(other)}
              aria-label={t("actions.changeLanguage")}
              className="grid size-11 place-items-center rounded-lg text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {t(`language.${other}`)}
            </button>
            <Link
              to="/portal/profile"
              aria-label={t("nav.profile")}
              title={t("nav.profile")}
              className={cn(
                "grid size-11 place-items-center rounded-lg",
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
      {/* Padded for the iPhone home indicator; detail pages keep their tab lit. */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-2 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
        {tenantItems.map(([key, path, Icon]) => {
          const active = isActive(pathname, path);
          return (
            <Link
              key={path}
              to={path}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-16 min-w-0 flex-col items-center justify-center gap-1 px-1 text-xs",
                active ? "font-semibold text-primary" : "font-medium text-muted-foreground",
              )}
            >
              <Icon className="size-5 shrink-0" strokeWidth={active ? 2.5 : 2} />
              <span className="max-w-full text-center leading-tight">{t(`nav.${key}`)}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/**
 * The browser tab says "Inicio — Truman Properties", not "— Rentio". Route
 * heads set the title with the vendor suffix; this swaps it for the
 * landlord's name whenever the title changes (research §5: tenants see
 * their landlord, not the software).
 */
function useCompanyTabTitle() {
  const name = usePublicSettings().data?.company_name;
  useEffect(() => {
    if (!name) return;
    const suffix = ` — ${BRAND_NAME}`;
    const fix = () => {
      if (document.title.endsWith(suffix))
        document.title = document.title.slice(0, -suffix.length) + ` — ${name}`;
    };
    fix();
    const title = document.querySelector("title");
    if (!title) return;
    const observer = new MutationObserver(fix);
    observer.observe(title, { childList: true });
    return () => observer.disconnect();
  }, [name]);
}

/** The landlord's logo and name; Rentio's mark only when the company has set neither. */
function CompanyMark() {
  const { t } = useTranslation();
  const settings = usePublicSettings();
  const name = settings.data?.company_name;
  const logoPath = settings.data?.logo_url;
  // Logos are private files (company/logo/…); tenants may sign that path only.
  const logo = useQuery({
    queryKey: ["company-logo", logoPath],
    enabled: Boolean(logoPath),
    staleTime: 5 * 60 * 1000,
    queryFn: () => signedUrl("company", logoPath as string, 60 * 60),
  });

  if (!name && !logo.data) return <RentioMark subtitle={t("brand.tenant")} />;
  return (
    <div className="flex min-w-0 items-center gap-3">
      {logo.data ? (
        <img src={logo.data} alt="" className="size-9 shrink-0 rounded-lg object-contain" />
      ) : null}
      <div className="min-w-0">
        <div className="truncate font-semibold">{name}</div>
        <div className="truncate text-xs text-muted-foreground">{t("brand.tenant")}</div>
      </div>
    </div>
  );
}
