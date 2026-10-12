"use client";

import { cn } from "@praxis/ui";
import { Bell, BookMarked, ClipboardList, Lightbulb, ListTree, MessageSquare, MousePointerClick, PenLine, SquareTerminal, Target, UserRound } from "lucide-react";
import * as React from "react";
import { Markdown } from "@/components/common/markdown";
import type { Classification, SessionView, TranscriptEntry } from "../types";
import { CharacterAvatar } from "./chat-panel";
import { ProblemsList } from "./chrome";
import { useWorkspace } from "./context";
import { simClock } from "./model";

export interface StepFeedback {
  classification?: Classification;
  feedback?: string;
  score_deltas?: Record<string, number>;
}

const CLASS_STYLE: Record<string, { label: string; cls: string }> = {
  correct: { label: "Good call", cls: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  neutral: { label: "Neutral", cls: "bg-slate-100 text-slate-700 ring-slate-200" },
  incorrect: { label: "Not ideal", cls: "bg-amber-50 text-amber-900 ring-amber-200" },
  critical: { label: "Critical mistake", cls: "bg-rose-50 text-rose-800 ring-rose-200" },
};

export function FeedbackChip({ fb, className }: { fb: StepFeedback; className?: string }) {
  if (!fb.classification) return null;
  const s = CLASS_STYLE[fb.classification] ?? CLASS_STYLE.neutral!;
  const deltas = Object.entries(fb.score_deltas ?? {}).filter(([, v]) => v);
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5 rounded-lg px-2 py-0.5 text-2xs font-semibold ring-1 ring-inset", s.cls, className)}>
      {s.label}
      {deltas.map(([k, v]) => (
        <span key={k} className="font-mono font-medium opacity-80">
          {v > 0 ? "+" : ""}
          {v} {k.replace(/_/g, " ")}
        </span>
      ))}
    </span>
  );
}

type Tab = "brief" | "facts" | "log";

export function MissionColumn({ feedback, className }: { feedback: Record<number, StepFeedback>; className?: string }) {
  const { view, lastSeq } = useWorkspace();
  const [tab, setTab] = React.useState<Tab>("brief");
  const factsSeen = React.useRef(view.revealed_facts.length);
  const [newFacts, setNewFacts] = React.useState(0);
  React.useEffect(() => {
    if (tab === "facts") {
      factsSeen.current = view.revealed_facts.length;
      setNewFacts(0);
    } else setNewFacts(Math.max(0, view.revealed_facts.length - factsSeen.current));
  }, [view.revealed_facts.length, tab]);

  const tabs: { id: Tab; label: string; icon: React.ElementType; badge?: number }[] = [
    { id: "brief", label: "Brief", icon: Target },
    { id: "facts", label: "Facts", icon: BookMarked, badge: newFacts },
    { id: "log", label: "Log", icon: ListTree },
  ];

  return (
    <section className={cn("flex h-full min-h-0 flex-col bg-white", className)} aria-label="Mission">
      <div className="border-b border-slate-200/80 px-3 pt-3">
        <div className="flex gap-1" role="tablist" aria-label="Mission panels">
          {tabs.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "relative -mb-px inline-flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 pb-2.5 pt-1 text-sm font-medium transition-colors focus-visible:focus-ring",
                  tab === t.id ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800",
                )}
              >
                <Icon className="size-4" aria-hidden />
                {t.label}
                {!!t.badge && <span className="grid min-w-4 place-items-center rounded-full bg-fuchsia-500 px-1 text-2xs font-bold text-white">{t.badge}</span>}
              </button>
            );
          })}
        </div>
      </div>
      <div className="relative min-h-0 flex-1 overflow-y-auto p-4 scrollbar-thin">
        <ProblemsList problems={view.problems} className="mb-4" />
        {tab === "brief" && <Brief view={view} />}
        {tab === "facts" && <Facts view={view} lastSeq={lastSeq} />}
        {tab === "log" && <Log view={view} feedback={feedback} />}
      </div>
    </section>
  );
}

function Brief({ view }: { view: SessionView }) {
  const [more, setMore] = React.useState(false);
  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-gradient-to-br from-indigo-50 via-violet-50 to-white p-3.5 ring-1 ring-inset ring-indigo-100">
        <p className="text-2xs font-semibold uppercase tracking-wider text-indigo-700">Current phase</p>
        <p className="mt-0.5 font-display text-base font-semibold text-slate-900">{view.phase.name}</p>
        {view.phase.description && <p className="mt-0.5 text-sm text-slate-600">{view.phase.description}</p>}
      </div>
      {view.meta.learner_role && (
        <div className="flex items-center gap-2.5 text-sm">
          <span className="grid size-8 place-items-center rounded-lg bg-slate-100 text-slate-600">
            <UserRound className="size-4" aria-hidden />
          </span>
          <span>
            <span className="block text-2xs font-semibold uppercase tracking-wider text-slate-500">Your role</span>
            <span className="font-medium text-slate-900">{view.meta.learner_role}</span>
          </span>
        </div>
      )}
      {!!view.meta.objectives?.length && (
        <div>
          <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-slate-500">Objectives</h3>
          <ol className="space-y-2">
            {view.meta.objectives.map((o, i) => (
              <li key={i} className="flex gap-2.5 text-sm text-slate-700">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-md bg-emerald-50 text-2xs font-bold text-emerald-700 ring-1 ring-inset ring-emerald-200">{i + 1}</span>
                {o}
              </li>
            ))}
          </ol>
        </div>
      )}
      {view.meta.briefing && (
        <div>
          <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-slate-500">Briefing</h3>
          <div className={cn("relative overflow-hidden", !more && "max-h-28")}>
            <Markdown className="text-sm">{view.meta.briefing}</Markdown>
            {!more && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-white" aria-hidden />}
          </div>
          <button type="button" onClick={() => setMore((m) => !m)} className="mt-1 text-xs font-semibold text-brand-700 hover:underline focus-visible:focus-ring">
            {more ? "Show less" : "Read full briefing"}
          </button>
        </div>
      )}
      <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">
        <Lightbulb className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Simulated time only moves when you act. Work methodically: gather facts, test, then change things.
      </p>
    </div>
  );
}

