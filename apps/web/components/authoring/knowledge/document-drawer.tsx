"use client";

import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  FormField,
  Input,
  Pagination,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SimpleSelect,
  Skeleton,
  Switch,
  toast,
} from "@praxis/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Download, ExternalLink, Hash, Layers, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import * as React from "react";
import { api, errorMessage } from "@/lib/api";
import { formatDate, formatDateTime, formatRelative } from "@/lib/format";
import { ak } from "../keys";
import type { KnowledgeChunk, KnowledgeDocument, Page } from "../types";
import { useCourseOptions } from "../use-options";
import { DocStatus, SourceIcon, formatChars, sourceMeta } from "./shared";

const CHUNK_PAGE = 10;

function ChunkCard({ c }: { c: KnowledgeChunk }) {
  const [open, setOpen] = React.useState(false);
  const long = c.content.length > 420;
  return (
    <li className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-slate-800">
          <span className="grid size-5 shrink-0 place-items-center rounded-md bg-teal-50 text-2xs font-bold tabular-nums text-teal-700">{c.chunk_index + 1}</span>
          <span className="truncate">{c.heading || "Untitled section"}</span>
        </p>
        <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">{c.token_count} tokens</span>
      </div>
      <p className={`whitespace-pre-wrap text-sm leading-relaxed text-slate-700 ${!open && long ? "line-clamp-5" : ""}`}>{c.content}</p>
      {long && (
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mt-1 inline-flex items-center gap-1 rounded text-xs font-semibold text-brand-700 hover:underline focus-visible:focus-ring">
          {open ? "Show less" : "Show full chunk"} <ChevronDown className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
        </button>
      )}
    </li>
  );
}

