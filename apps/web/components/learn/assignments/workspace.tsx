"use client";

import { Alert, Badge, Button, ConfirmDialog, FileDropzone, FormField, Input, Textarea, cn, formatBytes, toast } from "@praxis/ui";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Code2, Eye, FileText, Image as ImageIcon, Lock, PenLine, Save, Send, ShieldCheck, Trash2, UploadCloud } from "lucide-react";
import * as React from "react";
import { Markdown } from "@/components/common/markdown";
import { ApiError, api, errorMessage } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { lk } from "../query-keys";
import type { EvidenceItem, FileOut, LearnerAssignment, Submission, SubmitResult } from "../types";
import { SectionTitle } from "../visuals";
import { EvidenceChecklist } from "./brief";
import { type DraftState, canEdit, evidenceReady, evidenceStatus, fileCategory, needsCode, needsFiles, needsText, wordCount } from "./meta";

function draftFrom(s: Submission | null | undefined): DraftState {
  const v = s?.latest_version;
  const structured: Record<string, string> = {};
  for (const [k, val] of Object.entries(v?.structured_answers ?? {})) structured[k] = typeof val === "string" ? val : val === null || val === undefined ? "" : String(val);
  return {
    text: v?.text_content ?? "",
    code: v?.code_content ?? "",
    structured,
    files: (v?.files ?? []).map((f) => ({ id: f.id, filename: f.filename, content_type: f.content_type, size_bytes: f.size_bytes })),
  };
}

function same(a: DraftState, b: DraftState) {
  return (
    a.text === b.text &&
    a.code === b.code &&
    JSON.stringify(a.structured) === JSON.stringify(b.structured) &&
    a.files.map((f) => f.id).join() === b.files.map((f) => f.id).join()
  );
}

/** Lightweight code editor (light theme, line numbers, Tab indents). */
function CodeArea({ value, onChange, disabled, id, describedBy }: { value: string; onChange: (v: string) => void; disabled?: boolean; id: string; describedBy?: string }) {
  const gutter = React.useRef<HTMLDivElement>(null);
  const lines = Math.max(14, value.split("\n").length + 1);
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/80 focus-within:border-brand-400 focus-within:ring-4 focus-within:ring-brand-500/15">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <span className="flex gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-rose-400" />
          <span className="size-2.5 rounded-full bg-amber-400" />
          <span className="size-2.5 rounded-full bg-emerald-400" />
        </span>
        <span className="ml-2 font-mono text-xs text-slate-500">solution</span>
      </div>
      <div className="flex max-h-[32rem] overflow-hidden">
        <div ref={gutter} className="select-none overflow-hidden border-r border-slate-200 bg-white/60 py-3 pl-3 pr-2 text-right font-mono text-[13px] leading-6 text-slate-400" aria-hidden>
          {Array.from({ length: lines }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <textarea
          id={id}
          aria-describedby={describedBy}
          value={value}
          disabled={disabled}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          rows={lines}
          onScroll={(e) => {
            if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
          }}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Tab" && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
              const el = e.currentTarget;
              const { selectionStart: s, selectionEnd: en } = el;
              if (s === en) {
                e.preventDefault();
                onChange(value.slice(0, s) + "  " + value.slice(en));
                requestAnimationFrame(() => {
                  el.selectionStart = el.selectionEnd = s + 2;
                });
              }
            }
          }}
          className="min-h-[18rem] flex-1 resize-y bg-transparent px-3 py-3 font-mono text-[13px] leading-6 text-slate-800 caret-brand-600 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed"
          placeholder="// Paste or write your code here"
        />
      </div>
    </div>
  );
}

function FileIcon({ type }: { type: string }) {
  const cat = fileCategory({ content_type: type });
  const Icon = cat === "screenshot" ? ImageIcon : FileText;
  return (
    <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl text-white", cat === "screenshot" ? "bg-gradient-to-br from-teal-400 to-sky-500" : "bg-gradient-to-br from-indigo-400 to-violet-500")}>
      <Icon className="size-4" aria-hidden />
    </span>
  );
}

export interface WorkspaceProps {
  assignment: LearnerAssignment;
  submission: Submission | null;
  onSubmitted?: (r: SubmitResult) => void;
}

