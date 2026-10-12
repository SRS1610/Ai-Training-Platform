"use client";

/**
 * Dense form primitives for the simulation builder (inspector + editor tabs). Native controls keep
 * large editors fast and fully keyboard-accessible; styling matches @praxis/ui inputs.
 */
import { Button, Checkbox, Popover, PopoverContent, PopoverTrigger, cn } from "@praxis/ui";
import { Check, ChevronDown, ChevronRight, ChevronsUpDown, ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import * as React from "react";

const base =
  "w-full rounded-lg border border-slate-300 bg-white text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 hover:border-slate-400 focus-visible:border-brand-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/15 disabled:cursor-not-allowed disabled:bg-slate-50 aria-[invalid=true]:border-rose-500";

export function useFieldId(id?: string) {
  const auto = React.useId();
  return id ?? `sf${auto.replace(/:/g, "")}`;
}

export function FieldRow({
  label,
  hint,
  error,
  children,
  className,
  htmlFor,
  inline,
  action,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | null;
  children: React.ReactNode;
  className?: string;
  htmlFor?: string;
  inline?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <div className={cn(inline ? "flex items-center justify-between gap-3" : "space-y-1", className)}>
      <div className="flex items-center justify-between gap-2">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-xs font-semibold text-slate-700">
            {label}
          </label>
        ) : (
          <span className="text-xs font-semibold text-slate-700">{label}</span>
        )}
        {action}
      </div>
      {children}
      {hint && !error && <p className="text-2xs leading-snug text-slate-500">{hint}</p>}
      {error && (
        <p role="alert" className="text-2xs font-medium text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
}

export const MiniInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }>(
  ({ className, mono, ...p }, ref) => <input ref={ref} className={cn(base, "h-8 px-2.5 text-[13px]", mono && "font-mono text-xs", className)} {...p} />,
);
MiniInput.displayName = "MiniInput";

export const MiniTextarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean }>(
  ({ className, mono, rows = 3, ...p }, ref) => (
    <textarea ref={ref} rows={rows} className={cn(base, "px-2.5 py-1.5 text-[13px] leading-relaxed", mono && "font-mono text-xs", className)} {...p} />
  ),
);
MiniTextarea.displayName = "MiniTextarea";

export function MiniSelect({
  value,
  onChange,
  options,
  placeholder,
  className,
  id,
  "aria-label": ariaLabel,
  disabled,
}: {
  value: string | null | undefined;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  className?: string;
  id?: string;
  "aria-label"?: string;
  disabled?: boolean;
}) {
  const known = value === null || value === undefined || value === "" || options.some((o) => o.value === value);
  return (
    <div className={cn("relative", className)}>
      <select
        id={id}
        aria-label={ariaLabel}
        disabled={disabled}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className={cn(base, "h-8 appearance-none truncate pl-2.5 pr-7 text-[13px]")}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {!known && <option value={value!}>{value} (unknown)</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-slate-500" aria-hidden />
    </div>
  );
}

export function NumberInput({
  value,
  onChange,
  nullable,
  className,
  step = 1,
  min,
  max,
  id,
  placeholder,
  "aria-label": ariaLabel,
}: {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  nullable?: boolean;
  className?: string;
  step?: number;
  min?: number;
  max?: number;
  id?: string;
  placeholder?: string;
  "aria-label"?: string;
}) {
  const [text, setText] = React.useState(value === null || value === undefined ? "" : String(value));
  React.useEffect(() => {
    const cur = text === "" ? null : Number(text);
    if (cur !== value) setText(value === null || value === undefined ? "" : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <MiniInput
      id={id}
      type="number"
      inputMode="decimal"
      step={step}
      min={min}
      max={max}
      aria-label={ariaLabel}
      placeholder={placeholder ?? (nullable ? "inherit" : undefined)}
      className={cn("tabular-nums", className)}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        if (e.target.value === "") return onChange(nullable ? null : 0);
        const n = Number(e.target.value);
        if (!Number.isNaN(n)) onChange(n);
      }}
    />
  );
}

export function ToggleRow({ label, checked, onChange, hint }: { label: React.ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: React.ReactNode }) {
  const id = useFieldId();
  return (
    <div className="flex items-start gap-2.5">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(!!v)} className="mt-0.5 size-4" />
      <div>
        <label htmlFor={id} className="cursor-pointer text-[13px] font-medium text-slate-800">
          {label}
        </label>
        {hint && <p className="text-2xs text-slate-500">{hint}</p>}
      </div>
    </div>
  );
}

