"use client";

import { Alert, Avatar, Badge, Breadcrumbs, Button, Card, ConfirmDialog, Progress, ProgressRing, Skeleton, Tabs, TabsList, TabsTrigger, toast } from "@praxis/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, FileQuestion, Flag, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import * as React from "react";
import { ErrorState } from "@/components/common/error-state";
import { QuestionGradeCard } from "@/components/grading/quiz-review";
import { fmtPct, gk, type AttemptResult, type AttemptSummary } from "@/components/grading/types";
import { ApiError, api, errorMessage } from "@/lib/api";
import { formatDateTime, formatRelative } from "@/lib/format";

export default function AttemptReviewPage() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [filterChoice, setFilter] = React.useState<"pending" | "all" | null>(null);
  const [confirm, setConfirm] = React.useState(false);
  const [pendingLive, setPendingLive] = React.useState<number | null>(null);
  // Marks changed after the attempt was finalised → the released result is stale until re-finalised.
  const [editedAfterFinal, setEditedAfterFinal] = React.useState(false);

  const q = useQuery({
    queryKey: gk.attempt(attemptId),
    queryFn: ({ signal }) => api.get<AttemptResult>(`/attempts/${attemptId}/result`, { signal }),
    refetchOnWindowFocus: false,
  });

  const finalize = useMutation({
    mutationFn: () => api.post<AttemptSummary>(`/attempts/${attemptId}/finalize`),
    onSuccess: (r) => {
      toast.success(`Attempt finalised: ${fmtPct(r.percentage ?? 0)} · ${r.passed ? "passed" : "not passed"}`);
      qc.invalidateQueries({ queryKey: gk.all });
      router.push("/app/instructor/grading?tab=quiz");
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "answers_pending") toast.error("Some answers still need a mark before you can finalise.");
      else toast.error(errorMessage(e));
    },
  });

  if (q.isLoading)
    return (
      <div className="space-y-6" aria-busy>
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-28 rounded-3xl" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    );
  if (q.isError || !q.data)
    return (
      <div className="space-y-4">
        <Button variant="ghost" asChild leftIcon={<ArrowLeft />}>
          <Link href="/app/instructor/grading?tab=quiz">Back to queue</Link>
        </Button>
        <ErrorState error={q.error} onRetry={() => q.refetch()} size="lg" />
      </div>
    );

  const r = q.data;
  const pending = pendingLive ?? r.questions.filter((x) => x.pending_review).length;
  const total = r.questions.length;
  // Default to the answers still needing a mark; a fully marked (e.g. finalised) attempt opens on all questions.
  const filter = filterChoice ?? (r.questions.some((x) => x.pending_review) ? "pending" : "all");
  const shown = filter === "pending" ? r.questions.filter((x) => x.pending_review) : r.questions;
  const integrity = r.integrity && Object.keys(r.integrity).length ? r.integrity : null;
  const finalised = r.status === "graded";
  const canFinalise = pending === 0 && (!finalised || editedAfterFinal);

  return (
    <div className="space-y-6">
      <Breadcrumbs linkComponent={Link} items={[{ label: "Grading", href: "/app/instructor/grading" }, { label: "Quiz answers", href: "/app/instructor/grading?tab=quiz" }, { label: r.title || "Attempt" }]} />
      <section className="relative overflow-hidden rounded-3xl border border-sky-200/70 bg-gradient-to-br from-sky-50 via-white to-violet-50 p-5 shadow-soft sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-600 text-white shadow-glow">
            <FileQuestion className="size-7" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-sky-700">Manual marking</p>
            <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{r.title || "Assessment attempt"}</h1>
            <p className="mt-1 text-sm text-slate-600">
              {r.learner_name && (
                <>
                  <span className="inline-flex items-center gap-1.5 align-middle font-semibold text-slate-800">
                    <Avatar name={r.learner_name} size="xs" />
                    {r.learner_name}
                  </span>
                  {" · "}
                </>
              )}
              Attempt {r.attempt_number} · submitted {formatRelative(r.submitted_at)} ({formatDateTime(r.submitted_at)}) · pass mark {r.pass_percentage}%
              {r.late && (
                <Badge tone="danger" size="sm" className="ml-2">
                  Late
                </Badge>
              )}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <ProgressRing value={total ? ((total - pending) / total) * 100 : 100} size={64} color="sky" aria-label="Marking progress" label={<span className="text-sm font-bold tabular-nums">{total - pending}/{total}</span>} />
            <Button variant="gradient" leftIcon={<CheckCircle2 />} disabled={!canFinalise} loading={finalize.isPending} onClick={() => setConfirm(true)}>
              {finalised ? (editedAfterFinal ? "Re-finalise attempt" : "Finalised") : "Finalise attempt"}
            </Button>
          </div>
        </div>
        <div className="mt-4" aria-live="polite">
          <Progress value={total ? ((total - pending) / total) * 100 : 100} color="sky" size="sm" aria-label="Answers marked" />
          <p className="mt-1.5 text-xs text-slate-600">
            {pending > 0
              ? `${pending} answer${pending === 1 ? "" : "s"} still need${pending === 1 ? "s" : ""} a mark.`
              : finalised
                ? editedAfterFinal
                  ? "You changed a mark after finalising — re-finalise to update the learner's result."
                  : "This attempt is finalised and the result has been released."
                : "Every answer is marked — finalise to release the result."}
          </p>
        </div>
      </section>

      {finalised && (
        <Alert tone={r.passed ? "success" : "warning"} icon={<CheckCircle2 aria-hidden />} title={`Finalised: ${fmtPct(r.percentage)} · ${r.passed ? "passed" : "not passed"}`}>
          Scored {r.score ?? 0} of {r.max_score ?? 0} points against a pass mark of {fmtPct(r.pass_percentage)}. You can still adjust a mark; the result only changes when you re-finalise.
        </Alert>
      )}

      {integrity && (
        <Alert tone="info" icon={<ShieldAlert aria-hidden />} title="Proctoring events (supplementary signal — never an accusation)">
          <span className="font-mono text-xs">{Object.entries(integrity).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ")}</span>
        </Alert>
      )}

      <Tabs value={filter} onValueChange={(v) => setFilter(v as "pending" | "all")}>
        <TabsList aria-label="Questions">
          <TabsTrigger value="pending">
            <Flag /> Needs a mark ({r.questions.filter((x) => x.pending_review).length})
          </TabsTrigger>
          <TabsTrigger value="all">All questions ({total})</TabsTrigger>
        </TabsList>
      </Tabs>

      {shown.length === 0 ? (
        <Card className="p-8 text-center">
          <CheckCircle2 className="mx-auto size-10 text-emerald-500" aria-hidden />
          <p className="mt-2 font-display text-lg font-semibold text-slate-900">All answers marked</p>
          <p className="text-sm text-muted-foreground">Review all questions or finalise the attempt.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {shown.map((x) => (
            <QuestionGradeCard
              key={x.id}
              attemptId={attemptId}
              q={x}
              index={r.questions.indexOf(x)}
              onSaved={(n) => {
                setPendingLive(n);
                if (finalised) setEditedAfterFinal(true);
              }}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={finalised ? "Re-finalise this attempt?" : "Finalise this attempt?"}
        description="The attempt is scored from your marks, the learner is notified and the result is released (subject to the assessment's feedback settings)."
        confirmLabel="Finalise"
        onConfirm={async () => {
          await finalize.mutateAsync().catch(() => undefined);
        }}
      />
    </div>
  );
}
