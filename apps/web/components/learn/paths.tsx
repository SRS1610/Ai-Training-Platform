"use client";

import type { Page } from "@praxis/types";
import { Badge, Button, Card, EmptyState, ProgressRing, Skeleton, cn, colorClasses, toast, type CategoryColor } from "@praxis/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, Circle, CircleDot, Compass, Plus, Route } from "lucide-react";
import Link from "next/link";
import { ErrorState } from "@/components/common/error-state";
import { api, errorMessage } from "@/lib/api";
import { lk } from "./query-keys";
import type { MyPath, PathEnrolOut, PathOut } from "./types";
import { SectionTitle } from "./visuals";

const PATH_COLORS: CategoryColor[] = ["emerald", "violet", "sky", "amber", "fuchsia", "teal"];

function MyPathCard({ path, index }: { path: MyPath; index: number }) {
  const color = PATH_COLORS[index % PATH_COLORS.length]!;
  const c = colorClasses(color);
  const next = path.courses.find((x) => x.course_id === path.next_course_id);
  return (
    <Card className="overflow-hidden">
      <div className={cn("h-1.5 bg-gradient-to-r", c.gradient)} aria-hidden />
      <div className="p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <ProgressRing value={path.progress_pct} size={64} stroke={7} color={color} aria-label={`${path.title} progress`} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={path.status === "completed" ? "success" : path.status === "in_progress" ? "info" : "neutral"} size="sm" dot>
                {path.status === "completed" ? "Completed" : path.status === "in_progress" ? "In progress" : "Not started"}
              </Badge>
              <span className="text-xs text-slate-500">
                {path.completed_courses} of {path.required_courses} required courses
              </span>
            </div>
            <h3 className="mt-1 font-display text-lg font-semibold text-slate-900">{path.title}</h3>
            {path.description && <p className="mt-1 line-clamp-2 text-sm text-slate-600">{path.description}</p>}
          </div>
        </div>
        <ol className="relative mt-5 space-y-1">
          {path.courses.map((pc, i) => {
            const isDone = pc.status === "completed";
            const active = !isDone && pc.enrolment_id;
            const Icon = isDone ? CheckCircle2 : active ? CircleDot : Circle;
            return (
              <li key={pc.item_id} className="relative flex gap-3">
                {i < path.courses.length - 1 && (
                  <span className={cn("absolute left-[11px] top-7 h-[calc(100%-1rem)] w-0.5 rounded-full", isDone ? "bg-emerald-300" : "bg-slate-200")} aria-hidden />
                )}
                <Icon className={cn("relative mt-2 size-6 shrink-0 rounded-full bg-white", isDone ? "text-emerald-600" : active ? c.icon : "text-slate-300")} aria-hidden />
                <Link
                  href={pc.enrolment_id ? `/app/learn/${pc.course_id}` : `/app/catalog/${pc.course_id}`}
                  className="-mx-1.5 flex min-w-0 flex-1 items-center gap-3 rounded-xl px-1.5 py-2 transition hover:bg-slate-50 focus-visible:focus-ring"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-800">{pc.title}</span>
                    <span className="block text-xs text-slate-500">
                      {isDone ? "Completed" : pc.enrolment_id ? `${Math.round(pc.progress_pct)}% complete` : "Not enrolled yet"}
                      {!pc.is_required && " · Optional"}
                    </span>
                  </span>
                  <span className="sr-only">{isDone ? "(completed)" : active ? "(in progress)" : "(not started)"}</span>
                </Link>
              </li>
            );
          })}
        </ol>
        {next && (
          <Button asChild className="mt-4" size="sm" rightIcon={<ArrowRight />}>
            <Link href={next.enrolment_id ? `/app/learn/${next.course_id}` : `/app/catalog/${next.course_id}`}>Continue: {next.title}</Link>
          </Button>
        )}
      </div>
    </Card>
  );
}

