"use client";

import type { Page } from "@praxis/types";
import { Button, EmptyState, Input, Pagination, SimpleSelect, categoryClasses, cn, colorClasses, humanize } from "@praxis/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { BookOpenCheck, Filter, Library, Search, Sparkles, X } from "lucide-react";
import * as React from "react";
import { Suspense } from "react";
import { CatalogCard, CatalogCardSkeleton } from "@/components/learn/catalog-card";
import { ErrorState } from "@/components/common/error-state";
import { DIFFICULTIES, difficultyColor } from "@/components/learn/meta";
import { lk } from "@/components/learn/query-keys";
import type { CatalogItem, CategoryCount, SkillOut } from "@/components/learn/types";
import { useUrlState } from "@/components/learn/use-url-state";
import { HeroGlow } from "@/components/learn/visuals";
import { api } from "@/lib/api";

const PAGE_SIZE = 12;

function CategoryChips({ categories, active, onSelect, total }: { categories: CategoryCount[]; active: string | null; onSelect: (c: string | null) => void; total: number | undefined }) {
  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-1 no-scrollbar" role="group" aria-label="Filter by category">
      <ul className="flex gap-2">
        <li>
          <button
            type="button"
            aria-pressed={!active}
            onClick={() => onSelect(null)}
            className={cn(
              "inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-full px-4 text-sm font-semibold ring-1 ring-inset transition focus-visible:focus-ring",
              !active ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50",
            )}
          >
            <Sparkles className="size-3.5" aria-hidden />
            All courses
            {total !== undefined && !active && <span className="rounded-full bg-white/20 px-1.5 text-2xs tabular-nums">{total}</span>}
          </button>
        </li>
        {categories.map((cat) => {
          const c = categoryClasses(cat.category);
          const on = active === cat.category;
          return (
            <li key={cat.category}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onSelect(on ? null : cat.category)}
                className={cn(
                  "inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-full px-4 text-sm font-semibold ring-1 ring-inset transition focus-visible:focus-ring",
                  on ? cn("bg-gradient-to-r text-white shadow-sm ring-transparent", c.gradient) : cn("bg-white hover:-translate-y-px", c.text, c.ring),
                )}
              >
                <span className={cn("size-2 rounded-full", on ? "bg-white" : c.solid)} aria-hidden />
                {cat.category}
                <span className={cn("rounded-full px-1.5 text-2xs tabular-nums", on ? "bg-white/25" : c.soft)}>{cat.count}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function DifficultyPills({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by difficulty">
      {[null, ...DIFFICULTIES].map((d) => {
        const on = value === d;
        const c = d ? colorClasses(difficultyColor(d)) : null;
        return (
          <button
            key={d ?? "any"}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(d)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition focus-visible:focus-ring",
              on ? (c ? cn(c.soft, c.text, "ring-1 ring-inset", c.ring) : "bg-slate-900 text-white") : "text-slate-600 hover:bg-slate-100",
            )}
          >
            {c && <span className={cn("size-1.5 rounded-full", c.solid)} aria-hidden />}
            {d ? humanize(d) : "Any level"}
          </button>
        );
      })}
    </div>
  );
}

function Catalog() {
  const url = useUrlState();
  const q = url.get("q") ?? "";
  const category = url.get("category");
  const difficulty = url.get("difficulty");
  const skill = url.get("skill");
  const show = url.get("show"); // enrolled | available
  const page = Math.max(1, Number(url.get("page")) || 1);
  const [term, setTerm] = React.useState(q);
  React.useEffect(() => setTerm(q), [q]);
  React.useEffect(() => {
    if (term === q) return;
    const t = setTimeout(() => url.set({ q: term.trim() || null, page: null }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  const params = { q, category, difficulty, skill, show, page };
  const list = useQuery({
    queryKey: lk.catalog.list(params),
    queryFn: ({ signal }) =>
      api.get<Page<CatalogItem>>("/catalog", {
        signal,
        query: {
          search: q || undefined,
          category: category ?? undefined,
          difficulty: difficulty ?? undefined,
          skill_id: skill ?? undefined,
          enrolled: show === "enrolled" ? true : show === "available" ? false : undefined,
          page,
          page_size: PAGE_SIZE,
        },
      }),
    placeholderData: keepPreviousData,
  });
  const cats = useQuery({ queryKey: lk.catalog.categories, queryFn: ({ signal }) => api.get<CategoryCount[]>("/catalog/categories", { signal }), staleTime: 300_000 });
  const skills = useQuery({ queryKey: lk.skills.list, queryFn: ({ signal }) => api.get<SkillOut[]>("/skills", { signal }), staleTime: 300_000 });

  const totalCourses = cats.data?.reduce((a, c) => a + c.count, 0);
  const filtersActive = !!(q || category || difficulty || skill || show);
  const clear = () => url.set({ q: null, category: null, difficulty: null, skill: null, show: null, page: null });
  const skillName = skills.data?.find((s) => s.id === skill)?.name;

  return (
    <div className="space-y-6">
      <section aria-labelledby="catalog-title" className="relative overflow-hidden rounded-3xl bg-brand-gradient px-6 py-8 text-white shadow-glow sm:px-10 sm:py-10">
        <HeroGlow />
        <div className="relative max-w-3xl">
          <p className="flex items-center gap-2 text-sm font-semibold text-indigo-100">
            <Library className="size-4" aria-hidden /> Course catalog
          </p>
          <h1 id="catalog-title" className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Build skills you can prove at work
          </h1>
          <p className="mt-2 max-w-2xl text-indigo-100">
            Learn, practise in realistic simulations, and earn verifiable certificates — at your own pace.
          </p>
          <form
            role="search"
            className="mt-6 flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              url.set({ q: term.trim() || null, page: null });
            }}
          >
            <div className="flex-1">
              <Input
                inputSize="lg"
                type="search"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                leftIcon={<Search />}
                placeholder="Search courses, topics or skills…"
                aria-label="Search the catalog"
                className="border-white/60 shadow-lift"
              />
            </div>
            <Button type="submit" variant="white" size="lg" leftIcon={<Search />}>
              Search
            </Button>
          </form>
          <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <div className="flex items-baseline gap-2">
              <dt className="sr-only">Courses</dt>
              <dd className="font-display text-2xl font-bold tabular-nums">{totalCourses ?? "—"}</dd>
              <span className="text-indigo-100">courses</span>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="sr-only">Categories</dt>
              <dd className="font-display text-2xl font-bold tabular-nums">{cats.data?.length ?? "—"}</dd>
              <span className="text-indigo-100">categories</span>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="sr-only">Skills</dt>
              <dd className="font-display text-2xl font-bold tabular-nums">{skills.data?.length ?? "—"}</dd>
              <span className="text-indigo-100">skills tracked</span>
            </div>
          </dl>
        </div>
      </section>

      {(cats.data?.length ?? 0) > 0 && <CategoryChips categories={cats.data ?? []} active={category} total={totalCourses} onSelect={(c) => url.set({ category: c, page: null })} />}

      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-soft lg:flex-row lg:items-center lg:justify-between">
        <DifficultyPills value={difficulty} onChange={(d) => url.set({ difficulty: d, page: null })} />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <SimpleSelect
            className="h-9 sm:w-52"
            aria-label="Filter by skill"
            value={skill ?? "any"}
            onValueChange={(v) => url.set({ skill: v === "any" ? null : v, page: null })}
            options={[{ value: "any", label: "Any skill" }, ...(skills.data ?? []).map((s) => ({ value: s.id, label: s.name }))]}
          />
          <SimpleSelect
            className="h-9 sm:w-44"
            aria-label="Enrolment"
            value={show ?? "all"}
            onValueChange={(v) => url.set({ show: v === "all" ? null : v, page: null })}
            options={[
              { value: "all", label: "All courses" },
              { value: "available", label: "Not enrolled" },
              { value: "enrolled", label: "My courses" },
            ]}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600" aria-live="polite">
          {list.isLoading ? (
            "Loading courses…"
          ) : (
            <>
              <span className="font-semibold text-slate-900">{list.data?.total ?? 0}</span> course{list.data?.total === 1 ? "" : "s"}
              {category && <> in <span className="font-semibold text-slate-900">{category}</span></>}
              {q && <> matching “<span className="font-semibold text-slate-900">{q}</span>”</>}
              {skillName && <> · skill: <span className="font-semibold text-slate-900">{skillName}</span></>}
            </>
          )}
        </p>
        {filtersActive && (
          <Button variant="ghost" size="sm" leftIcon={<X />} onClick={clear}>
            Clear filters
          </Button>
        )}
      </div>

      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.isLoading ? (
        <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" aria-busy aria-label="Loading courses">
          {Array.from({ length: 8 }).map((_, i) => (
            <li key={i}>
              <CatalogCardSkeleton />
            </li>
          ))}
        </ul>
      ) : (list.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          bordered
          illustration={filtersActive ? "search" : "learning"}
          title={filtersActive ? "No courses match those filters" : "The catalog is empty for now"}
          description={filtersActive ? "Try a different search term, category or level." : "Published courses from your organisation will appear here."}
          action={
            filtersActive ? (
              <Button variant="secondary" leftIcon={<Filter />} onClick={clear}>
                Reset filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <ul className={cn("stagger grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4", list.isFetching && "opacity-70 transition-opacity")}>
            {list.data!.items.map((c) => (
              <li key={c.id}>
                <CatalogCard course={c} />
              </li>
            ))}
          </ul>
          {(list.data?.total ?? 0) > PAGE_SIZE && (
            <Pagination page={page} pageSize={PAGE_SIZE} total={list.data!.total} onPageChange={(p) => url.set({ page: p > 1 ? p : null })} />
          )}
        </>
      )}

      <p className="flex items-center justify-center gap-2 pt-2 text-xs text-slate-500">
        <BookOpenCheck className="size-3.5" aria-hidden /> Enrolling pins the current course version — you can upgrade when a new version is published.
      </p>
    </div>
  );
}

export default function CatalogPage() {
  return (
    <Suspense fallback={null}>
      <Catalog />
    </Suspense>
  );
}