/** Right-hand drawer for one knowledge document: metadata, scope, approval, reprocess/delete and its chunks. */
export function DocumentDrawer({ id, onOpenChange }: { id: string | null; onOpenChange: (open: boolean) => void }) {
  const qc = useQueryClient();
  const courses = useCourseOptions(!!id);
  const [page, setPage] = React.useState(1);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [category, setCategory] = React.useState("");
  React.useEffect(() => setPage(1), [id]);

  const doc = useQuery({
    queryKey: ak.knowledge.detail(id ?? ""),
    enabled: !!id,
    queryFn: ({ signal }) => api.get<KnowledgeDocument>(`/knowledge/documents/${id}`, { signal }),
    refetchInterval: (q) => (q.state.data && ["pending", "processing"].includes(q.state.data.status) ? 2000 : false),
  });
  const d = doc.data;
  React.useEffect(() => {
    if (d) {
      setTitle(d.title);
      setCategory(d.category ?? "");
    }
  }, [d?.id, d?.title, d?.category]); // eslint-disable-line react-hooks/exhaustive-deps

  const chunks = useQuery({
    queryKey: ak.knowledge.chunks(id ?? "", page),
    enabled: !!id && d?.status === "ready",
    queryFn: ({ signal }) => api.get<Page<KnowledgeChunk>>(`/knowledge/documents/${id}/chunks`, { signal, query: { page, page_size: CHUNK_PAGE } }),
    placeholderData: (p) => p,
  });

  const apply = (out: KnowledgeDocument, msg?: string) => {
    qc.setQueryData(ak.knowledge.detail(out.id), out);
    qc.invalidateQueries({ queryKey: ["knowledge", "list"] });
    if (msg) toast.success(msg);
  };
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch<KnowledgeDocument>(`/knowledge/documents/${id}`, body),
    onSuccess: (out) => apply(out, "Document updated"),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const approve = useMutation({
    mutationFn: (on: boolean) => api.post<KnowledgeDocument>(`/knowledge/documents/${id}/${on ? "approve" : "unapprove"}`),
    onSuccess: (out) => apply(out, out.approved ? "Approved — available in knowledge-only mode" : "Approval removed"),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const reprocess = useMutation({
    mutationFn: () => api.post<KnowledgeDocument>(`/knowledge/documents/${id}/reprocess`),
    onSuccess: (out) => {
      apply(out, "Re-indexing started");
      qc.invalidateQueries({ queryKey: ["knowledge", "chunks", id] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const m = sourceMeta(d?.source_type);
  const embedding = chunks.data?.items[0]?.embedding_model;

  return (
    <Sheet open={!!id} onOpenChange={onOpenChange}>
      <SheetContent className="w-full max-w-none gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        {!d ? (
          <div className="space-y-4 p-6" aria-busy>
            {doc.isError ? (
              <Alert tone="danger" title="Couldn't load this document">
                {errorMessage(doc.error)}
              </Alert>
            ) : (
              <>
                <Skeleton className="h-12 w-3/4" />
                <Skeleton className="h-24" />
                <Skeleton className="h-64" />
              </>
            )}
            <SheetTitle className="sr-only">Document</SheetTitle>
          </div>
        ) : (
          <>
            <div className="border-b border-slate-100 bg-gradient-to-br from-teal-50 via-white to-emerald-50">
              <SheetHeader className="pb-5 pr-14">
                <div className="flex items-start gap-3">
                  <SourceIcon type={d.source_type} size="lg" />
                  <div className="min-w-0">
                    <SheetTitle className="text-xl leading-snug">{d.title}</SheetTitle>
                    <SheetDescription asChild>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <DocStatus status={d.status} error={d.error} />
                        <Badge size="sm">{m.label}</Badge>
                        {d.approved && (
                          <Badge tone="success" size="sm">
                            <ShieldCheck aria-hidden /> Approved
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground">Added {formatRelative(d.created_at)}</span>
                      </div>
                    </SheetDescription>
                  </div>
                </div>
              </SheetHeader>
            </div>
            <div className="space-y-5 p-6">
              {d.status === "failed" && (
                <Alert
                  tone="danger"
                  title="Indexing failed"
                  action={
                    <Button size="xs" variant="secondary" leftIcon={<RefreshCw />} loading={reprocess.isPending} onClick={() => reprocess.mutate()}>
                      Retry
                    </Button>
                  }
                >
                  {d.error ?? "The document couldn't be processed."}
                </Alert>
              )}
              {["pending", "processing"].includes(d.status) && (
                <Alert tone="info" title="Indexing in progress">
                  Extracting text, splitting it into chunks and computing embeddings. This updates live.
                </Alert>
              )}

              <dl className="grid grid-cols-3 gap-3">
                {[
                  { k: "Chunks", v: d.chunk_count.toLocaleString(), c: "from-teal-50 text-teal-700", icon: Layers },
                  { k: "Chars", v: formatChars(d.char_count).replace(/ chars$/, ""), c: "from-sky-50 text-sky-700", icon: Hash },
                  { k: "Updated", v: formatDate(d.updated_at, { day: "numeric", month: "short" }), title: formatRelative(d.updated_at), c: "from-violet-50 text-violet-700", icon: RefreshCw },
                ].map((s) => (
                  <div key={s.k} title={"title" in s ? s.title : undefined} className={`flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-gradient-to-br to-white p-3 ${s.c}`}>
                    <s.icon className="size-4" aria-hidden />
                    <dt className="order-last truncate text-2xs font-semibold uppercase tracking-wider">{s.k}</dt>
                    <dd className="mt-1 truncate font-display text-base font-bold text-slate-900 sm:text-lg">{s.v}</dd>
                  </div>
                ))}
              </dl>

              <div className="flex items-start justify-between gap-4 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
                <div>
                  <label htmlFor="kb-approved" className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
                    <ShieldCheck className="size-4 text-emerald-600" aria-hidden /> Approved source
                  </label>
                  <p className="mt-0.5 text-xs text-emerald-900/80">
                    Approved documents are the only sources the tutor may use in knowledge-only mode.
                    {d.approved_at && ` Approved ${formatDateTime(d.approved_at)}.`}
                  </p>
                </div>
                <Switch id="kb-approved" checked={d.approved} disabled={approve.isPending} onCheckedChange={(v) => approve.mutate(v)} />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Title" className="sm:col-span-2">
                  <Input value={title} maxLength={255} onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && title.trim() !== d.title && patch.mutate({ title: title.trim() })} />
                </FormField>
                <FormField label="Scope" hint="Re-scoping updates every chunk instantly.">
                  {(aria) => (
                    <SimpleSelect
                      {...aria}
                      value={d.course_id ?? "none"}
                      onValueChange={(v) => patch.mutate(v === "none" ? { clear_course: true } : { course_id: v })}
                      options={[{ value: "none", label: "Organisation-wide" }, ...courses.options]}
                    />
                  )}
                </FormField>
                <FormField label="Category">
                  <Input value={category} maxLength={64} onChange={(e) => setCategory(e.target.value)} onBlur={() => category.trim() !== (d.category ?? "") && patch.mutate({ category: category.trim() })} />
                </FormField>
              </div>

              <div className="flex flex-wrap gap-2">
                {d.source_url && (
                  <Button asChild variant="secondary" size="sm" rightIcon={<ExternalLink />}>
                    <a href={d.source_url} target="_blank" rel="noopener noreferrer">
                      Open source page
                    </a>
                  </Button>
                )}
                {d.file_id && (
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<Download />}
                    onClick={() => api.download(`/files/${d.file_id}/download`).catch((e) => toast.error(errorMessage(e)))}
                  >
                    Download original
                  </Button>
                )}
                <Button variant="secondary" size="sm" leftIcon={<RefreshCw />} loading={reprocess.isPending} onClick={() => reprocess.mutate()} disabled={["pending", "processing"].includes(d.status)}>
                  Re-index
                </Button>
                <Button variant="destructive-soft" size="sm" leftIcon={<Trash2 />} onClick={() => setConfirmDelete(true)}>
                  Delete
                </Button>
              </div>

              <section aria-labelledby="kb-chunks-h" className="space-y-3">
                <div className="flex items-end justify-between gap-2">
                  <div>
                    <h3 id="kb-chunks-h" className="text-sm font-semibold text-slate-900">
                      Chunks
                    </h3>
                    <p className="text-xs text-muted-foreground">What retrieval sees{embedding ? ` · embedded with ${embedding}` : ""}.</p>
                  </div>
                </div>
                {d.status !== "ready" ? (
                  <p className="rounded-2xl border-2 border-dashed border-slate-200 p-6 text-center text-sm text-muted-foreground">Chunks appear once indexing finishes.</p>
                ) : chunks.isLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-28 rounded-2xl" />
                    ))}
                  </div>
                ) : chunks.isError ? (
                  <Alert tone="danger">{errorMessage(chunks.error)}</Alert>
                ) : (
                  <>
                    <ol className="space-y-2">
                      {(chunks.data?.items ?? []).map((c) => (
                        <ChunkCard key={c.id} c={c} />
                      ))}
                    </ol>
                    {(chunks.data?.total ?? 0) > CHUNK_PAGE && <Pagination page={page} pageSize={CHUNK_PAGE} total={chunks.data?.total ?? 0} onPageChange={setPage} />}
                  </>
                )}
              </section>
            </div>
          </>
        )}
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          destructive
          title={`Delete “${d?.title}”?`}
          description="The document and its chunks are removed; the tutor stops citing it immediately."
          confirmLabel="Delete document"
          onConfirm={async () => {
            try {
              await api.delete(`/knowledge/documents/${id}`);
              toast.success("Document deleted");
              qc.invalidateQueries({ queryKey: ak.knowledge.all });
              onOpenChange(false);
            } catch (e) {
              toast.error(errorMessage(e));
            }
          }}
        />
      </SheetContent>
    </Sheet>
  );
}
