"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Switch,
  cn,
  colorClasses,
  toast,
} from "@praxis/ui";
import {
  ArrowLeft,
  Clock,
  Eye,
  FileQuestion,
  FolderInput,
  Layers,
  MoreHorizontal,
  NotebookText,
  Pencil,
  Repeat,
  Sparkles,
  Target,
  Trash2,
} from "lucide-react";
import * as React from "react";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { QuickGenerateDialog, type QuickKind } from "../ai/quick-generate";
import { problemsFrom, useAutosave } from "../hooks";
import { LESSON_TYPE_GROUPS, LESSON_TYPES, LINKED_LESSON_TYPES, lessonMeta, type LessonTypeKey } from "../meta";
import { AIBadge, AutoGrowTextarea, SaveIndicator, SectionCard, SkillPicker, TypeChip } from "../shared";
import type { Lesson, LessonPatch, LinkedItem, StructureModule } from "../types";
import { ActivitiesEditor } from "./activities-editor";
import { useBuilder } from "./builder-context";
import { ContentEditor, contentProblems, defaultContent } from "./content-editors";
import { LessonRender } from "./lesson-render";
import { LinkPicker, type LinkKind } from "./link-picker";
import { rovingRadio } from "../roving";

type Draft = {
  title: string;
  summary: string;
  lesson_type: string;
  content: Record<string, unknown>;
  duration_minutes: number;
  is_required: boolean;
  is_preview: boolean;
  skill_ids: string[];
  assessment_id: string | null;
  assignment_id: string | null;
  simulation_id: string | null;
  linked: LinkedItem | null;
};

function toDraft(l: Lesson): Draft {
  return {
    title: l.title,
    summary: l.summary ?? "",
    lesson_type: l.lesson_type,
    content: l.content ?? {},
    duration_minutes: l.duration_minutes,
    is_required: l.is_required,
    is_preview: l.is_preview,
    skill_ids: (l.skill_ids ?? []).map(String),
    assessment_id: l.assessment_id,
    assignment_id: l.assignment_id,
    simulation_id: l.simulation_id,
    linked: l.linked ?? null,
  };
}

/** Problems that block saving the type/content/link (title etc. still save). */
function draftProblems(d: Draft): string[] {
  const p = contentProblems(d.lesson_type, d.content);
  const link = LINKED_LESSON_TYPES[d.lesson_type];
  if (link && !d[link]) p.push(`Choose the ${link.replace("_id", "")} this lesson links to`);
  return p;
}