/** Learner workspace: response, code, structured answers and evidence files; save versioned drafts and submit. */
export function AssignmentWorkspace({ assignment: a, submission: s, onSubmitted }: WorkspaceProps) {
  const qc = useQueryClient();
  const editable = canEdit(a, s);
  const saved = React.useMemo(() => draftFrom(s), [s]);
  const [draft, setDraft] = React.useState<DraftState>(saved);
  const [preview, setPreview] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  const [missing, setMissing] = React.useState<{ id?: string; label?: string; type?: string }[] | null>(null);
  const [uploads, setUploads] = React.useState<{ name: string; size: number; progress?: number; error?: string }[]>([]);
  const missingRef = React.useRef<HTMLDivElement>(null);
  const savedVersion = s?.current_version ?? 0;

  // Re-sync the editor when a different saved version arrives (e.g. after save or "load version").
  const lastSync = React.useRef(saved);
  React.useEffect(() => {
    if (lastSync.current !== saved) {
      lastSync.current = saved;
      setDraft(saved);
    }
  }, [saved]);

  const dirty = editable && !same(draft, saved);
  React.useEffect(() => {
    if (!dirty) return;
    const onBefore = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, [dirty]);

  const checklist = evidenceStatus(a.required_evidence, a.structured_fields, draft);
  const ready = evidenceReady(checklist);
  const showText = needsText(a) || !!draft.text;
  const showCode = needsCode(a) || !!draft.code;
  const showFiles = needsFiles(a) || draft.files.length > 0;
  const accept = a.allowed_file_types.length ? a.allowed_file_types.join(",") : undefined;
  const remaining = s?.submissions_remaining ?? a.max_submissions;

  const save = async (quiet = false): Promise<Submission | null> => {
    setSaving(true);
    try {
      const out = await api.put<Submission>(`/assignments/${a.id}/submission`, {
        text_content: draft.text || null,
        code_content: draft.code || null,
        structured_answers: draft.structured,
        file_ids: draft.files.map((f) => f.id),
      });
      qc.setQueryData(lk.assignments.submission(a.id), out);
      qc.invalidateQueries({ queryKey: lk.assignments.versions(a.id) });
      setMissing(null);
      if (!quiet) toast.success(`Draft saved · version ${out.current_version}`, { description: "Every save is kept in your version history." });
      return out;
    } catch (e) {
      if (e instanceof ApiError && e.code === "invalid_files") toast.error(e.message, { description: "Remove the highlighted files and try again." });
      else toast.error(errorMessage(e));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    setMissing(null);
    if (dirty || !s || s.status !== "draft") {
      const out = await save(true);
      if (!out) return;
    }
    try {
      const r = await api.post<SubmitResult>(`/assignments/${a.id}/submission/submit`);
      qc.setQueryData(lk.assignments.submission(a.id), r);
      qc.invalidateQueries({ queryKey: lk.assignments.all });
      qc.invalidateQueries({ queryKey: ["learn"] });
      toast.success("Submitted for assessment", {
        description: a.grading_mode === "manual" ? "An assessor will review your work." : "You'll get feedback as soon as it's ready.",
      });
      onSubmitted?.(r);
    } catch (e) {
      if (e instanceof ApiError && e.code === "missing_evidence") {
        const list = ((e.details as { missing?: { id?: string; label?: string; type?: string }[] } | undefined)?.missing ?? []).filter(Boolean);
        setMissing(list.length ? list : [{ label: "Some required evidence" }]);
        requestAnimationFrame(() => missingRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
      } else toast.error(errorMessage(e));
    }
  };

  const addFiles = async (files: File[]) => {
    for (const f of files) {
      setUploads((u) => [...u, { name: f.name, size: f.size, progress: 0 }]);
      try {
        const res = await api.upload<FileOut>("/files", { file: f, purpose: "submission" }, { onProgress: (p) => setUploads((u) => u.map((x) => (x.name === f.name ? { ...x, progress: p } : x))) });
        setDraft((d) => ({ ...d, files: [...d.files, { id: res.id, filename: res.filename, content_type: res.content_type, size_bytes: res.size_bytes }] }));
        setUploads((u) => u.filter((x) => x.name !== f.name));
        toast.success(`${f.name} uploaded`, { description: "Save your draft to keep it with this version." });
      } catch (err) {
        setUploads((u) => u.map((x) => (x.name === f.name ? { ...x, error: errorMessage(err) } : x)));
      }
    }
  };

  const textId = React.useId();
  const codeId = React.useId();

  if (!editable) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-3xl border border-slate-200 bg-slate-50/70 p-5 sm:flex-row sm:items-center">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-slate-500 shadow-soft ring-1 ring-slate-200">
          <Lock className="size-5" aria-hidden />
        </span>
        <div className="flex-1 text-sm">
          <p className="font-semibold text-slate-900">Your submission is locked while it&apos;s assessed</p>
          <p className="text-slate-600">You can read what you submitted in the version history. Editing reopens if it&apos;s returned to you or not passed.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_20rem]">
      <div className="min-w-0 space-y-6">
        {s?.status === "returned" && s.returned_feedback && (
          <Alert tone="warning" title="Your assessor asked for changes" icon={<AlertTriangle aria-hidden />}>
            <Markdown className="text-sm">{s.returned_feedback}</Markdown>
          </Alert>
        )}

        <div ref={missingRef} aria-live="assertive">
          {missing && (
            <Alert tone="danger" title="Some required evidence is missing" icon={<AlertTriangle aria-hidden />}>
              <p className="text-sm">Add these before submitting:</p>
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm">
                {missing.map((m, i) => (
                  <li key={m.id ?? i}>
                    <span className="font-semibold">{m.label ?? m.id}</span>
                    {m.type ? <span className="text-rose-700"> · {m.type}</span> : null}
                  </li>
                ))}
              </ul>
            </Alert>
          )}
        </div>

        {showText && (
          <section className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-soft sm:p-6" aria-labelledby={`${textId}-h`}>
            <SectionTitle
              id={`${textId}-h`}
              icon={PenLine}
              color="indigo"
              title="Your response"
              description="Markdown supported — headings, lists, **bold** and `code`"
              action={
                <div className="inline-flex rounded-lg bg-slate-100 p-0.5" role="group" aria-label="Editor mode">
                  {[
                    { k: false, label: "Write", icon: PenLine },
                    { k: true, label: "Preview", icon: Eye },
                  ].map((m) => (
                    <button
                      key={m.label}
                      type="button"
                      aria-pressed={preview === m.k}
                      onClick={() => setPreview(m.k)}
                      className={cn("inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition focus-visible:focus-ring", preview === m.k ? "bg-white text-slate-900 shadow-sm" : "text-slate-600")}
                    >
                      <m.icon className="size-3.5" aria-hidden /> {m.label}
                    </button>
                  ))}
                </div>
              }
            />
            <div className="mt-4">
              {preview ? (
                <div className="min-h-[16rem] rounded-2xl border border-slate-200 bg-slate-50/50 p-4">
                  {draft.text.trim() ? <Markdown>{draft.text}</Markdown> : <p className="text-sm text-slate-500">Nothing to preview yet.</p>}
                </div>
              ) : (
                <Textarea
                  id={textId}
                  aria-labelledby={`${textId}-h`}
                  value={draft.text}
                  onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
                  rows={14}
                  placeholder="Write your report here…"
                  className="min-h-[16rem] text-[15px] leading-relaxed"
                />
              )}
              <p className="mt-1.5 text-right text-xs tabular-nums text-slate-500" aria-live="polite">
                {wordCount(draft.text)} words
              </p>
            </div>
          </section>
        )}

        {a.structured_fields.length > 0 && (
          <section className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-soft sm:p-6" aria-label="Structured answers">
            <SectionTitle icon={FileText} color="teal" title="Structured answers" description="Fill in each field" />
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              {a.structured_fields.map((f) => {
                const long = ["textarea", "long_text", "long", "markdown", "text_long"].includes((f.type ?? "").toLowerCase());
                const type = (f.type ?? "text").toLowerCase();
                const val = draft.structured[f.id] ?? "";
                const set = (v: string) => setDraft((d) => ({ ...d, structured: { ...d.structured, [f.id]: v } }));
                return (
                  <div key={f.id} className={cn(long && "md:col-span-2")}>
                    <FormField label={f.label} hint={f.help ?? undefined} required={f.required !== false}>
                      {long ? (
                        <Textarea value={val} onChange={(e) => set(e.target.value)} rows={5} />
                      ) : (
                        <Input value={val} onChange={(e) => set(e.target.value)} type={type === "number" ? "number" : type === "url" ? "url" : type === "date" ? "date" : type === "email" ? "email" : "text"} />
                      )}
                    </FormField>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {showCode && (
          <section className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-soft sm:p-6" aria-labelledby={`${codeId}-h`}>
            <SectionTitle id={`${codeId}-h`} icon={Code2} color="violet" title="Code" description="Tab inserts two spaces · Esc then Tab moves focus on" />
            <div className="mt-4">
              <CodeArea id={codeId} describedBy={`${codeId}-h`} value={draft.code} onChange={(v) => setDraft((d) => ({ ...d, code: v }))} />
            </div>
          </section>
        )}

        {showFiles && (
          <section className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-soft sm:p-6" aria-label="Evidence files">
            <SectionTitle icon={UploadCloud} color="sky" title="Evidence files" description={accept ? `Accepted: ${a.allowed_file_types.join(", ")} · up to 50 MB each` : "Screenshots, documents or recordings · up to 50 MB each"} />
            <FileDropzone
              className="mt-4"
              onFiles={addFiles}
              multiple
              accept={accept}
              maxSize={50 * 1024 * 1024}
              files={uploads}
              onRemove={(i) => setUploads((u) => u.filter((_, j) => j !== i))}
              hint="Files are virus-scanned and stored privately — only you and your assessors can open them."
            />
            {draft.files.length > 0 && (
              <ul className="mt-4 space-y-2" aria-label="Attached files">
                {draft.files.map((f) => {
                  const unsaved = !saved.files.some((x) => x.id === f.id);
                  return (
                    <li key={f.id} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3">
                      <FileIcon type={f.content_type} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-slate-900">{f.filename}</span>
                        <span className="block text-xs text-slate-500">
                          {formatBytes(f.size_bytes)} · {fileCategory(f) === "screenshot" ? "Screenshot / image" : "Document"}
                          {unsaved ? <span className="font-semibold text-amber-700"> · not saved yet</span> : null}
                        </span>
                      </span>
                      <Button variant="ghost" size="icon-sm" aria-label={`Remove ${f.filename}`} onClick={() => setDraft((d) => ({ ...d, files: d.files.filter((x) => x.id !== f.id) }))}>
                        <Trash2 />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
      </div>

      <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start" aria-label="Submission">
        <section className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-soft">
          <div className="h-1 bg-gradient-to-r from-amber-400 via-orange-500 to-rose-500" aria-hidden />
          <div className="space-y-4 p-5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-900">{savedVersion ? `Draft · version ${savedVersion}` : "New draft"}</p>
              {dirty ? (
                <Badge tone="warning" size="sm" dot>
                  Unsaved changes
                </Badge>
              ) : savedVersion ? (
                <Badge tone="success" size="sm">
                  <CheckCircle2 aria-hidden /> Saved
                </Badge>
              ) : null}
            </div>
            {s?.latest_version && <p className="-mt-2 text-xs text-slate-500">Last saved {formatRelative(s.latest_version.created_at)}</p>}
            <EvidenceChecklist items={checklist as { item: EvidenceItem; met: boolean }[]} />
            <div className="grid gap-2">
              <Button variant="secondary" leftIcon={<Save />} loading={saving && !confirm} disabled={!dirty} onClick={() => void save()}>
                Save draft
              </Button>
              <Button variant="gradient" leftIcon={<Send />} onClick={() => setConfirm(true)} disabled={saving || (remaining !== null && remaining !== undefined && remaining <= 0)}>
                Submit for assessment
              </Button>
            </div>
            <p className="flex items-start gap-2 text-xs text-slate-500">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-600" aria-hidden />
              {remaining === null || remaining === undefined ? "Unlimited submissions." : `${remaining} submission${remaining === 1 ? "" : "s"} remaining.`} Submitted versions are fingerprinted and can&apos;t be changed.
            </p>
          </div>
        </section>
      </aside>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Submit for assessment?"
        description={ready ? "Everything required looks ready. Once submitted, this version is locked for grading." : "Some required evidence still looks incomplete — the assessor needs every item."}
        confirmLabel={dirty ? "Save & submit" : "Submit"}
        onConfirm={submit}
      >
        <EvidenceChecklist items={checklist} />
      </ConfirmDialog>
    </div>
  );
}
