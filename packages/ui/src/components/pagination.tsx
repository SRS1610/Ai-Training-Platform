"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import * as React from "react";
import { cn } from "../lib/cn";

function range(page: number, pages: number): (number | "…")[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(pages - 1, page + 1);
  if (start > 2) out.push("…");
  for (let i = start; i <= end; i++) out.push(i);
  if (end < pages - 1) out.push("…");
  out.push(pages);
  return out;
}

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  className?: string;
  /** Show "Showing x–y of z". */
  showSummary?: boolean;
}

export function Pagination({ page, pageSize, total, onPageChange, className, showSummary = true }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const btn =
    "inline-flex h-9 min-w-9 items-center justify-center rounded-lg px-2 text-sm font-medium transition-colors focus-visible:focus-ring disabled:pointer-events-none disabled:opacity-40";
  return (
    <nav aria-label="Pagination" className={cn("flex flex-col items-center justify-between gap-3 sm:flex-row", className)}>
      {showSummary && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          Showing <span className="font-semibold text-slate-900">{from}</span>–
          <span className="font-semibold text-slate-900">{to}</span> of{" "}
          <span className="font-semibold text-slate-900">{total.toLocaleString()}</span>
        </p>
      )}
      <div className="flex items-center gap-1">
        <button type="button" className={cn(btn, "text-slate-700 hover:bg-slate-100")} onClick={() => onPageChange(page - 1)} disabled={page <= 1} aria-label="Previous page">
          <ChevronLeft className="size-4" aria-hidden />
        </button>
        {range(page, pages).map((p, i) =>
          p === "…" ? (
            <span key={`e${i}`} className="px-1 text-slate-400" aria-hidden>
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onPageChange(p)}
              aria-current={p === page ? "page" : undefined}
              aria-label={`Page ${p}`}
              className={cn(btn, p === page ? "bg-brand-600 text-white shadow-sm" : "text-slate-700 hover:bg-slate-100")}
            >
              {p}
            </button>
          ),
        )}
        <button type="button" className={cn(btn, "text-slate-700 hover:bg-slate-100")} onClick={() => onPageChange(page + 1)} disabled={page >= pages} aria-label="Next page">
          <ChevronRight className="size-4" aria-hidden />
        </button>
      </div>
    </nav>
  );
}
