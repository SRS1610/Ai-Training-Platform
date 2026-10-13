"use client";

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ConfirmDialog, EmptyState, Progress, cn, humanize, toast } from "@praxis/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, CheckCircle2, Gavel, HelpCircle, History, Info, Quote, ShieldAlert, Undo2, XCircle } from "lucide-react";
import * as React from "react";
import { api, errorMessage } from "@/lib/api";
import { useAuth, usePermission } from "@/lib/auth";
import { formatDateTime, formatRelative } from "@/lib/format";
import { fmtPct, gk, gradePct, type GradeOut, type IntegritySignal } from "./types";

/** Resolve a staff member's display name (users.view); falls back gracefully. */
export function useMemberName(userId: string | null | undefined) {
  const { user } = useAuth();
  const canView = usePermission("users.view");
  const q = useQuery({
    queryKey: gk.member(userId ?? ""),
    queryFn: ({ signal }) => api.get<{ full_name: string }>(`/users/${userId}`, { signal }),
    enabled: !!userId && canView && userId !== user?.id,
    staleTime: 10 * 60_000,
    retry: false,
  });
  if (!userId) return null;
  if (userId === user?.id) return "You";
  return q.data?.full_name ?? "Staff member";
}

function GraderName({ id }: { id: string | null | undefined }) {
  const name = useMemberName(id);
  return <>{name ?? "System"}</>;
}

