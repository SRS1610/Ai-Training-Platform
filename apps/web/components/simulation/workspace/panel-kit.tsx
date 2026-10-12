"use client";

import { cn, colorClasses, humanize, type CategoryColor } from "@praxis/ui";
import { Inbox, type LucideIcon } from "lucide-react";
import * as React from "react";
import { Markdown } from "@/components/common/markdown";
import type { TranscriptEntry } from "../types";
import { useWorkspace } from "./context";
import { simClock } from "./model";

/* ------------------------------------------------------------------ chrome */

export function PanelShell({
  icon: Icon,
  color,
  title,
  subtitle,
  right,
  toolbar,
  children,
  className,
  bodyClassName,
}: {
  icon: LucideIcon;
  color: CategoryColor;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  toolbar?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const c = colorClasses(color);
  return (
    <section className={cn("flex h-full min-h-0 flex-col bg-white", className)} aria-label={typeof title === "string" ? title : undefined}>
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200/80 px-4 py-3 sm:px-5">
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow-sm", c.gradient)}>
          <Icon className="size-[18px]" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-[15px] font-semibold tracking-tight text-slate-900">{title}</h2>
          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {right}
      </header>
      {toolbar && <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-2.5 sm:px-5">{toolbar}</div>}
      <div className={cn("relative min-h-0 flex-1 overflow-y-auto scrollbar-thin", bodyClassName)}>{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ generic data renderer */

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

function isPrimitive(v: unknown): v is string | number | boolean | null {
  return v === null || ["string", "number", "boolean"].includes(typeof v);
}

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

/** Highlights ALL-CAPS warnings (e.g. "*** NUT ALLERGY ***", "PEANUTS") in data strings. */
export function Emphasis({ text }: { text: string }) {
  const parts = text.split(/(\*{3}[^*]+\*{3}|\b[A-Z]{6,}(?:\s+[A-Z]{6,})*\b)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^\*{3}/.test(p) || /^[A-Z]{6,}/.test(p) ? (
          <mark key={i} className="rounded bg-rose-100 px-1 font-semibold text-rose-800">
            {p.replace(/\*{3}/g, "").trim()}
          </mark>
        ) : (
          <React.Fragment key={i}>{p}</React.Fragment>
        ),
      )}
    </>
  );
}

export function DataView({ data, mono, className }: { data: Record<string, unknown>; mono?: boolean; className?: string }) {
  const entries = Object.entries(data);
  const prims = entries.filter(([, v]) => isPrimitive(v));
  const nested = entries.filter(([, v]) => !isPrimitive(v));
  return (
    <div className={cn("space-y-5", className)}>
      {prims.length > 0 && <Properties rows={prims.map(([k, v]) => [humanize(k), fmt(v)])} mono={mono} />}
      {nested.map(([k, v]) => (
        <div key={k}>
          <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-slate-500">{humanize(k)}</h3>
          <Nested value={v as Json} mono={mono} />
        </div>
      ))}
    </div>
  );
}

function Nested({ value, mono }: { value: Json; mono?: boolean }) {
  if (Array.isArray(value)) {
    if (value.every(isPrimitive))
      return (
        <div className="flex flex-wrap gap-1.5">
          {value.map((v, i) => (
            <span key={i} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
              {fmt(v)}
            </span>
          ))}
        </div>
      );
    const rows = value.filter((v): v is { [k: string]: Json } => !!v && typeof v === "object" && !Array.isArray(v));
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))].slice(0, 6);
    return <DataTable cols={cols} rows={rows} />;
  }
  if (value && typeof value === "object") return <DataView data={value as Record<string, unknown>} mono={mono} />;
  return <p className="text-sm text-slate-700">{fmt(value)}</p>;
}

