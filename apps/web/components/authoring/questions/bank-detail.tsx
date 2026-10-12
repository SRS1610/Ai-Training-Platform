"use client";

import {
  Alert,
  Badge,
  Breadcrumbs,
  Button,
  ConfirmDialog,
  DataTable,
  FilterBar,
  SimpleSelect,
  Skeleton,
  Tooltip,
  cn,
  colorClasses,
  toast,
  type ColumnDef,
} from "@praxis/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Copy, Download, FileUp, Library, Pencil, Plus, Sparkles, Target, Trash2 } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { ErrorState } from "@/components/common/error-state";
import { api, errorMessage } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { downloadJson, problemsFrom, problemsMessage } from "../hooks";
import { ak } from "../keys";
import { QUESTION_DIFFICULTY, QUESTION_TYPES, questionMeta, type QuestionTypeKey } from "../meta";
import { AIBadge, AStatus, DifficultyDots, GradientHeader, SubNav, TypeChip } from "../shared";
import type { Bank, Page, Question, QuestionInput } from "../types";
import { useCourseOptions } from "../use-options";
import { ASSESS_NAV, BankDialog } from "./banks-list";
import { QuestionEditorDialog } from "./question-editor";

function plain(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`[\]()!-]/g, "")
    .replace(/\{\{\w+\}\}/g, "____")
    .replace(/\s+/g, " ")
    .trim();
}

function toInput(q: Question): QuestionInput {
  return {
    bank_id: q.bank_id,
    question_type: q.question_type as QuestionInput["question_type"],
    prompt: q.prompt,
    options: q.options,
    answer_key: q.answer_key,
    explanation: q.explanation,
    points: q.points,
    negative_points: q.negative_points,
    difficulty: q.difficulty,
    tags: q.tags,
    skill_ids: q.skill_ids,
    rubric_id: q.rubric_id,
    status: (q.status as QuestionInput["status"]) ?? "active",
  };
}

export function BankDetail({ bankId }: { bankId: string }) {
  const qc = useQueryClient();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [search, setSearch] = React.useState("");
  const [type, setType] = React.useState("all");
  const [difficulty, setDifficulty] = React.useState("all");
  const [status, setStatus] = React.useState("all");
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize: 20 });
  const [editor, setEditor] = React.useState<{ question: Question | null } | null>(null);
  const [toDelete, setToDelete] = React.useState<Question | null>(null);
  const [editBank, setEditBank] = React.useState(false);
  const [importErrors, setImportErrors] = React.useState<string[]>([]);
  const courses = useCourseOptions();

  const bank = useQuery({ queryKey: ak.banks.detail(bankId), queryFn: ({ signal }) => api.get<Bank>(`/question-banks/${bankId}`, { signal }) });
  const params = { bank_id: bankId, q: search, type, difficulty, status, page: pagination.pageIndex + 1, size: pagination.pageSize };
  const questions = useQuery({
    queryKey: ak.questions.list(params),
    queryFn: ({ signal }) =>
      api.get<Page<Question>>("/questions", {
        signal,
        query: {
          bank_id: bankId,
          q: search || undefined,
          question_type: type === "all" ? undefined : type,
          difficulty: difficulty === "all" ? undefined : difficulty,
          status: status === "all" ? undefined : status,
          page: params.page,
          page_size: pagination.pageSize,
        },
      }),
    placeholderData: (p) => p,
  });
  // Type mix for the header bar (first 200 questions).
  const mix = useQuery({
    queryKey: ak.questions.list({ bank_id: bankId, mix: true }),
    queryFn: ({ signal }) => api.get<Page<Question>>("/questions", { signal, query: { bank_id: bankId, page_size: 200 } }),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ak.questions.all });
    qc.invalidateQueries({ queryKey: ak.banks.all });
  };
  const duplicate = useMutation({
    mutationFn: (q: Question) => api.post<Question>("/questions", { ...toInput(q), prompt: `${q.prompt}`.slice(0, 20000), status: "draft" }),
    onSuccess: () => {
      toast.success("Question duplicated as a draft");
      invalidate();
    },
    onError: (e) => toast.error(problemsMessage(e)),
  });
  const importJson = useMutation({
    mutationFn: async (file: File) => {
      const text = await file.text();
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error("That file isn't valid JSON.");
      }
      const list = Array.isArray(data) ? data : (data as { questions?: unknown[] })?.questions;
      if (!Array.isArray(list) || !list.length) throw new Error("No questions found. Expected a Praxis bank export or an array of questions.");
      return api.post<{ imported: number }>(`/question-banks/${bankId}/import`, { questions: list });
    },
    onSuccess: (r) => {
      setImportErrors([]);
      toast.success(`Imported ${r.imported} question${r.imported === 1 ? "" : "s"}`);
      invalidate();
    },
    onError: (e) => {
      const p = problemsFrom(e);
      setImportErrors(p.length ? p : [problemsMessage(e)]);
    },
  });
  const exportBank = async () => {
    try {
      const data = await api.get(`/question-banks/${bankId}/export`);
      downloadJson(`${(bank.data?.title ?? "bank").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.praxis-bank.json`, data);
      toast.success("Bank exported");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const columns = React.useMemo<ColumnDef<Question, unknown>[]>(
    () => [
      {
        id: "type",
        header: "Type",
        cell: ({ row }) => {
          const m = questionMeta(row.original.question_type);
          return (
            <span className="inline-flex items-center gap-2 whitespace-nowrap">
              <TypeChip meta={m} size="sm" />
              <span className="hidden text-xs font-semibold text-slate-700 xl:inline">{m.label}</span>
            </span>
          );
        },
      },
      {
        id: "prompt",
        header: "Question",
        cell: ({ row }) => (
          <div className="min-w-[240px] max-w-xl">
            <p className="line-clamp-2 text-sm font-medium text-slate-900">{plain(row.original.prompt) || "—"}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {row.original.ai_generated && <AIBadge />}
              {row.original.tags.slice(0, 3).map((t) => (
                <span key={t} className="rounded-full bg-slate-100 px-1.5 py-0.5 text-2xs font-medium text-slate-600">
                  #{t}
                </span>
              ))}
              {row.original.tags.length > 3 && <span className="text-2xs text-muted-foreground">+{row.original.tags.length - 3}</span>}
            </div>
          </div>
        ),
      },
      { id: "difficulty", header: "Difficulty", cell: ({ row }) => <DifficultyDots value={row.original.difficulty} /> },
      {
        id: "points",
        header: "Points",
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums text-slate-700">
            {row.original.points}
            {row.original.negative_points > 0 && <span className="ml-1 text-xs text-rose-600">−{row.original.negative_points}</span>}
          </span>
        ),
      },
      {
        id: "skills",
        header: "Skills",
        cell: ({ row }) =>
          row.original.skill_ids.length ? (
            <Badge tone="success" size="sm">
              <Target aria-hidden /> {row.original.skill_ids.length}
            </Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      { id: "status", header: "Status", cell: ({ row }) => <AStatus status={row.original.status} size="sm" /> },
      { id: "updated", header: "Updated", cell: ({ row }) => <span className="whitespace-nowrap text-xs text-muted-foreground">{formatRelative(row.original.updated_at)}</span> },
    ],
    [],
  );

  if (bank.isLoading) return <Skeleton className="h-96 rounded-3xl" />;
  if (bank.isError || !bank.data) return <ErrorState error={bank.error} onRetry={() => bank.refetch()} />;
  const b = bank.data;
  const counts = new Map<string, number>();
  for (const q of mix.data?.items ?? []) counts.set(q.question_type, (counts.get(q.question_type) ?? 0) + 1);
  const mixTotal = [...counts.values()].reduce((s, n) => s + n, 0);
  const avgDiff = mixTotal ? (mix.data!.items.reduce((s, q) => s + q.difficulty, 0) / mixTotal).toFixed(1) : "—";
  const filtered = !!search || type !== "all" || difficulty !== "all" || status !== "all";

  return (
    <div className="space-y-5">
      <Breadcrumbs linkComponent={Link} items={[{ label: "Question banks", href: "/app/instructor/question-banks" }, { label: b.title }]} />
      <SubNav items={ASSESS_NAV} className="mb-0" />
      <GradientHeader color="sky">
        <div className="p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-sky-400 to-blue-500 text-white shadow-glow">
                <Library className="size-7" aria-hidden />
              </span>
              <div className="min-w-0">
                <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{b.title}</h1>
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{b.description || "No description yet."}</p>
                {courses.titleOf(b.course_id) && (
                  <p className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-slate-600">
                    <BookOpen className="size-3.5" aria-hidden /> {courses.titleOf(b.course_id)}
                  </p>
                )}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button variant="ghost" size="sm" leftIcon={<Pencil />} onClick={() => setEditBank(true)}>
                Edit
              </Button>
              <Button variant="secondary" size="sm" leftIcon={<FileUp />} loading={importJson.isPending} onClick={() => fileRef.current?.click()}>
                Import JSON
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="sr-only"
                tabIndex={-1}
                aria-hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importJson.mutate(f);
                  e.target.value = "";
                }}
              />
              <Button variant="secondary" size="sm" leftIcon={<Download />} onClick={() => void exportBank()} disabled={!b.question_count}>
                Export
              </Button>
              <Button variant="gradient" size="sm" leftIcon={<Plus />} onClick={() => setEditor({ question: null })}>
                New question
              </Button>
            </div>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-[auto_auto_1fr] sm:items-center">
            <div>
              <p className="font-display text-3xl font-bold tabular-nums text-slate-900">{b.question_count}</p>
              <p className="text-xs text-muted-foreground">questions</p>
            </div>
            <div className="sm:border-l sm:border-slate-200 sm:pl-4">
              <p className="font-display text-3xl font-bold tabular-nums text-slate-900">{avgDiff}</p>
              <p className="text-xs text-muted-foreground">avg difficulty</p>
            </div>
            {mixTotal > 0 && (
              <div className="min-w-0 sm:border-l sm:border-slate-200 sm:pl-4">
                <div className="flex h-3 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`Question type mix: ${[...counts.entries()].map(([t, n]) => `${questionMeta(t).label} ${n}`).join(", ")}`}>
                  {[...counts.entries()].map(([t, n]) => (
                    <Tooltip key={t} content={`${questionMeta(t).label}: ${n}`}>
                      <span className={cn("h-full", colorClasses(questionMeta(t).color).solid)} style={{ width: `${(n / mixTotal) * 100}%` }} />
                    </Tooltip>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                  {[...counts.entries()].map(([t, n]) => (
                    <span key={t} className="inline-flex items-center gap-1 text-2xs font-medium text-slate-600">
                      <span className={cn("size-2 rounded-full", colorClasses(questionMeta(t).color).solid)} aria-hidden />
                      {questionMeta(t).label} {n}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </GradientHeader>

      {importErrors.length > 0 && (
        <Alert tone="danger" title="Import failed — nothing was imported" action={<Button size="xs" variant="ghost" onClick={() => setImportErrors([])}>Dismiss</Button>}>
          <ul className="mt-1 max-h-40 list-disc space-y-0.5 overflow-y-auto pl-4">
            {importErrors.slice(0, 20).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </Alert>
      )}

      {questions.isError ? (
        <ErrorState error={questions.error} onRetry={() => questions.refetch()} />
      ) : (
        <DataTable
          aria-label="Questions"
          columns={columns}
          data={questions.data?.items ?? []}
          loading={questions.isLoading}
          total={questions.data?.total ?? 0}
          pagination={pagination}
          onPaginationChange={setPagination}
          onRowClick={(q) => setEditor({ question: q })}
          columnToggle={false}
          rowActions={[
            { label: "Edit", icon: <Pencil />, onSelect: (q) => setEditor({ question: q }) },
            { label: "Duplicate", icon: <Copy />, onSelect: (q) => duplicate.mutate(q) },
            { label: "Delete", icon: <Trash2 />, destructive: true, separatorBefore: true, onSelect: (q) => setToDelete(q) },
          ]}
          toolbar={
            <FilterBar
              search={search}
              onSearchChange={(v) => {
                setSearch(v);
                setPagination((p) => ({ ...p, pageIndex: 0 }));
              }}
              searchPlaceholder="Search prompts…"
            >
              <SimpleSelect
                aria-label="Question type"
                value={type}
                onValueChange={(v) => {
                  setType(v);
                  setPagination((p) => ({ ...p, pageIndex: 0 }));
                }}
                options={[{ value: "all", label: "All types" }, ...(Object.keys(QUESTION_TYPES) as QuestionTypeKey[]).map((t) => ({ value: t, label: QUESTION_TYPES[t].label }))]}
                className="h-9 w-44"
              />
              <SimpleSelect
                aria-label="Difficulty"
                value={difficulty}
                onValueChange={(v) => {
                  setDifficulty(v);
                  setPagination((p) => ({ ...p, pageIndex: 0 }));
                }}
                options={[{ value: "all", label: "Any difficulty" }, ...QUESTION_DIFFICULTY.map((d, i) => ({ value: String(i + 1), label: `${i + 1} · ${d.label}` }))]}
                className="h-9 w-40"
              />
              <SimpleSelect
                aria-label="Status"
                value={status}
                onValueChange={(v) => {
                  setStatus(v);
                  setPagination((p) => ({ ...p, pageIndex: 0 }));
                }}
                options={[
                  { value: "all", label: "Any status" },
                  { value: "active", label: "Active" },
                  { value: "draft", label: "Draft" },
                  { value: "retired", label: "Retired" },
                ]}
                className="h-9 w-36"
              />
            </FilterBar>
          }
          empty={{
            title: filtered ? "No questions match" : "This bank is empty",
            description: filtered ? "Try different filters." : "Add a question, import a JSON export, or generate a quiz with the AI builder.",
            action: !filtered ? (
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="sm" leftIcon={<Plus />} onClick={() => setEditor({ question: null })}>
                  New question
                </Button>
                <Button asChild size="sm" variant="soft" leftIcon={<Sparkles />}>
                  <Link href="/app/instructor/ai-builder">Generate with AI</Link>
                </Button>
              </div>
            ) : undefined,
          }}
        />
      )}

      <QuestionEditorDialog open={!!editor} onOpenChange={(o) => !o && setEditor(null)} bankId={bankId} question={editor?.question} />
      <BankDialog open={editBank} onOpenChange={setEditBank} bank={b} />
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        destructive
        title="Delete this question?"
        description="It's removed from the bank. Past attempts keep their snapshot; assessments using it as a fixed item will flag it before publishing."
        confirmLabel="Delete question"
        onConfirm={async () => {
          if (!toDelete) return;
          try {
            await api.delete(`/questions/${toDelete.id}`);
            toast.success("Question deleted");
            invalidate();
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </div>
  );
}
