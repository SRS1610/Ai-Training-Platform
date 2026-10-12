"use client";

import { Alert, Button, Input, SimpleSelect, Spinner, Switch, cn } from "@praxis/ui";
import { useMutation } from "@tanstack/react-query";
import { ArrowUpRight, Cpu, FlaskConical, Search, Sparkles } from "lucide-react";
import * as React from "react";
import { api, errorMessage } from "@/lib/api";
import type { SearchOut } from "../types";
import { useCourseOptions } from "../use-options";
import { Highlight } from "./shared";

function scoreTone(score: number, max: number) {
  const r = max > 0 ? score / max : 0;
  if (r >= 0.75) return { bar: "from-emerald-400 to-emerald-500", text: "text-emerald-700" };
  if (r >= 0.45) return { bar: "from-sky-400 to-sky-500", text: "text-sky-700" };
  return { bar: "from-amber-400 to-amber-500", text: "text-amber-800" };
}

const SAMPLES = ["How do I escalate a P1 incident?", "Steps to flush the DNS cache", "What should never go in a ticket?"];

/** "Test retrieval": runs POST /knowledge/search exactly as the tutor would. */
export function SearchPanel({ onOpenDocument }: { onOpenDocument: (id: string) => void }) {
  const courses = useCourseOptions();
  const [query, setQuery] = React.useState("");
  const [courseId, setCourseId] = React.useState("none");
  const [k, setK] = React.useState("5");
  const [approvedOnly, setApprovedOnly] = React.useState(false);
  const search = useMutation({
    mutationFn: (q: string) =>
      api.post<SearchOut>("/knowledge/search", { query: q, course_id: courseId === "none" ? null : courseId, k: Number(k), approved_only: approvedOnly }),
  });
  const run = (q = query) => {
    if (q.trim()) search.mutate(q.trim());
  };
  const results = search.data?.results ?? [];
  const max = Math.max(0, ...results.map((r) => r.score));

  return (
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-soft" aria-labelledby="kb-test-h">
      <div className="border-b border-slate-100 bg-gradient-to-br from-violet-50 via-white to-fuchsia-50 p-5">
        <h2 id="kb-test-h" className="flex items-center gap-2 font-display text-base font-semibold text-slate-900">
          <span className="grid size-8 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-sm" aria-hidden>
            <FlaskConical className="size-4" />
          </span>
          Test retrieval
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">Ask what a learner might ask — see exactly which chunks the tutor would cite.</p>
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
        >
          <div className="flex gap-2">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. How do I reset someone's MFA?" aria-label="Test question" leftIcon={<Search />} maxLength={2000} />
            <Button type="submit" loading={search.isPending} disabled={!query.trim()} aria-label="Run search">
              Search
            </Button>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-2">
            <SimpleSelect aria-label="Course scope" value={courseId} onValueChange={setCourseId} options={[{ value: "none", label: "Any course (organisation)" }, ...courses.options]} className="h-9" />
            <SimpleSelect
              aria-label="Results"
              value={k}
              onValueChange={setK}
              options={["3", "5", "8", "12"].map((v) => ({ value: v, label: `${v} results` }))}
              className="h-9"
            />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl bg-white/80 px-3 py-2 ring-1 ring-inset ring-slate-200">
            <label htmlFor="kb-approved-only" className="text-xs font-medium text-slate-700">
              Approved sources only <span className="text-muted-foreground">(knowledge-only mode)</span>
            </label>
            <Switch id="kb-approved-only" checked={approvedOnly} onCheckedChange={setApprovedOnly} />
          </div>
        </form>
      </div>
      <div className="p-4 2xl:max-h-[60vh] 2xl:overflow-y-auto 2xl:scrollbar-thin" aria-live="polite" aria-busy={search.isPending}>
        {search.isPending ? (
          <div className="grid h-40 place-items-center">
            <Spinner label="Searching" />
          </div>
        ) : search.isError ? (
          <Alert tone="danger">{errorMessage(search.error)}</Alert>
        ) : !search.data ? (
          <div className="space-y-2 py-2">
            <p className="flex items-center gap-1.5 text-2xs font-bold uppercase tracking-wider text-slate-500">
              <Sparkles className="size-3.5 text-fuchsia-500" aria-hidden /> Try
            </p>
            {SAMPLES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setQuery(s);
                  run(s);
                }}
                className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:border-violet-300 hover:bg-violet-50/50 focus-visible:focus-ring"
              >
                {s}
              </button>
            ))}
          </div>
        ) : results.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No chunks matched. Add documents that cover this topic, or loosen the scope.</p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 text-xs font-medium text-slate-700">
                {results.length} result{results.length === 1 ? "" : "s"} for “{search.data.query}”
              </p>
              <span className="inline-flex max-w-full items-center gap-1 truncate rounded-full bg-slate-100 px-2 py-0.5 text-2xs font-medium text-slate-600">
                <Cpu className="size-3 shrink-0" aria-hidden /> {search.data.embedding_model}
              </span>
            </div>
            <ol className="grid gap-2.5 md:grid-cols-2 2xl:grid-cols-1">
              {results.map((r, i) => {
                const t = scoreTone(r.score, max);
                return (
                  <li key={r.chunk_id} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="flex items-start gap-2">
                      <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-slate-100 text-xs font-bold tabular-nums text-slate-600">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <button type="button" onClick={() => onOpenDocument(r.document_id)} className="group inline-flex max-w-full items-center gap-1 rounded text-left text-sm font-semibold text-slate-900 hover:text-brand-700 focus-visible:focus-ring">
                          <span className="truncate">{r.title}</span>
                          <ArrowUpRight className="size-3.5 shrink-0 opacity-60 group-hover:opacity-100" aria-hidden />
                        </button>
                        {r.heading && <p className="truncate text-2xs text-muted-foreground">{r.heading}</p>}
                      </div>
                      <span className={cn("shrink-0 text-xs font-bold tabular-nums", t.text)}>{r.score.toFixed(3)}</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`Relevance ${r.score.toFixed(3)}`}>
                      <div className={cn("h-full rounded-full bg-gradient-to-r", t.bar)} style={{ width: `${max ? Math.max(6, (r.score / max) * 100) : 0}%` }} />
                    </div>
                    <p className="mt-2 line-clamp-4 text-sm leading-relaxed text-slate-700">
                      <Highlight text={r.snippet} query={search.data.query} />
                    </p>
                    <p className="mt-1.5 text-2xs font-semibold uppercase tracking-wider text-violet-700">{r.source} match</p>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>
    </section>
  );
}