function DiscoverPathCard({ path, index }: { path: PathOut; index: number }) {
  const qc = useQueryClient();
  const c = colorClasses(PATH_COLORS[(index + 2) % PATH_COLORS.length]!);
  const join = useMutation({
    mutationFn: () => api.post<PathEnrolOut>(`/learning-paths/${path.id}/join`),
    onSuccess: (r) => {
      toast.success(`Joined “${path.title}”`, { description: r.created ? `${r.created} course${r.created === 1 ? "" : "s"} added to your learning.` : undefined });
      qc.invalidateQueries({ queryKey: lk.paths.all });
      qc.invalidateQueries({ queryKey: lk.enrolments.all });
      qc.invalidateQueries({ queryKey: lk.catalog.all });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card className={cn("flex flex-col bg-gradient-to-br p-5", c.tint)}>
      <span className={cn("grid size-10 place-items-center rounded-xl bg-gradient-to-br text-white shadow-sm", c.gradient)}>
        <Route className="size-5" aria-hidden />
      </span>
      <h3 className="mt-3 font-display text-base font-semibold text-slate-900">{path.title}</h3>
      {path.description && <p className="mt-1 line-clamp-3 text-sm text-slate-600">{path.description}</p>}
      <p className="mt-3 text-xs font-medium text-slate-500">
        {path.items.length} course{path.items.length === 1 ? "" : "s"}
        {path.enrolled_users ? ` · ${path.enrolled_users} learner${path.enrolled_users === 1 ? "" : "s"}` : ""}
      </p>
      <ul className="mt-2 space-y-1">
        {path.items.slice(0, 3).map((it) => (
          <li key={it.id} className="truncate text-xs text-slate-600">
            · {it.course_title ?? "Course"}
          </li>
        ))}
        {path.items.length > 3 && <li className="text-xs text-slate-500">+{path.items.length - 3} more</li>}
      </ul>
      <Button className="mt-4 self-start" size="sm" variant="secondary" leftIcon={<Plus />} loading={join.isPending} onClick={() => join.mutate()}>
        Join path
      </Button>
    </Card>
  );
}

export function LearningPathsTab() {
  const mine = useQuery({ queryKey: lk.paths.me, queryFn: ({ signal }) => api.get<MyPath[]>("/learning-paths/me", { signal }) });
  const available = useQuery({
    queryKey: lk.paths.available,
    queryFn: ({ signal }) => api.get<Page<PathOut>>("/learning-paths", { signal, query: { status: "published", page_size: 50 } }),
  });
  const joined = new Set((mine.data ?? []).map((p) => p.id));
  const discover = (available.data?.items ?? []).filter((p) => !joined.has(p.id) && p.status === "published" && !p.is_personalised);

  return (
    <div className="space-y-8">
      <section aria-labelledby="my-paths">
        <SectionTitle id="my-paths" icon={Route} color="emerald" title="Your learning paths" description="Structured programmes of courses" />
        <div className="mt-4">
          {mine.isLoading ? (
            <div className="grid gap-5 lg:grid-cols-2">
              <Skeleton className="h-72 rounded-2xl" />
              <Skeleton className="h-72 rounded-2xl" />
            </div>
          ) : mine.isError ? (
            <ErrorState error={mine.error} onRetry={() => mine.refetch()} size="sm" />
          ) : (mine.data ?? []).length === 0 ? (
            <EmptyState bordered size="sm" illustration="rocket" title="You haven't joined a learning path yet" description="Paths bundle courses into a programme — join one below or ask your manager." />
          ) : (
            <ul className="grid gap-5 lg:grid-cols-2">
              {mine.data!.map((p, i) => (
                <li key={p.id}>
                  <MyPathCard path={p} index={i} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section aria-labelledby="discover-paths">
        <SectionTitle id="discover-paths" icon={Compass} color="violet" title="Discover paths" description="Published programmes you can join" />
        <div className="mt-4">
          {available.isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-56 rounded-2xl" />
              ))}
            </div>
          ) : available.isError ? (
            <ErrorState error={available.error} onRetry={() => available.refetch()} size="sm" />
          ) : discover.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center text-sm text-slate-600">
              No other learning paths are open right now.
            </p>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {discover.map((p, i) => (
                <li key={p.id}>
                  <DiscoverPathCard path={p} index={i} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
