"use client";

import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type PaginationState,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { Columns3, MoreHorizontal } from "lucide-react";
import * as React from "react";
import { cn } from "../lib/cn";
import { Button } from "./button";
import { Checkbox } from "./choice";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { EmptyState, type EmptyStateProps } from "./empty-state";
import { Skeleton } from "./feedback";
import { Pagination } from "./pagination";
import { SortableHeader, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table";

export type { ColumnDef, SortingState, PaginationState };

export interface RowAction<T> {
  label: string;
  icon?: React.ReactNode;
  onSelect: (row: T) => void;
  destructive?: boolean;
  hidden?: (row: T) => boolean;
  separatorBefore?: boolean;
}

export interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  loading?: boolean;
  /** Server-side pagination: provide total + page state. Omit for client-side pagination. */
  total?: number;
  pagination?: PaginationState;
  onPaginationChange?: OnChangeFn<PaginationState>;
  /** Server-side sorting: provide state + handler and set `manualSorting`. */
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
  manualSorting?: boolean;
  rowActions?: RowAction<T>[];
  enableSelection?: boolean;
  onSelectionChange?: (rows: T[]) => void;
  getRowId?: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  empty?: Partial<EmptyStateProps>;
  toolbar?: React.ReactNode;
  /** Show the column visibility menu. */
  columnToggle?: boolean;
  className?: string;
  pageSize?: number;
  "aria-label"?: string;
}

/**
 * DataTable on TanStack Table: sorting, pagination (client or server), row selection, row actions,
 * column visibility, loading skeleton and empty state.
 *
 * Column `meta` options: `{ headerClassName?, cellClassName?, label? }` (label used in the column menu).
 */
