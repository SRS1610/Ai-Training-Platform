"use client";

import type { Page } from "@praxis/types";
import { Button, EmptyState, FilterBar, PageHeader, Pagination, SectionHeader, SimpleSelect, Skeleton, Tabs, TabsList, TabsTrigger } from "@praxis/ui";
import { useQuery } from "@tanstack/react-query";
import { Plus, Wand2, Workflow } from "lucide-react";
import { Suspense, useState } from "react";
import { ErrorState } from "@/components/common/error-state";
import { AccessGate } from "@/components/grading/access-gate";
import { useUrlState } from "@/components/grading/use-url-state";
import { AIBuildDialog, CreateBlankDialog, TemplateDialog } from "@/components/sim-builder/create-dialogs";
import { SimulationCard, SimulationGridSkeleton, StartCards, TemplateCard } from "@/components/sim-builder/list";
import { INDUSTRIES } from "@/components/sim-builder/theme";
import { sk, type SimulationOut, type TemplateOut } from "@/components/sim-builder/types";
import { api } from "@/lib/api";
import { Can } from "@/lib/auth";

const PAGE_SIZE = 12;
const KEYS = ["status", "industry", "q", "page"] as const;

function SimulationsList() {
  const [state, set] = useUrlState(KEYS);
  const page = Math.max(1, Number(state.page) || 1);
  const [aiOpen, setAiOpen] = useState(false);
  const [blankOpen, setBlankOpen] = useState(false);
  const [template, setTemplate] = useState<TemplateOut | null>(null);

  const params = { status: state.status, industry: state.industry, search: state.q, page };
  const list = useQuery({
    queryKey: sk.list(params),
    queryFn: ({ signal }) => api.get<Page<SimulationOut>>("/simulations", { signal, query: { ...params, page_size: PAGE_SIZE } }),
    placeholderData: (p) => p,
  });
  const templates = useQuery({
    queryKey: sk.templates,
    queryFn: ({ signal }) => api.get<TemplateOut[]>("/simulations/templates", { signal }),
    staleTime: 10 * 60_000,
  });
  const filtered = !!(state.status || state.industry || state.q);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Simulation builder"
        description="Design realistic, data-driven work simulations — scored by a deterministic engine, never by guesswork."
        icon={<Workflow />}
        actions={
          <Can permission="simulations.manage">
            <Button variant="secondary" leftIcon={<Plus />} onClick={() => setBlankOpen(true)}>
              New blank
            </Button>
            <Button variant="gradient" leftIcon={<Wand2 />} onClick={() => setAiOpen(true)}>
              AI Simulation Builder
            </Button>
          </Can>
        }
      />

      <section aria-labelledby="start-heading">
        <SectionHeader title={<span id="start-heading">Start something new</span>} description="Pick an industry template, describe one to the AI, or start from a blank canvas." />
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <Can permission="simulations.manage">
            <StartCards onAI={() => setAiOpen(true)} onBlank={() => setBlankOpen(true)} />
            {templates.isLoading
              ? Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-72 rounded-3xl" />)
              : (templates.data ?? []).map((t) => <TemplateCard key={t.key} t={t} onUse={() => setTemplate(t)} />)}
          </Can>
        </div>
      </section>

      <section aria-labelledby="mine-heading" className="space-y-4">
        <SectionHeader title={<span id="mine-heading">Your simulations</span>} description={list.data ? `${list.data.total} simulation${list.data.total === 1 ? "" : "s"}` : undefined} />
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <Tabs value={state.status ?? "all"} onValueChange={(v) => set({ status: v === "all" ? undefined : v, page: undefined })}>
            <TabsList aria-label="Status">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="draft">Drafts</TabsTrigger>
              <TabsTrigger value="published">Published</TabsTrigger>
            </TabsList>
          </Tabs>
          <FilterBar className="flex-1" search={state.q ?? ""} onSearchChange={(q) => set({ q, page: undefined })} searchPlaceholder="Search simulations…">
            <SimpleSelect
              aria-label="Filter by industry"
              className="h-9 w-full sm:w-56"
              value={state.industry ?? "all"}
              onValueChange={(v) => set({ industry: v === "all" ? undefined : v, page: undefined })}
              options={[{ value: "all", label: "All industries" }, ...INDUSTRIES]}
            />
          </FilterBar>
        </div>

        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : list.isLoading ? (
          <SimulationGridSkeleton />
        ) : !list.data?.items.length ? (
          <EmptyState
            bordered
            illustration={filtered ? "search" : "rocket"}
            title={filtered ? "No simulations match" : "No simulations yet"}
            description={filtered ? "Try a different search or filter." : "Start from a template above, or let the AI Simulation Builder draft one from a description."}
            action={
              filtered ? (
                <Button variant="secondary" onClick={() => set({ status: undefined, industry: undefined, q: undefined, page: undefined })}>
                  Clear filters
                </Button>
              ) : (
                <Button variant="gradient" leftIcon={<Wand2 />} onClick={() => setAiOpen(true)}>
                  Build one with AI
                </Button>
              )
            }
          />
        ) : (
          <>
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {list.data.items.map((s) => (
                <SimulationCard key={s.id} s={s} />
              ))}
            </div>
            {list.data.total > PAGE_SIZE && <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.total} onPageChange={(p) => set({ page: p === 1 ? undefined : p })} />}
          </>
        )}
      </section>

      <AIBuildDialog open={aiOpen} onOpenChange={setAiOpen} />
      <CreateBlankDialog open={blankOpen} onOpenChange={setBlankOpen} />
      <TemplateDialog template={template} onOpenChange={(o) => !o && setTemplate(null)} />
    </div>
  );
}

export default function SimulationsBuilderPage() {
  return (
    <AccessGate anyOf={["simulations.manage"]} area="the simulation builder">
      <Suspense fallback={<SimulationGridSkeleton />}>
        <SimulationsList />
      </Suspense>
    </AccessGate>
  );
}
