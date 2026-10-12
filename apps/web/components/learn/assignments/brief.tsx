"use client";

import { Badge, cn, toast } from "@praxis/ui";
import { CheckCircle2, Circle, ClipboardList, Download, ExternalLink, FileCode2, FileText, Film, Image as ImageIcon, LibraryBig, ListChecks, Mic, Target, Theater, Type } from "lucide-react";
import * as React from "react";
import { Markdown } from "@/components/common/markdown";
import { api, errorMessage } from "@/lib/api";
import { isPlaceholderUrl } from "../player/media";
import type { EvidenceItem, LearnerAssignment, RubricCriterion } from "../types";
import { SectionTitle } from "../visuals";

export const EVIDENCE_ICON: Record<string, typeof FileText> = {
  text: Type,
  code: FileCode2,
  screenshot: ImageIcon,
  video: Film,
  audio: Mic,
  document: FileText,
  file: FileText,
  structured: ClipboardList,
};

export function EvidenceChecklist({ items, className }: { items: { item: EvidenceItem; met: boolean }[]; className?: string }) {
  if (!items.length) return null;
  const done = items.filter((x) => x.met).length;
  return (
    <div className={className}>
      <div className="mb-2 flex items-center justify-between text-xs font-medium text-slate-600">
        <span>
          {done} of {items.length} ready
        </span>
        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100" aria-hidden>
          <span className="block h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-500 transition-[width]" style={{ width: `${(done / items.length) * 100}%` }} />
        </span>
      </div>
      <ul className="space-y-2" aria-label="Evidence checklist">
        {items.map(({ item, met }) => {
          const Icon = EVIDENCE_ICON[item.type] ?? FileText;
          return (
            <li key={item.id} className={cn("flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition", met ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200 bg-white")}>
              {met ? <CheckCircle2 className="size-5 shrink-0 text-emerald-600" aria-hidden /> : <Circle className="size-5 shrink-0 text-slate-300" aria-hidden />}
              <Icon className="size-4 shrink-0 text-slate-400" aria-hidden />
              <span className={cn("flex-1", met ? "text-emerald-900" : "text-slate-800")}>{item.label}</span>
              {item.required === false ? (
                <span className="text-2xs font-semibold uppercase text-slate-500">Optional</span>
              ) : (
                <span className="sr-only">{met ? "ready" : "still needed"}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ResourceLink({ title, url, fileId }: { title: string; url?: string | null; fileId?: string | null }) {
  const [busy, setBusy] = React.useState(false);
  const placeholder = !fileId && isPlaceholderUrl(url ?? undefined);
  const cls = "group flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-left transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lift focus-visible:focus-ring";
  const inner = (
    <>
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-sky-400 to-indigo-500 text-white">
        {fileId ? <Download className="size-4" aria-hidden /> : <LibraryBig className="size-4" aria-hidden />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-slate-900">{title}</span>
        <span className="block truncate text-xs text-slate-500">{fileId ? "Download file" : placeholder ? "Demo placeholder link" : "Opens in a new tab"}</span>
      </span>
      {!fileId && <ExternalLink className="size-4 shrink-0 text-slate-400 group-hover:text-brand-600" aria-hidden />}
    </>
  );
  if (fileId)
    return (
      <button
        type="button"
        className={cn(cls, "w-full")}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api.download(`/files/${fileId}/download`);
          } catch (e) {
            toast.error(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {inner}
      </button>
    );
  if (!url) return <div className={cls}>{inner}</div>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer nofollow" className={cls}>
      {inner}
    </a>
  );
}

export function RubricPreview({ criteria }: { criteria: RubricCriterion[] }) {
  const totalWeight = criteria.reduce((a, c) => a + (c.weight || 0), 0) || 1;
  const palette = ["bg-indigo-500", "bg-sky-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500", "bg-fuchsia-500", "bg-teal-500", "bg-orange-500", "bg-violet-500"];
  return (
    <div className="space-y-4">
      <div className="flex h-3 overflow-hidden rounded-full" role="img" aria-label="Rubric weighting">
        {criteria.map((c, i) => (
          <span key={c.id ?? i} className={palette[i % palette.length]} style={{ width: `${((c.weight || 0) / totalWeight) * 100}%` }} title={`${c.name} ${Math.round(c.weight)}%`} />
        ))}
      </div>
      <ol className="space-y-3">
        {criteria.map((c, i) => (
          <li key={c.id ?? i} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn("size-2.5 rounded-full", palette[i % palette.length])} aria-hidden />
              <p className="flex-1 text-sm font-semibold text-slate-900">{c.name}</p>
              <Badge tone="neutral" size="sm">
                {Math.round(c.weight)}% weight
              </Badge>
            </div>
            {c.description && <p className="mt-1.5 text-sm text-slate-600">{c.description}</p>}
            {(c.levels?.length ?? 0) > 0 && (
              <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {[...(c.levels ?? [])]
                  .sort((a, b) => a.score - b.score)
                  .map((l) => (
                    <li key={l.label} className="rounded-xl bg-slate-50 p-2.5 ring-1 ring-slate-200/70">
                      <p className="flex items-center justify-between text-xs font-semibold text-slate-800">
                        {l.label}
                        <span className="tabular-nums text-slate-500">{l.score}</span>
                      </p>
                      {l.description && <p className="mt-1 text-xs leading-relaxed text-slate-600">{l.description}</p>}
                    </li>
                  ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
      <p className="text-xs text-slate-500">Each criterion is scored on its level scale; weights combine them into your final percentage.</p>
    </div>
  );
}

/** Full assignment brief: scenario, objective, instructions, resources, evidence and rubric. */
export function AssignmentBrief({ a, checklist }: { a: LearnerAssignment; checklist: { item: EvidenceItem; met: boolean }[] }) {
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_22rem]">
      <div className="min-w-0 space-y-6">
        {a.scenario && (
          <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-amber-50 via-orange-50/60 to-white p-5 ring-1 ring-amber-100 sm:p-7" aria-labelledby="brief-scenario">
            <div className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-orange-200/40 blur-2xl" aria-hidden />
            <h2 id="brief-scenario" className="relative flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-800">
              <Theater className="size-4" aria-hidden /> The scenario
            </h2>
            <Markdown className="relative mt-3 text-[15px] leading-relaxed">{a.scenario}</Markdown>
          </section>
        )}
        {a.objective && (
          <section className="flex gap-4 rounded-3xl border border-emerald-200 bg-white p-5 shadow-soft sm:p-6" aria-labelledby="brief-objective">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-sm">
              <Target className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 id="brief-objective" className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
                Objective
              </h2>
              <Markdown className="mt-1 text-[15px] font-medium [&_p]:text-slate-900">{a.objective}</Markdown>
            </div>
          </section>
        )}
        {a.instructions && (
          <section className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-soft sm:p-7" aria-labelledby="brief-instructions">
            <SectionTitle id="brief-instructions" icon={ListChecks} color="indigo" title="Instructions" />
            <Markdown className="mt-4 text-[15px] leading-relaxed">{a.instructions}</Markdown>
          </section>
        )}
        {a.rubric && a.rubric.criteria.length > 0 && (
          <section className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-soft sm:p-7" aria-labelledby="brief-rubric">
            <SectionTitle id="brief-rubric" icon={ClipboardList} color="violet" title={a.rubric.title || "How you'll be assessed"} description={a.rubric.description ?? "Rubric criteria and performance levels"} />
            <div className="mt-5">
              <RubricPreview criteria={a.rubric.criteria} />
            </div>
          </section>
        )}
        {!a.rubric && a.evaluation_criteria && (
          <section className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-soft sm:p-7">
            <SectionTitle icon={ClipboardList} color="violet" title="How you'll be assessed" />
            <Markdown className="mt-4">{a.evaluation_criteria}</Markdown>
          </section>
        )}
      </div>
      <aside className="space-y-6 xl:sticky xl:top-24 xl:self-start">
        {checklist.length > 0 && (
          <section className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-soft" aria-labelledby="brief-evidence">
            <SectionTitle id="brief-evidence" icon={CheckCircle2} color="emerald" title="Evidence to submit" description="Ticked items are already in your draft" />
            <EvidenceChecklist items={checklist} className="mt-4" />
            {a.allowed_file_types.length > 0 && <p className="mt-3 text-xs text-slate-500">Accepted files: {a.allowed_file_types.join(", ")}</p>}
          </section>
        )}
        {a.resources.length > 0 && (
          <section className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-soft" aria-labelledby="brief-resources">
            <SectionTitle id="brief-resources" icon={LibraryBig} color="sky" title="Resources" />
            <ul className="mt-4 space-y-2">
              {a.resources.map((r, i) => (
                <li key={i}>
                  <ResourceLink title={r.title} url={r.url} fileId={r.file_id} />
                </li>
              ))}
            </ul>
          </section>
        )}
        {a.rubric && a.evaluation_criteria && (
          <section className="rounded-3xl bg-gradient-to-br from-violet-50 to-white p-5 ring-1 ring-violet-100">
            <p className="text-xs font-semibold uppercase tracking-wider text-violet-700">Evaluation focus</p>
            <Markdown className="mt-2 text-sm">{a.evaluation_criteria}</Markdown>
          </section>
        )}
      </aside>
    </div>
  );
}
