"use client";

import { Button, Input, Popover, PopoverContent, PopoverTrigger, cn } from "@praxis/ui";
import { CalendarRange, ChevronDown } from "lucide-react";
import * as React from "react";
import { formatDate } from "@/lib/format";

export interface DateRangeValue {
  start: string;
  end: string;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
export function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return iso(d);
}

export const RANGE_PRESETS: { key: string; label: string; range: () => DateRangeValue }[] = [
  { key: "7d", label: "Last 7 days", range: () => ({ start: daysAgo(6), end: iso(new Date()) }) },
  { key: "30d", label: "Last 30 days", range: () => ({ start: daysAgo(29), end: iso(new Date()) }) },
  { key: "90d", label: "Last 90 days", range: () => ({ start: daysAgo(89), end: iso(new Date()) }) },
  { key: "ytd", label: "Year to date", range: () => ({ start: `${new Date().getFullYear()}-01-01`, end: iso(new Date()) }) },
  { key: "12m", label: "Last 12 months", range: () => ({ start: daysAgo(364), end: iso(new Date()) }) },
  { key: "all", label: "All time", range: () => ({ start: "", end: "" }) },
];

export function rangeLabel(v: DateRangeValue): string {
  const preset = RANGE_PRESETS.find((p) => {
    const r = p.range();
    return r.start === v.start && r.end === v.end;
  });
  if (preset) return preset.label;
  if (!v.start && !v.end) return "All time";
  return `${v.start ? formatDate(v.start) : "Start"} – ${v.end ? formatDate(v.end) : "Today"}`;
}

/** Date range picker with presets and custom start/end inputs. */
export function DateRangePicker({ value, onChange, className }: { value: DateRangeValue; onChange: (v: DateRangeValue) => void; className?: string }) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => setDraft(value), [value, open]);
  const invalid = !!draft.start && !!draft.end && draft.start > draft.end;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="secondary" size="sm" leftIcon={<CalendarRange />} rightIcon={<ChevronDown />} className={cn("justify-between", className)}>
          {rangeLabel(value)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Quick ranges</p>
        <div className="grid grid-cols-2 gap-1.5">
          {RANGE_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => {
                onChange(p.range());
                setOpen(false);
              }}
              className={cn(
                "rounded-lg px-2.5 py-1.5 text-left text-sm font-medium transition-colors focus-visible:focus-ring",
                rangeLabel(value) === p.label ? "bg-brand-50 text-brand-800 ring-1 ring-brand-200" : "text-slate-700 hover:bg-slate-100",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Custom</p>
        <div className="grid grid-cols-2 gap-2">
          <label htmlFor="range-from" className="space-y-1 text-xs font-medium text-slate-700">
            From
            <Input id="range-from" type="date" inputSize="sm" value={draft.start} max={draft.end || undefined} onChange={(e) => setDraft((d) => ({ ...d, start: e.target.value }))} />
          </label>
          <label htmlFor="range-to" className="space-y-1 text-xs font-medium text-slate-700">
            To
            <Input id="range-to" type="date" inputSize="sm" value={draft.end} min={draft.start || undefined} onChange={(e) => setDraft((d) => ({ ...d, end: e.target.value }))} />
          </label>
        </div>
        {invalid && <p className="mt-2 text-xs font-medium text-rose-700">Start must be before end.</p>}
        <Button
          size="sm"
          block
          className="mt-3"
          disabled={invalid}
          onClick={() => {
            onChange(draft);
            setOpen(false);
          }}
        >
          Apply range
        </Button>
      </PopoverContent>
    </Popover>
  );
}