export function GradeHistory({ grades }: { grades: GradeOut[] }) {
  const sorted = [...grades].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const byId = new Map(grades.map((g) => [g.id, g]));
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-violet-50 text-violet-600">
            <History className="size-[18px]" aria-hidden />
          </span>
          <div>
            <CardTitle as="h2">Grade history</CardTitle>
            <p className="text-xs text-muted-foreground">AI recommendations and human decisions, newest first</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <EmptyState size="sm" illustration="chart" title="No grades yet" description="AI recommendations and your grades will appear here." />
        ) : (
          <ol className="relative space-y-5 before:absolute before:bottom-2 before:left-[17px] before:top-2 before:w-px before:bg-slate-200">
            {sorted.map((g) => {
              const isReturn = g.target_type === "submission_return";
              const isAI = g.source === "ai";
              const Icon = isReturn ? Undo2 : isAI ? Bot : Gavel;
              const tone = isReturn ? "bg-rose-100 text-rose-700" : isAI ? "bg-violet-100 text-violet-700" : "bg-brand-100 text-brand-700";
              const overridden = g.overrides_grade_id ? byId.get(g.overrides_grade_id) : undefined;
              return (
                <li key={g.id} className="relative flex gap-3">
                  <span className={cn("relative z-10 grid size-9 shrink-0 place-items-center rounded-full ring-4 ring-white", tone)}>
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-slate-900">
                        {isReturn ? "Returned for resubmission" : isAI ? "AI recommendation" : "Human grade"}
                      </p>
                      {!isReturn && (
                        <Badge tone={g.passed === false ? "danger" : g.passed ? "success" : "neutral"} size="sm">
                          {fmtPct(gradePct(g))}{g.passed === null || g.passed === undefined ? "" : g.passed ? " · pass" : " · fail"}
                        </Badge>
                      )}
                      {g.is_final && (
                        <Badge tone="brand" size="sm">
                          <CheckCircle2 aria-hidden /> Final
                        </Badge>
                      )}
                      {g.submission_version && <span className="text-2xs font-medium text-slate-500">v{g.submission_version}</span>}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {isAI ? (
                        <>
                          {g.ai_model ?? "AI"}
                          {g.confidence !== null && g.confidence !== undefined && ` · confidence ${Math.round(g.confidence * 100)}%`}
                        </>
                      ) : (
                        <GraderName id={g.grader_id} />
                      )}{" "}
                      · <time dateTime={g.created_at} title={formatDateTime(g.created_at)}>{formatRelative(g.created_at)}</time>
                    </p>
                    {g.override_reason && (
                      <blockquote className="mt-2 rounded-xl border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                        <p className="mb-0.5 flex items-center gap-1 text-2xs font-bold uppercase tracking-wider text-amber-800">
                          <Quote className="size-3" aria-hidden /> Override reason
                          {overridden && ` · replaced ${overridden.source === "ai" ? "AI" : "human"} ${fmtPct(gradePct(overridden))}`}
                        </p>
                        {g.override_reason}
                      </blockquote>
                    )}
                    {g.summary && <p className="mt-2 line-clamp-4 text-sm text-slate-700">{g.summary}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

const OUTCOME = {
  dismissed: { label: "Dismissed", tone: "neutral" as const, icon: XCircle },
  confirmed: { label: "Confirmed", tone: "danger" as const, icon: ShieldAlert },
  inconclusive: { label: "Inconclusive", tone: "warning" as const, icon: HelpCircle },
};

function SignalRow({ s, submissionId }: { s: IntegritySignal; submissionId: string }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = React.useState<null | keyof typeof OUTCOME>(null);
  const reviewer = useMemberName(s.reviewed_by);
  const review = useMutation({
    mutationFn: (outcome: keyof typeof OUTCOME) => api.post<IntegritySignal>(`/grading/integrity-signals/${s.id}/review`, { outcome }),
    onSuccess: (r) => {
      toast.success(`Signal marked ${OUTCOME[r.review_outcome as keyof typeof OUTCOME]?.label.toLowerCase() ?? "reviewed"}`);
      qc.invalidateQueries({ queryKey: gk.detail(submissionId) });
      qc.invalidateQueries({ queryKey: gk.all });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const pct = Math.round(s.score * 100);
  const details = (s.details ?? {}) as Record<string, unknown>;
  const outcome = s.review_outcome ? OUTCOME[s.review_outcome as keyof typeof OUTCOME] : undefined;
  return (
    <li className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">{humanize(s.signal_type)}</p>
        {outcome ? (
          <Badge tone={outcome.tone} size="sm">
            <outcome.icon aria-hidden /> {outcome.label}
            {reviewer && ` by ${reviewer}`}
          </Badge>
        ) : (
          <Badge tone="warning" size="sm">
            Awaiting review
          </Badge>
        )}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Progress value={pct} size="sm" color={pct >= 80 ? "rose" : pct >= 60 ? "amber" : "sky"} aria-label={`Signal strength ${pct}%`} className="flex-1" />
        <span className="w-12 text-right text-sm font-bold tabular-nums text-slate-900">{pct}%</span>
      </div>
      <dl className="mt-3 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
        {Object.entries(details)
          .filter(([k]) => k !== "note")
          .map(([k, v]) => (
            <div key={k} className="flex min-w-0 gap-1.5">
              <dt className="shrink-0 text-slate-500">{humanize(k)}:</dt>
              <dd className="truncate font-medium text-slate-800" title={String(v)}>
                {typeof v === "object" ? JSON.stringify(v) : String(v)}
              </dd>
            </div>
          ))}
      </dl>
      {typeof details.note === "string" && <p className="mt-2 text-xs italic text-slate-500">{details.note}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="xs" variant="secondary" onClick={() => review.mutate("dismissed")} loading={review.isPending && review.variables === "dismissed"} disabled={s.review_outcome === "dismissed"}>
          Dismiss
        </Button>
        <Button size="xs" variant="secondary" onClick={() => review.mutate("inconclusive")} loading={review.isPending && review.variables === "inconclusive"} disabled={s.review_outcome === "inconclusive"}>
          Inconclusive
        </Button>
        <Button size="xs" variant="destructive-soft" onClick={() => setConfirm("confirmed")} disabled={s.review_outcome === "confirmed"}>
          Confirm concern
        </Button>
      </div>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        destructive
        title="Confirm this integrity concern?"
        description="Confirming records that you reviewed the evidence and share the concern. It does not change the grade — follow your organisation's academic-integrity process."
        confirmLabel="Confirm concern"
        onConfirm={async () => {
          await review.mutateAsync("confirmed").catch(() => undefined);
        }}
      />
    </li>
  );
}

export function IntegrityPanel({ signals, submissionId }: { signals: IntegritySignal[]; submissionId: string }) {
  if (!signals.length) return null;
  return (
    <Card className="border-slate-300/70">
      <CardHeader>
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-slate-100 text-slate-600">
            <ShieldAlert className="size-[18px]" aria-hidden />
          </span>
          <div>
            <CardTitle as="h2">Integrity signals</CardTitle>
            <p className="text-xs font-semibold text-slate-600">Supplementary signal — never an accusation</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="flex gap-2 rounded-xl bg-sky-50 p-3 text-xs leading-relaxed text-sky-900">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Similarity and timing checks can have innocent explanations (shared templates, quoted instructions, study groups). They never change a score automatically.
        </p>
        <ul className="space-y-3">
          {signals.map((s) => (
            <SignalRow key={s.id} s={s} submissionId={submissionId} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