function LessonTypeMenu({ value, onChange }: { value: string; onChange: (t: LessonTypeKey) => void }) {
  const meta = lessonMeta(value);
  const c = colorClasses(meta.color);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn("inline-flex items-center gap-1.5 rounded-full py-1 pl-1 pr-3 text-xs font-semibold ring-1 ring-inset transition-colors focus-visible:focus-ring", c.soft, c.text, c.ring)}
          aria-label={`Lesson type: ${meta.label}. Change type`}
        >
          <TypeChip meta={meta} size="xs" className="rounded-full" />
          {meta.label}
          <Repeat className="size-3 opacity-70" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[65vh] w-72 overflow-y-auto">
        {LESSON_TYPE_GROUPS.map((g, gi) => (
          <React.Fragment key={g.label}>
            {gi > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel>{g.label}</DropdownMenuLabel>
            {g.types.map((t) => {
              const m = LESSON_TYPES[t];
              return (
                <DropdownMenuItem key={t} onSelect={() => onChange(t)} disabled={t === value} className="items-start">
                  <TypeChip meta={m} size="xs" className="mt-0.5" />
                  <span className="min-w-0">
                    <span className="block font-medium text-slate-900">{m.label}</span>
                    <span className="block text-2xs text-muted-foreground">{m.description}</span>
                  </span>
                </DropdownMenuItem>
              );
            })}
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function LessonEditor({
  lesson,
  modules,
  onBack,
}: {
  lesson: Lesson;
  modules: StructureModule[];
  onBack?: () => void;
}) {
  const { courseId, patchLesson, markDirty, refresh, selectLesson } = useBuilder();
  const { can } = useAuth();
  const [draft, setDraft] = React.useState<Draft>(() => toDraft(lesson));
  const [view, setView] = React.useState<"edit" | "preview">("edit");
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [pendingType, setPendingType] = React.useState<LessonTypeKey | null>(null);
  const [quick, setQuick] = React.useState<QuickKind | null>(null);
  const [serverProblems, setServerProblems] = React.useState<string[]>([]);
  const problems = draftProblems(draft);
  const meta = lessonMeta(draft.lesson_type);
  const mod = modules.find((m) => m.id === lesson.module_id);
  const linkField = LINKED_LESSON_TYPES[draft.lesson_type];
  // Type/content/link edits are held back (not sent) while they're invalid — say so instead of "Saved".
  const held =
    problems.length > 0 &&
    (draft.lesson_type !== lesson.lesson_type ||
      JSON.stringify(draft.content) !== JSON.stringify(lesson.content ?? {}) ||
      draft.assessment_id !== lesson.assessment_id ||
      draft.assignment_id !== lesson.assignment_id ||
      draft.simulation_id !== lesson.simulation_id);

  const save = useAutosave(async (d: Draft) => {
    const body: LessonPatch = {
      title: d.title.trim() || "Untitled lesson",
      summary: d.summary.trim() || null,
      duration_minutes: Math.max(0, Math.round(d.duration_minutes || 0)),
      is_required: d.is_required,
      is_preview: d.is_preview,
      skill_ids: d.skill_ids,
    };
    if (!draftProblems(d).length) {
      body.lesson_type = d.lesson_type;
      body.content = d.content;
      body.assessment_id = d.assessment_id;
      body.assignment_id = d.assignment_id;
      body.simulation_id = d.simulation_id;
    }
    try {
      const out = await api.patch<Lesson>(`/courses/${courseId}/lessons/${lesson.id}`, body);
      setServerProblems([]);
      patchLesson(lesson.id, (l) => ({ ...out, activities: l.activities }));
      markDirty();
    } catch (e) {
      setServerProblems(problemsFrom(e));
      throw e;
    }
  });

  // Warn before leaving the page while edits are held back, pending, in flight or failed.
  const unsafe = held || save.status === "dirty" || save.status === "saving" || save.status === "error";
  React.useEffect(() => {
    if (!unsafe) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [unsafe]);

  const update = (patch: Partial<Draft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    // Instant outline feedback.
    if ("title" in patch || "lesson_type" in patch || "duration_minutes" in patch || "is_required" in patch || "is_preview" in patch)
      patchLesson(lesson.id, {
        title: next.title,
        ...(draftProblems(next).length ? {} : { lesson_type: next.lesson_type }),
        duration_minutes: next.duration_minutes,
        is_required: next.is_required,
        is_preview: next.is_preview,
      });
    save.schedule(next);
  };

  const changeType = (t: LessonTypeKey) => {
    const body = typeof draft.content.body_markdown === "string" ? (draft.content.body_markdown as string) : "";
    const base = defaultContent(t) ?? {};
    const content = { ...base, ...(body && t !== "text" ? { body_markdown: body } : {}), ...(t === "text" && body ? { body_markdown: body } : {}) };
    update({ lesson_type: t, content, assessment_id: null, assignment_id: null, simulation_id: null, linked: null });
    setPendingType(null);
  };

  const remove = async () => {
    try {
      await save.flush();
      await api.delete(`/courses/${courseId}/lessons/${lesson.id}`);
      save.reset();
      toast.success("Lesson deleted");
      selectLesson(null);
      await refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const moveTo = async (moduleId: string) => {
    try {
      await save.flush();
      await api.patch(`/courses/${courseId}/lessons/${lesson.id}`, { module_id: moduleId });
      toast.success(`Moved to “${modules.find((m) => m.id === moduleId)?.title}”`);
      markDirty();
      await refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const durationId = React.useId();
  const titleId = React.useId();

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        <div className={cn("h-1.5 bg-gradient-to-r", colorClasses(meta.color).gradient)} aria-hidden />
        <div className="space-y-4 p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            {onBack && (
              <Button variant="ghost" size="sm" leftIcon={<ArrowLeft />} onClick={onBack} className="-ml-2 lg:hidden">
                Outline
              </Button>
            )}
            <LessonTypeMenu value={draft.lesson_type} onChange={(t) => (t === draft.lesson_type ? null : setPendingType(t))} />
            {mod && <span className="truncate text-xs text-muted-foreground">in {mod.title}</span>}
            {lesson.ai_generated && <AIBadge />}
            <div className="ml-auto flex items-center gap-2">
              <SaveIndicator status={save.status} held={held ? problems.length : 0} error={save.error} savedAt={save.savedAt} onRetry={() => void save.flush()} className="hidden sm:flex" />
              <div className="flex items-center rounded-xl bg-slate-100 p-1" role="radiogroup" {...rovingRadio} aria-label="Lesson view">
                {(
                  [
                    ["edit", Pencil, "Edit"],
                    ["preview", Eye, "Preview"],
                  ] as const
                ).map(([v, Icon, label]) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={view === v}
                    onClick={() => setView(v)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors focus-visible:focus-ring",
                      view === v ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900",
                    )}
                  >
                    <Icon className="size-3.5" aria-hidden />
                    {label}
                  </button>
                ))}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" size="icon-sm" aria-label="Lesson actions">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  {can("courses.create") && (
                    <>
                      <DropdownMenuLabel className="flex items-center gap-1.5">
                        <Sparkles className="size-3.5 text-fuchsia-600" aria-hidden /> AI assist
                      </DropdownMenuLabel>
                      <DropdownMenuItem onSelect={() => setQuick("quiz")}>
                        <FileQuestion /> Generate a quiz from this lesson
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setQuick("flashcards")}>
                        <Layers /> Generate flashcards
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setQuick("revision_notes")}>
                        <NotebookText /> Generate revision notes
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  {modules.length > 1 && (
                    <>
                      <DropdownMenuLabel className="flex items-center gap-1.5">
                        <FolderInput className="size-3.5" aria-hidden /> Move to module
                      </DropdownMenuLabel>
                      {modules
                        .filter((m) => m.id !== lesson.module_id)
                        .map((m) => (
                          <DropdownMenuItem key={m.id} onSelect={() => void moveTo(m.id)}>
                            <span className="truncate">{m.title}</span>
                          </DropdownMenuItem>
                        ))}
                      <DropdownMenuSeparator />
                    </>
                  )}
                  <DropdownMenuItem destructive onSelect={() => setConfirmDelete(true)}>
                    <Trash2 /> Delete lesson
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {view === "edit" && (
            <>
              <div>
                <label htmlFor={titleId} className="sr-only">
                  Lesson title
                </label>
                <AutoGrowTextarea
                  id={titleId}
                  value={draft.title}
                  singleLine
                  maxLength={255}
                  onChange={(v) => update({ title: v })}
                  placeholder="Lesson title"
                  className="w-full rounded-lg bg-transparent font-display text-2xl font-bold leading-tight tracking-tight text-slate-900 outline-none placeholder:text-slate-300 focus-visible:ring-2 focus-visible:ring-brand-500/30 sm:text-[1.75rem]"
                />
                <AutoGrowTextarea
                  aria-label="Lesson summary"
                  value={draft.summary}
                  maxLength={2000}
                  onChange={(v) => update({ summary: v })}
                  placeholder="Add a one-line summary learners see in the outline…"
                  className="mt-1 w-full rounded-lg bg-transparent text-base text-slate-600 outline-none placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-brand-500/30"
                />
              </div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-slate-100 pt-4">
                <div className="flex items-center gap-2">
                  <Clock className="size-4 text-sky-600" aria-hidden />
                  <label htmlFor={durationId} className="text-sm text-slate-700">
                    Duration
                  </label>
                  <input
                    id={durationId}
                    type="number"
                    min={0}
                    max={10000}
                    value={draft.duration_minutes}
                    onChange={(e) => update({ duration_minutes: Number(e.target.value) || 0 })}
                    className="h-8 w-16 rounded-lg border border-input bg-white px-2 text-sm tabular-nums shadow-sm outline-none focus-visible:border-brand-500 focus-visible:ring-4 focus-visible:ring-brand-500/15"
                  />
                  <span className="text-sm text-muted-foreground">min</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-700">
                  <Switch id={`${titleId}-req`} checked={draft.is_required} onCheckedChange={(v) => update({ is_required: v })} />
                  <label htmlFor={`${titleId}-req`} className="cursor-pointer">
                    Required
                  </label>
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-700">
                  <Switch id={`${titleId}-prev`} checked={draft.is_preview} onCheckedChange={(v) => update({ is_preview: v })} />
                  <label htmlFor={`${titleId}-prev`} className="cursor-pointer">
                    Free preview
                  </label>
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  <Target className="size-4 shrink-0 text-teal-600" aria-hidden />
                  <SkillPicker value={draft.skill_ids} onChange={(ids) => update({ skill_ids: ids })} />
                </div>
              </div>
            </>
          )}
          <SaveIndicator status={save.status} held={held ? problems.length : 0} error={save.error} savedAt={save.savedAt} onRetry={() => void save.flush()} className="sm:hidden" />
        </div>
      </Card>

      {view === "preview" ? (
        <Card className="p-5 sm:p-8">
          <Badge tone="violet" size="sm" className="mb-4">
            <Eye aria-hidden /> Learner preview · draft
          </Badge>
          <LessonRender lesson={{ ...draft, linked: draft.linked, activities: lesson.activities }} />
        </Card>
      ) : (
        <>
          {problems.length > 0 && (
            <Alert tone="warning" title="Content changes are held until the lesson is complete">
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </Alert>
          )}
          {serverProblems.length > 0 && (
            <Alert tone="danger" title="The server rejected the last change">
              {serverProblems.join(" · ")}
            </Alert>
          )}
          {linkField && (
            <LinkPicker
              kind={draft.lesson_type as LinkKind}
              value={draft[linkField]}
              linked={draft.linked}
              courseId={courseId}
              defaultNewTitle={draft.title}
              onChange={(item) =>
                update({
                  [linkField]: item.id,
                  linked: { type: linkField.replace("_id", ""), id: item.id, title: item.title, status: item.status ?? null },
                } as Partial<Draft>)
              }
            />
          )}
          <SectionCard title={linkField ? "Introduction" : "Content"} description={meta.description} icon={meta.icon} color={meta.color}>
            <ContentEditor type={draft.lesson_type} content={draft.content} onChange={(content) => update({ content })} title={draft.title} />
          </SectionCard>
          <ActivitiesEditor key={lesson.id} lessonId={lesson.id} activities={lesson.activities ?? []} required={draft.lesson_type === "mixed"} />
        </>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        destructive
        title={`Delete “${draft.title}”?`}
        description="The lesson and its blocks are removed from the draft. Published versions keep their copy until you publish again."
        confirmLabel="Delete lesson"
        onConfirm={remove}
      />
      <ConfirmDialog
        open={!!pendingType}
        onOpenChange={(o) => !o && setPendingType(null)}
        title={`Change to ${pendingType ? LESSON_TYPES[pendingType].label : ""}?`}
        description="Type-specific content (media links, cards, code…) is replaced with a starter for the new type. Text you wrote in the main body is kept where possible."
        confirmLabel="Change type"
        onConfirm={() => {
          if (pendingType) changeType(pendingType);
        }}
      />
      {quick && (
        <QuickGenerateDialog
          open={!!quick}
          onOpenChange={(o) => !o && setQuick(null)}
          kind={quick}
          courseId={courseId}
          moduleId={lesson.module_id}
          lesson={{ id: lesson.id, title: draft.title, position: lesson.position }}
          onApplied={() => void refresh()}
        />
      )}
    </div>
  );
}
