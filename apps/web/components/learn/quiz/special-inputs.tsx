"use client";

import type { Page } from "@praxis/types";
import { BandChip, Button, FileDropzone, Skeleton, cn, formatBytes, toast } from "@praxis/ui";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, CornerDownRight, ExternalLink, FileText, Flag, GitBranch, MonitorPlay, RefreshCw, RotateCcw, X } from "lucide-react";
import * as React from "react";
import { Markdown } from "@/components/common/markdown";
import { api, errorMessage } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import type { FileOut } from "../types";
import { type InputProps, LongAnswerInput, QuestionContext } from "./inputs";

/* ------------------------------------------------------------------ decision tree */

interface TreeChoice {
  id: string;
  text: string;
  next?: string | null;
}
interface TreeNode {
  prompt?: string;
  text?: string;
  choices?: TreeChoice[];
}

export function DecisionTreeInput({ question, value, onChange, disabled, labelledBy }: InputProps) {
  const nodes = (question.options.nodes ?? {}) as Record<string, TreeNode>;
  const start = String(question.options.start ?? Object.keys(nodes)[0] ?? "");
  const path: { node_id: string; choice_id: string }[] = Array.isArray(value?.path) ? (value!.path as { node_id: string; choice_id: string }[]) : [];
  const last = path[path.length - 1];
  const lastChoice = last ? nodes[last.node_id]?.choices?.find((c) => c.id === last.choice_id) : undefined;
  const currentId = path.length === 0 ? start : lastChoice?.next ? String(lastChoice.next) : null;
  const current = currentId ? nodes[currentId] : undefined;
  const ended = path.length > 0 && (!currentId || !current || !(current.choices?.length));

  const choose = (nodeId: string, choiceId: string) => onChange({ path: [...path, { node_id: nodeId, choice_id: choiceId }] });

  return (
    <div role="group" aria-labelledby={labelledBy} className="space-y-3">
      <ol className="space-y-3">
        {path.map((step, i) => {
          const n = nodes[step.node_id];
          const ch = n?.choices?.find((c) => c.id === step.choice_id);
          return (
            <li key={i} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <GitBranch className="size-3.5" aria-hidden /> Step {i + 1}
              </p>
              {(n?.prompt || n?.text) && <Markdown className="mt-1 text-sm">{(n.prompt ?? n.text)!}</Markdown>}
              <p className="mt-2 flex items-start gap-2 text-sm font-semibold text-brand-800">
                <CornerDownRight className="mt-0.5 size-4 shrink-0" aria-hidden /> {ch?.text ?? "—"}
              </p>
            </li>
          );
        })}
      </ol>
      <div aria-live="polite">
        {!ended && current ? (
          <div className="rounded-2xl border-2 border-violet-200 bg-gradient-to-br from-violet-50 to-white p-4 sm:p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-violet-700">Step {path.length + 1} · decide</p>
            {(current.prompt || current.text) && <Markdown className="mt-1.5 text-base">{(current.prompt ?? current.text)!}</Markdown>}
            <ul className="mt-3 grid gap-2">
              {(current.choices ?? []).map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => choose(currentId!, c.id)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-medium text-slate-800 shadow-sm transition hover:-translate-y-0.5 hover:border-violet-300 hover:shadow-lift focus-visible:focus-ring disabled:pointer-events-none"
                  >
                    {c.text}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : ended ? (
          <p className="flex items-center gap-2 rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-800 ring-1 ring-emerald-100">
            <Flag className="size-4" aria-hidden /> Path complete — your decisions are saved.
          </p>
        ) : null}
      </div>
      {path.length > 0 && (
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onChange({ path: path.slice(0, -1) })}>
            Undo last step
          </Button>
          <Button variant="ghost" size="sm" leftIcon={<RotateCcw />} disabled={disabled} onClick={() => onChange({ path: [] })}>
            Start over
          </Button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ file upload */

interface UploadedRef {
  id: string;
  filename: string;
  size: number;
}

export function useEvidenceUpload() {
  const [queue, setQueue] = React.useState<{ name: string; size: number; progress?: number; error?: string }[]>([]);
  const upload = async (files: File[]): Promise<FileOut[]> => {
    const out: FileOut[] = [];
    for (const f of files) {
      setQueue((q) => [...q, { name: f.name, size: f.size, progress: 0 }]);
      try {
        const res = await api.upload<FileOut>("/files", { file: f, purpose: "submission" }, {
          onProgress: (pct) => setQueue((q) => q.map((x) => (x.name === f.name ? { ...x, progress: pct } : x))),
        });
        out.push(res);
        setQueue((q) => q.filter((x) => x.name !== f.name));
      } catch (e) {
        setQueue((q) => q.map((x) => (x.name === f.name ? { ...x, error: errorMessage(e) } : x)));
        toast.error(`${f.name}: ${errorMessage(e)}`);
      }
    }
    return out;
  };
  return { queue, upload, clearErrors: () => setQueue((q) => q.filter((x) => !x.error)) };
}

export function FileUploadInput(props: InputProps) {
  const { question, value, onChange, disabled } = props;
  const files: UploadedRef[] = Array.isArray(value?.files) ? (value!.files as UploadedRef[]) : [];
  const { queue, upload } = useEvidenceUpload();
  const accept = Array.isArray(question.options.allowed_types) ? (question.options.allowed_types as string[]).join(",") : typeof question.options.accept === "string" ? (question.options.accept as string) : undefined;
  const add = async (list: File[]) => {
    const done = await upload(list);
    if (!done.length) return;
    const next = [...files, ...done.map((f) => ({ id: f.id, filename: f.filename, size: f.size_bytes }))];
    onChange({ ...(value ?? {}), files: next, file_ids: next.map((f) => f.id) });
  };
  const remove = (id: string) => {
    const next = files.filter((f) => f.id !== id);
    onChange({ ...(value ?? {}), files: next, file_ids: next.map((f) => f.id) });
  };
  return (
    <div className="space-y-4">
      <QuestionContext options={question.options} />
      <FileDropzone onFiles={add} multiple accept={accept} maxSize={50 * 1024 * 1024} disabled={disabled} files={queue} />
      {files.length > 0 && (
        <ul className="space-y-2" aria-label="Uploaded files">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
              <span className="grid size-9 place-items-center rounded-lg bg-white text-emerald-600 ring-1 ring-emerald-200">
                <FileText className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-800">{f.filename}</span>
                <span className="flex items-center gap-1 text-xs text-emerald-700">
                  <CheckCircle2 className="size-3.5" aria-hidden /> Uploaded · {formatBytes(f.size)}
                </span>
              </span>
              <Button variant="ghost" size="icon-sm" aria-label={`Remove ${f.filename}`} onClick={() => remove(f.id)} disabled={disabled}>
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <LongAnswerInput {...props} rows={3} placeholder="Optional note for your assessor…" value={value} onChange={(r) => onChange({ ...(value ?? {}), ...r })} />
    </div>
  );
}

/* ------------------------------------------------------------------ practical task / scenario */

export function PracticalInput(props: InputProps) {
  return (
    <div className="space-y-4">
      <QuestionContext options={props.question.options} />
      <LongAnswerInput {...props} placeholder={props.question.question_type === "scenario" ? "Explain how you would handle this situation and why…" : "Describe what you did, the steps you took and the outcome…"} />
    </div>
  );
}

/* ------------------------------------------------------------------ simulation */

interface SessionSummary {
  id: string;
  simulation_id: string;
  attempt_number: number;
  status: string;
  total_score: number | null;
  band: string | null;
  passed: boolean | null;
  started_at: string;
  completed_at: string | null;
}

export function SimulationInput({ question, value, onChange, disabled, labelledBy }: InputProps) {
  const simId = typeof question.options.simulation_id === "string" ? (question.options.simulation_id as string) : "";
  const selected = typeof value?.session_id === "string" ? (value.session_id as string) : null;
  const q = useQuery({
    queryKey: ["simulation-sessions", "mine", simId],
    queryFn: ({ signal }) => api.get<Page<SessionSummary>>("/simulation-sessions", { signal, query: { simulation_id: simId, page_size: 20 } }),
    enabled: !!simId,
  });
  const completed = (q.data?.items ?? []).filter((s) => s.status === "completed");
  const name = React.useId();
  return (
    <div className="space-y-4" role="group" aria-labelledby={labelledBy}>
      <div className="flex flex-col gap-3 rounded-2xl bg-gradient-to-br from-violet-50 via-fuchsia-50/40 to-white p-4 ring-1 ring-violet-100 sm:flex-row sm:items-center">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white">
          <MonitorPlay className="size-5" aria-hidden />
        </span>
        <p className="flex-1 text-sm text-slate-700">Complete the simulation, then come back and select the session you want scored for this question.</p>
        {simId && (
          <Button asChild variant="gradient" size="sm" rightIcon={<ExternalLink />}>
            <a href={`/app/simulations/${simId}`} target="_blank" rel="noopener noreferrer">
              Launch simulation
            </a>
          </Button>
        )}
      </div>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-800">Your completed sessions</p>
        <Button variant="ghost" size="xs" leftIcon={<RefreshCw />} onClick={() => q.refetch()} loading={q.isFetching}>
          Refresh
        </Button>
      </div>
      {q.isLoading ? (
        <Skeleton className="h-16 rounded-xl" />
      ) : completed.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-sm text-slate-600">No completed sessions yet.</p>
      ) : (
        <ul className="space-y-2">
          {completed.map((s) => (
            <li key={s.id}>
              <label className={cn("flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm transition focus-within:ring-2 focus-within:ring-brand-500/40", selected === s.id ? "border-brand-400 bg-brand-50/60" : "border-slate-200 hover:bg-slate-50")}>
                <input type="radio" name={name} className="size-4 accent-brand-600" checked={selected === s.id} disabled={disabled} onChange={() => onChange({ session_id: s.id })} />
                <span className="flex-1">
                  <span className="block font-semibold text-slate-800">Attempt {s.attempt_number}</span>
                  <span className="text-xs text-slate-500">Completed {formatRelative(s.completed_at)}</span>
                </span>
                {s.band && <BandChip band={s.band} size="sm" />}
                {s.total_score !== null && <span className="font-display text-base font-bold tabular-nums text-slate-900">{Math.round(s.total_score)}</span>}
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
