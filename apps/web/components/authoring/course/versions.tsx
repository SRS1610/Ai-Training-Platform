"use client";

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SimpleSelect,
  Skeleton,
  cn,
  colorClasses,
  humanize,
  type CategoryColor,
} from "@praxis/ui";
import { useQuery } from "@tanstack/react-query";
import { ArrowRightLeft, Eye, GitCompare, History, Minus, Pencil, Plus, Settings2, User } from "lucide-react";
import * as React from "react";
import { ErrorState } from "@/components/common/error-state";
import { api } from "@/lib/api";
import { formatDateTime, formatMinutes, formatRelative } from "@/lib/format";
import { ak } from "../keys";
import { lessonMeta } from "../meta";
import { SectionCard, TypeChip } from "../shared";
import type { Course, DiffLesson, SnapshotLesson, VersionDetail, VersionDiff, VersionSummary } from "../types";
import { LessonRender } from "./lesson-render";

/* ------------------------------------------------------------------ diff */

const FIELD_LABEL: Record<string, string> = {
  content: "content",
  activities: "blocks",
  lesson_type: "type",
  duration_minutes: "duration",
  is_required: "required",
  is_preview: "preview",
  assessment_id: "linked quiz",
  assignment_id: "linked assignment",
  simulation_id: "linked simulation",
};

function DiffRow({ l, color, icon: Icon, extra }: { l: DiffLesson; color: CategoryColor; icon: typeof Plus; extra?: React.ReactNode }) {
  const c = colorClasses(color);
  const meta = lessonMeta(l.lesson_type);
  return (
    <li className={cn("flex items-start gap-2.5 rounded-xl border px-3 py-2", c.border, c.soft)}>
      <span className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-md text-white", c.solid)} aria-hidden>
        <Icon className="size-3" />
      </span>
      <TypeChip meta={meta} size="xs" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-slate-900">{l.title}</span>
        <span className="block truncate text-2xs text-slate-600">in {l.module_title}</span>
        {extra}
      </span>
    </li>
  );
}

