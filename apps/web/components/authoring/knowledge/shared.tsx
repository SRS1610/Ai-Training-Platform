"use client";

import { cn, colorClasses, type CategoryColor } from "@praxis/ui";
import { FileCode2, FileText, FileType2, Globe, type LucideIcon, NotebookText, Presentation, ScrollText } from "lucide-react";
import * as React from "react";

export const SOURCE_META: Record<string, { label: string; icon: LucideIcon; color: CategoryColor }> = {
  pdf: { label: "PDF", icon: FileText, color: "rose" },
  docx: { label: "Word", icon: FileType2, color: "sky" },
  pptx: { label: "Slides", icon: Presentation, color: "orange" },
  txt: { label: "Text file", icon: ScrollText, color: "teal" },
  text: { label: "Text", icon: ScrollText, color: "teal" },
  markdown: { label: "Markdown", icon: FileCode2, color: "violet" },
  md: { label: "Markdown", icon: FileCode2, color: "violet" },
  url: { label: "Web page", icon: Globe, color: "emerald" },
};

export function sourceMeta(t: string | null | undefined) {
  return SOURCE_META[t ?? ""] ?? { label: t ?? "Document", icon: NotebookText, color: "indigo" as CategoryColor };
}

export function SourceIcon({ type, size = "md" }: { type: string; size?: "sm" | "md" | "lg" }) {
  const m = sourceMeta(type);
  const Icon = m.icon;
  const c = colorClasses(m.color);
  const box = { sm: "size-8 rounded-lg", md: "size-10 rounded-xl", lg: "size-12 rounded-2xl" }[size];
  return (
    <span className={cn("grid shrink-0 place-items-center bg-gradient-to-br text-white shadow-sm", c.gradient, box)} aria-hidden>
      <Icon className={size === "lg" ? "size-6" : size === "md" ? "size-5" : "size-4"} />
    </span>
  );
}

/** Ingestion status pill with a live pulse while pending / processing. */
export function DocStatus({ status, error }: { status: string; error?: string | null }) {
  const map: Record<string, { label: string; cls: string; dot: string; pulse?: boolean }> = {
    pending: { label: "Queued", cls: "bg-slate-100 text-slate-700 ring-slate-200", dot: "bg-slate-400", pulse: true },
    processing: { label: "Indexing", cls: "bg-sky-50 text-sky-800 ring-sky-200", dot: "bg-sky-500", pulse: true },
    ready: { label: "Ready", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-emerald-500" },
    failed: { label: "Failed", cls: "bg-rose-50 text-rose-700 ring-rose-200", dot: "bg-rose-500" },
  };
  const m = map[status] ?? { label: status, cls: "bg-slate-100 text-slate-700 ring-slate-200", dot: "bg-slate-400" };
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-2xs font-semibold ring-1 ring-inset", m.cls)} title={error ?? undefined}>
      <span className="relative flex size-1.5">
        {m.pulse && <span className={cn("absolute inline-flex size-full rounded-full opacity-75 motion-safe:animate-ping", m.dot)} aria-hidden />}
        <span className={cn("relative inline-flex size-1.5 rounded-full", m.dot)} aria-hidden />
      </span>
      {m.label}
    </span>
  );
}

export function formatChars(n: number): string {
  if (n < 1000) return `${n} chars`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k chars`;
  return `${(n / 1_000_000).toFixed(1)}M chars`;
}

const STOP = new Set(["the", "and", "for", "you", "your", "how", "what", "when", "where", "which", "who", "why", "can", "does", "with", "that", "this", "are", "was", "should", "into", "from", "about", "have", "has"]);

/** Highlight query terms (whole words, prefix match) inside a snippet — React nodes only, no HTML injection. */
export function Highlight({ text, query }: { text: string; query: string }) {
  const terms = [...new Set((query.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((t) => !STOP.has(t)))];
  if (!terms.length) return <>{text}</>;
  const re = new RegExp(`(\\b(?:${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\w*)`, "gi");
  const parts = text.split(re);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded bg-amber-100 px-0.5 text-amber-950">
            {p}
          </mark>
        ) : (
          <React.Fragment key={i}>{p}</React.Fragment>
        ),
      )}
    </>
  );
}
