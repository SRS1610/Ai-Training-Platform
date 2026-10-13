"use client";

import {
  Alert,
  Badge,
  BandChip,
  EmptyState,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  StatusPill,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
} from "@praxis/ui";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Bot, Clock, Database, MessageSquare, Terminal, User, Zap } from "lucide-react";
import * as React from "react";
import { Markdown } from "@/components/common/markdown";
import { useMemberName } from "@/components/grading/history-integrity";
import { sk, type ReplayOut } from "@/components/sim-builder/types";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

type Dict = Record<string, unknown>;

const CLS: Record<string, { dot: string; chip: string; label: string }> = {
  correct: { dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200", label: "Correct" },
  neutral: { dot: "bg-slate-400", chip: "bg-slate-100 text-slate-600 ring-slate-200", label: "Neutral" },
  incorrect: { dot: "bg-amber-500", chip: "bg-amber-50 text-amber-800 ring-amber-200", label: "Incorrect" },
  critical: { dot: "bg-rose-500", chip: "bg-rose-50 text-rose-700 ring-rose-200", label: "Critical" },
};

function inputText(input: unknown): string | null {
  if (!input) return null;
  if (typeof input === "string") return input;
  const i = input as Dict;
  if (typeof i.text === "string" && i.text) return i.text;
  const inner = i.input as Dict | string | null | undefined;
  if (typeof inner === "string" && inner) return inner;
  if (inner && typeof inner === "object") {
    if (typeof inner.text === "string" && inner.text) return inner.text;
    if (inner.choice !== undefined) return `Chose: ${String(inner.choice)}`;
    const parts = Object.entries(inner).filter(([, v]) => v !== null && v !== "");
    if (parts.length) return parts.map(([k, v]) => `${k.replace(/_/g, " ")}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ");
  }
  if (i.choice !== undefined) return `Chose: ${String(i.choice)}`;
  // A plain button press ({ action_id, tool, input: null }) has no typed input to show.
  if ("action_id" in i) return null;
  const rest = Object.entries(i).filter(([, v]) => v !== null && v !== "");
  return rest.length ? rest.map(([k, v]) => `${k.replace(/_/g, " ")}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ") : null;
}

function Deltas({ d }: { d: unknown }) {
  const entries = Object.entries((d ?? {}) as Record<string, number>).filter(([, v]) => v);
  if (!entries.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {entries.map(([k, v]) => (
        <span key={k} className={cn("rounded-md px-1.5 py-px text-2xs font-bold tabular-nums ring-1 ring-inset", v > 0 ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-rose-50 text-rose-700 ring-rose-200")}>
          {v > 0 ? "+" : ""}
          {v} {k.replace(/_/g, " ")}
        </span>
      ))}
    </span>
  );
}

function Timeline({ data }: { data: ReplayOut }) {
  if (!data.actions.length) return <EmptyState size="sm" illustration="inbox" title="No actions recorded" description="The learner didn't take any actions in this session." />;
  return (
    <ol className="relative space-y-4 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-slate-200">
      {data.actions.map((a) => {
        const o = (a.outcome ?? {}) as Dict;
        const cls = CLS[String(a.classification ?? o.classification ?? "neutral")] ?? CLS.neutral!;
        const label = String(o.label ?? a.action_id ?? (o.matched === "unknown" ? "Unrecognised input" : "Step"));
        const txt = inputText(a.input);
        const outputs = (o.outputs as Dict[] | undefined) ?? [];
        const reply = (a.reply ?? null) as Dict | null;
        const events = (o.events as Dict[] | undefined) ?? [];
        const changed = a.phase_before !== a.phase_after;
        return (
          <li key={String(a.seq)} className="relative flex gap-3">
            <span className={cn("relative z-10 grid size-8 shrink-0 place-items-center rounded-full text-2xs font-bold text-white ring-4 ring-white", cls.dot)}>{String(a.seq)}</span>
            <div className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="text-sm font-semibold text-slate-900">{label}</p>
                <span className={cn("rounded-full px-2 py-px text-2xs font-semibold ring-1 ring-inset", cls.chip)}>{cls.label}</span>
                {a.tool ? <span className="rounded bg-slate-100 px-1.5 font-mono text-2xs text-slate-600">{String(a.tool)}</span> : null}
                {o.sim_minutes !== undefined && (
                  <span className="ml-auto inline-flex items-center gap-0.5 text-2xs text-slate-500">
                    <Clock className="size-3" aria-hidden /> {Number(o.sim_minutes).toFixed(1)} min
                  </span>
                )}
              </div>
              {txt && (
                <p className="mt-1.5 flex gap-1.5 rounded-lg bg-indigo-50/70 px-2.5 py-1.5 text-xs text-indigo-950">
                  <User className="mt-0.5 size-3 shrink-0 text-indigo-500" aria-hidden />
                  <span className="whitespace-pre-wrap break-words">{txt}</span>
                </p>
              )}
              {outputs.map((out, i) =>
                out.format === "terminal" ? (
                  <pre key={i} className="mt-1.5 max-h-40 overflow-auto rounded-lg bg-slate-950 p-2.5 font-mono text-2xs leading-relaxed text-emerald-200 scrollbar-thin">
                    {String(out.text ?? "")}
                  </pre>
                ) : (
                  <div key={i} className="mt-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 [&_p]:text-xs [&_p]:leading-relaxed [&_li]:text-xs">
                    <Markdown className="text-xs text-slate-700">{String(out.text ?? "")}</Markdown>
                  </div>
                ),
              )}
              {reply?.text ? (
                <p className="mt-1.5 flex gap-1.5 rounded-lg bg-teal-50 px-2.5 py-1.5 text-xs text-teal-950">
                  <MessageSquare className="mt-0.5 size-3 shrink-0 text-teal-600" aria-hidden />
                  <span>
                    <span className="font-semibold">{String(reply.name ?? reply.from ?? "Character")}:</span> {String(reply.text)}
                    {a.ai_generated_reply ? (
                      <span className="ml-1 inline-flex items-center gap-0.5 text-2xs text-violet-700">
                        <Bot className="size-3" aria-hidden /> AI-phrased
                      </span>
                    ) : null}
                  </span>
                </p>
              ) : null}
              {events.map((ev, i) => (
                <p key={i} className="mt-1.5 flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-950">
                  <Zap className="size-3 text-amber-600" aria-hidden /> Event: {String(ev.title ?? ev.id ?? "event")}
                </p>
              ))}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {changed && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-2xs font-semibold text-violet-700 ring-1 ring-inset ring-violet-200">
                    {String(a.phase_before)} <ArrowRight className="size-3" aria-hidden /> {String(a.phase_after)}
                  </span>
                )}
                <Deltas d={a.score_deltas ?? o.score_deltas} />
              </div>
              {o.feedback ? <p className="mt-1.5 text-xs italic text-slate-600">{String(o.feedback)}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Transcript({ entries }: { entries: Dict[] }) {
  if (!entries.length) return <EmptyState size="sm" illustration="inbox" title="Empty transcript" />;
  return (
    <ol className="space-y-2">
      {entries.map((e, i) => {
        const learner = e.from === "learner";
        const system = e.from === "system";
        const terminal = e.format === "terminal" || e.kind === "command";
        return (
          <li key={i} className={cn("flex", learner ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-3 py-2 text-xs",
                learner ? "bg-brand-600 text-white" : system ? (e.kind === "notice" ? "bg-amber-50 text-amber-950 ring-1 ring-amber-200" : "bg-slate-100 text-slate-800") : "bg-teal-50 text-teal-950 ring-1 ring-teal-200",
                terminal && !learner && "bg-slate-950 font-mono text-emerald-200 ring-0",
                terminal && learner && "font-mono",
              )}
            >
              <p className={cn("mb-0.5 text-2xs font-semibold", learner ? "text-white/80" : "opacity-70")}>
                {learner ? "Learner" : system ? (e.kind === "notice" ? "Notice" : String(e.tool ?? "System")) : String(e.name ?? e.from)}
                {e.minutes !== undefined && ` · ${Number(e.minutes).toFixed(1)}m`}
              </p>
              <p className="whitespace-pre-wrap break-words">{String(e.text ?? "")}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function States({ states }: { states: Dict[] }) {
  if (!states.length) return <EmptyState size="sm" illustration="inbox" title="No snapshots" />;
  return (
    <ol className="space-y-2">
      {states.map((s, i) => {
        const prev = (i > 0 ? (states[i - 1]!.variables as Dict) : {}) ?? {};
        const vars = (s.variables as Dict) ?? {};
        const changed = Object.entries(vars).filter(([k, v]) => i === 0 || JSON.stringify(prev[k]) !== JSON.stringify(v));
        return (
          <li key={i} className="rounded-2xl border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <Badge tone="brand" size="sm">
                seq {String(s.seq)}
              </Badge>
              <Badge tone="violet" size="sm">
                {String(s.phase)}
              </Badge>
              <span className="text-slate-500">{String(s.reason ?? "")}</span>
            </div>
            {changed.length > 0 ? (
              <dl className="mt-2 grid gap-x-3 gap-y-0.5 font-mono text-2xs sm:grid-cols-2">
                {changed.map(([k, v]) => (
                  <div key={k} className="flex min-w-0 gap-1">
                    <dt className="text-slate-500">{k}</dt>
                    <dd className="truncate font-semibold text-slate-800" title={JSON.stringify(v)}>
                      = {JSON.stringify(v)}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="mt-1 text-2xs text-slate-500">No variable changes</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function ReplaySheet({ sessionId, onOpenChange }: { sessionId: string | null; onOpenChange: (o: boolean) => void }) {
  const q = useQuery({
    queryKey: sk.replay(sessionId ?? ""),
    queryFn: ({ signal }) => api.get<ReplayOut>(`/simulation-sessions/${sessionId}/replay`, { signal }),
    enabled: !!sessionId,
  });
  const learner = useMemberName(q.data?.session.user_id);
  const s = q.data?.session;
  return (
    <Sheet open={!!sessionId} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[96%] max-w-2xl">
        <SheetHeader>
          <SheetTitle>Session replay</SheetTitle>
          <SheetDescription>
            {s ? (
              <span className="flex flex-wrap items-center gap-1.5">
                {learner ?? "Learner"} · attempt {s.attempt_number} · started {formatDateTime(s.started_at)}
              </span>
            ) : (
              "Every action, outcome and state change, in order."
            )}
          </SheetDescription>
          {s && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <StatusPill status={s.status} size="sm" />
              {s.band && <BandChip band={s.band} size="sm" />}
              {s.total_score !== null && s.total_score !== undefined && <Badge tone={s.passed ? "success" : "danger"} size="sm">{s.total_score.toFixed(1)} / 100</Badge>}
              <Badge tone="neutral" size="sm">
                {s.action_count} actions · {s.sim_minutes_elapsed.toFixed(1)} sim min
              </Badge>
            </div>
          )}
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-6 pb-6 scrollbar-thin">
          {q.isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-2xl" />
              ))}
            </div>
          ) : q.isError ? (
            <Alert tone="danger" title="Couldn't load the replay">
              {errorMessage(q.error)}
            </Alert>
          ) : q.data ? (
            <Tabs defaultValue="timeline">
              <TabsList aria-label="Replay views">
                <TabsTrigger value="timeline">
                  <Clock aria-hidden /> Timeline ({q.data.actions.length})
                </TabsTrigger>
                <TabsTrigger value="transcript">
                  <Terminal aria-hidden /> Transcript
                </TabsTrigger>
                <TabsTrigger value="state">
                  <Database aria-hidden /> State
                </TabsTrigger>
              </TabsList>
              <TabsContent value="timeline">
                <Timeline data={q.data} />
              </TabsContent>
              <TabsContent value="transcript">
                <Transcript entries={q.data.transcript as Dict[]} />
              </TabsContent>
              <TabsContent value="state">
                <States states={q.data.states as Dict[]} />
              </TabsContent>
            </Tabs>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
