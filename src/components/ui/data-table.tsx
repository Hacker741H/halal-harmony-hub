import * as React from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type SortDirection = "asc" | "desc" | null;
export type DataTableDensity = "compact" | "comfortable" | "relaxed";

export interface DataTableColumn<TData> {
  id: string;
  header:
    | React.ReactNode
    | ((context: { column: DataTableColumn<TData>; sortDirection: SortDirection }) => React.ReactNode);
  cell: (row: TData) => React.ReactNode;
  sortValue?: (row: TData) => string | number | Date | null | undefined;
  className?: string;
  hideOnMobile?: boolean;
}

export interface DataTableProps<TData> {
  data: readonly TData[];
  columns: readonly DataTableColumn<TData>[];
  getRowId: (row: TData) => string;
  getRowSearchText?: (row: TData) => string;
  onRowClick?: (row: TData) => void;
  onSelectionChange?: (rowIds: string[]) => void;
  emptyState?: React.ReactNode;
  toolbar?: React.ReactNode;
  pageSize?: number;
  searchable?: boolean;
  searchPlaceholder?: string;
  selectable?: boolean;
  density?: DataTableDensity;
  className?: string;
}

function compareValues(
  left: string | number | Date | null | undefined,
  right: string | number | Date | null | undefined,
): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;

  const normalizedLeft = left instanceof Date ? left.getTime() : left;
  const normalizedRight = right instanceof Date ? right.getTime() : right;

  if (typeof normalizedLeft === "number" && typeof normalizedRight === "number") {
    return normalizedLeft - normalizedRight;
  }

  return String(normalizedLeft).localeCompare(String(normalizedRight), "fr", {
    numeric: true,
    sensitivity: "base",
  });
}

