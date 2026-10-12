"use client";

import { Alert, Button, ConfirmDialog, FormField, Input, Textarea, cn, colorClasses, toast } from "@praxis/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  Award,
  Bot,
  Copy,
  Globe,
  GraduationCap,
  ListOrdered,
  Lock,
  Settings2,
  ShieldAlert,
  Target,
  Trash2,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useAutosave } from "../hooks";
import { ak } from "../keys";
import { MarkdownEditor } from "../markdown-editor";
import { MediaField } from "../media-field";
import { DIFFICULTIES } from "../meta";
import { NumberInput, SaveIndicator, SectionCard, SkillPicker, StringListEditor, TagInput, ToggleRow } from "../shared";
import type { Course, CourseInput, Structure } from "../types";

type Form = {
  title: string;
  subtitle: string;
  slug: string;
  category: string;
  difficulty: string;
  duration_minutes: number | null;
  description: string;
  learning_objectives: string[];
  prerequisites: string[];
  target_audience: string;
  tags: string[];
  thumbnail_url: string;
  visibility: string;
  sequential: boolean;
  ai_tutor_enabled: boolean;
  certificate_enabled: boolean;
  pass_threshold: number;
  skill_ids: string[];
};

function toForm(c: Course): Form {
  return {
    title: c.title,
    subtitle: c.subtitle ?? "",
    slug: c.slug,
    category: c.category ?? "",
    difficulty: c.difficulty,
    duration_minutes: c.duration_minutes,
    description: c.description ?? "",
    learning_objectives: (c.learning_objectives ?? []).map(String),
    prerequisites: (c.prerequisites ?? []).map(String),
    target_audience: c.target_audience ?? "",
    tags: (c.tags ?? []).map(String),
    thumbnail_url: c.thumbnail_url ?? "",
    visibility: c.visibility,
    sequential: c.sequential,
    ai_tutor_enabled: c.ai_tutor_enabled,
    certificate_enabled: c.certificate_enabled,
    pass_threshold: c.pass_threshold,
    skill_ids: c.skills.map((s) => s.id),
  };
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function CourseSettings({ course }: { course: Course }) {
  const qc = useQueryClient();
  const router = useRouter();
  const { can } = useAuth();
  const [form, setForm] = React.useState<Form>(() => toForm(course));
  const [confirm, setConfirm] = React.useState<null | "archive" | "delete">(null);
  const categories = useQuery({
    queryKey: ["catalog", "categories"],
    queryFn: ({ signal }) => api.get<{ category: string; count: number }[]>("/catalog/categories", { signal }),
    staleTime: 300_000,
  });

  const errors: Partial<Record<keyof Form, string>> = {};
  if (!form.title.trim()) errors.title = "Title is required";
  if (form.slug && !SLUG_RE.test(form.slug)) errors.slug = "Use lowercase letters, numbers and single hyphens";

  const save = useAutosave(async (f: Form) => {
    if (!f.title.trim() || (f.slug && !SLUG_RE.test(f.slug))) throw new Error("Fix the highlighted fields to save");
    const body: CourseInput = {
      title: f.title.trim(),
      subtitle: f.subtitle.trim() || null,
      slug: f.slug || undefined,
      category: f.category.trim() || null,
      difficulty: f.difficulty as CourseInput["difficulty"],
      duration_minutes: f.duration_minutes ?? 0,
      description: f.description,
      learning_objectives: f.learning_objectives.filter((x) => x.trim()),
      prerequisites: f.prerequisites.filter((x) => x.trim()),
      target_audience: f.target_audience.trim() || null,
      tags: f.tags,
      thumbnail_url: f.thumbnail_url.trim() || null,
      visibility: f.visibility as "organisation" | "public",
      sequential: f.sequential,
      ai_tutor_enabled: f.ai_tutor_enabled,
      certificate_enabled: f.certificate_enabled,
      pass_threshold: f.pass_threshold,
      skill_ids: f.skill_ids,
    };
    const out = await api.patch<Course>(`/courses/${course.id}`, body);
    qc.setQueryData<Structure>(ak.courses.structure(course.id), (s) => (s ? { ...s, course: out, has_unpublished_changes: true } : s));
    qc.invalidateQueries({ queryKey: ["courses", "list"] });
  });

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    const next = { ...form, [k]: v };
    setForm(next);
    save.schedule(next);
  };

  const duplicate = useMutation({
    mutationFn: () => api.post<Course>(`/courses/${course.id}/duplicate`, { title: `${course.title} (copy)` }),
    onSuccess: (c) => {
      toast.success("Course duplicated as a new draft");
      qc.invalidateQueries({ queryKey: ak.courses.all });
      router.push(`/app/instructor/courses/${c.id}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const restore = useMutation({
    mutationFn: () => api.post<Course>(`/courses/${course.id}/restore`),
    onSuccess: () => {
      toast.success("Course restored");
      qc.invalidateQueries({ queryKey: ak.courses.all });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3">
          <SaveIndicator status={save.status} error={save.error} savedAt={save.savedAt} onRetry={() => void save.flush()} />
        </div>
        <SectionCard title="Basics" description="What learners see in the catalog" icon={GraduationCap} color="indigo">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Title" required error={errors.title} className="sm:col-span-2">
              <Input value={form.title} onChange={(e) => set("title", e.target.value)} maxLength={255} />
            </FormField>
            <FormField label="Subtitle" className="sm:col-span-2">
              <Input value={form.subtitle} onChange={(e) => set("subtitle", e.target.value)} maxLength={255} placeholder="A one-line promise to learners" />
            </FormField>
            <FormField label="Category" hint="Colour-codes the course across Praxis.">
              {(aria) => (
                <>
                  <Input {...aria} list="course-categories" value={form.category} onChange={(e) => set("category", e.target.value)} placeholder="e.g. Security" />
                  <datalist id="course-categories">
                    {(categories.data ?? []).map((c) => (
                      <option key={c.category} value={c.category} />
                    ))}
                  </datalist>
                </>
              )}
            </FormField>
            <FormField label="URL slug" error={errors.slug} hint="Used in links; must be unique.">
              <Input value={form.slug} onChange={(e) => set("slug", e.target.value.toLowerCase())} maxLength={160} className="font-mono" />
            </FormField>
            <FormField label="Estimated duration" hint="Total minutes (0 = sum of lessons).">
              {(aria) => <NumberInput {...aria} value={form.duration_minutes} onChange={(v) => set("duration_minutes", v)} min={0} suffix="min" />}
            </FormField>
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium text-slate-800">Difficulty</legend>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Difficulty">
                {DIFFICULTIES.map((d) => {
                  const on = form.difficulty === d.value;
                  const c = colorClasses(d.color);
                  return (
                    <button
                      key={d.value}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => set("difficulty", d.value)}
                      className={cn("rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition-colors focus-visible:focus-ring", on ? cn(c.soft, c.text, c.ring) : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50")}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          </div>
          <div className="mt-5">
            <FormField label="Description">
              {(aria) => <MarkdownEditor {...aria} label="Description" value={form.description} onChange={(v) => set("description", v)} minRows={8} />}
            </FormField>
          </div>
          <div className="mt-5">
            <MediaField label="Thumbnail image" url={form.thumbnail_url} accept=".png,.jpg,.jpeg,.webp" onChange={(v) => set("thumbnail_url", v.url)} hint="Shown on catalog cards (16:9 works best)." />
          </div>
        </SectionCard>

        <SectionCard title="Audience & outcomes" description="Helps learners and the AI tutor understand the course" icon={Users} color="sky">
          <div className="space-y-5">
            <FormField label="Learning objectives" hint="What learners will be able to do afterwards.">
              {() => <StringListEditor label="objective" numbered value={form.learning_objectives} onChange={(v) => set("learning_objectives", v)} placeholder="e.g. Triage a phishing alert within 10 minutes" color="emerald" />}
            </FormField>
            <FormField label="Prerequisites">
              {() => <StringListEditor label="prerequisite" value={form.prerequisites} onChange={(v) => set("prerequisites", v)} placeholder="e.g. Basic networking" color="amber" />}
            </FormField>
            <FormField label="Target audience">
              <Textarea rows={3} value={form.target_audience} onChange={(e) => set("target_audience", e.target.value)} placeholder="e.g. Junior SOC analysts in their first 90 days" />
            </FormField>
            <FormField label="Tags" hint="Press Enter or comma to add.">
              {(aria) => <TagInput id={aria.id} aria-describedby={aria["aria-describedby"]} value={form.tags} onChange={(v) => set("tags", v)} />}
            </FormField>
          </div>
        </SectionCard>

        <SectionCard title="Skills" description="Completing the course updates learners' skill profiles" icon={Target} color="teal">
          <SkillPicker value={form.skill_ids} onChange={(v) => set("skill_ids", v)} />
        </SectionCard>
      </div>

      <div className="space-y-6">
        <SectionCard title="Learning experience" icon={Settings2} color="violet">
          <div className="space-y-3">
            <ToggleRow
              label="Sequential lessons"
              description="Lessons unlock once earlier required lessons are complete."
              icon={ListOrdered}
              color="violet"
              checked={form.sequential}
              onCheckedChange={(v) => set("sequential", v)}
            />
            <ToggleRow label="AI tutor" description="Learners can ask the AI tutor about this course." icon={Bot} color="fuchsia" checked={form.ai_tutor_enabled} onCheckedChange={(v) => set("ai_tutor_enabled", v)} />
            <ToggleRow
              label="Public visibility"
              description={form.visibility === "public" ? "Listed beyond your organisation." : "Only your organisation can see it."}
              icon={form.visibility === "public" ? Globe : Lock}
              color="sky"
              checked={form.visibility === "public"}
              onCheckedChange={(v) => set("visibility", v ? "public" : "organisation")}
            />
          </div>
        </SectionCard>
        <SectionCard title="Certificate" icon={Award} color="amber">
          <div className="space-y-4">
            <ToggleRow label="Issue a certificate" description="Awarded on completion when the pass threshold is met." icon={Award} color="amber" checked={form.certificate_enabled} onCheckedChange={(v) => set("certificate_enabled", v)} />
            <FormField label={`Pass threshold: ${Math.round(form.pass_threshold)}%`} hint="Minimum average score across graded lessons.">
              {(aria) => (
                <div className="flex items-center gap-3">
                  <input {...aria} type="range" min={0} max={100} step={5} value={form.pass_threshold} disabled={!form.certificate_enabled} onChange={(e) => set("pass_threshold", Number(e.target.value))} className="w-full accent-amber-500" />
                  <span className="w-12 text-right font-display text-lg font-bold tabular-nums text-amber-700">{Math.round(form.pass_threshold)}%</span>
                </div>
              )}
            </FormField>
          </div>
        </SectionCard>
        {can("courses.create") || can("courses.delete") ? (
          <SectionCard title="Manage course" icon={ShieldAlert} color="rose">
            <div className="space-y-2">
              {can("courses.create") && (
                <Button variant="secondary" block leftIcon={<Copy />} loading={duplicate.isPending} onClick={() => duplicate.mutate()} className="justify-start">
                  Duplicate as new draft
                </Button>
              )}
              {can("courses.delete") &&
                (course.status === "archived" ? (
                  <Button variant="secondary" block leftIcon={<ArchiveRestore />} loading={restore.isPending} onClick={() => restore.mutate()} className="justify-start">
                    Restore course
                  </Button>
                ) : (
                  <Button variant="secondary" block leftIcon={<Archive />} onClick={() => setConfirm("archive")} className="justify-start">
                    Archive course
                  </Button>
                ))}
              {can("courses.delete") && (
                <Button variant="destructive-soft" block leftIcon={<Trash2 />} onClick={() => setConfirm("delete")} className="justify-start">
                  Delete course
                </Button>
              )}
            </div>
            {course.enrolment_count > 0 && (
              <Alert tone="warning" className="mt-3">
                {course.enrolment_count} learner{course.enrolment_count === 1 ? " is" : "s are"} enrolled.
              </Alert>
            )}
          </SectionCard>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirm === "archive"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Archive this course?"
        description="It disappears from the catalog. Enrolled learners keep their records, and you can restore it any time."
        confirmLabel="Archive"
        onConfirm={async () => {
          try {
            await api.post(`/courses/${course.id}/archive`);
            toast.success("Course archived");
            qc.invalidateQueries({ queryKey: ak.courses.all });
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(o) => !o && setConfirm(null)}
        destructive
        title="Delete this course permanently?"
        description="The course, its draft and versions are removed. This cannot be undone."
        confirmText={course.title.length <= 40 ? course.title : "DELETE"}
        confirmLabel="Delete course"
        onConfirm={async () => {
          try {
            await api.delete(`/courses/${course.id}`);
            toast.success("Course deleted");
            qc.invalidateQueries({ queryKey: ak.courses.all });
            router.push("/app/instructor/courses");
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </div>
  );
}
