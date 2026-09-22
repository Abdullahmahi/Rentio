import { useEffect, useState } from "react";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Menu, Moon, Search, Sun, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { INTERNAL_DEFAULT_LANGUAGE } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { useLanguagePreference } from "@/lib/queries";
import { CommandPalette } from "@/components/rentio/command-palette";
import { RentioMark } from "@/components/rentio/rentio-mark";
import { dashboardItem, navGroups, navItems } from "@/components/rentio/nav-items";
import { cn } from "@/lib/utils";

const THEME_STORAGE_KEY = "rentio-theme";

export function AppShell() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { profile, role, signOut } = useAuth();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    const shouldUseDark = stored === "dark";
    setDark(shouldUseDark);
    document.documentElement.classList.toggle("dark", shouldUseDark);
  }, []);

  const { setLanguage } = useLanguagePreference(INTERNAL_DEFAULT_LANGUAGE);

  const toggleTheme = () => {
    setDark((current) => {
      const next = !current;
      document.documentElement.classList.toggle("dark", next);
      window.localStorage.setItem(THEME_STORAGE_KEY, next ? "dark" : "light");
      return next;
    });
  };

  const displayName = profile?.full_name?.trim() || t("user.fallbackName");
  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toLocaleUpperCase())
    .join("");

  const handleSignOut = async () => {
    await signOut();
    void navigate({ to: "/sign-in", replace: true });
  };

  // Exact match first, then longest prefix, so /app/units/$id still titles the
  // header "Units" rather than falling through to "Dashboard".
  const currentKey =
    navItems.find(([, path]) => path === pathname)?.[0] ??
    navItems
      .filter(([, path]) => path !== "/app" && pathname.startsWith(`${path}/`))
      .sort((a, b) => b[1].length - a[1].length)[0]?.[0] ??
    "dashboard";

  const navLink = ([key, path, Icon]: (typeof navItems)[number]) => {
    const active = pathname === path;
    return (
      <Link
        key={path}
        to={path}
        title={collapsed ? t(`nav.${key}`) : undefined}
        onClick={() => setMobileOpen(false)}
        className={cn(
          "flex h-9 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
          active
            ? "bg-sidebar-primary text-sidebar-primary-foreground"
            : "text-sidebar-foreground hover:bg-sidebar-accent",
          collapsed && "justify-center px-0",
        )}
      >
        <Icon className="size-4 shrink-0" />
        {collapsed ? null : <span className="truncate">{t(`nav.${key}`)}</span>}
      </Link>
    );
  };

  const sidebar = (
    <aside
      className={cn(
        "flex h-full flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200",
        collapsed ? "w-16" : "w-60",
      )}
    >
      <div className="flex h-16 items-center border-b border-sidebar-border px-3">
        <RentioMark compact={collapsed} />
      </div>
      <nav className="flex-1 overflow-y-auto p-2">
        {navLink(dashboardItem)}
        {navGroups.map((group) => (
          <div key={group.label} className={cn(collapsed ? "mt-2 space-y-1" : "mt-4 space-y-1")}>
            {collapsed ? (
              <div className="mx-2 mb-2 border-t border-sidebar-border" />
            ) : (
              <div className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t(`nav.groups.${group.label}`)}
              </div>
            )}
            {group.items.map(navLink)}
          </div>
        ))}
      </nav>
      <div className="border-t border-sidebar-border p-2">
        <Button
          variant="ghost"
          className={cn("w-full", collapsed ? "px-0" : "justify-start")}
          onClick={() => setCollapsed((value) => !value)}
          aria-label={t(collapsed ? "actions.expand" : "actions.collapse")}
          title={t(collapsed ? "actions.expand" : "actions.collapse")}
        >
          {collapsed ? (
            <ChevronRight />
          ) : (
            <>
              <ChevronLeft />
              <span>{t("actions.collapse")}</span>
            </>
          )}
        </Button>
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="fixed inset-y-0 left-0 z-40 hidden lg:block">{sidebar}</div>
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            className="absolute inset-0 bg-overlay"
            onClick={() => setMobileOpen(false)}
            aria-label={t("actions.collapse")}
          />
          <div className="relative h-full w-60">
            {sidebar}
            <Button
              size="icon"
              variant="ghost"
              className="absolute right-2 top-3"
              onClick={() => setMobileOpen(false)}
            >
              <X />
            </Button>
          </div>
        </div>
      ) : null}
      <div className={cn("transition-[padding] duration-200", collapsed ? "lg:pl-16" : "lg:pl-60")}>
        <header className="sticky top-0 z-30 grid h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b md:grid-cols-[minmax(0,1fr)_auto_auto] border-border bg-surface px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              size="icon"
              variant="ghost"
              className="shrink-0 lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label={t("actions.expand")}
            >
              <Menu />
            </Button>
            <h2 className="truncate text-base font-semibold">{t(`pages.${currentKey}.title`)}</h2>
          </div>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="hidden h-9 min-w-56 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm text-muted-foreground transition-colors hover:bg-muted md:flex"
          >
            <Search className="size-4 shrink-0" />
            <span className="truncate">{t("palette.trigger")}</span>
            <kbd className="ml-auto rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-medium">
              {t("palette.shortcut")}
            </kbd>
          </button>
          <div className="flex shrink-0 items-center gap-1">
            <div
              className="flex rounded-lg border border-border p-0.5"
              aria-label={t("actions.changeLanguage")}
            >
              {(["es-MX", "en"] as const).map((language) => (
                <button
                  key={language}
                  className={cn(
                    "h-7 rounded-md px-2 text-xs font-semibold",
                    i18n.language === language
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                  onClick={() => setLanguage(language)}
                >
                  {t(`language.${language}`)}
                </button>
              ))}
            </div>
            <Button
              size="icon"
              variant="ghost"
              onClick={toggleTheme}
              aria-label={t("actions.changeTheme")}
              title={t(dark ? "theme.light" : "theme.dark")}
            >
              {dark ? <Sun /> : <Moon />}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" aria-label={t("actions.openUserMenu")}>
                  <Avatar className="size-8">
                    <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="truncate">{displayName}</div>
                  {role ? (
                    <span className="mt-1 inline-flex h-5 items-center rounded-full border border-border bg-muted px-2 text-[11px] font-medium text-muted-foreground">
                      {t(`roles.${role}`)}
                    </span>
                  ) : null}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/app/settings">{t("user.myProfile")}</Link>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    void handleSignOut();
                  }}
                >
                  {t("actions.signOut")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="mx-auto max-w-[1600px] p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onToggleTheme={toggleTheme}
        onToggleLanguage={() => setLanguage(i18n.language === "en" ? "es-MX" : "en")}
      />
    </div>
  );
}
