"use client";

import {
  Alert,
  Badge,
  Breadcrumbs,
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
  colorClasses,
  toast,
} from "@praxis/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  BarChart3,
  BookOpen,
  ExternalLink,
  FileQuestion,
  Gauge,
  ListChecks,
  MoreHorizontal,
  Repeat,
  Rocket,
  Settings2,
  ShieldAlert,
  Shuffle,
  Timer,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { ErrorState } from "@/components/common/error-state";
import { ApiError, api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatRelative } from "@/lib/format";
import { problemsMessage, useAutosave, useSearchParamState } from "../hooks";
import { ak } from "../keys";
import { gradingLabel, kindMeta, questionMeta } from "../meta";
import { ASSESS_NAV } from "../questions/banks-list";
import { AStatus, GradientHeader, InlineTitle, SaveIndicator, SubNav } from "../shared";
import type { AssessmentDetail } from "../types";
import { useBankOptions, useCourseOptions } from "../use-options";
import { KindChip } from "./assessment-list";
import { AssessmentSettings } from "./assessment-settings";
import { AssessmentStatsPanel } from "./assessment-stats";
import { ItemsEditor, toItemsIn, toLocal, type ItemsSummary, type LocalItem } from "./items-editor";

function BuilderSkeleton() {
  return (
    <div className="space-y-6" aria-busy aria-label="Loading assessment">
      <Skeleton className="h-10 w-72" />
      <Skeleton className="h-40 rounded-3xl" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-72 rounded-3xl" />
      </div>
    </div>
  );
}

