import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  DoorClosed,
  FileText,
  Languages,
  MoonStar,
  ReceiptText,
  Search,
  Users,
  WalletCards,
  Wrench,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { EmptyState } from "@/components/rentio/empty-state";
import { navItems } from "@/components/rentio/nav-items";
import { usePortfolio } from "@/lib/queries";
import { leaseContexts, unitContexts } from "@/lib/portfolio";

/** Per group. The palette is a shortcut, not a search results page. */
const MAX_ROWS = 5;

/** Accent- and case-insensitive, so "jose" finds "José". */
function fold(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase();
}

interface Row {
  id: string;
  label: string;
  hint?: string;
  onSelect: () => void;
}

/**
 * cmdk still owns matching and ranking — this only decides which rows are
 * worth handing it, so a 120-unit portfolio does not render 120 hidden nodes
 * to cap at five.
 */
function capRows(rows: Row[], search: string) {
  const query = fold(search.trim());
  const matched = query
    ? rows.filter((row) => fold(`${row.label} ${row.hint ?? ""}`).includes(query))
    : rows;
  return { shown: matched.slice(0, MAX_ROWS), total: matched.length };
}

export function CommandPalette({
  open,
  onOpenChange,
  onToggleTheme,
  onToggleLanguage,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onToggleTheme: () => void;
  onToggleLanguage: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const portfolio = usePortfolio();
  const [search, setSearch] = useState("");

  // Cmd+K on macOS, Ctrl+K elsewhere. The sidebar's own shortcut is "b", so
  // there is no collision.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      onOpenChange(!open);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  const close = () => {
    onOpenChange(false);
    setSearch("");
  };

  const run = (action: () => void) => () => {
    close();
    action();
  };

  const data = portfolio.data;

  const navigationRows: Row[] = useMemo(
    () =>
      navItems.map(([key, path]) => ({
        id: `nav-${key}`,
        label: t(`nav.${key}`),
        onSelect: () => void navigate({ to: path }),
      })),
    [navigate, t],
  );

  const unitRows: Row[] = useMemo(() => {
    if (!data) return [];
    return unitContexts(data).map(({ unit, property }) => ({
      id: `unit-${unit.id}`,
      label: unit.unit_number,
      hint: property?.name ?? "",
      onSelect: () => void navigate({ to: "/app/units/$id", params: { id: unit.id } }),
    }));
  }, [data, navigate]);

  const tenantRows: Row[] = useMemo(() => {
    if (!data) return [];
    return data.tenants.map((tenant) => ({
      id: `tenant-${tenant.id}`,
      label: tenant.full_name,
      onSelect: () => void navigate({ to: "/app/tenants/$id", params: { id: tenant.id } }),
    }));
  }, [data, navigate]);

  const contractRows: Row[] = useMemo(() => {
    if (!data) return [];
    return leaseContexts(data).map((context) => ({
      id: `contract-${context.lease.id}`,
      label: context.unit?.unit_number ?? t("receipts.untitled"),
      hint: context.primaryTenant?.full_name ?? "",
      onSelect: () => void navigate({ to: "/app/contracts/$id", params: { id: context.lease.id } }),
    }));
  }, [data, navigate, t]);

  const actionRows: Row[] = useMemo(
    () => [
      {
        id: "action-generate",
        label: t("palette.actions.generateReceipts"),
        onSelect: () => void navigate({ to: "/app/receipts" }),
      },
      {
        id: "action-payment",
        label: t("palette.actions.recordPayment"),
        onSelect: () => void navigate({ to: "/app/payments", search: { new: true } }),
      },
      {
        id: "action-workorder",
        label: t("palette.actions.newWorkOrder"),
        onSelect: () => void navigate({ to: "/app/maintenance", search: { new: true } }),
      },
      {
        id: "action-language",
        label: t("palette.actions.toggleLanguage"),
        onSelect: onToggleLanguage,
      },
      { id: "action-theme", label: t("palette.actions.toggleTheme"), onSelect: onToggleTheme },
    ],
    [navigate, onToggleLanguage, onToggleTheme, t],
  );

  const groups = [
    { key: "navigation", icon: Search, rows: capRows(navigationRows, search) },
    { key: "units", icon: DoorClosed, rows: capRows(unitRows, search) },
    { key: "tenants", icon: Users, rows: capRows(tenantRows, search) },
    { key: "contracts", icon: FileText, rows: capRows(contractRows, search) },
    { key: "actions", icon: WalletCards, rows: capRows(actionRows, search) },
  ];

  const actionIcons: Record<string, typeof Search> = {
    "action-generate": ReceiptText,
    "action-payment": WalletCards,
    "action-workorder": Wrench,
    "action-language": Languages,
    "action-theme": MoonStar,
  };

  const nothing = groups.every((group) => group.rows.shown.length === 0);

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setSearch("");
      }}
    >
      <CommandInput
        placeholder={t("palette.placeholder")}
        value={search}
        onValueChange={setSearch}
      />
      <CommandList className="max-h-[60vh]">
        {nothing ? (
          <CommandEmpty className="py-0">
            <EmptyState icon={Search} message={t("palette.emptyTitle")} />
          </CommandEmpty>
        ) : null}
        {groups.map(({ key, icon: GroupIcon, rows }) =>
          rows.shown.length === 0 ? null : (
            <CommandGroup
              key={key}
              heading={
                <span className="flex items-center justify-between gap-2">
                  <span>{t(`palette.groups.${key}`)}</span>
                  {rows.total > rows.shown.length ? (
                    <span className="numeric text-[11px] font-normal tabular-nums">
                      {t("palette.showingOf", { shown: rows.shown.length, total: rows.total })}
                    </span>
                  ) : null}
                </span>
              }
            >
              {rows.shown.map((row) => {
                const Icon = actionIcons[row.id] ?? GroupIcon;
                return (
                  <CommandItem
                    key={row.id}
                    value={`${row.label} ${row.hint ?? ""}`}
                    onSelect={run(row.onSelect)}
                    // shadcn's default selected state is bg-accent, which in
                    // this design system is the terracotta brand accent —
                    // white on it measures 3.7:1. Match the sidebar's active
                    // item instead.
                    className="data-[selected=true]:bg-primary/10 data-[selected=true]:text-foreground"
                  >
                    <Icon className="mr-2 size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{row.label}</span>
                    {row.hint ? (
                      <span className="ml-2 truncate text-xs text-muted-foreground">
                        {row.hint}
                      </span>
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ),
        )}
      </CommandList>
    </CommandDialog>
  );
}
