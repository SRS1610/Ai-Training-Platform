"use client";

import {
  Button,
  ConfirmDialog,
  DataTable,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  FilterBar,
  KpiTile,
  PageHeader,
  SimpleSelect,
  Switch,
  cn,
  toast,
  type ColumnDef,
} from "@praxis/ui";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BookPlus, ChevronDown, Eye, FileUp, FolderKanban, Globe, Layers, RefreshCw, ScrollText, ShieldCheck, Trash2 } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { ErrorState } from "@/components/common/error-state";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatRelative } from "@/lib/format";
import { useSearchParamState } from "../hooks";
import { ak } from "../keys";
import type { KnowledgeDocument, Page } from "../types";
import { useCourseOptions } from "../use-options";
import { AddKnowledgeDialog, type AddMode } from "./add-dialog";
import { DocumentDrawer } from "./document-drawer";
import { SearchPanel } from "./search-panel";
import { DocStatus, SourceIcon, formatChars, sourceMeta } from "./shared";

const PAGE_SIZE = 15;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
const ACTIVE = new Set(["pending", "processing"]);

/** /app/instructor/knowledge — the documents that ground the AI tutor. `?document=<id>` opens the detail drawer. */
export function KnowledgePage() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [get, set] = useSearchParamState(sp, router.replace, pathname);
  const qc = useQueryClient();
  const { can } = useAuth();
  const courses = useCourseOptions();
  const q = get("q") ?? "";
  const status = get("status") ?? "all";
  const approved = get("approved") ?? "all";
  const course = get("course") ?? "all";
  const page = Math.max(1, Number(get("page") ?? 1));
  const docId = get("document");
  const [add, setAdd] = React.useState<AddMode | null>(null);
  const [toDelete, setToDelete] = React.useState<KnowledgeDocument | null>(null);

  const list = useQuery({
    queryKey: ak.knowledge.list({ q, status, approved, course, page }),
    queryFn: ({ signal }) =>
      api.get<Page<KnowledgeDocument>>("/knowledge/documents", {
        signal,
        query: {
          q: q || undefined,
          status: status === "all" ? undefined : status,
          approved: approved === "all" ? undefined : approved === "yes",
          course_id: course === "all" ? undefined : course,
          page,
          page_size: PAGE_SIZE,
        },
      }),
    placeholderData: (p) => p,
    refetchInterval: (query) => (query.state.data?.items.some((d) => ACTIVE.has(d.status)) ? 2500 : false),
  });
  const anyActive = !!list.data?.items.some((d) => ACTIVE.has(d.status));
  const counts = useQueries({
    queries: [{}, { status: "ready" }, { approved: true }, { status: "failed" }].map((f) => ({
      queryKey: ak.knowledge.list({ count: f }),
      queryFn: ({ signal }: { signal: AbortSignal }) => api.get<Page<KnowledgeDocument>>("/knowledge/documents", { signal, query: { ...f, page_size: 1 } }),
      staleTime: 15_000,
      refetchInterval: anyActive ? 4000 : (false as const),
    })),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ak.knowledge.all });
  const approve = useMutation({
    mutationFn: ({ d, on }: { d: KnowledgeDocument; on: boolean }) => api.post<KnowledgeDocument>(`/knowledge/documents/${d.id}/${on ? "approve" : "unapprove"}`),
    onMutate: ({ d, on }) => {
      qc.setQueriesData<Page<KnowledgeDocument>>({ queryKey: ["knowledge", "list"] }, (old) =>
        old?.items ? { ...old, items: old.items.map((x) => (x.id === d.id ? { ...x, approved: on } : x)) } : old,
      );
    },
    onSuccess: (out) => {
      toast.success(out.approved ? `“${out.title}” approved` : `Approval removed from “${out.title}”`);
      qc.setQueryData(ak.knowledge.detail(out.id), out);
    },
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: invalidate,
  });
  const reprocess = useMutation({
    mutationFn: (d: KnowledgeDocument) => api.post<KnowledgeDocument>(`/knowledge/documents/${d.id}/reprocess`),
    onSuccess: (d) => {
      toast.success(`Re-indexing “${d.title}”`);
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const columns = React.useMemo<ColumnDef<KnowledgeDocument, unknown>[]>(
    () => [
      {
        id: "title",
        header: "Document",
        cell: ({ row }) => {
          const d = row.original;
          return (
            <div className="flex min-w-[240px] items-center gap-3">
              <SourceIcon type={d.source_type} size="sm" />
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-900">{d.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {sourceMeta(d.source_type).label}
                  {d.category ? ` · ${d.category}` : ""}
                  {d.source_url ? ` · ${hostOf(d.source_url)}` : ""}
                </p>
                <p className="mt-0.5 flex items-center gap-2 text-2xs text-slate-500">
                  <span className="inline-flex items-center gap-1 tabular-nums">
                    <Layers className="size-3 text-teal-600" aria-hidden /> {d.chunk_count} chunk{d.chunk_count === 1 ? "" : "s"}
                  </span>
                  <span className="tabular-nums">{formatChars(d.char_count)}</span>
                </p>
              </div>
            </div>
          );
        },
      },
      { id: "status", header: "Status", cell: ({ row }) => <DocStatus status={row.original.status} error={row.original.error} /> },
      {
        id: "approved",
        header: "Approved",
        cell: ({ row }) => (
          // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
          <span onClick={(e) => e.stopPropagation()}>
            <Switch
              checked={row.original.approved}
              disabled={!can("knowledge.manage")}
              onCheckedChange={(on) => approve.mutate({ d: row.original, on })}
              aria-label={`${row.original.approved ? "Unapprove" : "Approve"} ${row.original.title}`}
            />
          </span>
        ),
      },
      {
        id: "scope",
        header: "Scope",
        cell: ({ row }) =>
          row.original.course_id ? (
            <span className="inline-flex max-w-[180px] items-center rounded-full bg-indigo-50 px-2 py-0.5 text-2xs font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200">
              <span className="truncate">{courses.titleOf(row.original.course_id) ?? "Course"}</span>
            </span>
          ) : (
            <span className="whitespace-nowrap rounded-full bg-teal-50 px-2 py-0.5 text-2xs font-semibold text-teal-700 ring-1 ring-inset ring-teal-200">Organisation-wide</span>
          ),
      },
      { id: "updated", header: "Updated", cell: ({ row }) => <span className="whitespace-nowrap text-xs text-muted-foreground">{formatRelative(row.original.updated_at)}</span> },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [courses.data],
  );

  const filtered = !!q || status !== "all" || approved !== "all" || course !== "all";
  const failed = counts[3]?.data?.total ?? 0;

  return (
    <>
      <PageHeader
        title="Knowledge base"
        description="Policies, runbooks and manuals that ground the AI tutor — every answer cites its source."
        icon={<FolderKanban />}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="gradient" leftIcon={<FileUp />} onClick={() => setAdd("upload")}>
              Upload documents
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" rightIcon={<ChevronDown />}>
                  More ways to add
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setAdd("url")}>
                  <Globe /> Add a web page
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setAdd("text")}>
                  <ScrollText /> Paste text
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      <section aria-label="Knowledge base summary" className="stagger mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {[
          { label: "Documents", v: counts[0]?.data?.total, icon: <FolderKanban />, color: "teal" as const, hint: "In your organisation", f: { status: null, approved: null } },
          { label: "Ready", v: counts[1]?.data?.total, icon: <Layers />, color: "sky" as const, hint: "Indexed and searchable", f: { status: "ready", approved: null } },
          { label: "Approved", v: counts[2]?.data?.total, icon: <ShieldCheck />, color: "emerald" as const, hint: "Used in knowledge-only mode", f: { status: null, approved: "yes" } },
          { label: "Need attention", v: counts[3]?.data?.total, icon: <AlertTriangle />, color: (failed ? "rose" : "amber") as "rose" | "amber", hint: "Failed to index", f: { status: "failed", approved: null } },
        ].map((k) => {
          const on = (k.f.status ?? "all") === status && (k.f.approved ?? "all") === approved;
          return (
            <button
              key={k.label}
              type="button"
              aria-pressed={on}
              onClick={() => set({ ...k.f, page: null })}
              className={cn("rounded-2xl text-left focus-visible:focus-ring", on && "ring-2 ring-brand-400 ring-offset-2 ring-offset-background")}
            >
              <KpiTile label={k.label} value={k.v ?? "—"} icon={k.icon} color={k.color} hint={k.hint} />
            </button>
          );
        })}
      </section>

      <div className="grid grid-cols-1 items-start gap-6 2xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0">
          {list.isError ? (
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          ) : (
            <DataTable
              aria-label="Knowledge documents"
              columns={columns}
              data={list.data?.items ?? []}
              loading={list.isLoading}
              total={list.data?.total ?? 0}
              pagination={{ pageIndex: page - 1, pageSize: PAGE_SIZE }}
              onPaginationChange={(u) => {
                const next = typeof u === "function" ? u({ pageIndex: page - 1, pageSize: PAGE_SIZE }) : u;
                set({ page: next.pageIndex ? String(next.pageIndex + 1) : null });
              }}
              onRowClick={(d) => set({ document: d.id })}
              columnToggle={false}
              rowActions={[
                { label: "Open details", icon: <Eye />, onSelect: (d) => set({ document: d.id }) },
                { label: "Approve", icon: <ShieldCheck />, hidden: (d) => d.approved, onSelect: (d) => approve.mutate({ d, on: true }) },
                { label: "Remove approval", icon: <ShieldCheck />, hidden: (d) => !d.approved, onSelect: (d) => approve.mutate({ d, on: false }) },
                { label: "Re-index", icon: <RefreshCw />, hidden: (d) => ACTIVE.has(d.status), onSelect: (d) => reprocess.mutate(d) },
                { label: "Delete", icon: <Trash2 />, destructive: true, separatorBefore: true, onSelect: setToDelete },
              ]}
              toolbar={
                <FilterBar search={q} onSearchChange={(v) => set({ q: v || null, page: null })} searchPlaceholder="Search titles…">
                  <SimpleSelect
                    aria-label="Status"
                    value={status}
                    onValueChange={(v) => set({ status: v === "all" ? null : v, page: null })}
                    options={[
                      { value: "all", label: "Any status" },
                      { value: "ready", label: "Ready" },
                      { value: "processing", label: "Indexing" },
                      { value: "pending", label: "Queued" },
                      { value: "failed", label: "Failed" },
                    ]}
                    className="h-9 w-36"
                  />
                  <SimpleSelect
                    aria-label="Approval"
                    value={approved}
                    onValueChange={(v) => set({ approved: v === "all" ? null : v, page: null })}
                    options={[
                      { value: "all", label: "Approved or not" },
                      { value: "yes", label: "Approved" },
                      { value: "no", label: "Not approved" },
                    ]}
                    className="h-9 w-44"
                  />
                  <SimpleSelect
                    aria-label="Scope"
                    value={course}
                    onValueChange={(v) => set({ course: v === "all" ? null : v, page: null })}
                    options={[{ value: "all", label: "All scopes" }, ...courses.options]}
                    className="h-9 w-48"
                  />
                </FilterBar>
              }
              empty={{
                illustration: filtered ? "search" : "learning",
                title: filtered ? "No documents match" : "Your knowledge base is empty",
                description: filtered ? "Try different filters." : "Upload policies, SOPs and manuals so the AI tutor answers from your organisation's own material.",
                action: filtered ? (
                  <Button size="sm" variant="secondary" onClick={() => set({ q: null, status: null, approved: null, course: null, page: null })}>
                    Clear filters
                  </Button>
                ) : (
                  <Button size="sm" leftIcon={<BookPlus />} onClick={() => setAdd("upload")}>
                    Add your first document
                  </Button>
                ),
              }}
            />
          )}
          {anyActive && (
            <p className="mt-3 flex items-center gap-2 text-xs font-medium text-sky-800" role="status">
              <RefreshCw className="size-3.5 motion-safe:animate-spin" aria-hidden /> Indexing in progress — this list refreshes automatically.
            </p>
          )}
        </div>
        <aside className="2xl:sticky 2xl:top-20" aria-label="Test retrieval">
          <SearchPanel onOpenDocument={(id) => set({ document: id })} />
        </aside>
      </div>

      <AddKnowledgeDialog open={!!add} mode={add ?? "upload"} onModeChange={setAdd} onOpenChange={(o) => !o && setAdd(null)} onAdded={(d) => set({ document: d.id })} />
      <DocumentDrawer id={docId} onOpenChange={(o) => !o && set({ document: null })} />
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        destructive
        title={`Delete “${toDelete?.title}”?`}
        description="The document and its chunks are removed; the tutor stops citing it immediately."
        confirmLabel="Delete document"
        onConfirm={async () => {
          if (!toDelete) return;
          try {
            await api.delete(`/knowledge/documents/${toDelete.id}`);
            toast.success("Document deleted");
            invalidate();
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </>
  );
}