export function DiffSummary({ diff, compact }: { diff: VersionDiff; compact?: boolean }) {
  const s = diff.summary;
  const nothing =
    s.added + s.removed + s.changed + s.moved === 0 &&
    !diff.modules_added.length &&
    !diff.modules_removed.length &&
    !diff.modules_renamed.length &&
    !diff.course_fields_changed.length;
  if (nothing) return <p className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-muted-foreground">No differences.</p>;
  const groups: { key: string; label: string; color: CategoryColor; icon: typeof Plus; items: DiffLesson[]; extra?: (l: DiffLesson) => React.ReactNode }[] = [
    { key: "added", label: "Added", color: "emerald", icon: Plus, items: diff.lessons_added },
    { key: "removed", label: "Removed", color: "rose", icon: Minus, items: diff.lessons_removed },
    {
      key: "changed",
      label: "Changed",
      color: "amber",
      icon: Pencil,
      items: diff.lessons_changed,
      extra: (l) => (
        <span className="mt-1 flex flex-wrap gap-1">
          {(l.fields ?? []).map((f) => (
            <span key={f} className="rounded-full bg-white px-1.5 py-0.5 text-2xs font-semibold text-amber-800 ring-1 ring-amber-200">
              {FIELD_LABEL[f] ?? humanize(f).toLowerCase()}
            </span>
          ))}
        </span>
      ),
    },
    { key: "moved", label: "Moved", color: "sky", icon: ArrowRightLeft, items: diff.lessons_moved },
  ];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {groups.map((g) => (
          <Badge key={g.key} tone={g.color === "emerald" ? "success" : g.color === "rose" ? "danger" : g.color === "amber" ? "warning" : "info"} dot>
            {g.items.length} {g.label.toLowerCase()}
          </Badge>
        ))}
        {diff.course_fields_changed.length > 0 && (
          <Badge tone="violet" dot>
            {diff.course_fields_changed.length} setting{diff.course_fields_changed.length === 1 ? "" : "s"}
          </Badge>
        )}
      </div>
      <div className={cn("grid gap-3", !compact && "lg:grid-cols-2")}>
        {groups
          .filter((g) => g.items.length)
          .map((g) => (
            <div key={g.key}>
              {!compact && <p className={cn("mb-1.5 text-2xs font-bold uppercase tracking-wider", colorClasses(g.color).text)}>{g.label} lessons</p>}
              <ul className={cn("space-y-1.5", compact && "max-h-48 overflow-y-auto scrollbar-thin")}>
                {g.items.map((l) => (
                  <DiffRow key={`${g.key}-${l.id}`} l={l} color={g.color} icon={g.icon} extra={g.extra?.(l)} />
                ))}
              </ul>
            </div>
          ))}
      </div>
      {(diff.modules_added.length > 0 || diff.modules_removed.length > 0 || diff.modules_renamed.length > 0) && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          {diff.modules_added.map((m) => (
            <span key={m.id} className="rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-800 ring-1 ring-emerald-200">
              + Module “{m.title}”
            </span>
          ))}
          {diff.modules_removed.map((m) => (
            <span key={m.id} className="rounded-full bg-rose-50 px-2.5 py-1 font-medium text-rose-800 ring-1 ring-rose-200 line-through decoration-rose-300">
              Module “{m.title}”
            </span>
          ))}
          {diff.modules_renamed.map((m) => (
            <span key={m.id} className="rounded-full bg-sky-50 px-2.5 py-1 font-medium text-sky-800 ring-1 ring-sky-200">
              “{m.from}” → “{m.to}”
            </span>
          ))}
        </div>
      )}
      {diff.course_fields_changed.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
          <Settings2 className="size-3.5 text-violet-600" aria-hidden /> Course settings changed:
          {diff.course_fields_changed.map((f) => (
            <span key={f} className="rounded-full bg-violet-50 px-2 py-0.5 font-semibold text-violet-800 ring-1 ring-violet-200">
              {humanize(f).toLowerCase()}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ snapshot viewer */

function SnapshotSheet({ courseId, number, onOpenChange }: { courseId: string; number: number | null; onOpenChange: (o: boolean) => void }) {
  const q = useQuery({
    queryKey: ak.courses.version(courseId, number ?? 0),
    enabled: number !== null,
    queryFn: ({ signal }) => api.get<VersionDetail>(`/courses/${courseId}/versions/${number}`, { signal }),
  });
  const [sel, setSel] = React.useState<SnapshotLesson | null>(null);
  React.useEffect(() => setSel(null), [number]);
  const snap = q.data?.snapshot;
  return (
    <Sheet open={number !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full max-w-none overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>Version {number} snapshot</SheetTitle>
          <SheetDescription>Read-only copy of exactly what learners on this version see. Answer keys are stripped.</SheetDescription>
        </SheetHeader>
        <div className="px-6 pb-8">
          {q.isLoading ? (
            <Skeleton className="h-72 rounded-2xl" />
          ) : q.isError ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} size="sm" />
          ) : snap ? (
            sel ? (
              <div className="space-y-4">
                <Button variant="ghost" size="sm" onClick={() => setSel(null)}>
                  ← Back to outline
                </Button>
                <LessonRender lesson={{ ...sel, activities: sel.activities.map((a) => ({ ...a, content: a.content })) }} />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-brand-50 via-white to-white p-4">
                  <p className="font-display text-lg font-semibold text-slate-900">{snap.course.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {snap.stats.module_count} modules · {snap.stats.lesson_count} lessons · {formatMinutes(snap.stats.duration_minutes ?? 0)}
                  </p>
                </div>
                {snap.modules.map((m, i) => (
                  <section key={m.id}>
                    <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">
                      Module {i + 1} · {m.title}
                    </p>
                    <ul className="space-y-1">
                      {m.lessons.map((l) => (
                        <li key={l.id}>
                          <button type="button" onClick={() => setSel(l)} className="flex w-full items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left hover:border-brand-300 hover:bg-brand-50/40 focus-visible:focus-ring">
                            <TypeChip meta={lessonMeta(l.lesson_type)} size="xs" />
                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{l.title}</span>
                            <span className="text-2xs text-muted-foreground">{l.duration_minutes}m</span>
                            <Eye className="size-3.5 text-slate-400" aria-hidden />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ versions panel */

export function VersionsPanel({ course, hasUnpublished }: { course: Course; hasUnpublished: boolean }) {
  const versions = useQuery({
    queryKey: ak.courses.versions(course.id),
    queryFn: ({ signal }) => api.get<VersionSummary[]>(`/courses/${course.id}/versions`, { signal }),
  });
  const list = React.useMemo(() => versions.data ?? [], [versions.data]);
  const [from, setFrom] = React.useState<string>("");
  const [to, setTo] = React.useState<string>("draft");
  const [view, setView] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (list.length && !from) setFrom(String(list[0]!.version_number));
  }, [list, from]);

  const diff = useQuery({
    queryKey: ak.courses.diff(course.id, Number(from), to),
    enabled: !!from && from !== to,
    queryFn: ({ signal }) => api.get<VersionDiff>(`/courses/${course.id}/versions/diff`, { signal, query: { from, to } }),
    staleTime: 0,
  });

  if (versions.isLoading)
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  if (versions.isError) return <ErrorState error={versions.error} onRetry={() => versions.refetch()} />;
  if (!list.length)
    return (
      <Card className="p-6">
        <EmptyState
          illustration="rocket"
          title="No published versions yet"
          description="When you publish, Praxis freezes the draft into version 1. Every later publish adds a version you can compare and inspect here."
        />
      </Card>
    );

  const options = [
    { value: "draft", label: hasUnpublished ? "Current draft •" : "Current draft" },
    ...list.map((v) => ({ value: String(v.version_number), label: `Version ${v.version_number}` })),
  ];

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <SectionCard title="Compare versions" description="See exactly what changed between any two versions or the draft" icon={GitCompare} color="sky">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <SimpleSelect aria-label="Compare from" value={from} onValueChange={setFrom} options={list.map((v) => ({ value: String(v.version_number), label: `Version ${v.version_number}` }))} className="sm:w-44" />
          <ArrowRightLeft className="mx-auto size-4 text-slate-400 sm:mx-0" aria-hidden />
          <SimpleSelect aria-label="Compare to" value={to} onValueChange={setTo} options={options.filter((o) => o.value !== from)} className="sm:w-44" />
        </div>
        {from === to ? (
          <p className="text-sm text-muted-foreground">Pick two different versions.</p>
        ) : diff.isLoading ? (
          <Skeleton className="h-40 rounded-2xl" />
        ) : diff.isError ? (
          <ErrorState error={diff.error} onRetry={() => diff.refetch()} size="sm" />
        ) : diff.data ? (
          <DiffSummary diff={diff.data} />
        ) : null}
      </SectionCard>

      <SectionCard title="History" description={`${list.length} published version${list.length === 1 ? "" : "s"}`} icon={History} color="violet">
        <ol className="relative space-y-4 before:absolute before:bottom-2 before:left-[18px] before:top-2 before:w-0.5 before:bg-gradient-to-b before:from-violet-200 before:to-slate-100">
          {list.map((v) => {
            const live = v.status === "published";
            return (
              <li key={v.id} className="relative flex gap-3">
                <span className={cn("relative z-10 grid size-9 shrink-0 place-items-center rounded-full text-xs font-bold ring-4 ring-white", live ? "bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-sm" : "bg-slate-100 text-slate-600")}>
                  v{v.version_number}
                </span>
                <div className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={live ? "success" : "neutral"} size="sm" dot>
                      {live ? "Live" : humanize(v.status)}
                    </Badge>
                    <span className="text-2xs text-muted-foreground" title={formatDateTime(v.published_at)}>
                      {formatRelative(v.published_at)}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm text-slate-800">{v.changelog || <span className="italic text-slate-400">No changelog</span>}</p>
                  <p className="mt-1 flex items-center gap-1 text-2xs text-muted-foreground">
                    <User className="size-3" aria-hidden /> {v.published_by_name ?? "Unknown"} · {v.stats.lesson_count ?? 0} lessons
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Button size="xs" variant="secondary" leftIcon={<Eye />} onClick={() => setView(v.version_number)}>
                      View
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      leftIcon={<GitCompare />}
                      onClick={() => {
                        setFrom(String(v.version_number));
                        setTo("draft");
                      }}
                    >
                      Compare with draft
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </SectionCard>
      <SnapshotSheet courseId={course.id} number={view} onOpenChange={(o) => !o && setView(null)} />
    </div>
  );
}
