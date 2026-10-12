"use client";

import {
  Alert,
  Badge,
  Breadcrumbs,
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  FormField,
  Input,
  SimpleSelect,
  Skeleton,
  Switch,
  Textarea,
  cn,
  colorClasses,
  toast,
} from "@praxis/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  BookOpen,
  CheckCircle2,
  Circle,
  ClipboardCheck,
  Clock,
  Code2,
  Eye,
  FileText,
  Files,
  FormInput,
  Headphones,
  Image as ImageIcon,
  Library,
  Link as LinkIcon,
  ListChecks,
  Lock,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  Rocket,
  Scale,
  ShieldAlert,
  Target,
  Trash2,
  Type,
  UploadCloud,
  Video,
  Wand2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Markdown } from "@/components/common/markdown";
import { ErrorState } from "@/components/common/error-state";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatRelative } from "@/lib/format";
import { problemsMessage, uid, useAutosave } from "../hooks";
import { ak } from "../keys";
import { MarkdownEditor } from "../markdown-editor";
import { useUpload } from "../media-field";
import { GRADING_MODES } from "../meta";
import { RubricGrid } from "../rubrics/rubric-editor";
import { AIBadge, AStatus, GradientHeader, InlineTitle, NumberInput, SaveIndicator, SectionCard, SkillPicker, SubNav, TagInput, ToggleRow } from "../shared";
import type { Assignment, AssignmentResource, EvidenceItem, EvidenceType, Rubric, StructuredField } from "../types";
import { useCourseOptions } from "../use-options";
import { ASSIGN_NAV, GradingChip } from "./assignment-list";
import { RubricPicker } from "./rubric-picker";

/* ------------------------------------------------------------------ constants */

const EVIDENCE_META: Record<EvidenceType, { label: string; icon: typeof FileText; color: Parameters<typeof colorClasses>[0]; hint: string }> = {
  text: { label: "Written response", icon: Type, color: "indigo", hint: "Typed answer in the editor" },
  file: { label: "Any file", icon: Paperclip, color: "sky", hint: "One uploaded file of any kind" },
  document: { label: "Document", icon: FileText, color: "emerald", hint: "PDF, Word, slides…" },
  screenshot: { label: "Screenshot", icon: ImageIcon, color: "teal", hint: "An image upload" },
  video: { label: "Video", icon: Video, color: "rose", hint: "Screen or camera recording" },
  audio: { label: "Audio", icon: Headphones, color: "orange", hint: "Voice note or call recording" },
  code: { label: "Code", icon: Code2, color: "violet", hint: "Code editor or code file" },
  structured: { label: "Structured form", icon: FormInput, color: "fuchsia", hint: "The fields defined below" },
};

const FIELD_TYPES = [
  { value: "text", label: "Short text" },
  { value: "textarea", label: "Long text" },
  { value: "number", label: "Number" },
  { value: "url", label: "Link" },
  { value: "date", label: "Date" },
  { value: "email", label: "Email" },
];

const FILE_PRESETS = [
  { label: "Documents", types: [".pdf", ".docx", ".pptx"] },
  { label: "Images", types: [".png", ".jpg", ".jpeg"] },
  { label: "Spreadsheets", types: [".xlsx", ".csv"] },
  { label: "Media", types: [".mp4", ".mp3", ".m4a"] },
  { label: "Code & logs", types: [".txt", ".log", ".py", ".ps1", ".sh", ".json"] },
];

const AI_MODES = new Set(["ai_assisted", "ai_recommend_human_final"]);

type Form = {
  course_id: string | null;
  scenario: string;
  objective: string;
  instructions: string;
  required_evidence: EvidenceItem[];
  structured_fields: StructuredField[];
  resources: AssignmentResource[];
  expected_output: string;
  evaluation_criteria: string;
  rubric_id: string | null;
  time_limit_minutes: number | null;
  due_days_after_enrolment: number | null;
  passing_score: number;
  grading_mode: string;
  high_stakes: boolean;
  max_submissions: number | null;
  allowed_file_types: string[];
  skill_ids: string[];
};

