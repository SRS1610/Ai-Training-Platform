"use client";

import {
  Badge,
  Breadcrumbs,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FormField,
  ProgressRing,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  cn,
  toast,
} from "@praxis/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, BookOpen, ClipboardCheck, Clock, History, Hourglass, MessageSquareWarning, PenSquare, Repeat, RotateCcw, ShieldAlert, Sparkles, Target, Trophy } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";
import { Suspense } from "react";
import { ErrorState } from "@/components/common/error-state";
import { Markdown } from "@/components/common/markdown";
import { AssignmentBrief } from "@/components/learn/assignments/brief";
import { GradeFeedback } from "@/components/learn/assignments/feedback";
import { GRADING_MODE_LABEL, PHASE_META, canEdit, evidenceStatus, submissionPhase } from "@/components/learn/assignments/meta";
import { VersionHistory } from "@/components/learn/assignments/versions";
import { AssignmentWorkspace } from "@/components/learn/assignments/workspace";
import { lk } from "@/components/learn/query-keys";
import type { LearnerAssignment, MyEnrolment, Submission } from "@/components/learn/types";
import { useUrlState } from "@/components/learn/use-url-state";
import { DueChip } from "@/components/learn/visuals";
import { ApiError, api, errorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

const TABS = ["brief", "workspace", "history", "feedback"] as const;
/** Stacked icon + label on phones so all four tabs fit at 390px; inline from sm up. */
const TRIGGER =
  "flex-col gap-1 text-xs group-data-[variant=pill]/tabs:px-1 group-data-[variant=pill]/tabs:py-2 sm:flex-row sm:gap-2 sm:text-sm sm:group-data-[variant=pill]/tabs:px-3 sm:group-data-[variant=pill]/tabs:py-1.5";
type Tab = (typeof TABS)[number];

function RequestReview({ assignmentId, open, onOpenChange }: { assignmentId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!open) {
      setNote("");
      setError(null);
    }
  }, [open]);
  const send = async () => {
    if (!note.trim()) {
      setError("Tell the assessor what you'd like them to look at.");
      return;
    }
    setBusy(true);
    try {
      const out = await api.post<Submission>(`/assignments/${assignmentId}/submission/request-review`, { note: note.trim() });
      qc.setQueryData(lk.assignments.submission(assignmentId), out);
      toast.success("Review requested", { description: "Your instructor has been notified." });
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent size="md">
        <DialogHeader>
          <span className="mb-2 grid size-11 place-items-center rounded-2xl bg-violet-100 text-violet-600">
            <MessageSquareWarning className="size-5" aria-hidden />
          </span>
          <DialogTitle>Request a human review</DialogTitle>
          <DialogDescription>Ask an assessor to take a closer look — for example if you think the AI recommendation missed part of your evidence.</DialogDescription>
        </DialogHeader>
        <FormField label="What should the reviewer look at?" required error={error} hint="Be specific: which criterion, which part of your evidence.">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={5} maxLength={5000} placeholder="e.g. My screenshot in version 2 shows the APIPA address — I think it covers the evidence criterion." />
        </FormField>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={send} loading={busy}>
            Send request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusBanner({ s, a, onRevise, onRequestReview }: { s: Submission | null; a: LearnerAssignment; onRevise: () => void; onRequestReview: () => void }) {
  const phase = submissionPhase(s);
  if (!s || phase === "not_started" || phase === "draft") return null;
  const reviewable = ["submitted", "ai_grading", "ai_graded", "under_review", "graded_passed", "graded_failed"].includes(phase);
  const reviewBtn =
    reviewable && !s.review_requested ? (
      <Button size="sm" variant="secondary" leftIcon={<MessageSquareWarning />} onClick={onRequestReview}>
        Request review
      </Button>
    ) : null;
  const requested = s.review_requested ? (
    <p className="mt-2 rounded-xl bg-white/70 px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-200">
      <span className="font-semibold">Review requested:</span> {s.review_request_note}
    </p>
  ) : null;

  if (phase === "ai_graded")
    return (
      <section className="flex flex-col gap-4 rounded-3xl bg-gradient-to-r from-violet-50 via-fuchsia-50 to-white p-5 ring-1 ring-violet-200 sm:flex-row sm:items-center" role="status">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-sm">
          <Bot className="size-6" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-base font-semibold text-slate-900">AI recommendation — awaiting assessor</p>
          <p className="text-sm text-slate-600">
            The AI assistant has prepared a recommended score for version {s.current_version}. A human assessor reviews it and makes the final decision before any grade is released.
          </p>
          {requested}
        </div>
        {reviewBtn}
      </section>
    );
  if (phase === "returned")
    return (
      <section className="flex flex-col gap-4 rounded-3xl bg-gradient-to-r from-amber-50 via-orange-50 to-white p-5 ring-1 ring-amber-200 sm:flex-row sm:items-start" role="status">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-sm">
          <RotateCcw className="size-6" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-base font-semibold text-slate-900">Returned for changes</p>
          {s.returned_feedback ? <Markdown className="mt-1 text-sm">{s.returned_feedback}</Markdown> : <p className="text-sm text-slate-600">Your assessor asked you to revise and resubmit.</p>}
        </div>
        <Button variant="gradient" size="sm" leftIcon={<PenSquare />} onClick={onRevise}>
          Revise & resubmit
        </Button>
      </section>
    );
  if (phase === "graded_failed" && canEdit(a, s))
    return (
      <section className="flex flex-col gap-4 rounded-3xl bg-gradient-to-r from-rose-50 via-orange-50 to-white p-5 ring-1 ring-rose-200 sm:flex-row sm:items-center" role="status">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-rose-500 to-orange-500 text-white shadow-sm">
          <Target className="size-6" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-base font-semibold text-slate-900">Not passed this time — you can try again</p>
          <p className="text-sm text-slate-600">
            Use the feedback below to strengthen your work. {s.submissions_remaining !== null ? `${s.submissions_remaining} submission${s.submissions_remaining === 1 ? "" : "s"} left.` : ""}
          </p>
          {requested}
        </div>
        <div className="flex flex-wrap gap-2">
          {reviewBtn}
          <Button variant="gradient" size="sm" leftIcon={<PenSquare />} onClick={onRevise}>
            Revise & resubmit
          </Button>
        </div>
      </section>
    );
  if (phase === "graded_passed" || phase === "graded_failed") return null;
  const meta = PHASE_META[phase];
  return (
    <section className="flex flex-col gap-4 rounded-3xl bg-gradient-to-r from-sky-50 via-indigo-50 to-white p-5 ring-1 ring-indigo-100 sm:flex-row sm:items-center" role="status">
      <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-500 text-white shadow-sm">
        <meta.icon className="size-6" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-display text-base font-semibold text-slate-900">
          {meta.label} · version {s.current_version}
        </p>
        <p className="text-sm text-slate-600">
          {s.submitted_at ? `Submitted ${formatDateTime(s.submitted_at)}${s.late ? " (late)" : ""}. ` : ""}
          {meta.hint} We&apos;ll notify you when feedback is ready.
        </p>
        {requested}
      </div>
      {reviewBtn}
    </section>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-6" aria-busy aria-label="Loading assignment">
      <Skeleton className="h-4 w-56" />
      <Skeleton className="h-56 rounded-3xl" />
      <Skeleton className="h-10 w-96 rounded-xl" />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_22rem]">
        <Skeleton className="h-96 rounded-3xl" />
        <Skeleton className="h-72 rounded-3xl" />
      </div>
    </div>
  );
}

function AssignmentDetail() {
  const { id } = useParams<{ id: string }>();
  const url = useUrlState();
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const aq = useQuery({
    queryKey: lk.assignments.detail(id),
    queryFn: ({ signal }) => api.get<LearnerAssignment>(`/assignments/${id}`, { signal }),
    retry: (n, err) => !(err instanceof ApiError && err.status < 500) && n < 2,
  });
  const sq = useQuery({
    queryKey: lk.assignments.submission(id),
    queryFn: ({ signal }) => api.get<Submission | null>(`/assignments/${id}/submission`, { signal }),
    enabled: aq.isSuccess,
    refetchInterval: (query) => (query.state.data && ["submitted", "ai_grading"].includes(query.state.data.status) ? 15_000 : false),
  });
  const enrolments = useQuery({ queryKey: lk.enrolments.me, queryFn: ({ signal }) => api.get<MyEnrolment[]>("/enrolments/me", { signal }) });

  if (aq.isLoading || (aq.isSuccess && sq.isLoading)) return <DetailSkeleton />;
  if (aq.isError || !aq.data) {
    const err = aq.error;
    if (err instanceof ApiError && err.code === "not_enrolled")
      return (
        <EmptyState
          size="lg"
          illustration="shield"
          title="Enrol in the course to open this assignment"
          description="Assignments belong to a course — enrol first, then come back to start your submission."
          action={
            <Button asChild variant="gradient">
              <Link href="/app/catalog">Browse the catalog</Link>
            </Button>
          }
        />
      );
    if (err instanceof ApiError && err.status === 404)
      return (
        <EmptyState
          size="lg"
          illustration="search"
          title="Assignment not found"
          description="It may have been archived."
          action={
            <Button asChild>
              <Link href="/app/assignments">All assignments</Link>
            </Button>
          }
        />
      );
    return <ErrorState error={err} onRetry={() => aq.refetch()} size="lg" />;
  }
  if (sq.isError) return <ErrorState error={sq.error} onRetry={() => sq.refetch()} size="lg" />;

  const a = aq.data;
  const s = sq.data ?? null;
  const phase = submissionPhase(s);
  const meta = PHASE_META[phase];
  const editable = canEdit(a, s);
  const grade = s?.grade ?? null;
  const course = enrolments.data?.find((e) => e.course_id === a.course_id);
  const latest = s?.latest_version;
  const checklist = evidenceStatus(a.required_evidence, a.structured_fields, {
    text: latest?.text_content ?? "",
    code: latest?.code_content ?? "",
    structured: Object.fromEntries(Object.entries(latest?.structured_answers ?? {}).map(([k, v]) => [k, v == null ? "" : String(v)])),
    files: latest?.files ?? [],
  });
  const defaultTab: Tab = grade ? "feedback" : editable && s ? "workspace" : "brief";
  const tab = (TABS as readonly string[]).includes(url.get("tab") ?? "") ? (url.get("tab") as Tab) : defaultTab;
  const go = (t: Tab) => {
    url.set({ tab: t === defaultTab ? null : t });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const due = s?.due_at ?? (a.due_days_after_enrolment !== null && course ? new Date(new Date(course.created_at).getTime() + a.due_days_after_enrolment * 86400000).toISOString() : null);
  // After a resubmission the last grade still comes back, but it belongs to an earlier version.
  const gradeIsCurrent = phase === "graded_passed" || phase === "graded_failed";
  const gradePct = grade ? (grade.max_score && grade.max_score !== 100 ? (grade.score / grade.max_score) * 100 : grade.score) : (s?.final_score ?? null);

  return (
    <div className="space-y-6">
      <Breadcrumbs
        linkComponent={Link}
        items={[
          { label: "Assignments", href: "/app/assignments" },
          ...(course ? [{ label: course.title, href: `/app/learn/${course.course_id}` }] : []),
          { label: a.title },
        ]}
      />

      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-orange-700 via-rose-600 to-fuchsia-700 px-6 py-7 text-white shadow-glow sm:px-9 sm:py-9">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.16)_1px,transparent_0)] [background-size:20px_20px]" aria-hidden />
        <div className="pointer-events-none absolute -right-16 -top-20 size-72 rounded-full bg-white/10" aria-hidden />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 size-64 rounded-full bg-white/[0.07]" aria-hidden />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-center">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-black/15 px-2.5 py-0.5 text-xs font-semibold ring-1 ring-white/25">
                <ClipboardCheck className="size-3.5" aria-hidden /> Practical assignment
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-0.5 text-xs font-bold text-slate-800">
                <meta.icon className="size-3.5" aria-hidden /> {meta.label}
              </span>
              {a.high_stakes && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-black/15 px-2.5 py-0.5 text-xs font-semibold ring-1 ring-white/25">
                  <ShieldAlert className="size-3.5" aria-hidden /> High stakes
                </span>
              )}
            </div>
            <h1 className="mt-3 font-display text-2xl font-bold tracking-tight sm:text-3xl">{a.title}</h1>
            {course && (
              <p className="mt-1.5 flex items-center gap-1.5 text-sm text-white/95">
                <BookOpen className="size-4" aria-hidden />
                <Link href={`/app/learn/${course.course_id}`} className="font-semibold underline-offset-4 hover:underline focus-visible:focus-ring">
                  {course.title}
                </Link>
              </p>
            )}
            <ul className="mt-5 flex flex-wrap gap-2 text-xs font-semibold text-slate-800">
              <li className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 shadow-sm">
                <Target className="size-3.5 text-emerald-600" aria-hidden /> Pass mark {Math.round(a.passing_score)}%
              </li>
              <li className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 shadow-sm">
                {a.grading_mode.startsWith("ai") ? <Sparkles className="size-3.5 text-fuchsia-600" aria-hidden /> : <ClipboardCheck className="size-3.5 text-violet-600" aria-hidden />}
                {GRADING_MODE_LABEL[a.grading_mode] ?? a.grading_mode}
              </li>
              <li className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 shadow-sm">
                <Repeat className="size-3.5 text-sky-600" aria-hidden />
                {a.max_submissions ? `${s?.submit_count ?? 0} of ${a.max_submissions} submissions used` : "Unlimited submissions"}
              </li>
              {a.time_limit_minutes ? (
                <li className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 shadow-sm">
                  <Clock className="size-3.5 text-amber-600" aria-hidden /> {a.time_limit_minutes} min suggested
                </li>
              ) : null}
            </ul>
            {due && phase !== "graded_passed" && (
              <div className="mt-3 [&_span]:bg-white [&_span]:ring-0">
                <DueChip date={due} size="md" />
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-4 rounded-2xl bg-black/10 p-4 ring-1 ring-white/25 md:flex-col md:px-6">
            <div className="rounded-full bg-white p-1.5">
              {gradePct !== null ? (
                <ProgressRing value={gradePct} size={96} stroke={9} color={s?.passed ? "emerald" : "amber"} aria-label={`${gradeIsCurrent ? "Final" : "Previous"} score ${Math.round(gradePct)}%`} />
              ) : (
                <span className="grid size-24 place-items-center rounded-full bg-gradient-to-br from-amber-50 to-orange-100 text-orange-600">
                  {phase === "ai_graded" || phase === "submitted" || phase === "ai_grading" || phase === "under_review" ? <Hourglass className="size-9" aria-hidden /> : <ClipboardCheck className="size-9" aria-hidden />}
                </span>
              )}
            </div>
            <div className="md:text-center">
              <p className="text-xs font-semibold uppercase tracking-wider text-white/90">{gradePct === null ? "Status" : gradeIsCurrent ? "Final score" : "Previous score"}</p>
              <p className="text-sm font-semibold">{gradePct !== null && gradeIsCurrent ? (s?.passed ? "Passed" : "Not passed") : meta.label}</p>
            </div>
          </div>
        </div>
      </section>

      <StatusBanner s={s} a={a} onRevise={() => go("workspace")} onRequestReview={() => setReviewOpen(true)} />

      <Tabs value={tab} onValueChange={(v) => go(v as Tab)}>
        <TabsList aria-label="Assignment sections" className="grid w-full grid-cols-4 sm:inline-flex sm:w-auto">
          <TabsTrigger value="brief" className={TRIGGER}>
            <BookOpen aria-hidden /> Brief
          </TabsTrigger>
          <TabsTrigger value="workspace" className={TRIGGER}>
            <PenSquare aria-hidden /> Workspace
            {editable && s?.current_version ? <span className="hidden text-xs tabular-nums text-slate-500 sm:inline">v{s.current_version}</span> : null}
          </TabsTrigger>
          <TabsTrigger value="history" className={TRIGGER}>
            <History aria-hidden /> Versions
            {s?.current_version ? <span className="hidden text-xs tabular-nums text-slate-500 sm:inline">{s.current_version}</span> : null}
          </TabsTrigger>
          <TabsTrigger value="feedback" className={cn(TRIGGER, "relative")}>
            <Trophy aria-hidden /> Feedback
            {grade ? <span className="absolute right-2 top-1.5 size-1.5 rounded-full bg-emerald-500 sm:static" aria-label="available" /> : null}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="brief">
          <AssignmentBrief a={a} checklist={checklist} />
          {editable && (
            <div className="mt-6 flex justify-center">
              <Button variant="gradient" size="lg" leftIcon={<PenSquare />} onClick={() => go("workspace")}>
                {s ? "Continue working" : "Start my submission"}
              </Button>
            </div>
          )}
        </TabsContent>
        {/* Force-mounted so switching tabs never discards unsaved workspace edits. */}
        <TabsContent value="workspace" forceMount hidden={tab !== "workspace"}>
          <AssignmentWorkspace assignment={a} submission={s} onSubmitted={() => go("history")} />
        </TabsContent>
        <TabsContent value="history">
          <div className="max-w-4xl">
            <VersionHistory assignmentId={a.id} />
          </div>
        </TabsContent>
        <TabsContent value="feedback">
          {grade ? (
            <>
              <GradeFeedback grade={grade} assignment={a} />
              <div className="mt-6 flex flex-col gap-3 rounded-3xl border border-dashed border-slate-300 bg-white/70 p-5 sm:flex-row sm:items-center">
                <MessageSquareWarning className="size-5 shrink-0 text-violet-600" aria-hidden />
                {s?.review_requested ? (
                  <p className="flex-1 text-sm text-slate-700">
                    <span className="font-semibold text-slate-900">Review requested.</span> {s.review_request_note}
                  </p>
                ) : (
                  <>
                    <p className="flex-1 text-sm text-slate-700">
                      <span className="font-semibold text-slate-900">Think something was missed?</span> Ask an assessor to take another look at this grade.
                    </p>
                    <Button size="sm" variant="secondary" onClick={() => setReviewOpen(true)}>
                      Request review
                    </Button>
                  </>
                )}
              </div>
            </>
          ) : phase === "ai_graded" ? (
            <EmptyState
              bordered
              illustration={
                <span className="grid size-20 place-items-center rounded-3xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-glow">
                  <Bot className="size-9" aria-hidden />
                </span>
              }
              title="AI recommendation — awaiting assessor"
              description="Your score and written feedback appear here once an assessor confirms or adjusts the AI's recommendation."
            />
          ) : (
            <EmptyState
              bordered
              illustration="chart"
              title={phase === "not_started" || phase === "draft" ? "Feedback appears after you submit" : "Feedback is on its way"}
              description={
                phase === "not_started" || phase === "draft"
                  ? "Submit your work and your assessor's rubric scores, strengths and next steps will show up here."
                  : "Your submission is being assessed. You'll get a notification as soon as feedback is released."
              }
              action={
                editable ? (
                  <Button variant="gradient" onClick={() => go("workspace")}>
                    Open workspace
                  </Button>
                ) : undefined
              }
            />
          )}
        </TabsContent>
      </Tabs>

      <p className={cn("flex items-center justify-center gap-2 text-center text-xs text-slate-500")}>
        <Sparkles className="size-3.5 shrink-0 text-fuchsia-500" aria-hidden />
        AI may recommend a score, but {a.grading_mode === "ai_assisted" ? "you can always request a human review." : "a human assessor makes every final decision."}
      </p>
      <RequestReview assignmentId={a.id} open={reviewOpen} onOpenChange={setReviewOpen} />
      {!editable && phase === "not_started" && <Badge tone="neutral">This assignment is closed for submissions.</Badge>}
    </div>
  );
}

export default function AssignmentPage() {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <AssignmentDetail />
    </Suspense>
  );
}