/** Collapsible inspector section with a coloured dot and optional count. */
export function Section({
  title,
  children,
  defaultOpen = true,
  count,
  color = "bg-brand-500",
  action,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  count?: number;
  color?: string;
  action?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const id = useFieldId();
  return (
    <section className="border-b border-slate-100 last:border-b-0">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={id}
          className="flex flex-1 items-center gap-2 rounded-md text-left text-[13px] font-semibold text-slate-900 focus-visible:focus-ring"
        >
          <ChevronRight className={cn("size-3.5 text-slate-400 transition-transform", open && "rotate-90")} aria-hidden />
          <span className={cn("size-2 rounded-full", color)} aria-hidden />
          {title}
          {count !== undefined && count > 0 && <span className="rounded-full bg-slate-100 px-1.5 text-2xs font-semibold text-slate-600">{count}</span>}
        </button>
        {action}
      </div>
      {open && (
        <div id={id} className="space-y-3 px-4 pb-4">
          {children}
        </div>
      )}
    </section>
  );
}

/** Toggle chips for picking several ids from a short list. */
export function ChipPicker({
  options,
  value,
  onChange,
  emptyLabel,
  "aria-label": ariaLabel,
}: {
  options: { value: string; label: string }[];
  value: string[];
  onChange: (v: string[]) => void;
  emptyLabel?: string;
  "aria-label"?: string;
}) {
  if (!options.length) return <p className="text-2xs italic text-slate-500">{emptyLabel ?? "Nothing to pick yet."}</p>;
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={ariaLabel}>
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition-colors focus-visible:focus-ring",
              on ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50",
            )}
          >
            {on && <Check className="size-3" aria-hidden />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Searchable multi-pick popover for longer lists (facts, intents, actions). */
export function MultiPick({
  options,
  value,
  onChange,
  placeholder = "Select…",
  "aria-label": ariaLabel,
}: {
  options: { value: string; label: string; hint?: string }[];
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  "aria-label"?: string;
}) {
  const [q, setQ] = React.useState("");
  const shown = options.filter((o) => `${o.value} ${o.label}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={ariaLabel} className={cn(base, "flex min-h-8 items-center justify-between gap-2 px-2.5 py-1 text-left text-[13px]")}>
          <span className="flex min-w-0 flex-wrap gap-1">
            {value.length ? (
              value.map((v) => (
                <span key={v} className="rounded-md bg-brand-50 px-1.5 py-px font-mono text-2xs font-medium text-brand-800">
                  {v}
                </span>
              ))
            ) : (
              <span className="text-slate-400">{placeholder}</span>
            )}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-slate-500" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="start">
        <MiniInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" aria-label="Search options" autoFocus />
        <ul className="mt-2 max-h-60 space-y-0.5 overflow-auto scrollbar-thin" role="listbox" aria-multiselectable>
          {shown.length === 0 && <li className="px-2 py-3 text-center text-xs text-slate-500">No matches</li>}
          {shown.map((o) => {
            const on = value.includes(o.value);
            return (
              <li key={o.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
                  className={cn("flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-brand-50 focus-visible:focus-ring", on && "bg-brand-50/70")}
                >
                  <span className={cn("mt-0.5 grid size-4 shrink-0 place-items-center rounded border", on ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300")}>
                    {on && <Check className="size-3" aria-hidden />}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-mono text-2xs text-slate-500">{o.value}</span>
                    <span className="line-clamp-2 text-slate-800">{o.label}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/** JSON textarea that only commits valid JSON. */
export function JsonField({
  value,
  onChange,
  rows = 6,
  id,
  "aria-label": ariaLabel,
  className,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
  rows?: number;
  id?: string;
  "aria-label"?: string;
  className?: string;
}) {
  const fmt = React.useCallback((v: unknown) => (v === undefined ? "" : JSON.stringify(v, null, 2)), []);
  const [text, setText] = React.useState(() => fmt(value));
  const [error, setError] = React.useState<string | null>(null);
  const last = React.useRef(value);
  React.useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(fmt(value));
      setError(null);
    }
  }, [value, fmt]);
  return (
    <div className="space-y-1">
      <MiniTextarea
        id={id}
        aria-label={ariaLabel}
        mono
        rows={rows}
        spellCheck={false}
        aria-invalid={!!error}
        className={cn("bg-slate-50/60", className)}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (!e.target.value.trim()) {
            setError(null);
            last.current = null;
            onChange(null);
            return;
          }
          try {
            const v = JSON.parse(e.target.value);
            setError(null);
            last.current = v;
            onChange(v);
          } catch (err) {
            setError((err as Error).message.replace(/^JSON\.parse: /, ""));
          }
        }}
      />
      {error ? <p className="text-2xs font-medium text-rose-700">Invalid JSON — {error}</p> : <p className="text-2xs text-emerald-700">Valid JSON</p>}
    </div>
  );
}

/** Ordered list editor with add/remove/reorder; renders each item with `render`. */
export function ListEditor<T>({
  items,
  onChange,
  render,
  make,
  addLabel = "Add",
  empty,
  itemLabel,
  className,
}: {
  items: T[];
  onChange: (next: T[]) => void;
  render: (item: T, update: (patch: T) => void, index: number) => React.ReactNode;
  make: () => T;
  addLabel?: string;
  empty?: React.ReactNode;
  itemLabel?: (item: T, index: number) => string;
  className?: string;
}) {
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  return (
    <div className={cn("space-y-2", className)}>
      {items.length === 0 && empty}
      {items.map((it, i) => {
        const name = itemLabel?.(it, i) ?? `Item ${i + 1}`;
        return (
          <div key={i} className="group relative rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="absolute right-1.5 top-1.5 flex gap-0.5 opacity-70 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
              <button type="button" className="grid size-6 place-items-center rounded-md text-slate-500 hover:bg-slate-100 focus-visible:focus-ring disabled:opacity-30" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${name} up`}>
                <ArrowUp className="size-3.5" aria-hidden />
              </button>
              <button type="button" className="grid size-6 place-items-center rounded-md text-slate-500 hover:bg-slate-100 focus-visible:focus-ring disabled:opacity-30" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label={`Move ${name} down`}>
                <ArrowDown className="size-3.5" aria-hidden />
              </button>
              <button type="button" className="grid size-6 place-items-center rounded-md text-rose-600 hover:bg-rose-50 focus-visible:focus-ring" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label={`Remove ${name}`}>
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            </div>
            {render(it, (patch) => onChange(items.map((x, j) => (j === i ? patch : x))), i)}
          </div>
        );
      })}
      <Button type="button" variant="secondary" size="xs" onClick={() => onChange([...items, make()])}>
        + {addLabel}
      </Button>
    </div>
  );
}

/** Parse free text into a JSON value when possible ("3" → 3, "true" → true), else keep the string. */
export function textToValue(t: string): unknown {
  const s = t.trim();
  if (s === "") return "";
  try {
    return JSON.parse(s);
  } catch {
    return t;
  }
}

export function valueToText(v: unknown): string {
  if (v === undefined) return "";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}
