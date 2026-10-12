"use client";

import { Button, EmptyState, KpiTile, PageHeader, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@praxis/ui";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, BookOpen, CheckCircle2, ClipboardCheck, ClipboardList, Library, PlayCircle, Route, Trophy } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { ErrorState } from "@/components/common/error-state";
import { EnrolmentCard } from "@/components/learn/enrolment-card";
import { LearningPathsTab } from "@/components/learn/paths";
import { lk } from "@/components/learn/query-keys";
import type { MyEnrolment, MyPath } from "@/components/learn/types";
import { useUrlState } from "@/components/learn/use-url-state";
import { api } from "@/lib/api";

const TABS = ["in-progress", "assigned", "completed", "paths"] as const;
type Tab = (typeof TABS)[number];

function ListSkeleton() {
  return (
    <div className="space-y-4" aria-busy aria-label="Loading">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-32 rounded-2xl" />
      ))}
    </div>
  );
}

function EnrolmentList({ items, emphasiseDue }: { items: MyEnrolment[]; emphasiseDue?: boolean }) {
  return (
    <ul className="stagger space-y-4">
      {items.map((e) => (
        <li key={e.id}>
          <EnrolmentCard e={e} emphasiseDue={emphasiseDue} />
        </li>
      ))}
    </ul>
  );
}

function MyLearning() {
  const url = useUrlState();
  const tab = (TABS as readonly string[]).includes(url.get("tab") ?? "") ? (url.get("tab") as Tab) : "in-progress";
  const q = useQuery({ queryKey: lk.enrolments.me, queryFn: ({ signal }) => api.get<MyEnrolment[]>("/enrolments/me", { signal }) });
  const paths = useQuery({ queryKey: lk.paths.me, queryFn: ({ signal }) => api.get<MyPath[]>("/learning-paths/me", { signal }) });

  const all = q.data ?? [];
  const active = all.filter((e) => e.status !== "completed");
  const assigned = active
    .filter((e) => e.source !== "self")
    .sort((a, b) => Number(b.is_overdue) - Number(a.is_overdue) || (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
  const completed = all.filter((e) => e.status === "completed").sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));
  const overdue = assigned.filter((e) => e.is_overdue).length;

  return (
    <>
      <PageHeader
        title="My learning"
        description="Pick up where you left off, keep on top of assigned training and track your paths."
        icon={<BookOpen />}
        actions={
          <>
            <Button asChild variant="secondary" leftIcon={<ClipboardCheck />}>
              <Link href="/app/assignments">Assignments</Link>
            </Button>
            <Button asChild variant="secondary" leftIcon={<Trophy />} className="hidden sm:inline-flex">
              <Link href="/app/achievements">Achievements</Link>
            </Button>
            <Button asChild variant="gradient" leftIcon={<Library />}>
              <Link href="/app/catalog">Browse catalog</Link>
            </Button>
          </>
        }
      />

      <section aria-label="Summary" className="stagger mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiTile label="In progress" value={q.isLoading ? "—" : active.length} icon={<PlayCircle />} color="sky" hint="Active courses" />
        <KpiTile
          label="Assigned"
          value={q.isLoading ? "—" : assigned.length}
          icon={<ClipboardList />}
          color={overdue ? "rose" : "violet"}
          hint={overdue ? `${overdue} overdue` : "By your organisation"}
        />
        <KpiTile label="Completed" value={q.isLoading ? "—" : completed.length} icon={<Trophy />} color="emerald" hint="Courses finished" />
        <KpiTile label="Learning paths" value={paths.isLoading ? "—" : (paths.data?.length ?? 0)} icon={<Route />} color="amber" hint="Programmes joined" />
      </section>

      {overdue > 0 && tab !== "assigned" && (
        <button
          type="button"
          onClick={() => url.set({ tab: "assigned" })}
          className="mb-6 flex w-full items-center gap-3 rounded-2xl border border-rose-200 bg-gradient-to-r from-rose-50 to-orange-50 p-4 text-left text-sm text-rose-900 transition hover:shadow-soft focus-visible:focus-ring"
        >
          <AlertTriangle className="size-5 shrink-0 text-rose-600" aria-hidden />
          <span className="flex-1">
            <strong className="font-semibold">{overdue} assigned course{overdue === 1 ? " is" : "s are"} overdue.</strong> Review your assigned training.
          </span>
          <span className="font-semibold text-rose-700">View</span>
        </button>
      )}

      <Tabs value={tab} onValueChange={(v) => url.set({ tab: v === "in-progress" ? null : v })}>
        <TabsList aria-label="My learning sections">
          <TabsTrigger value="in-progress">
            <PlayCircle aria-hidden /> In progress <span className="text-xs tabular-nums text-slate-500">{active.length}</span>
          </TabsTrigger>
          <TabsTrigger value="assigned">
            <ClipboardList aria-hidden /> Assigned <span className={overdue ? "text-xs font-semibold tabular-nums text-rose-600" : "text-xs tabular-nums text-slate-500"}>{assigned.length}</span>
          </TabsTrigger>
          <TabsTrigger value="completed">
            <CheckCircle2 aria-hidden /> Completed <span className="text-xs tabular-nums text-slate-500">{completed.length}</span>
          </TabsTrigger>
          <TabsTrigger value="paths">
            <Route aria-hidden /> Learning paths
          </TabsTrigger>
        </TabsList>

        {q.isError ? (
          tab !== "paths" && <ErrorState error={q.error} onRetry={() => q.refetch()} className="mt-5" />
        ) : (
          <>
            <TabsContent value="in-progress">
              {q.isLoading ? (
                <ListSkeleton />
              ) : active.length === 0 ? (
                <EmptyState
                  bordered
                  illustration="learning"
                  title="Nothing in progress"
                  description="Enrol in a course from the catalog and it will show up here."
                  action={
                    <Button asChild variant="gradient">
                      <Link href="/app/catalog">Explore courses</Link>
                    </Button>
                  }
                />
              ) : (
                <EnrolmentList items={active} />
              )}
            </TabsContent>
            <TabsContent value="assigned">
              {q.isLoading ? (
                <ListSkeleton />
              ) : assigned.length === 0 ? (
                <EmptyState bordered illustration="inbox" title="No assigned training" description="Courses your manager or organisation assigns to you will appear here with their due dates." />
              ) : (
                <EnrolmentList items={assigned} emphasiseDue />
              )}
            </TabsContent>
            <TabsContent value="completed">
              {q.isLoading ? (
                <ListSkeleton />
              ) : completed.length === 0 ? (
                <EmptyState bordered illustration="trophy" title="No completed courses yet" description="Finish a course to earn your first certificate." />
              ) : (
                <>
                  <EnrolmentList items={completed} />
                  <p className="mt-4 text-center text-sm text-slate-600">
                    Looking for your credentials?{" "}
                    <Link href="/app/certificates" className="font-semibold text-brand-700 hover:underline">
                      View certificates
                    </Link>
                  </p>
                </>
              )}
            </TabsContent>
          </>
        )}
        <TabsContent value="paths">
          <LearningPathsTab />
        </TabsContent>
      </Tabs>
    </>
  );
}

export default function MyLearningPage() {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <MyLearning />
    </Suspense>
  );
}
