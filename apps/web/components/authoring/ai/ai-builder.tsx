"use client";

import {
  Button,
  DataTable,
  PageHeader,
  SimpleSelect,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
  type ColumnDef,
} from "@praxis/ui";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BookOpen, ClipboardCheck, FileQuestion, History, Layers, MonitorPlay, NotebookText, Scale, Sparkles, Wand2 } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { ErrorState } from "@/components/common/error-state";
import { api } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { useSearchParamState } from "../hooks";
import { ak } from "../keys";
import { GENERATION_STATUS_LABEL } from "../meta";
import { AStatus, TypeChip } from "../shared";
import type { GenerationSummary, Page } from "../types";
import { CreateGenerationForm } from "./create-form";
import { GenerationReview } from "./review";

const KIND_META: Record<string, { label: string; icon: typeof BookOpen; color: "fuchsia" | "sky" | "amber" | "emerald" | "violet" | "orange" | "teal" | "indigo" | "rose" }> = {
  course: { label: "Course", icon: BookOpen, color: "fuchsia" },
  module: { label: "Module", icon: Layers, color: "indigo" },
  lesson: { label: "Lesson", icon: BookOpen, color: "sky" },
  quiz: { label: "Quiz", icon: FileQuestion, color: "sky" },
  assignment: { label: "Assignment", icon: ClipboardCheck, color: "amber" },
  rubric: { label: "Rubric", icon: Scale, color: "emerald" },
  flashcards: { label: "Flashcards", icon: Layers, color: "orange" },
  revision_notes: { label: "Revision notes", icon: NotebookText, color: "teal" },
  case_study: { label: "Case study", icon: BookOpen, color: "rose" },
  scenario: { label: "Scenario", icon: MonitorPlay, color: "violet" },
};

const PAGE_SIZE = 15;

function HistoryList({ onOpen }: { onOpen: (id: string) => void }) {
  const [kind, setKind] = React.useState("all");
  const [status, setStatus] = React.useState("all");
  const [mine, setMine] = React.useState(false);
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize: PAGE_SIZE });
  const params = { kind, status, mine, page: pagination.pageIndex + 1 };
  const q = useQuery({
    queryKey: ak.generations.list(params),
    queryFn: ({ signal }) =>
      api.get<Page<GenerationSummary>>("/ai/generations", {
        signal,
        query: { kind: kind === "all" ? undefined : kind, status: status === "all" ? undefined : status, mine: mine || undefined, page: params.page, page_size: PAGE_SIZE },
      }),
    refetchInterval: (query) => (query.state.data?.items.some((g) => g.status === "pending" || g.status === "running") ? 3000 : false),
    placeholderData: (p) => p,
  });

  const columns = React.useMemo<ColumnDef<GenerationSummary, unknown>[]>(
    () => [
      {
        id: "title",
        header: "Generation",
        cell: ({ row }) => {
          const g = row.original;
          const m = KIND_META[g.kind] ?? KIND_META.course!;
          return (
            <div className="flex min-w-[220px] items-center gap-3">
              <TypeChip meta={m} size="sm" />
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-900">{g.title ?? "Untitled"}</p>
                <p className="text-xs text-muted-foreground">
                  {m.label} · v{g.version}
                </p>
              </div>
            </div>
          );
        },
      },
      { id: "status", header: "Status", cell: ({ row }) => <AStatus status={row.original.status} label={GENERATION_STATUS_LABEL[row.original.status]} size="sm" /> },
      { id: "provider", header: "Provider", cell: ({ row }) => <span className="text-sm text-slate-600">{row.original.provider ?? "—"}</span> },
      { id: "cost", header: "Cost", cell: ({ row }) => <span className="tabular-nums text-slate-600">${row.original.cost_usd.toFixed(3)}</span> },
      { id: "created", header: "Created", cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{formatRelative(row.original.created_at)}</span> },
    ],
    [],
  );

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <DataTable
      aria-label="Generation history"
      columns={columns}
      data={q.data?.items ?? []}
      loading={q.isLoading}
      total={q.data?.total ?? 0}
      pagination={pagination}
      onPaginationChange={setPagination}
      onRowClick={(g) => onOpen(g.id)}
      columnToggle={false}
      toolbar={
        <div className="grid w-full grid-cols-2 items-center gap-2 sm:flex sm:w-auto sm:flex-wrap">
          <SimpleSelect aria-label="Kind" value={kind} onValueChange={(v) => { setKind(v); setPagination((p) => ({ ...p, pageIndex: 0 })); }} options={[{ value: "all", label: "All kinds" }, ...Object.entries(KIND_META).map(([k, m]) => ({ value: k, label: m.label }))]} className="h-9 sm:w-44" />
          <SimpleSelect aria-label="Status" value={status} onValueChange={(v) => { setStatus(v); setPagination((p) => ({ ...p, pageIndex: 0 })); }} options={[{ value: "all", label: "Any status" }, ...Object.entries(GENERATION_STATUS_LABEL).map(([k, l]) => ({ value: k, label: l }))]} className="h-9 sm:w-48" />
          <div className="col-span-2 flex w-fit items-center gap-1 rounded-xl bg-slate-100 p-1" role="radiogroup" aria-label="Scope">
            {[
              [false, "Everyone"],
              [true, "Mine"],
            ].map(([v, l]) => (
              <button key={String(v)} type="button" role="radio" aria-checked={mine === v} onClick={() => setMine(v as boolean)} className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold focus-visible:focus-ring", mine === v ? "bg-white text-slate-900 shadow-sm" : "text-slate-600")}>
                {l as string}
              </button>
            ))}
          </div>
        </div>
      }
      empty={{ title: "No generations yet", description: "Describe a course on the Create tab and it will appear here." }}
    />
  );
}

export function AIBuilder() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [get, set] = useSearchParamState(sp, router.push, pathname);
  const genId = get("generation");
  const tab = get("tab") ?? "create";
  const open = (id: string) => set({ generation: id, tab: null });

  return (
    <>
      <PageHeader
        title={
          <span>
            AI <span className="text-gradient">Course Builder</span>
          </span>
        }
        description="Turn a one-line brief into a complete, reviewable course draft — lessons, quizzes, assignments, rubric and more."
        icon={<Wand2 />}
        actions={
          genId ? (
            <Button variant="secondary" leftIcon={<ArrowLeft />} onClick={() => set({ generation: null })}>
              All generations
            </Button>
          ) : undefined
        }
      />
      {genId ? (
        <GenerationReview id={genId} onOpen={open} />
      ) : (
        <Tabs value={tab} onValueChange={(v) => set({ tab: v === "create" ? null : v })}>
          <TabsList>
            <TabsTrigger value="create">
              <Sparkles aria-hidden /> Create
            </TabsTrigger>
            <TabsTrigger value="history">
              <History aria-hidden /> History
            </TabsTrigger>
          </TabsList>
          <TabsContent value="create">
            <CreateGenerationForm onCreated={(g) => open(g.id)} />
          </TabsContent>
          <TabsContent value="history">
            <HistoryList onOpen={open} />
          </TabsContent>
        </Tabs>
      )}
    </>
  );
}
