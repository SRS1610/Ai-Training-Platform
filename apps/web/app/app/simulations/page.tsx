"use client";

import { Button, cn, EmptyState, FilterBar, PageHeader, Pagination, SimpleSelect, Skeleton } from "@praxis/ui";
import { useQuery } from "@tanstack/react-query";
import { MonitorPlay } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { ErrorState } from "@/components/common/error-state";
import { LauncherHero, PastSessions } from "@/components/simulation/launcher";
import { aggregateAttempts, fetchMySessions, fetchSimulations, simKeys } from "@/components/simulation/queries";
import { SimulationCard } from "@/components/simulation/sim-card";
import { DIFFICULTY, industryMeta } from "@/components/simulation/theme";

const PAGE_SIZE = 12;

function LauncherInner() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const search = params.get("q") ?? "";
  const industry = params.get("industry") ?? "";
  const difficulty = params.get("difficulty") ?? "";
  const page = Math.max(1, Number(params.get("page") ?? 1) || 1);

  const setParam = React.useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      if (!("page" in patch)) next.delete("page");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const sims = useQuery({
    queryKey: simKeys.list({ search, industry, page }),
    queryFn: ({ signal }) =>
      fetchSimulations({ status: "published", search: search || undefined, industry: industry || undefined, page, page_size: PAGE_SIZE }, signal),
  });
  // Industry pills come from an unfiltered request so they don't disappear while filtering.
  const allSims = useQuery({
    queryKey: simKeys.list({ facets: true }),
    queryFn: ({ signal }) => fetchSimulations({ status: "published", page_size: 200 }, signal),
    staleTime: 60_000,
  });
  const mine = useQuery({
    queryKey: simKeys.mySessions({ page_size: 200 }),
    queryFn: ({ signal }) => fetchMySessions({ page_size: 200 }, signal),
  });

  const stats = React.useMemo(() => aggregateAttempts(mine.data?.items ?? []), [mine.data]);
  const industries = React.useMemo(() => {
    const set = new Set<string>();
    for (const s of allSims.data?.items ?? []) set.add(s.industry);
    return [...set].sort();
  }, [allSims.data]);

  const items = (sims.data?.items ?? []).filter((s) => !difficulty || s.difficulty === difficulty);
  const titles = React.useMemo(() => new Map((allSims.data?.items ?? []).map((s) => [s.id, s])), [allSims.data]);
  const active = (mine.data?.items ?? []).find((s) => s.status === "active");

  return (
    <>
      <PageHeader
        title="Simulations"
        eyebrow="Practise"
        description="Step into realistic work environments. Talk to people, use real tools and make decisions — every action has consequences."
        icon={<MonitorPlay />}
      />

      <LauncherHero
        sessions={mine.data?.items ?? []}
        available={allSims.data?.total ?? 0}
        loading={mine.isLoading || allSims.isLoading}
        active={active}
        activeTitle={active ? titles.get(active.simulation_id)?.title : undefined}
      />

      <section aria-labelledby="sims-heading" className="mt-8">
        <h2 id="sims-heading" className="sr-only">
          Available simulations
        </h2>
        <FilterBar
          search={search}
          onSearchChange={(q) => setParam({ q })}
          searchPlaceholder="Search simulations…"
          actions={
            <SimpleSelect
              aria-label="Difficulty"
              value={difficulty || "all"}
              onValueChange={(v) => setParam({ difficulty: v === "all" ? null : v })}
              options={[{ value: "all", label: "All levels" }, ...Object.entries(DIFFICULTY).map(([value, d]) => ({ value, label: d.label }))]}
              className="w-40"
            />
          }
        >
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Industry">
            <IndustryPill label="All industries" active={!industry} onClick={() => setParam({ industry: null })} />
            {industries.map((i) => (
              <IndustryPill key={i} industry={i} active={industry === i} onClick={() => setParam({ industry: industry === i ? null : i })} />
            ))}
          </div>
        </FilterBar>

        <div className="mt-6">
          {sims.isError ? (
            <ErrorState error={sims.error} onRetry={() => sims.refetch()} />
          ) : sims.isLoading ? (
            <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3" aria-busy aria-label="Loading simulations">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-[23rem] rounded-2xl" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              bordered
              illustration="search"
              title={search || industry || difficulty ? "No simulations match your filters" : "No simulations published yet"}
              description={
                search || industry || difficulty
                  ? "Try a different search or clear the filters."
                  : "When your organisation publishes simulations they'll appear here, ready to play."
              }
              action={
                search || industry || difficulty ? (
                  <Button variant="secondary" onClick={() => router.replace(pathname)}>
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <ul className="stagger grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((s) => (
                  <li key={s.id} className="flex motion-safe:animate-fade-up">
                    <SimulationCard sim={s} stats={stats.get(s.id)} className="w-full" />
                  </li>
                ))}
              </ul>
              {(sims.data?.total ?? 0) > PAGE_SIZE && (
                <Pagination className="mt-6" page={page} pageSize={PAGE_SIZE} total={sims.data?.total ?? 0} onPageChange={(p) => setParam({ page: String(p) })} />
              )}
            </>
          )}
        </div>
      </section>

      <PastSessions sessions={mine.data?.items ?? []} loading={mine.isLoading} error={mine.error} onRetry={() => mine.refetch()} simulations={titles} />
    </>
  );
}

function IndustryPill({ industry, label, active, onClick }: { industry?: string; label?: string; active: boolean; onClick: () => void }) {
  const m = industry ? industryMeta(industry) : null;
  const Icon = m?.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium ring-1 ring-inset transition-colors focus-visible:focus-ring",
        active
          ? m
            ? cn(m.classes.soft, m.classes.text, m.classes.ring, "ring-2")
            : "bg-brand-600 text-white ring-brand-600"
          : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50 hover:text-slate-900",
      )}
    >
      {Icon && <Icon className={cn("size-4", active ? m?.classes.icon : "text-slate-400")} aria-hidden />}
      {label ?? m?.label}
    </button>
  );
}

export default function SimulationsPage() {
  return (
    <React.Suspense fallback={<Skeleton className="h-96 rounded-3xl" />}>
      <LauncherInner />
    </React.Suspense>
  );
}