export function Properties({ rows, mono, className }: { rows: [React.ReactNode, React.ReactNode][]; mono?: boolean; className?: string }) {
  return (
    <dl className={cn("overflow-hidden rounded-xl border border-slate-200 text-sm", className)}>
      {rows.map(([k, v], i) => (
        <div key={i} className={cn("grid grid-cols-[minmax(7rem,38%)_1fr] gap-3 px-3.5 py-2", i % 2 ? "bg-white" : "bg-slate-50/70")}>
          <dt className="text-slate-500">{k}</dt>
          <dd className={cn("min-w-0 break-words text-slate-900", mono && "font-mono text-[13px]")}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DataTable({ cols, rows, render }: { cols: string[]; rows: Record<string, unknown>[]; render?: (col: string, v: unknown, row: Record<string, unknown>) => React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 scrollbar-thin">
      <table className="w-full min-w-[28rem] text-left text-sm">
        <thead className="bg-slate-50 text-2xs uppercase tracking-wider text-slate-500">
          <tr>
            {cols.map((c) => (
              <th key={c} scope="col" className="px-3 py-2 font-semibold">
                {humanize(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => (
            <tr key={i} className="align-top">
              {cols.map((c) => (
                <td key={c} className="px-3 py-2 text-slate-700">
                  {render ? render(c, r[c], r) : Array.isArray(r[c]) ? (r[c] as unknown[]).map(fmt).join(", ") : <Emphasis text={fmt(r[c])} />}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ results feed */

/** Non-terminal outputs and learner actions for one app, newest first. */
export function ResultsFeed({ entries, title = "Activity", empty, className }: { entries: TranscriptEntry[]; title?: string; empty?: React.ReactNode; className?: string }) {
  const { lastSeq } = useWorkspace();
  const shown = entries.filter((e) => e.kind === "output" || e.kind === "action" || e.kind === "note").slice().reverse();
  return (
    <div className={className}>
      <h3 className="mb-2 flex items-center gap-2 text-2xs font-semibold uppercase tracking-wider text-slate-500">{title}</h3>
      {shown.length === 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-slate-200 px-3 py-3 text-sm text-muted-foreground">
          <Inbox className="size-4 text-slate-400" aria-hidden />
          {empty ?? "Nothing yet. Results of your actions appear here."}
        </div>
      ) : (
        <ol className="space-y-2" aria-live="polite">
          {shown.map((e, i) => {
            const fresh = e.seq === lastSeq;
            const learner = e.from === "learner";
            return (
              <li
                key={`${e.seq}-${i}`}
                className={cn(
                  "rounded-xl border px-3 py-2.5 text-sm",
                  learner ? "border-slate-100 bg-slate-50/60" : "border-slate-200 bg-white",
                  fresh && "motion-safe:animate-fade-up ring-2 ring-brand-200",
                )}
              >
                <div className="mb-0.5 flex items-center justify-between gap-2 text-2xs text-slate-500">
                  <span className="font-semibold uppercase tracking-wider">{learner ? (e.kind === "note" ? "You wrote" : "You") : "Result"}</span>
                  <span className="font-mono tabular-nums">T+{simClock(e.minutes)}</span>
                </div>
                {e.format === "markdown" ? (
                  <Markdown className="text-sm">{e.text}</Markdown>
                ) : (
                  <p className={cn("whitespace-pre-wrap", learner ? "text-slate-700" : "text-slate-900")}>{e.text}</p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ streaming reveal */

/**
 * Progressive reveal of `text` (line by line) when `animate` is true — the terminal "streaming" effect.
 * Respects prefers-reduced-motion.
 */
export function useReveal(text: string, animate: boolean): string {
  const [shown, setShown] = React.useState(animate ? "" : text);
  React.useEffect(() => {
    if (!animate || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setShown(text);
      return;
    }
    const lines = text.split("\n");
    let i = 0;
    const per = Math.max(8, Math.min(40, 700 / Math.max(1, lines.length)));
    setShown("");
    const t = setInterval(() => {
      i += 1;
      setShown(lines.slice(0, i).join("\n"));
      if (i >= lines.length) clearInterval(t);
    }, per);
    return () => clearInterval(t);
  }, [text, animate]);
  return shown;
}