function Facts({ view, lastSeq }: { view: SessionView; lastSeq: number }) {
  // Facts revealed by the latest step are those whose character spoke in that step.
  const freshIds = new Set(
    lastSeq > 0 && view.transcript.some((e) => e.seq === lastSeq && e.kind === "message" && e.from !== "learner") ? view.revealed_facts.slice(-1).map((f) => f.id) : [],
  );
  if (!view.revealed_facts.length)
    return (
      <div className="py-8 text-center">
        <BookMarked className="mx-auto size-8 text-fuchsia-300" aria-hidden />
        <p className="mt-2 text-sm font-medium text-slate-700">No facts established yet</p>
        <p className="text-xs text-muted-foreground">What people tell you is collected here as you ask good questions.</p>
      </div>
    );
  const byChar = new Map<string, typeof view.revealed_facts>();
  for (const f of view.revealed_facts) byChar.set(f.character, [...(byChar.get(f.character) ?? []), f]);
  return (
    <div className="space-y-4">
      {[...byChar.entries()].map(([cid, facts]) => {
        const ch = view.characters.find((c) => c.id === cid);
        return (
          <div key={cid}>
            <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-700">
              {ch && <CharacterAvatar c={ch} size="sm" className="size-6 text-[9px]" />}
              From {facts[0]!.character_name}
            </p>
            <ul className="space-y-1.5">
              {facts.map((f) => (
                <li
                  key={f.id}
                  className={cn(
                    "rounded-xl border border-fuchsia-100 bg-fuchsia-50/50 px-3 py-2 text-sm text-slate-800",
                    freshIds.has(f.id) && "ring-2 ring-fuchsia-300 motion-safe:animate-fade-up",
                  )}
                >
                  {f.text}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

const LOG_ICON: Record<string, React.ElementType> = {
  notice: Bell,
  message: MessageSquare,
  command: SquareTerminal,
  action: MousePointerClick,
  note: PenLine,
  output: ClipboardList,
};

function Log({ view, feedback }: { view: SessionView; feedback: Record<number, StepFeedback> }) {
  const end = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => end.current?.scrollIntoView({ block: "nearest" }), [view.transcript.length]);
  const items = view.transcript.filter((e) => !(e.kind === "output" && e.format === "terminal"));
  const shownFb = new Set<number>();
  return (
    <ol className="relative space-y-3 border-l border-slate-200 pl-4" aria-label="Activity log">
      {items.map((e: TranscriptEntry, i) => {
        const Icon = LOG_ICON[e.kind] ?? Bell;
        const fb = feedback[e.seq];
        const showFb = fb && e.from === "learner" && !shownFb.has(e.seq);
        if (showFb) shownFb.add(e.seq);
        const who = e.from === "learner" ? "You" : e.from === "system" ? (e.kind === "notice" ? "Notice" : "System") : (e.name ?? e.from);
        return (
          <li key={i} className="relative">
            <span
              className={cn(
                "absolute -left-[25px] top-0.5 grid size-[18px] place-items-center rounded-full ring-2 ring-white",
                e.kind === "notice" ? "bg-amber-400 text-white" : e.from === "learner" ? "bg-brand-500 text-white" : "bg-slate-200 text-slate-600",
              )}
              aria-hidden
            >
              <Icon className="size-2.5" />
            </span>
            <p className="flex items-center justify-between gap-2 text-2xs text-slate-500">
              <span className="font-semibold text-slate-700">
                {who}
                {e.to ? ` → ${view.characters.find((c) => c.id === e.to)?.name ?? e.to}` : ""}
              </span>
              <span className="font-mono tabular-nums">T+{simClock(e.minutes)}</span>
            </p>
            <p className={cn("mt-0.5 line-clamp-3 text-sm", e.kind === "command" ? "font-mono text-[12.5px] text-teal-800" : e.kind === "notice" ? "font-medium text-amber-900" : "text-slate-700")}>
              {e.kind === "command" ? `> ${e.text}` : e.text}
            </p>
            {showFb && (
              <div className="mt-1 space-y-1">
                <FeedbackChip fb={fb} />
                {fb.feedback && <p className="text-xs text-slate-600">{fb.feedback}</p>}
              </div>
            )}
          </li>
        );
      })}
      <div ref={end} />
    </ol>
  );
}