export function DataTable<T>({
  columns,
  data,
  loading,
  total,
  pagination: controlledPagination,
  onPaginationChange,
  sorting: controlledSorting,
  onSortingChange,
  manualSorting,
  rowActions,
  enableSelection,
  onSelectionChange,
  getRowId,
  onRowClick,
  empty,
  toolbar,
  columnToggle = true,
  className,
  pageSize = 10,
  "aria-label": ariaLabel,
}: DataTableProps<T>) {
  const [localSorting, setLocalSorting] = React.useState<SortingState>([]);
  const [localPagination, setLocalPagination] = React.useState<PaginationState>({ pageIndex: 0, pageSize });
  const [visibility, setVisibility] = React.useState<VisibilityState>({});
  const [selection, setSelection] = React.useState<RowSelectionState>({});
  const manualPagination = total !== undefined;

  const allColumns = React.useMemo(() => {
    const cols: ColumnDef<T, unknown>[] = [];
    if (enableSelection) {
      cols.push({
        id: "__select",
        enableSorting: false,
        enableHiding: false,
        header: ({ table }) => (
          <Checkbox
            aria-label="Select all rows"
            checked={table.getIsAllPageRowsSelected() ? true : table.getIsSomePageRowsSelected() ? "indeterminate" : false}
            onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            aria-label="Select row"
            checked={row.getIsSelected()}
            onCheckedChange={(v) => row.toggleSelected(!!v)}
            onClick={(e) => e.stopPropagation()}
          />
        ),
      });
    }
    cols.push(...columns);
    if (rowActions?.length) {
      cols.push({
        id: "__actions",
        enableSorting: false,
        enableHiding: false,
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => {
          const visible = rowActions.filter((a) => !a.hidden?.(row.original));
          if (!visible.length) return null;
          return (
            <div className="flex justify-end">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="Row actions" onClick={(e) => e.stopPropagation()}>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                  {visible.map((a, i) => (
                    <React.Fragment key={a.label}>
                      {a.separatorBefore && i > 0 && <DropdownMenuSeparator />}
                      <DropdownMenuItem destructive={a.destructive} onSelect={() => a.onSelect(row.original)}>
                        {a.icon}
                        {a.label}
                      </DropdownMenuItem>
                    </React.Fragment>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      });
    }
    return cols;
  }, [columns, enableSelection, rowActions]);

  const pagination = controlledPagination ?? localPagination;
  const table = useReactTable({
    data,
    columns: allColumns,
    state: {
      sorting: controlledSorting ?? localSorting,
      pagination,
      columnVisibility: visibility,
      rowSelection: selection,
    },
    getRowId,
    onSortingChange: onSortingChange ?? setLocalSorting,
    onPaginationChange: onPaginationChange ?? setLocalPagination,
    onColumnVisibilityChange: setVisibility,
    onRowSelectionChange: setSelection,
    enableRowSelection: !!enableSelection,
    manualSorting,
    manualPagination,
    rowCount: manualPagination ? total : undefined,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: manualSorting ? undefined : getSortedRowModel(),
    getPaginationRowModel: manualPagination ? undefined : getPaginationRowModel(),
  });

  React.useEffect(() => {
    if (!onSelectionChange) return;
    onSelectionChange(table.getSelectedRowModel().rows.map((r) => r.original));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  const rows = table.getRowModel().rows;
  const count = manualPagination ? (total ?? 0) : data.length;
  const hideable = table.getAllLeafColumns().filter((c) => c.getCanHide());
  const colCount = table.getVisibleLeafColumns().length;

  return (
    <div className={cn("overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-soft", className)}>
      {(toolbar || (columnToggle && hideable.length > 1)) && (
        <div className="flex flex-col gap-3 border-b border-slate-100 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
          <div className="min-w-0 flex-1">{toolbar}</div>
          {columnToggle && hideable.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm" leftIcon={<Columns3 />}>
                  Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
                {hideable.map((c) => (
                  <DropdownMenuCheckboxItem
                    key={c.id}
                    checked={c.getIsVisible()}
                    onCheckedChange={(v) => c.toggleVisibility(!!v)}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {(c.columnDef.meta as { label?: string } | undefined)?.label ??
                      (typeof c.columnDef.header === "string" ? c.columnDef.header : c.id)}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
      <Table aria-label={ariaLabel} aria-busy={loading || undefined}>
        <TableHeader>
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id} className="hover:bg-transparent">
              {hg.headers.map((h) => {
                const sorted = h.column.getIsSorted();
                const meta = h.column.columnDef.meta as { headerClassName?: string } | undefined;
                return (
                  <TableHead
                    key={h.id}
                    className={meta?.headerClassName}
                    aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
                  >
                    {h.isPlaceholder ? null : h.column.getCanSort() ? (
                      <SortableHeader direction={sorted} onToggle={() => h.column.toggleSorting(sorted === "asc")}>
                        {flexRender(h.column.columnDef.header, h.getContext())}
                      </SortableHeader>
                    ) : (
                      flexRender(h.column.columnDef.header, h.getContext())
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {loading ? (
            Array.from({ length: Math.min(pagination.pageSize, 6) }).map((_, i) => (
              <TableRow key={`sk${i}`} className="hover:bg-transparent">
                {Array.from({ length: colCount }).map((__, j) => (
                  <TableCell key={j}>
                    <Skeleton className={cn("h-4", j === 0 ? "w-3/4" : "w-1/2")} />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : rows.length === 0 ? null : (
            rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() ? "selected" : undefined}
                className={cn(onRowClick && "cursor-pointer")}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
              >
                {row.getVisibleCells().map((cell) => {
                  const meta = cell.column.columnDef.meta as { cellClassName?: string } | undefined;
                  return (
                    <TableCell key={cell.id} className={meta?.cellClassName}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {/* Rendered outside the horizontal scroll container so it stays centred and unclipped on narrow screens. */}
      {!loading && rows.length === 0 && (
        <div className="border-t border-slate-100 px-4 py-10">
          <EmptyState
            size="sm"
            illustration="search"
            title={empty?.title ?? "Nothing here yet"}
            description={empty?.description ?? "When there is data it will show up here."}
            action={empty?.action}
          />
        </div>
      )}
      {count > pagination.pageSize && (
        <div className="border-t border-slate-100 p-3 sm:px-4">
          <Pagination
            page={pagination.pageIndex + 1}
            pageSize={pagination.pageSize}
            total={count}
            onPageChange={(p) => table.setPageIndex(p - 1)}
          />
        </div>
      )}
    </div>
  );
}
