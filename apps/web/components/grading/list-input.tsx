"use client";

import { Button, Input, Switch, cn } from "@praxis/ui";
import { Plus, X } from "lucide-react";
import * as React from "react";

/**
 * Editable list of short strings (strengths, patterns, tags…). Enter adds, items can be edited inline and removed.
 */
export function ListInput({
  value,
  onChange,
  placeholder = "Add an item and press Enter",
  id,
  mono,
  chips,
  "aria-label": ariaLabel,
  "aria-describedby": describedBy,
  className,
  max,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  id?: string;
  mono?: boolean;
  /** Render items as compact chips (tags) instead of rows. */
  chips?: boolean;
  "aria-label"?: string;
  "aria-describedby"?: string;
  className?: string;
  max?: number;
}) {
  const [draft, setDraft] = React.useState("");
  const add = () => {
    const t = draft.trim();
    if (!t) return;
    if (max && value.length >= max) return;
    onChange([...value, t]);
    setDraft("");
  };
  return (
    <div className={cn("space-y-2", className)}>
      {value.length > 0 &&
        (chips ? (
          <ul className="flex flex-wrap gap-1.5" aria-label={ariaLabel}>
            {value.map((v, i) => (
              <li key={`${v}-${i}`} className={cn("inline-flex items-center gap-1 rounded-full bg-brand-50 py-1 pl-2.5 pr-1 text-xs font-medium text-brand-800 ring-1 ring-inset ring-brand-200", mono && "font-mono")}>
                {v}
                <button
                  type="button"
                  className="grid size-5 place-items-center rounded-full hover:bg-brand-100 focus-visible:focus-ring"
                  aria-label={`Remove ${v}`}
                  onClick={() => onChange(value.filter((_, j) => j !== i))}
                >
                  <X className="size-3" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="space-y-1.5" aria-label={ariaLabel}>
            {value.map((v, i) => (
              <li key={i} className="flex items-center gap-1.5">
                <Input
                  inputSize="sm"
                  value={v}
                  className={cn(mono && "font-mono text-xs")}
                  aria-label={`${ariaLabel ?? "Item"} ${i + 1}`}
                  onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))}
                />
                <Button variant="ghost" size="icon-sm" aria-label={`Remove item ${i + 1}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        ))}
      <div className="flex items-center gap-1.5">
        <Input
          id={id}
          inputSize="sm"
          value={draft}
          placeholder={placeholder}
          className={cn(mono && "font-mono text-xs")}
          aria-label={ariaLabel ? `Add to ${ariaLabel}` : "Add item"}
          aria-describedby={describedBy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button variant="secondary" size="icon-sm" aria-label="Add" onClick={add} disabled={!draft.trim()}>
          <Plus />
        </Button>
      </div>
    </div>
  );
}

/** Switch + clickable label (pill style) for filter bars and toolbars. */
export function SwitchChip({
  checked,
  onCheckedChange,
  label,
  className,
  icon,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label: React.ReactNode;
  className?: string;
  icon?: React.ReactNode;
}) {
  const id = React.useId();
  return (
    <div className={cn("flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700", className)}>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
      <label htmlFor={id} className="flex cursor-pointer select-none items-center gap-1.5 [&_svg]:size-4 [&_svg]:text-slate-500">
        {icon}
        {label}
      </label>
    </div>
  );
}
