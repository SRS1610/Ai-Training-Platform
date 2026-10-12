"use client";

import { Badge, Button, EmptyState, Skeleton, cn, formatBytes, toast } from "@praxis/ui";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Download, FileText, Fingerprint, GitCommitVertical, Lock } from "lucide-react";
import * as React from "react";
import { ErrorState } from "@/components/common/error-state";
import { Markdown } from "@/components/common/markdown";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime, formatRelative } from "@/lib/format";
import { lk } from "../query-keys";
import type { SubmissionVersion } from "../types";
import { wordCount } from "./meta";

function FileChip({ id, name, size }: { id: string; name: string; size: number }) {
  const [busy, setBusy] = React.useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api.download(`/files/${id}/download`, { filename: name });
        } catch (e) {
          toast.error(errorMessage(e));
        } finally {
          setBusy(false);
        }
      }}
      className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-white px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50 focus-visible:focus-ring"
      aria-label={`Download ${name}`}
    >
      <FileText className="size-3.5 shrink-0 text-slate-400" aria-hidden />
      <span className="truncate">{name}</span>
      <span className="shrink-0 text-slate-400">{formatBytes(size)}</span>
      <Download className="size-3.5 shrink-0 text-brand-600" aria-hidden />
    </button>
  );
}

function VersionRow({ v, latest }: { v: SubmissionVersion; latest: boolean }) {
  const [open, setOpen] = React.useState(latest);
  const id = React.useId();
  const answers = Object.entries(v.structured_answers ?? {}).filter(([, val]) => val !== null && val !== "");
  return (
    <li className="relative pl-10">
      <span
        className={cn(
          "absolute left-0 top-3 grid size-7 place-items-center rounded-full ring-4 ring-white",
          v.is_final ? "bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white" : "bg-sky-100 text-sky-700",
        )}
        aria-hidden
      >
        {v.is_final ? <Lock className="size-3.5" /> : <GitCommitVertical className="size-3.5" />}
      </span>
      <div className="rounded-2xl border border-slate-200 bg-white shadow-soft">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
          className="flex w-full flex-wrap items-center gap-2 rounded-2xl px-4 py-3 text-left transition hover:bg-slate-50 focus-visible:focus-ring"
        >
          <span className="font-display text-sm font-bold text-slate-900">Version {v.version_number}</span>
          {v.is_final ? (
            <Badge tone="violet" size="sm">
              Submitted
            </Badge>
          ) : (
            <Badge tone="info" size="sm">
              Draft
            </Badge>
          )}
          {latest && (
            <Badge tone="brand" size="sm">
              Latest
            </Badge>
          )}
          <span className="text-xs text-slate-500" title={formatDateTime(v.created_at)}>
            {formatRelative(v.created_at)}
          </span>
          <span className="ml-auto flex items-center gap-3 text-xs text-slate-500">
            {v.text_content ? <span>{wordCount(v.text_content)} words</span> : null}
            {v.files.length ? <span>{v.files.length} file{v.files.length === 1 ? "" : "s"}</span> : null}
            <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden />
          </span>
        </button>
        {open && (
          <div id={id} className="space-y-4 border-t border-slate-100 px-4 py-4">
            {v.text_content ? (
              <div className="max-h-80 overflow-y-auto rounded-xl bg-slate-50/70 p-4 ring-1 ring-slate-200/70 scrollbar-thin">
                <Markdown className="text-sm">{v.text_content}</Markdown>
              </div>
            ) : null}
            {v.code_content ? <pre className="max-h-72 overflow-auto rounded-xl bg-slate-50 p-3 font-mono text-xs text-slate-800 ring-1 ring-slate-200 scrollbar-thin">{v.code_content}</pre> : null}
            {answers.length > 0 && (
              <dl className="grid gap-2 sm:grid-cols-2">
                {answers.map(([k, val]) => (
                  <div key={k} className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200/70">
                    <dt className="text-2xs font-semibold uppercase tracking-wider text-slate-500">{k.replace(/_/g, " ")}</dt>
                    <dd className="mt-0.5 text-sm text-slate-800">{String(val)}</dd>
                  </div>
                ))}
              </dl>
            )}
            {v.files.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {v.files.map((f) => (
                  <FileChip key={f.id} id={f.id} name={f.filename} size={f.size_bytes} />
                ))}
              </div>
            )}
            {!v.text_content && !v.code_content && !answers.length && !v.files.length && <p className="text-sm text-slate-500">This version is empty.</p>}
            {v.content_sha256 && (
              <p className="flex items-center gap-1.5 font-mono text-2xs text-slate-500">
                <Fingerprint className="size-3.5 shrink-0 text-violet-500" aria-hidden />
                <span className="sr-only">Content fingerprint:</span>
                SHA-256 {v.content_sha256.slice(0, 16)}…
              </p>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

/** Immutable version history of the learner's submission (newest first). */
export function VersionHistory({ assignmentId }: { assignmentId: string }) {
  const q = useQuery({
    queryKey: lk.assignments.versions(assignmentId),
    queryFn: ({ signal }) => api.get<SubmissionVersion[]>(`/assignments/${assignmentId}/submission/versions`, { signal }),
  });
  if (q.isLoading)
    return (
      <div className="space-y-3" aria-busy aria-label="Loading versions">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-14 rounded-2xl" />
        ))}
      </div>
    );
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} size="sm" />;
  const list = q.data ?? [];
  if (!list.length)
    return <EmptyState bordered size="sm" illustration="inbox" title="No versions yet" description="Every time you save a draft we keep a numbered copy here, so nothing is ever lost." />;
  return (
    <div>
      <ol className="relative space-y-3 before:absolute before:bottom-4 before:left-[13px] before:top-4 before:w-0.5 before:rounded-full before:bg-slate-200">
        {list.map((v, i) => (
          <VersionRow key={v.id} v={v} latest={i === 0} />
        ))}
      </ol>
      <Button variant="ghost" size="sm" className="mt-3" onClick={() => q.refetch()} loading={q.isFetching}>
        Refresh history
      </Button>
    </div>
  );
}