function SummaryCard({ summary, assessment }: { summary: ItemsSummary | null; assessment: AssessmentDetail }) {
  const total = summary ? summary.fixed + summary.pooled : assessment.question_count;
  const mix = summary ? [...summary.typeMix.entries()].sort((a, b) => b[1] - a[1]) : [];
  const mixTotal = mix.reduce((s, [, n]) => s + n, 0);
  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-soft">
      <div className="bg-brand-gradient p-5 text-white">
        <p className="text-xs font-semibold uppercase tracking-wider text-white">Each attempt</p>
        <p className="mt-1 font-display text-4xl font-bold tabular-nums">{total}</p>
        <p className="text-sm font-medium text-white">question{total === 1 ? "" : "s"}{summary ? ` · ~${Math.round(summary.points)} points` : ""}</p>
      </div>
      <div className="space-y-4 p-5">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-2xl bg-sky-50 p-3">
            <dt className="text-2xs font-semibold uppercase tracking-wider text-sky-700">Fixed</dt>
            <dd className="font-display text-xl font-bold tabular-nums text-slate-900">{summary?.fixed ?? "—"}</dd>
          </div>
          <div className="rounded-2xl bg-amber-50 p-3">
            <dt className="text-2xs font-semibold uppercase tracking-wider text-amber-800">From pools</dt>
            <dd className="font-display text-xl font-bold tabular-nums text-slate-900">{summary?.pooled ?? "—"}</dd>
          </div>
        </dl>
        {mixTotal > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold text-slate-700">Question type mix</p>
            <div className="flex h-3 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`Type mix: ${mix.map(([t, n]) => `${questionMeta(t).label} ${Math.round((n / mixTotal) * 100)}%`).join(", ")}`}>
              {mix.map(([t, n]) => (
                <span key={t} className={cn("h-full", colorClasses(questionMeta(t).color).solid)} style={{ width: `${(n / mixTotal) * 100}%` }} />
              ))}
            </div>
            <ul className="mt-2 space-y-1">
              {mix.slice(0, 6).map(([t, n]) => (
                <li key={t} className="flex items-center justify-between text-xs text-slate-700">
                  <span className="inline-flex items-center gap-1.5">
                    <span className={cn("size-2 rounded-full", colorClasses(questionMeta(t).color).solid)} aria-hidden />
                    {questionMeta(t).label}
                  </span>
                  <span className="tabular-nums text-muted-foreground">{Math.round((n / mixTotal) * 100)}%</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {summary && summary.shortPools > 0 && (
          <Alert tone="warning">
            {summary.shortPools} pool{summary.shortPools === 1 ? " doesn't" : "s don't"} have enough matching questions.
          </Alert>
        )}
        <ul className="space-y-2 border-t border-slate-100 pt-4 text-xs text-slate-600">
          <li className="flex items-center gap-2">
            <Gauge className="size-3.5 text-emerald-600" aria-hidden /> Pass at {Math.round(assessment.pass_percentage)}%
          </li>
          <li className="flex items-center gap-2">
            <Timer className="size-3.5 text-sky-600" aria-hidden /> {assessment.time_limit_minutes ? `${assessment.time_limit_minutes} minute limit` : "Untimed"}
          </li>
          <li className="flex items-center gap-2">
            <Repeat className="size-3.5 text-violet-600" aria-hidden /> {assessment.max_attempts ? `${assessment.max_attempts} attempts` : "Unlimited attempts"}
          </li>
          <li className="flex items-center gap-2">
            <Shuffle className="size-3.5 text-amber-600" aria-hidden /> {assessment.shuffle_questions ? "Questions shuffled" : "Fixed order"}
          </li>
        </ul>
      </div>
    </div>
  );
}

function Workspace({ assessment }: { assessment: AssessmentDetail }) {
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [get, set] = useSearchParamState(sp, router.replace, pathname);
  const { can } = useAuth();
  const tab = get("tab") ?? "questions";
  const banks = useBankOptions();
  const courses = useCourseOptions();
  const [items, setItems] = React.useState<LocalItem[]>(() => toLocal(assessment.items));
  const [summary, setSummary] = React.useState<ItemsSummary | null>(null);
  const [problems, setProblems] = React.useState<Record<string, string>>({});
  const [live, setLive] = React.useState("");
  const [confirm, setConfirm] = React.useState<"delete" | "archive" | null>(null);
  const serverIds = React.useRef<string[]>([...assessment.items].sort((a, b) => a.position - b.position).map((i) => i.id));
  const keysAtSave = React.useRef<string[]>(items.map((i) => i.key));
  const k = kindMeta(assessment.kind);

  const save = useAutosave(async (next: LocalItem[]) => {
    const out = await api.put<AssessmentDetail>(`/assessments/${assessment.id}/items`, { items: toItemsIn(next) });
    serverIds.current = [...out.items].sort((a, b) => a.position - b.position).map((i) => i.id);
    keysAtSave.current = next.map((i) => i.key);
    qc.setQueryData<AssessmentDetail>(ak.assessments.detail(assessment.id), (old) => (old ? { ...old, question_count: out.question_count, updated_at: out.updated_at } : old));
  }, 700);

  const change = (next: LocalItem[], announce?: string) => {
    setItems(next);
    setProblems({});
    if (announce) setLive(announce);
    save.schedule(next);
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ak.assessments.detail(assessment.id) });
    qc.invalidateQueries({ queryKey: ["assessments", "list"] });
  };
  const publish = useMutation({
    mutationFn: async () => {
      await save.flush();
      return api.post<AssessmentDetail>(`/assessments/${assessment.id}/publish`);
    },
    onSuccess: (a) => {
      toast.success(`“${a.title}” is published`);
      qc.setQueryData(ak.assessments.detail(assessment.id), a);
      invalidate();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "publish_blocked") {
        const d = e.details as { items?: { item_id: string; problem: string; available?: number; draw_count?: number }[] } | undefined;
        const map: Record<string, string> = {};
        for (const p of d?.items ?? []) {
          const idx = serverIds.current.indexOf(p.item_id);
          const key = keysAtSave.current[idx];
          if (key)
            map[key] =
              p.problem === "pool too small"
                ? `Item ${idx + 1}: pool has ${p.available ?? 0} of the ${p.draw_count ?? 0} questions it draws`
                : `Item ${idx + 1}: ${p.problem}`;
        }
        setProblems(map);
        set({ tab: null });
        toast.error(e.message);
      } else toast.error(problemsMessage(e));
    },
  });
  const archive = useMutation({
    mutationFn: () => api.post<AssessmentDetail>(`/assessments/${assessment.id}/archive`),
    onSuccess: (a) => {
      toast.success("Assessment archived");
      qc.setQueryData(ak.assessments.detail(assessment.id), a);
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const rename = async (title: string) => {
    try {
      const out = await api.patch<AssessmentDetail>(`/assessments/${assessment.id}`, { title });
      qc.setQueryData(ak.assessments.detail(assessment.id), out);
      toast.success("Renamed");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const course = courses.titleOf(assessment.course_id);

  return (
    <div className="space-y-5">
      <p className="sr-only" aria-live="polite">
        {live}
      </p>
      <Breadcrumbs linkComponent={Link} items={[{ label: "Assessments", href: "/app/instructor/assessments" }, { label: assessment.title }]} />
      <SubNav items={ASSESS_NAV} className="mb-0" />
      <GradientHeader color={k.color}>
        <div className="flex flex-col gap-4 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <span className={cn("hidden size-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br text-white shadow-glow sm:grid", colorClasses(k.color).gradient)}>
              <FileQuestion className="size-7" aria-hidden />
            </span>
            <div className="min-w-0">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <AStatus status={assessment.status} size="sm" />
                <KindChip kind={assessment.kind} />
                {assessment.high_stakes && (
                  <Badge tone="danger" size="sm">
                    <ShieldAlert aria-hidden /> High stakes
                  </Badge>
                )}
                <Badge tone="violet" size="sm">
                  {gradingLabel(assessment.grading_mode)}
                </Badge>
              </div>
              <InlineTitle value={assessment.title} onCommit={rename} ariaLabel="Assessment title" className="font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl" />
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <ListChecks className="size-3.5" aria-hidden /> {assessment.question_count} question{assessment.question_count === 1 ? "" : "s"} per attempt
                </span>
                {course && (
                  <Link href={`/app/instructor/courses/${assessment.course_id}`} className="inline-flex items-center gap-1 rounded hover:text-brand-700 focus-visible:focus-ring">
                    <BookOpen className="size-3.5" aria-hidden /> {course}
                  </Link>
                )}
                <span>Updated {formatRelative(assessment.updated_at)}</span>
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <SaveIndicator status={save.status} error={save.error} savedAt={save.savedAt} onRetry={() => void save.flush()} className="w-full sm:w-auto" />
            {assessment.status !== "archived" && (
              <Button asChild variant="secondary" rightIcon={<ExternalLink />}>
                <Link href={`/app/quiz/${assessment.id}`} target="_blank" rel="noopener">
                  Learner view
                </Link>
              </Button>
            )}
            {assessment.status !== "published" && (
              <Button variant="gradient" leftIcon={<Rocket />} loading={publish.isPending} onClick={() => publish.mutate()}>
                Publish
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="icon" aria-label="More actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {assessment.status === "published" && (
                  <DropdownMenuItem onSelect={() => setConfirm("archive")}>
                    <Archive /> Archive
                  </DropdownMenuItem>
                )}
                {assessment.status === "archived" && (
                  <DropdownMenuItem onSelect={() => publish.mutate()}>
                    <Rocket /> Republish
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => set({ tab: "settings" })}>
                  <Settings2 /> Settings
                </DropdownMenuItem>
                {can("assessments.manage") && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem destructive onSelect={() => setConfirm("delete")}>
                      <Trash2 /> Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </GradientHeader>

      <Tabs value={tab} onValueChange={(v) => set({ tab: v === "questions" ? null : v })}>
        <TabsList variant="underline">
          <TabsTrigger value="questions">
            <ListChecks aria-hidden /> Questions
            <span className="rounded-full bg-sky-100 px-1.5 text-2xs font-bold text-sky-800">{items.length}</span>
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings2 aria-hidden /> Settings
          </TabsTrigger>
          <TabsTrigger value="insights">
            <BarChart3 aria-hidden /> Insights
          </TabsTrigger>
        </TabsList>
        <TabsContent value="questions">
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0 space-y-3">
              <p className="text-sm text-muted-foreground">
                Drag items to reorder (keyboard: focus a handle, press space, then the arrow keys). Changes save automatically.
              </p>
              {banks.isLoading ? (
                <Skeleton className="h-48 rounded-2xl" />
              ) : (
                <ItemsEditor items={items} onChange={change} banks={banks.banks} problems={problems} onSummary={setSummary} />
              )}
            </div>
            <aside className="lg:sticky lg:top-20" aria-label="Assessment summary">
              <SummaryCard summary={summary} assessment={assessment} />
            </aside>
          </div>
        </TabsContent>
        <TabsContent value="settings">
          <AssessmentSettings key={assessment.id} assessment={assessment} />
        </TabsContent>
        <TabsContent value="insights">
          <AssessmentStatsPanel assessmentId={assessment.id} />
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={confirm === "archive"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Archive this assessment?"
        description="Learners can no longer start new attempts. Results are kept and you can republish later."
        confirmLabel="Archive"
        onConfirm={() => archive.mutateAsync().then(() => undefined)}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(o) => !o && setConfirm(null)}
        destructive
        title={`Delete “${assessment.title}”?`}
        description="Quiz lessons linked to it will block course publishing until relinked. Past attempts are kept for reporting."
        confirmLabel="Delete assessment"
        onConfirm={async () => {
          try {
            save.reset();
            await api.delete(`/assessments/${assessment.id}`);
            toast.success("Assessment deleted");
            qc.invalidateQueries({ queryKey: ["assessments", "list"] });
            router.push("/app/instructor/assessments");
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </div>
  );
}

/** /app/instructor/assessments/[id]: items (fixed + random pools), settings and item analysis. */
export function AssessmentBuilder({ assessmentId }: { assessmentId: string }) {
  const q = useQuery({
    queryKey: ak.assessments.detail(assessmentId),
    queryFn: ({ signal }) => api.get<AssessmentDetail>(`/assessments/${assessmentId}`, { signal }),
  });
  if (q.isLoading) return <BuilderSkeleton />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} size="lg" />;
  return <Workspace key={q.data.id} assessment={q.data} />;
}