function toForm(a: Assignment): Form {
  return {
    course_id: a.course_id,
    scenario: a.scenario ?? "",
    objective: a.objective ?? "",
    instructions: a.instructions ?? "",
    required_evidence: (a.required_evidence ?? []).map((e) => ({ ...e, required: e.required !== false })),
    structured_fields: (a.structured_fields ?? []).map((f) => ({ ...f, help: f.help ?? "", required: f.required !== false })),
    resources: a.resources ?? [],
    expected_output: a.expected_output ?? "",
    evaluation_criteria: a.evaluation_criteria ?? "",
    rubric_id: a.rubric_id,
    time_limit_minutes: a.time_limit_minutes,
    due_days_after_enrolment: a.due_days_after_enrolment,
    passing_score: a.passing_score,
    grading_mode: a.grading_mode,
    high_stakes: a.high_stakes,
    max_submissions: a.max_submissions,
    allowed_file_types: a.allowed_file_types ?? [],
    skill_ids: (a.skill_ids ?? []).map(String),
  };
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40) || uid("f");

function sectionProblems(f: Form) {
  return {
    evidence: f.required_evidence.some((e) => !e.label.trim()) ? "Every evidence item needs a label" : null,
    fields: f.structured_fields.some((x) => !x.label.trim()) ? "Every form field needs a label" : null,
    resources: f.resources.some((r) => !r.title.trim() || (!r.url && !r.file_id)) ? "Each resource needs a title and a link or file" : null,
  };
}

/* ------------------------------------------------------------------ row helpers */

