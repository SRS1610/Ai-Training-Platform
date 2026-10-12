"use client";

import { Search, X } from "lucide-react";
import * as React from "react";
import { cn } from "../lib/cn";
import { Button } from "./button";
import { Input } from "./input";

export interface FilterChip {
  key: string;
  label: React.ReactNode;
  onRemove: () => void;
}

/**
 * Filter bar: debounced search box, slot for filter controls (selects, toggles) and active filter chips.
 */
export function FilterBar({
  search,
  onSearchChange,
  searchPlaceholder = "Search…",
  debounceMs = 300,
  children,
  chips,
  onClearAll,
  actions,
  className,
}: {
  search?: string;
  onSearchChange?: (q: string) => void;
  searchPlaceholder?: string;
  debounceMs?: number;
  children?: React.ReactNode;
  chips?: FilterChip[];
  onClearAll?: () => void;
  actions?: React.ReactNode;
  className?: string;
}) {
  const [q, setQ] = React.useState(search ?? "");
  React.useEffect(() => setQ(search ?? ""), [search]);
  React.useEffect(() => {
    if (!onSearchChange || q === (search ?? "")) return;
    const t = setTimeout(() => onSearchChange(q), debounceMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className={cn("space-y-3", className)} role="search">
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        {onSearchChange && (
          <div className="md:w-72">
            <Input
              inputSize="sm"
              leftIcon={<Search />}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder.replace(/…$/, "")}
              type="search"
            />
          </div>
        )}
        {children && <div className="flex flex-1 flex-wrap items-center gap-2">{children}</div>}
        {actions && <div className="flex items-center gap-2 md:ml-auto">{actions}</div>}
      </div>
      {chips && chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((c) => (
            <span key={c.key} className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-1 pl-3 pr-1 text-xs font-medium text-brand-800 ring-1 ring-inset ring-brand-200">
              {c.label}
              <button type="button" onClick={c.onRemove} className="grid size-5 place-items-center rounded-full hover:bg-brand-100 focus-visible:focus-ring" aria-label="Remove filter">
                <X className="size-3" aria-hidden />
              </button>
            </span>
          ))}
          {onClearAll && (
            <Button variant="link" size="xs" onClick={onClearAll}>
              Clear all
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
