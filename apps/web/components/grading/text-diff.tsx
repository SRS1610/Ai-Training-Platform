"use client";

import { cn } from "@praxis/ui";
import * as React from "react";

export type DiffOp = { type: "same" | "add" | "del"; text: string; a?: number; b?: number };

/** Line diff via LCS (bounded; very large inputs fall back to a whole-block replace). */
export function diffLines(before: string, after: string): DiffOp[] {
  const a = before.replace(/\r\n/g, "\n").split("\n");
  const b = after.replace(/\r\n/g, "\n").split("\n");
  const n = a.length;
  const m = b.length;
  if (n * m > 4_000_000) {
    return [...a.map((t, i) => ({ type: "del" as const, text: t, a: i + 1 })), ...b.map((t, i) => ({ type: "add" as const, text: t, b: i + 1 }))];
  }
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1]! + 1 : Math.max(dp[(i + 1) * w + j]!, dp[i * w + j + 1]!);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "same", text: a[i]!, a: i + 1, b: j + 1 });
      i++;
      j++;
    } else if (dp[(i + 1) * w + j]! >= dp[i * w + j + 1]!) {
      ops.push({ type: "del", text: a[i]!, a: i + 1 });
      i++;
    } else {
      ops.push({ type: "add", text: b[j]!, b: j + 1 });
      j++;
    }
  }
  while (i < n) ops.push({ type: "del", text: a[i]!, a: ++i });
  while (j < m) ops.push({ type: "add", text: b[j]!, b: ++j });
  return ops;
}

/** Collapse long unchanged stretches, keeping `context` lines around changes. */
function collapse(ops: DiffOp[], context = 3): (DiffOp | { type: "gap"; count: number })[] {
  const keep = new Array(ops.length).fill(false);
  ops.forEach((op, idx) => {
    if (op.type !== "same") for (let k = Math.max(0, idx - context); k <= Math.min(ops.length - 1, idx + context); k++) keep[k] = true;
  });
  const out: (DiffOp | { type: "gap"; count: number })[] = [];
  let gap = 0;
  ops.forEach((op, idx) => {
    if (keep[idx]) {
      if (gap) out.push({ type: "gap", count: gap });
      gap = 0;
      out.push(op);
    } else gap++;
  });
  if (gap) out.push({ type: "gap", count: gap });
  return out;
}

export function TextDiff({ before, after, mono, className }: { before: string; after: string; mono?: boolean; className?: string }) {
  const ops = React.useMemo(() => diffLines(before, after), [before, after]);
  const rows = React.useMemo(() => collapse(ops), [ops]);
  const added = ops.filter((o) => o.type === "add").length;
  const removed = ops.filter((o) => o.type === "del").length;
  if (!added && !removed)
    return <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-muted-foreground">No changes between these versions.</p>;
  return (
    <figure className={cn("overflow-hidden rounded-xl border border-slate-200", className)}>
      <figcaption className="flex items-center gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
        <span className="text-emerald-700">+{added} added</span>
        <span className="text-rose-700">−{removed} removed</span>
      </figcaption>
      <div className="max-h-[520px] overflow-auto scrollbar-thin">
        <table className={cn("w-full border-collapse text-[13px] leading-6", mono ? "font-mono" : "font-sans")}>
          <tbody>
            {rows.map((r, idx) =>
              r.type === "gap" ? (
                <tr key={`g${idx}`} className="bg-slate-50/70">
                  <td colSpan={3} className="px-3 py-0.5 text-center text-2xs font-medium text-slate-500">
                    ⋯ {r.count} unchanged line{r.count === 1 ? "" : "s"}
                  </td>
                </tr>
              ) : (
                <tr
                  key={idx}
                  className={cn(r.type === "add" && "bg-emerald-50", r.type === "del" && "bg-rose-50")}
                >
                  <td className="w-10 select-none border-r border-slate-200/70 px-2 text-right align-top text-2xs tabular-nums text-slate-400">{r.a ?? ""}</td>
                  <td className="w-10 select-none border-r border-slate-200/70 px-2 text-right align-top text-2xs tabular-nums text-slate-400">{r.b ?? ""}</td>
                  <td className="whitespace-pre-wrap break-words px-3 align-top text-slate-800">
                    <span
                      aria-hidden
                      className={cn("mr-2 inline-block w-3 select-none font-bold", r.type === "add" ? "text-emerald-600" : r.type === "del" ? "text-rose-600" : "text-transparent")}
                    >
                      {r.type === "add" ? "+" : r.type === "del" ? "−" : " "}
                    </span>
                    <span className="sr-only">{r.type === "add" ? "Added: " : r.type === "del" ? "Removed: " : ""}</span>
                    {r.text || " "}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