function move<T>(list: T[], i: number, d: -1 | 1): T[] {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

function RowControls({ i, n, label, onMove, onRemove }: { i: number; n: number; label: string; onMove: (d: -1 | 1) => void; onRemove: () => void }) {
  return (
    <div className="flex shrink-0 items-center">
      <Button variant="ghost" size="icon-sm" aria-label={`Move ${label} up`} disabled={i === 0} onClick={() => onMove(-1)}>
        <ArrowUp />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label={`Move ${label} down`} disabled={i === n - 1} onClick={() => onMove(1)}>
        <ArrowDown />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label={`Remove ${label}`} onClick={onRemove}>
        <Trash2 />
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ evidence builder */

function EvidenceBuilder({ value, onChange }: { value: EvidenceItem[]; onChange: (v: EvidenceItem[]) => void }) {
  const add = (type: EvidenceType) => {
    const label = EVIDENCE_META[type].label;
    let id = slug(label);
    while (value.some((e) => e.id === id)) id = `${slug(label)}_${Math.random().toString(36).slice(2, 5)}`;
    onChange([...value, { id, label, type, required: true }]);
  };
  return (
    <div className="space-y-3">
      {value.length > 0 && (
        <ol className="space-y-2">
          {value.map((e, i) => {
            const m = EVIDENCE_META[e.type] ?? EVIDENCE_META.file;
            const c = colorClasses(m.color);
            const Icon = m.icon;
            return (
              <li key={e.id} className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-2.5 shadow-sm 2xl:flex-row 2xl:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow-sm", c.gradient)} aria-hidden>
                    <Icon className="size-4" />
                  </span>
                  <Input
                    inputSize="sm"
                    value={e.label}
                    aria-label={`Evidence ${i + 1} label`}
                    aria-invalid={!e.label.trim() || undefined}
                    placeholder="What should learners provide?"
                    maxLength={200}
                    onChange={(ev) => onChange(value.map((x, j) => (j === i ? { ...x, label: ev.target.value } : x)))}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 pl-11 2xl:pl-0">
                  <SimpleSelect
                    aria-label={`Evidence ${i + 1} type`}
                    value={e.type}
                    onValueChange={(t) => onChange(value.map((x, j) => (j === i ? { ...x, type: t as EvidenceType } : x)))}
                    options={(Object.keys(EVIDENCE_META) as EvidenceType[]).map((t) => ({ value: t, label: EVIDENCE_META[t].label }))}
                    className="h-9 w-40"
                  />
                  <span className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                    <Switch checked={e.required} onCheckedChange={(v) => onChange(value.map((x, j) => (j === i ? { ...x, required: v } : x)))} aria-label={`Evidence ${i + 1} required`} />
                    <span aria-hidden>Required</span>
                  </span>
                  <RowControls i={i} n={value.length} label={`evidence ${i + 1}`} onMove={(d) => onChange(move(value, i, d))} onRemove={() => onChange(value.filter((_, j) => j !== i))} />
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <div>
        <p className="mb-2 text-2xs font-bold uppercase tracking-wider text-slate-500">Add evidence</p>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(EVIDENCE_META) as EvidenceType[]).map((t) => {
            const m = EVIDENCE_META[t];
            const c = colorClasses(m.color);
            const Icon = m.icon;
            return (
              <button
                key={t}
                type="button"
                title={m.hint}
                onClick={() => add(t)}
                className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition-colors hover:-translate-y-px focus-visible:focus-ring", c.soft, c.text, c.ring)}
              >
                <Icon className="size-3.5" aria-hidden />
                <Plus className="-ml-1 size-3" aria-hidden />
                {m.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function FieldsBuilder({ value, onChange }: { value: StructuredField[]; onChange: (v: StructuredField[]) => void }) {
  return (
    <div className="space-y-2">
      {value.map((f, i) => (
        <div key={f.id} className="rounded-2xl border border-fuchsia-200/70 bg-gradient-to-r from-fuchsia-50/50 to-white p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto]">
            <Input
              inputSize="sm"
              value={f.label}
              placeholder="Field label, e.g. Root cause"
              aria-label={`Field ${i + 1} label`}
              aria-invalid={!f.label.trim() || undefined}
              maxLength={200}
              onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
            />
            <SimpleSelect aria-label={`Field ${i + 1} type`} value={f.type || "text"} onValueChange={(t) => onChange(value.map((x, j) => (j === i ? { ...x, type: t } : x)))} options={FIELD_TYPES} className="h-9" />
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                <Switch checked={f.required} onCheckedChange={(v) => onChange(value.map((x, j) => (j === i ? { ...x, required: v } : x)))} aria-label={`Field ${i + 1} required`} />
                <span aria-hidden>Required</span>
              </span>
              <RowControls i={i} n={value.length} label={`field ${i + 1}`} onMove={(d) => onChange(move(value, i, d))} onRemove={() => onChange(value.filter((_, j) => j !== i))} />
            </div>
          </div>
          <Input
            inputSize="sm"
            className="mt-2"
            value={f.help ?? ""}
            placeholder="Help text shown under the field (optional)"
            aria-label={`Field ${i + 1} help text`}
            maxLength={2000}
            onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, help: e.target.value } : x)))}
          />
        </div>
      ))}
      <Button variant="soft" size="sm" leftIcon={<Plus />} onClick={() => onChange([...value, { id: uid("fld_"), label: "", type: "text", help: "", required: true }])}>
        Add field
      </Button>
    </div>
  );
}

function ResourcesBuilder({ value, onChange }: { value: AssignmentResource[]; onChange: (v: AssignmentResource[]) => void }) {
  const { upload, uploading, progress, name } = useUpload("lesson_media");
  const fileRef = React.useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-2">
      {value.map((r, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-2.5 shadow-sm sm:flex-row sm:items-center">
          <span className={cn("hidden size-9 shrink-0 place-items-center rounded-xl sm:grid", r.file_id ? "bg-emerald-50 text-emerald-600" : "bg-teal-50 text-teal-600")} aria-hidden>
            {r.file_id ? <Files className="size-4" /> : <LinkIcon className="size-4" />}
          </span>
          <Input
            inputSize="sm"
            value={r.title}
            placeholder="Title, e.g. Firewall log excerpt"
            aria-label={`Resource ${i + 1} title`}
            maxLength={255}
            onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
          />
          <Input
            inputSize="sm"
            value={r.url ?? ""}
            placeholder="https://…"
            aria-label={`Resource ${i + 1} link`}
            maxLength={2048}
            disabled={!!r.file_id}
            onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, url: e.target.value || null } : x)))}
          />
          <RowControls i={i} n={value.length} label={`resource ${i + 1}`} onMove={(d) => onChange(move(value, i, d))} onRemove={() => onChange(value.filter((_, j) => j !== i))} />
        </div>
      ))}
      {uploading && (
        <p className="text-xs text-slate-600" aria-live="polite">
          Uploading {name}… {progress}%
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="soft" size="sm" leftIcon={<LinkIcon />} onClick={() => onChange([...value, { title: "", url: "" }])}>
          Add link
        </Button>
        <Button variant="secondary" size="sm" leftIcon={<UploadCloud />} loading={uploading} onClick={() => fileRef.current?.click()}>
          Upload file
        </Button>
        <input
          ref={fileRef}
          type="file"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            const out = await upload(file);
            if (out) onChange([...value, { title: out.filename, url: out.download_url, file_id: out.id }]);
          }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ learner preview */

function LearnerPreview({ title, form, rubric }: { title: string; form: Form; rubric?: Rubric | null }) {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Badge tone="violet">
        <Eye aria-hidden /> Learner preview · expected output and assessor notes are hidden
      </Badge>
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-soft">
        <div className="relative overflow-hidden border-b border-amber-100 bg-gradient-to-br from-amber-50 via-orange-50 to-rose-50 p-6">
          <span className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-amber-400 via-orange-500 to-rose-500" aria-hidden />
          <p className="text-xs font-semibold uppercase tracking-wider text-orange-800">Practical assignment</p>
          <h2 className="mt-1 font-display text-2xl font-bold text-slate-900">{title}</h2>
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm font-medium text-slate-700">
            <span>Pass with {Math.round(form.passing_score)}%</span>
            {form.time_limit_minutes && <span>{form.time_limit_minutes} min limit</span>}
            {form.due_days_after_enrolment !== null && <span>Due {form.due_days_after_enrolment} days after enrolling</span>}
            {form.max_submissions && <span>{form.max_submissions} submission{form.max_submissions === 1 ? "" : "s"}</span>}
          </p>
        </div>
        <div className="space-y-6 p-6">
          {form.scenario.trim() && (
            <section>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-amber-700">The situation</h3>
              <Markdown>{form.scenario}</Markdown>
            </section>
          )}
          {form.objective.trim() && (
            <section className="rounded-2xl bg-emerald-50 p-4 ring-1 ring-inset ring-emerald-200">
              <h3 className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-emerald-800">
                <Target className="size-3.5" aria-hidden /> Your objective
              </h3>
              <p className="text-sm text-emerald-950">{form.objective}</p>
            </section>
          )}
          {form.instructions.trim() && (
            <section>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-sky-700">Instructions</h3>
              <Markdown>{form.instructions}</Markdown>
            </section>
          )}
          {form.required_evidence.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-violet-700">What to submit</h3>
              <ul className="grid gap-2 sm:grid-cols-2">
                {form.required_evidence.map((e) => {
                  const m = EVIDENCE_META[e.type] ?? EVIDENCE_META.file;
                  const Icon = m.icon;
                  const c = colorClasses(m.color);
                  return (
                    <li key={e.id} className="flex items-center gap-2.5 rounded-xl border border-slate-200 p-2.5 text-sm">
                      <span className={cn("grid size-8 place-items-center rounded-lg", c.soft, c.icon)} aria-hidden>
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1 font-medium text-slate-800">{e.label}</span>
                      {e.required ? <Badge size="sm" tone="danger">Required</Badge> : <Badge size="sm">Optional</Badge>}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {form.structured_fields.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-fuchsia-700">Structured answers</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {form.structured_fields.map((f) => (
                  <FormField key={f.id} label={f.label || "Untitled field"} hint={f.help || undefined} required={f.required} className={f.type === "textarea" ? "sm:col-span-2" : undefined}>
                    {f.type === "textarea" ? <Textarea rows={3} disabled /> : <Input disabled type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"} />}
                  </FormField>
                ))}
              </div>
            </section>
          )}
          {form.resources.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-teal-700">Resources</h3>
              <ul className="space-y-1.5">
                {form.resources.map((r, i) => (
                  <li key={i}>
                    {r.url ? (
                      <a href={r.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded text-sm font-medium text-brand-700 hover:underline focus-visible:focus-ring">
                        <LinkIcon className="size-3.5" aria-hidden /> {r.title || r.url}
                      </a>
                    ) : (
                      <span className="inline-flex items-center gap-2 text-sm text-slate-700">
                        <LinkIcon className="size-3.5" aria-hidden /> {r.title}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {rubric && (
            <section>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-emerald-700">How you&apos;ll be assessed</h3>
              <RubricGrid criteria={rubric.criteria} />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ readiness */

function Readiness({ form, onFix }: { form: Form; onFix: (section: string) => void }) {
  const ai = AI_MODES.has(form.grading_mode);
  const checks = [
    { ok: !!(form.scenario.trim() || form.objective.trim() || form.instructions.trim()), label: "Brief written", hint: "Add a scenario, objective or instructions", section: "brief", blocking: true },
    { ok: form.required_evidence.length > 0, label: "Evidence defined", hint: "Tell learners what to submit", section: "evidence", blocking: false },
    { ok: !ai || !!form.rubric_id, label: ai ? "Rubric attached (needed for AI)" : "Rubric attached", hint: "Attach or create a rubric", section: "rubric", blocking: ai },
    { ok: !!form.expected_output.trim() || !!form.evaluation_criteria.trim(), label: "Assessor guidance", hint: "Helps assessors and the AI grade fairly", section: "guidance", blocking: false },
  ];
  const done = checks.filter((c) => c.ok).length;
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-soft">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-900">Ready to publish</p>
        <span className="text-xs font-semibold tabular-nums text-slate-500">
          {done}/{checks.length}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-gradient-to-r from-amber-400 via-emerald-400 to-emerald-500 transition-[width] duration-500" style={{ width: `${(done / checks.length) * 100}%` }} />
      </div>
      <ul className="mt-3 space-y-1.5">
        {checks.map((c) => (
          <li key={c.label}>
            <button type="button" onClick={() => onFix(c.section)} className="flex w-full items-start gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-slate-50 focus-visible:focus-ring">
              {c.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden /> : <Circle className={cn("mt-0.5 size-4 shrink-0", c.blocking ? "text-rose-500" : "text-amber-500")} aria-hidden />}
              <span className="min-w-0">
                <span className={cn("block text-sm", c.ok ? "text-slate-700" : "font-medium text-slate-900")}>{c.label}</span>
                {!c.ok && <span className={cn("block text-2xs", c.blocking ? "text-rose-700" : "text-amber-800")}>{c.blocking ? "Required · " : ""}{c.hint}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ editor */

function Editor({ assignment }: { assignment: Assignment }) {
  const qc = useQueryClient();
  const router = useRouter();
  const { can } = useAuth();
  const courses = useCourseOptions();
  const [form, setForm] = React.useState<Form>(() => toForm(assignment));
  const [view, setView] = React.useState<"edit" | "preview">("edit");
  const [confirm, setConfirm] = React.useState<"delete" | "archive" | null>(null);
  const [publishError, setPublishError] = React.useState<string | null>(null);
  const problems = sectionProblems(form);
  const rubric = useQuery({
    queryKey: ak.rubrics.detail(form.rubric_id ?? ""),
    enabled: !!form.rubric_id,
    queryFn: ({ signal }) => api.get<Rubric>(`/rubrics/${form.rubric_id}`, { signal }),
  });

  const save = useAutosave(async (f: Form) => {
    const p = sectionProblems(f);
    const body: Record<string, unknown> = {
      course_id: f.course_id,
      scenario: f.scenario,
      objective: f.objective,
      instructions: f.instructions,
      expected_output: f.expected_output.trim() || null,
      evaluation_criteria: f.evaluation_criteria.trim() || null,
      rubric_id: f.rubric_id,
      time_limit_minutes: f.time_limit_minutes,
      due_days_after_enrolment: f.due_days_after_enrolment,
      passing_score: Math.max(0, Math.min(100, f.passing_score)),
      grading_mode: f.grading_mode,
      high_stakes: f.high_stakes,
      max_submissions: f.max_submissions,
      allowed_file_types: f.allowed_file_types,
      skill_ids: f.skill_ids,
    };
    if (!p.evidence) body.required_evidence = f.required_evidence.map((e) => ({ ...e, label: e.label.trim() }));
    if (!p.fields) body.structured_fields = f.structured_fields.map((x) => ({ ...x, label: x.label.trim(), help: x.help?.trim() || null }));
    if (!p.resources) body.resources = f.resources.map((r) => ({ title: r.title.trim(), url: r.url || null, file_id: r.file_id ?? null }));
    const out = await api.patch<Assignment>(`/assignments/${assignment.id}`, body);
    qc.setQueryData(ak.assignments.detail(assignment.id), out);
    qc.invalidateQueries({ queryKey: ["assignments", "list"] });
  });

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    const next = { ...form, [k]: v };
    setForm(next);
    setPublishError(null);
    save.schedule(next);
  };

  const publish = useMutation({
    mutationFn: async () => {
      await save.flush();
      return api.post<Assignment>(`/assignments/${assignment.id}/publish`);
    },
    onSuccess: (a) => {
      toast.success(`“${a.title}” is published`);
      qc.setQueryData(ak.assignments.detail(assignment.id), a);
      qc.invalidateQueries({ queryKey: ["assignments", "list"] });
    },
    onError: (e) => setPublishError(problemsMessage(e)),
  });
  const archive = useMutation({
    mutationFn: () => api.post<Assignment>(`/assignments/${assignment.id}/archive`),
    onSuccess: (a) => {
      toast.success("Assignment archived — it no longer accepts submissions");
      qc.setQueryData(ak.assignments.detail(assignment.id), a);
      qc.invalidateQueries({ queryKey: ["assignments", "list"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const rename = async (title: string) => {
    try {
      const out = await api.patch<Assignment>(`/assignments/${assignment.id}`, { title });
      qc.setQueryData(ak.assignments.detail(assignment.id), out);
      toast.success("Renamed");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const focusSection = (id: string) => {
    setView("edit");
    setTimeout(() => document.getElementById(`as-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  const ai = AI_MODES.has(form.grading_mode);
  const course = courses.titleOf(form.course_id);
  const usesFiles = form.required_evidence.some((e) => ["file", "document", "screenshot", "video", "audio", "code"].includes(e.type));

  return (
    <div className="space-y-5">
      <Breadcrumbs linkComponent={Link} items={[{ label: "Assignments", href: "/app/instructor/assignments" }, { label: assignment.title }]} />
      <SubNav items={ASSIGN_NAV} className="mb-0" />
      <GradientHeader color="amber">
        <div className="flex flex-col gap-4 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <span className="hidden size-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-glow sm:grid">
              <ClipboardCheck className="size-7" aria-hidden />
            </span>
            <div className="min-w-0">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <AStatus status={assignment.status} size="sm" />
                <GradingChip mode={form.grading_mode} />
                {form.high_stakes && (
                  <Badge tone="danger" size="sm">
                    <ShieldAlert aria-hidden /> High stakes
                  </Badge>
                )}
                {assignment.ai_generated && <AIBadge />}
              </div>
              <InlineTitle value={assignment.title} onCommit={rename} ariaLabel="Assignment title" className="font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl" />
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {course && (
                  <Link href={`/app/instructor/courses/${form.course_id}`} className="inline-flex items-center gap-1 rounded hover:text-brand-700 focus-visible:focus-ring">
                    <BookOpen className="size-3.5" aria-hidden /> {course}
                  </Link>
                )}
                <span className="inline-flex items-center gap-1">
                  <Paperclip className="size-3.5" aria-hidden /> {form.required_evidence.length} evidence item{form.required_evidence.length === 1 ? "" : "s"}
                </span>
                <span>Updated {formatRelative(assignment.updated_at)}</span>
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <SaveIndicator status={save.status} error={save.error} savedAt={save.savedAt} onRetry={() => void save.flush()} className="w-full sm:w-auto" />
            <div className="flex items-center rounded-xl bg-slate-100 p-1" role="radiogroup" aria-label="View">
              {(
                [
                  ["edit", Pencil, "Edit"],
                  ["preview", Eye, "Preview"],
                ] as const
              ).map(([v, Icon, l]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={view === v}
                  onClick={() => setView(v)}
                  className={cn("inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold focus-visible:focus-ring", view === v ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900")}
                >
                  <Icon className="size-3.5" aria-hidden /> {l}
                </button>
              ))}
            </div>
            {assignment.status !== "published" && (
              <Button variant="gradient" leftIcon={<Rocket />} loading={publish.isPending} onClick={() => publish.mutate()}>
                Publish
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="icon" aria-label="More actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {assignment.status === "published" && (
                  <DropdownMenuItem onSelect={() => setConfirm("archive")}>
                    <Archive /> Archive
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem asChild>
                  <Link href="/app/instructor/grading">
                    <ListChecks /> Open grading queue
                  </Link>
                </DropdownMenuItem>
                {can("assignments.manage") && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem destructive onSelect={() => setConfirm("delete")}>
                      <Trash2 /> Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </GradientHeader>

      {publishError && (
        <Alert tone="danger" title="Not ready to publish" action={<Button size="xs" variant="ghost" onClick={() => setPublishError(null)}>Dismiss</Button>}>
          {publishError}
        </Alert>
      )}

      {view === "preview" ? (
        <LearnerPreview title={assignment.title} form={form} rubric={rubric.data} />
      ) : (
        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-6">
            <SectionCard id="as-brief" title="The brief" description="Set the scene, the goal and the steps" icon={BookOpen} color="amber">
              <div className="space-y-4">
                <FormField label="Scenario" hint="A realistic situation: who, where, what just happened.">
                  {(aria) => <MarkdownEditor {...aria} label="Scenario" value={form.scenario} onChange={(v) => set("scenario", v)} minRows={6} compact placeholder="It's 9:05 on Monday. The service desk queue is filling with…" />}
                </FormField>
                <FormField label="Objective" hint="One sentence: what a successful submission achieves.">
                  <Textarea rows={2} value={form.objective} onChange={(e) => set("objective", e.target.value)} maxLength={20000} placeholder="Identify the root cause and write a resolution report for the IT manager." />
                </FormField>
                <FormField label="Instructions" hint="Markdown supported — numbered steps work well.">
                  {(aria) => <MarkdownEditor {...aria} label="Instructions" value={form.instructions} onChange={(v) => set("instructions", v)} minRows={8} />}
                </FormField>
              </div>
            </SectionCard>

            <SectionCard id="as-evidence" title="Evidence learners submit" description="Each required item becomes a checklist entry learners must satisfy" icon={Paperclip} color="sky">
              <div className="space-y-5">
                <EvidenceBuilder value={form.required_evidence} onChange={(v) => set("required_evidence", v)} />
                {problems.evidence && <Alert tone="warning">{problems.evidence} — evidence changes are held until then.</Alert>}
                <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                  <p className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <FormInput className="size-4 text-fuchsia-600" aria-hidden /> Structured form fields
                  </p>
                  <p className="mb-3 text-xs text-muted-foreground">Ask for specific answers (root cause, ticket number, steps taken). Used by “Structured form” evidence.</p>
                  <FieldsBuilder value={form.structured_fields} onChange={(v) => set("structured_fields", v)} />
                  {problems.fields && <p className="mt-2 text-xs font-medium text-amber-800">{problems.fields}</p>}
                </div>
                {usesFiles && (
                  <FormField label="Allowed file types" hint="Leave empty to accept any safe file. Learners see this list.">
                    {(aria) => (
                      <div className="space-y-2">
                        <TagInput id={aria.id} aria-describedby={aria["aria-describedby"]} lowercase value={form.allowed_file_types} onChange={(v) => set("allowed_file_types", v.map((t) => (t.startsWith(".") ? t : `.${t}`)))} placeholder=".pdf, .png…" />
                        <div className="flex flex-wrap gap-1.5">
                          {FILE_PRESETS.map((p) => {
                            const on = p.types.every((t) => form.allowed_file_types.includes(t));
                            return (
                              <button
                                key={p.label}
                                type="button"
                                aria-pressed={on}
                                onClick={() => set("allowed_file_types", on ? form.allowed_file_types.filter((t) => !p.types.includes(t)) : [...new Set([...form.allowed_file_types, ...p.types])])}
                                className={cn("rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset focus-visible:focus-ring", on ? "bg-sky-50 text-sky-800 ring-sky-200" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50")}
                              >
                                {on ? "✓ " : "+ "}
                                {p.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </FormField>
                )}
              </div>
            </SectionCard>

            <SectionCard id="as-resources" title="Resources" description="Logs, templates, policies or data learners need" icon={Library} color="teal">
              <ResourcesBuilder value={form.resources} onChange={(v) => set("resources", v)} />
              {problems.resources && <p className="mt-2 text-xs font-medium text-amber-800">{problems.resources}</p>}
            </SectionCard>

            <SectionCard
              id="as-guidance"
              title="Assessor guidance"
              description="Used by assessors and the AI grader"
              icon={Lock}
              color="violet"
              action={
                <Badge tone="violet" size="sm">
                  <Lock aria-hidden /> Never shown to learners
                </Badge>
              }
            >
              <div className="space-y-4">
                <FormField label="Expected output" hint="A model answer or the key points a strong submission contains.">
                  {(aria) => <MarkdownEditor {...aria} label="Expected output" value={form.expected_output} onChange={(v) => set("expected_output", v)} minRows={6} compact />}
                </FormField>
                <FormField label="Evaluation criteria" hint="Shown to learners as a summary of how work is judged — keep it high-level.">
                  <Textarea rows={3} value={form.evaluation_criteria} onChange={(e) => set("evaluation_criteria", e.target.value)} maxLength={20000} />
                </FormField>
              </div>
            </SectionCard>

            <SectionCard id="as-rubric" title="Rubric" description="Weighted criteria with level descriptors" icon={Scale} color="emerald">
              <RubricPicker value={form.rubric_id} onChange={(id) => set("rubric_id", id)} aiMode={ai} />
            </SectionCard>
          </div>

          <aside className="space-y-4 xl:sticky xl:top-20" aria-label="Grading and rules">
            <Readiness form={form} onFix={focusSection} />
            <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-soft">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Wand2 className="size-4 text-fuchsia-600" aria-hidden /> Grading
              </p>
              <div className="space-y-1.5" role="radiogroup" aria-label="Grading mode">
                {GRADING_MODES.map((g) => {
                  const on = form.grading_mode === g.value;
                  const c = colorClasses(g.color);
                  return (
                    <button
                      key={g.value}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => set("grading_mode", g.value)}
                      className={cn("flex w-full items-start gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors focus-visible:focus-ring", on ? cn(c.border, c.soft) : "border-transparent hover:bg-slate-50")}
                    >
                      <span className={cn("mt-1 grid size-3.5 shrink-0 place-items-center rounded-full border-2", on ? cn("border-transparent", c.solid) : "border-slate-300")} aria-hidden>
                        {on && <span className="size-1 rounded-full bg-white" />}
                      </span>
                      <span>
                        <span className={cn("block text-sm font-semibold", on ? c.text : "text-slate-800")}>{g.label}</span>
                        <span className="block text-2xs text-muted-foreground">{g.description}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              {ai && !form.rubric_id && <Alert tone="warning">AI grading needs a rubric before you can publish.</Alert>}
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label htmlFor="as-pass" className="text-sm font-medium text-slate-800">
                    Passing score
                  </label>
                  <span className="font-display text-xl font-bold tabular-nums text-emerald-700">{Math.round(form.passing_score)}%</span>
                </div>
                <input id="as-pass" type="range" min={0} max={100} step={5} value={form.passing_score} onChange={(e) => set("passing_score", Number(e.target.value))} className="w-full accent-emerald-600" aria-valuetext={`${form.passing_score}%`} />
              </div>
              <ToggleRow icon={ShieldAlert} color="rose" label="High stakes" description="AI grades become recommendations — an assessor confirms every final grade." checked={form.high_stakes} onCheckedChange={(v) => set("high_stakes", v)} />
            </div>
            <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-soft">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Clock className="size-4 text-sky-600" aria-hidden /> Rules
              </p>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Time limit" hint="Empty = none">
                  {(aria) => <NumberInput {...aria} value={form.time_limit_minutes} onChange={(v) => set("time_limit_minutes", v && v >= 1 ? Math.round(v) : null)} min={1} suffix="min" placeholder="—" />}
                </FormField>
                <FormField label="Due after" hint="Days from enrolment">
                  {(aria) => <NumberInput {...aria} value={form.due_days_after_enrolment} onChange={(v) => set("due_days_after_enrolment", v === null ? null : Math.max(0, Math.round(v)))} min={0} suffix="days" placeholder="—" />}
                </FormField>
                <FormField label="Max submissions" hint="Empty = unlimited" className="col-span-2">
                  {(aria) => <NumberInput {...aria} value={form.max_submissions} onChange={(v) => set("max_submissions", v && v >= 1 ? Math.min(100, Math.round(v)) : null)} min={1} max={100} placeholder="Unlimited" />}
                </FormField>
              </div>
            </div>
            <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-soft">
              <FormField label="Course">
                {(aria) => <SimpleSelect {...aria} value={form.course_id ?? "none"} onValueChange={(v) => set("course_id", v === "none" ? null : v)} options={[{ value: "none", label: "Not linked to a course" }, ...courses.options]} />}
              </FormField>
              <FormField label="Skills assessed">{() => <SkillPicker value={form.skill_ids} onChange={(v) => set("skill_ids", v)} />}</FormField>
            </div>
          </aside>
        </div>
      )}

      <ConfirmDialog
        open={confirm === "archive"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Archive this assignment?"
        description="It stops accepting submissions. Existing submissions and grades are kept."
        confirmLabel="Archive"
        onConfirm={() => archive.mutateAsync().then(() => undefined)}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(o) => !o && setConfirm(null)}
        destructive
        title={`Delete “${assignment.title}”?`}
        description="Assignment lessons linked to it will block course publishing until relinked."
        confirmLabel="Delete assignment"
        onConfirm={async () => {
          try {
            save.reset();
            await api.delete(`/assignments/${assignment.id}`);
            toast.success("Assignment deleted");
            qc.invalidateQueries({ queryKey: ["assignments", "list"] });
            router.push("/app/instructor/assignments");
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </div>
  );
}

/** /app/instructor/assignments/[id] */
export function AssignmentEditor({ assignmentId }: { assignmentId: string }) {
  const q = useQuery({
    queryKey: ak.assignments.detail(assignmentId),
    queryFn: ({ signal }) => api.get<Assignment>(`/assignments/${assignmentId}`, { signal }),
  });
  if (q.isLoading)
    return (
      <div className="space-y-6" aria-busy aria-label="Loading assignment">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-36 rounded-3xl" />
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Skeleton className="h-[480px] rounded-3xl" />
          <Skeleton className="h-80 rounded-3xl" />
        </div>
      </div>
    );
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} size="lg" />;
  return <Editor key={q.data.id} assignment={q.data} />;
}
