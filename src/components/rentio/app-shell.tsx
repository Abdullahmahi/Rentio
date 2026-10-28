import { useEffect, useState } from "react";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { Languages, Moon, Search, Settings, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { INTERNAL_DEFAULT_LANGUAGE } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { useLanguagePreference } from "@/lib/queries";
import { CommandPalette } from "@/components/rentio/command-palette";
import { OrgSwitcher } from "@/components/rentio/org-switcher";
import { RentioMark } from "@/components/rentio/rentio-mark";
import { dashboardItem, navGroups, type NavItem } from "@/components/rentio/nav-items";

const THEME_STORAGE_KEY = "rentio-theme";

/** /app/units and /app/units/<id> both light up Units; /app lights up only itself. */
function isActive(pathname: string, path: string) {
  return path === "/app"
    ? pathname === "/app"
    : pathname === path || pathname.startsWith(`${path}/`);
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const { t } = useTranslation();
  const { setOpenMobile } = useSidebar();
  const [key, path, Icon] = item;
  const active = isActive(pathname, path);
  return (
    <SidebarMenuItem>
      {/* Quiet active state: a muted fill and a primary icon, not a solid slab. */}
      <SidebarMenuButton
        asChild
        isActive={active}
        tooltip={t(`nav.${key}`)}
        className="data-[active=true]:bg-sidebar-accent data-[active=true]:font-semibold [&[data-active=true]>svg]:text-primary"
      >
        <Link
          to={path}
          aria-current={active ? "page" : undefined}
          onClick={() => setOpenMobile(false)}
        >
          <Icon />
          <span>{t(`nav.${key}`)}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function AppShell() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { profile, role, signOut, isSuperAdmin } = useAuth();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [dark, setDark] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    const shouldUseDark = stored === "dark";
    setDark(shouldUseDark);
    document.documentElement.classList.toggle("dark", shouldUseDark);
  }, []);

  const { setLanguage } = useLanguagePreference(INTERNAL_DEFAULT_LANGUAGE);
  const toggleLanguage = () => setLanguage(i18n.language === "en" ? "es-MX" : "en");

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

  // The breadcrumb names the section; the page's own h1 is the only title.
  // On a detail page (/app/units/<id>) the section links back to its list.
  const [, , segment, detail] = pathname.split("/");
  const sectionKey = segment && i18n.exists(`pages.${segment}.title`) ? segment : "dashboard";
  const sectionPath = segment ? `/app/${segment}` : "/app";

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader className="gap-3 border-b border-sidebar-border">
          <div className="flex h-10 items-center px-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
            <RentioMark />
          </div>
          {isSuperAdmin ? (
            <div className="space-y-1 group-data-[collapsible=icon]:hidden">
              <span className="px-1 text-xs font-medium text-muted-foreground">
                {t("orgSwitcher.label")}
              </span>
              <OrgSwitcher className="h-8 w-full" />
            </div>
          ) : null}
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <NavLink item={dashboardItem} pathname={pathname} />
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          {navGroups.map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{t(`nav.groups.${group.label}`)}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => (
                    <NavLink key={item[1]} item={item} pathname={pathname} />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarFooter className="border-t border-sidebar-border">
          <SidebarMenu>
            <NavLink item={["settings", "/app/settings", Settings]} pathname={pathname} />
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="min-w-0 bg-background">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-surface/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-surface/80 sm:px-6">
          <SidebarTrigger className="-ml-1" aria-label={t("actions.expand")} />
          <Separator orientation="vertical" className="mr-1 h-4" />
          <Breadcrumb className="min-w-0 flex-1">
            <BreadcrumbList>
              <BreadcrumbItem className="min-w-0">
                {detail ? (
                  <BreadcrumbLink asChild>
                    <Link to={sectionPath} className="truncate">
                      {t(`pages.${sectionKey}.title`)}
                    </Link>
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage className="truncate">
                    {t(`pages.${sectionKey}.title`)}
                  </BreadcrumbPage>
                )}
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>

          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="hidden h-8 min-w-56 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm text-muted-foreground transition-colors hover:bg-muted md:flex"
          >
            <Search className="size-4 shrink-0" />
            <span className="truncate">{t("palette.trigger")}</span>
            <kbd className="ml-auto rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-medium">
              {t("palette.shortcut")}
            </kbd>
          </button>
          <Button
            size="icon"
            variant="ghost"
            className="md:hidden"
            onClick={() => setPaletteOpen(true)}
            aria-label={t("palette.trigger")}
          >
            <Search />
          </Button>
          {/* A visible language pill on phones, where the avatar menu is one tap too deep. */}
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2 text-xs font-semibold md:hidden"
            onClick={toggleLanguage}
            aria-label={t("actions.changeLanguage")}
          >
            {t(`language.${i18n.language === "en" ? "es-MX" : "en"}`)}
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
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel>
                <div className="truncate">{displayName}</div>
                {role ? (
                  <div className="mt-0.5 text-xs font-normal text-muted-foreground">
                    {t(`roles.${role}`)}
                  </div>
                ) : null}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={toggleLanguage}>
                <Languages />
                {t("actions.changeLanguage")}
                <span className="ml-auto text-xs text-muted-foreground">
                  {t(`language.${i18n.language === "en" ? "en" : "es-MX"}`)}
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={toggleTheme}>
                {dark ? <Sun /> : <Moon />}
                {t(dark ? "theme.light" : "theme.dark")}
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/app/settings">
                  <Settings />
                  {t("nav.settings")}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  void handleSignOut();
                }}
              >
                {t("actions.signOut")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        {isSuperAdmin && !profile?.org_id ? (
          <div className="border-b border-border bg-muted/40 px-4 py-2 text-sm text-muted-foreground sm:px-6">
            {t("orgSwitcher.hint")}
          </div>
        ) : null}
        <main className="mx-auto w-full max-w-[1600px] p-4 sm:p-6">
          <Outlet />
        </main>
      </SidebarInset>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onToggleTheme={toggleTheme}
        onToggleLanguage={toggleLanguage}
      />
    </SidebarProvider>
  );
}
