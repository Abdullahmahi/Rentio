import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/rentio/empty-state";
import { cn } from "@/lib/utils";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  sortValue?: ((row: T) => string | number) | undefined;
  numeric?: boolean | undefined;
  className?: string | undefined;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  getRowId: (row: T) => string;
  searchValue?: ((row: T) => string) | undefined;
  onRowClick?: ((row: T) => void) | undefined;
  loading?: boolean | undefined;
  pageSize?: number | undefined;
  emptyMessage?: string | undefined;
  /** Row ids currently ticked. Passing this turns on the checkbox column. */
  selectedIds?: string[] | undefined;
  onSelectionChange?: ((ids: string[]) => void) | undefined;
  /** Rows that may not be ticked (e.g. an invoice that is already sent). */
  isSelectable?: ((row: T) => boolean) | undefined;
  /** Bar rendered above the table while at least one row is ticked. */
  bulkActions?: ReactNode | undefined;
}

type SortDirection = "asc" | "desc";

export function DataTable<T>({
  columns, data, getRowId, searchValue, onRowClick, loading = false, pageSize = 10, emptyMessage,
  selectedIds, onSelectionChange, isSelectable, bulkActions,
}: DataTableProps<T>) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ key: string; direction: SortDirection } | null>(null);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const rows = normalizedQuery && searchValue
      ? data.filter((row) => searchValue(row).toLocaleLowerCase().includes(normalizedQuery))
      : [...data];
    if (!sort) return rows;
    const column = columns.find((item) => item.key === sort.key);
    if (!column?.sortValue) return rows;
    return rows.sort((a, b) => {
      const aValue = column.sortValue?.(a) ?? "";
      const bValue = column.sortValue?.(b) ?? "";
      const result = typeof aValue === "number" && typeof bValue === "number"
        ? aValue - bValue
        : String(aValue).localeCompare(String(bValue));
      return sort.direction === "asc" ? result : -result;
    });
  }, [columns, data, query, searchValue, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const rows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const selectable = Boolean(selectedIds && onSelectionChange);
  const selected = new Set(selectedIds ?? []);
  const eligible = rows.filter((row) => isSelectable?.(row) ?? true);
  const allOnPageSelected = eligible.length > 0 && eligible.every((row) => selected.has(getRowId(row)));

  const toggleRow = (row: T) => {
    const id = getRowId(row);
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onSelectionChange?.([...next]);
  };

  const togglePage = () => {
    const next = new Set(selected);
    for (const row of eligible) {
      const id = getRowId(row);
      if (allOnPageSelected) next.delete(id); else next.add(id);
    }
    onSelectionChange?.([...next]);
  };

  const toggleSort = (column: DataTableColumn<T>) => {
    if (!column.sortValue) return;
    setSort((current) => current?.key === column.key
      ? { key: column.key, direction: current.direction === "asc" ? "desc" : "asc" }
      : { key: column.key, direction: "asc" });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label={t("table.search")} className="pl-9" placeholder={t("table.search")} value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
        </div>
        {selectable && selected.size > 0 ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-muted-foreground">{t("table.selected", { count: selected.size })}</span>
            {bulkActions}
          </div>
        ) : null}
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-subtle">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-muted/70 text-left text-xs font-semibold text-muted-foreground">
              <tr>
                {selectable ? (
                  <th className="h-10 w-10 border-b border-border px-4">
                    <Checkbox
                      checked={allOnPageSelected}
                      onCheckedChange={togglePage}
                      aria-label={t("table.selectAll")}
                    />
                  </th>
                ) : null}
                {columns.map((column) => {
                  const active = sort?.key === column.key;
                  const Icon = active ? (sort.direction === "asc" ? ArrowUp : ArrowDown) : ChevronsUpDown;
                  return (
                    <th key={column.key} className={cn("h-10 whitespace-nowrap border-b border-border px-4", column.numeric && "numeric text-right", column.className)}>
                      {column.sortValue ? (
                        <button className={cn("inline-flex items-center gap-1.5 font-semibold", column.numeric && "ml-auto")} onClick={() => toggleSort(column)} title={t(active && sort.direction === "asc" ? "table.sortDescending" : "table.sortAscending")}>
                          {column.header}<Icon className="size-3.5" />
                        </button>
                      ) : column.header}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {loading ? Array.from({ length: 5 }).map((_, rowIndex) => (
                <tr key={rowIndex} className="h-10 border-b border-border last:border-b-0">
                  {selectable ? <td className="px-4"><Skeleton className="h-4 w-4" /></td> : null}
                  {columns.map((column) => <td key={column.key} className="px-4"><Skeleton className="h-4 w-24" /></td>)}
                </tr>
              )) : rows.map((row) => (
                <tr key={getRowId(row)} onClick={() => onRowClick?.(row)} className={cn("h-10 border-b border-border last:border-b-0", onRowClick && "cursor-pointer hover:bg-muted/60", selected.has(getRowId(row)) && "bg-primary/5")}>
                  {selectable ? (
                    <td className="px-4" onClick={(event) => event.stopPropagation()}>
                      <Checkbox
                        checked={selected.has(getRowId(row))}
                        disabled={!(isSelectable?.(row) ?? true)}
                        onCheckedChange={() => toggleRow(row)}
                        aria-label={t("table.selectRow")}
                      />
                    </td>
                  ) : null}
                  {columns.map((column) => <td key={column.key} className={cn("whitespace-nowrap px-4", column.numeric && "numeric text-right", column.className)}>{column.cell(row)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && rows.length === 0 ? <EmptyState message={emptyMessage ?? t("empty.table")} description={t("empty.tableDescription")} /> : null}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-sm text-muted-foreground">
        <span className="min-w-0 truncate">{t("table.page", { current: safePage, total: totalPages })}</span>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" disabled={safePage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>{t("table.previous")}</Button>
          <Button variant="outline" size="sm" disabled={safePage >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>{t("table.next")}</Button>
        </div>
      </div>
    </div>
  );
}