function DataTable<TData>({
  data,
  columns,
  getRowId,
  getRowSearchText,
  onRowClick,
  onSelectionChange,
  emptyState = "Aucune donnée à afficher.",
  toolbar,
  pageSize = 10,
  searchable = true,
  searchPlaceholder = "Rechercher…",
  selectable = false,
  density = "comfortable",
  className,
}: DataTableProps<TData>) {
  const [query, setQuery] = React.useState("");
  const [page, setPage] = React.useState(0);
  const [sort, setSort] = React.useState<{ columnId: string; direction: Exclude<SortDirection, null> } | null>(null);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(() => new Set());

  const filteredRows = React.useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("fr");
    if (!normalizedQuery || !getRowSearchText) return [...data];

    return data.filter((row) =>
      getRowSearchText(row).toLocaleLowerCase("fr").includes(normalizedQuery),
    );
  }, [data, getRowSearchText, query]);

  const sortedRows = React.useMemo(() => {
    if (!sort) return filteredRows;

    const column = columns.find((candidate) => candidate.id === sort.columnId);
    if (!column?.sortValue) return filteredRows;

    return [...filteredRows].sort((left, right) => {
      const comparison = compareValues(column.sortValue?.(left), column.sortValue?.(right));
      return sort.direction === "asc" ? comparison : -comparison;
    });
  }, [columns, filteredRows, sort]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const currentPage = Math.min(page, totalPages - 1);
  const pageRows = sortedRows.slice(currentPage * pageSize, currentPage * pageSize + pageSize);
  const pageRowIds = pageRows.map(getRowId);
  const selectedOnPage = pageRowIds.filter((id) => selectedIds.has(id)).length;
  const allRowsOnPageSelected = pageRowIds.length > 0 && selectedOnPage === pageRowIds.length;
  const someRowsOnPageSelected = selectedOnPage > 0 && !allRowsOnPageSelected;
  const rangeStart = sortedRows.length === 0 ? 0 : currentPage * pageSize + 1;
  const rangeEnd = Math.min((currentPage + 1) * pageSize, sortedRows.length);

  const densityClasses: Record<DataTableDensity, { head: string; cell: string }> = {
    compact: { head: "h-9", cell: "py-2" },
    comfortable: { head: "h-11", cell: "py-3" },
    relaxed: { head: "h-12", cell: "py-4" },
  };

  const commitSelection = React.useCallback(
    (nextSelection: Set<string>) => {
      setSelectedIds(nextSelection);
      onSelectionChange?.([...nextSelection]);
    },
    [onSelectionChange],
  );

  const toggleSort = (column: DataTableColumn<TData>) => {
    if (!column.sortValue) return;

    setPage(0);
    setSort((current) => {
      if (current?.columnId !== column.id) return { columnId: column.id, direction: "asc" };
      if (current.direction === "asc") return { columnId: column.id, direction: "desc" };
      return null;
    });
  };

  const toggleRow = (rowId: string, checked: boolean) => {
    const nextSelection = new Set(selectedIds);
    if (checked) nextSelection.add(rowId);
    else nextSelection.delete(rowId);
    commitSelection(nextSelection);
  };

  const toggleCurrentPage = (checked: boolean) => {
    const nextSelection = new Set(selectedIds);
    pageRowIds.forEach((id) => {
      if (checked) nextSelection.add(id);
      else nextSelection.delete(id);
    });
    commitSelection(nextSelection);
  };

  return (
    <section className={cn("overflow-hidden rounded-xl border border-border/80 bg-surface/95 shadow-xs", className)}>
      {(searchable || toolbar) && (
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
          {searchable ? (
            <label className="relative block w-full sm:max-w-sm">
              <span className="sr-only">{searchPlaceholder}</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(0);
                }}
                className="pl-9"
                placeholder={searchPlaceholder}
              />
            </label>
          ) : (
            <span />
          )}
          {toolbar ? <div className="flex shrink-0 items-center gap-2">{toolbar}</div> : null}
        </div>
      )}

      <div className="relative max-h-[min(60vh,42rem)] overflow-auto">
        <table className="w-full min-w-[42rem] text-left text-sm">
          <thead className="sticky top-0 z-10 border-b border-border/80 bg-surface-elevated/95 text-muted-foreground backdrop-blur-sm">
            <tr className="border-b">
              {selectable ? (
                <th className={cn("w-11 px-3", densityClasses[density].head)} scope="col">
                  <Checkbox
                    checked={someRowsOnPageSelected ? "indeterminate" : allRowsOnPageSelected}
                    onCheckedChange={(checked) => toggleCurrentPage(checked === true)}
                    aria-label="Sélectionner les lignes de cette page"
                  />
                </th>
              ) : null}
              {columns.map((column) => {
                const activeSortDirection = sort?.columnId === column.id ? sort.direction : null;
                const header = typeof column.header === "function"
                  ? column.header({ column, sortDirection: activeSortDirection })
                  : column.header;

                return (
                  <th
                    key={column.id}
                    scope="col"
                    aria-sort={
                      activeSortDirection === "asc"
                        ? "ascending"
                        : activeSortDirection === "desc"
                          ? "descending"
                          : "none"
                    }
                    className={cn(
                      "px-3 text-label text-muted-foreground",
                      densityClasses[density].head,
                      column.hideOnMobile && "hidden md:table-cell",
                      column.className,
                    )}
                  >
                    {column.sortValue ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="-ml-3 h-8 gap-1.5 px-3 text-label text-muted-foreground hover:text-foreground"
                        onClick={() => toggleSort(column)}
                      >
                        {header}
                        {activeSortDirection === "asc" ? <ArrowUp aria-hidden="true" /> : null}
                        {activeSortDirection === "desc" ? <ArrowDown aria-hidden="true" /> : null}
                      </Button>
                    ) : header}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (selectable ? 1 : 0)}
                  className="px-4 py-12 text-center text-sm text-muted-foreground"
                >
                  {emptyState}
                </td>
              </tr>
            ) : (
              pageRows.map((row) => {
                const rowId = getRowId(row);
                const isSelected = selectedIds.has(rowId);

                return (
                  <tr
                    key={rowId}
                    data-state={isSelected ? "selected" : undefined}
                    className={cn(
                      "border-b border-border/65 transition-[background-color] transition-ui-fast hover:bg-surface-hover/60 data-[state=selected]:bg-primary/5",
                      onRowClick && "cursor-pointer",
                    )}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {selectable ? (
                      <td className={cn("w-11 px-3", densityClasses[density].cell)} onClick={(event) => event.stopPropagation()}>
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={(checked) => toggleRow(rowId, checked === true)}
                          aria-label="Sélectionner cette ligne"
                        />
                      </td>
                    ) : null}
                    {columns.map((column) => (
                      <td
                        key={column.id}
                        className={cn(
                          "px-3 align-middle",
                          densityClasses[density].cell,
                          column.hideOnMobile && "hidden md:table-cell",
                          column.className,
                        )}
                      >
                        {column.cell(row)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <footer className="flex flex-col gap-3 border-t px-4 py-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>
          {rangeStart}–{rangeEnd} sur {sortedRows.length}
          {selectedIds.size > 0 ? ` · ${selectedIds.size} sélectionnée(s)` : ""}
        </p>
        <div className="flex items-center gap-2 self-end sm:self-auto">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={() => setPage((current) => Math.max(0, current - 1))}
            disabled={currentPage === 0}
            aria-label="Page précédente"
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <span className="min-w-20 text-center text-caption">Page {currentPage + 1} / {totalPages}</span>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))}
            disabled={currentPage >= totalPages - 1}
            aria-label="Page suivante"
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </footer>
    </section>
  );
}

export { DataTable };
