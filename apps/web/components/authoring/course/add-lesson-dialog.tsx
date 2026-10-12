"use client";

import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  cn,
  colorClasses,
  toast,
} from "@praxis/ui";
import { useMutation } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import * as React from "react";
import { api } from "@/lib/api";
import { problemsMessage } from "../hooks";
import { MediaField } from "../media-field";
import { LESSON_TYPE_GROUPS, LESSON_TYPES, LINKED_LESSON_TYPES, type LessonTypeKey } from "../meta";
import { STICKY_DIALOG_FOOTER, TypeChip } from "../shared";
import type { Lesson, StructureModule } from "../types";
import { useBuilder } from "./builder-context";
import { contentProblems, defaultContent } from "./content-editors";
import { LinkPicker, type LinkKind } from "./link-picker";

const DEFAULT_MINUTES: Partial<Record<LessonTypeKey, number>> = {
  video: 8,
  quiz: 10,
  assignment: 45,
  simulation: 30,
  flashcards: 5,
  scenario: 10,
  ai_tutor: 10,
};

const MEDIA: Partial<Record<LessonTypeKey, { key: string; label: string; accept: string }>> = {
  video: { key: "video_url", label: "Video", accept: ".mp4,.webm" },
  audio: { key: "audio_url", label: "Audio", accept: ".mp3,.wav,.m4a,.webm" },
  pdf: { key: "url", label: "PDF document", accept: ".pdf" },
  powerpoint: { key: "url", label: "Slide deck", accept: ".pptx,.pdf" },
  image: { key: "image_url", label: "Image", accept: ".png,.jpg,.jpeg,.gif,.webp" },
  infographic: { key: "image_url", label: "Infographic image", accept: ".png,.jpg,.jpeg,.gif,.webp" },
};

/** Create a lesson: title, one of 16 colourful types, plus whatever that type needs to be valid. */
export function AddLessonDialog({
  open,
  onOpenChange,
  module,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  module: StructureModule | null;
  onCreated: (lesson: Lesson) => void;
}) {
  const { courseId, refresh, markDirty } = useBuilder();
  const [title, setTitle] = React.useState("");
  const [type, setType] = React.useState<LessonTypeKey>("text");
  const [content, setContent] = React.useState<Record<string, unknown>>(defaultContent("text") ?? {});
  const [link, setLink] = React.useState<{ id: string; title: string; status?: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setTitle("");
      setType("text");
      setContent(defaultContent("text") ?? {});
      setLink(null);
      setError(null);
    }
  }, [open]);

  const pick = (t: LessonTypeKey) => {
    setType(t);
    setContent(defaultContent(t) ?? {});
    setLink(null);
    setError(null);
  };

  const linkField = LINKED_LESSON_TYPES[type];
  const media = MEDIA[type];
  const problems = [...contentProblems(type, content), ...(linkField && !link ? ["Choose or create the linked item"] : [])];

  const create = useMutation({
    mutationFn: () =>
      api.post<Lesson>(`/courses/${courseId}/modules/${module!.id}/lessons`, {
        title: title.trim(),
        lesson_type: type,
        content,
        duration_minutes: DEFAULT_MINUTES[type] ?? 5,
        ...(linkField && link ? { [linkField]: link.id } : {}),
      }),
    onSuccess: async (l) => {
      toast.success(`Lesson “${l.title}” added`);
      markDirty();
      await refresh();
      onCreated(l);
      onOpenChange(false);
    },
    onError: (e) => setError(problemsMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Add a lesson{module ? ` to “${module.title}”` : ""}</DialogTitle>
          <DialogDescription>Pick a format — you can change the type later.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return setError("Give the lesson a title");
            if (problems.length) return setError(problems[0]!);
            create.mutate();
          }}
        >
          <FormField label="Lesson title" required>
            <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Triage your first alert" maxLength={255} />
          </FormField>
          <fieldset className="space-y-4">
            <legend className="mb-2 text-sm font-medium text-slate-800">Lesson type</legend>
            {LESSON_TYPE_GROUPS.map((g) => (
              <div key={g.label}>
                <p className="mb-2 text-2xs font-bold uppercase tracking-wider text-slate-500">{g.label}</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" role="radiogroup" aria-label={g.label}>
                  {g.types.map((t) => {
                    const m = LESSON_TYPES[t];
                    const on = t === type;
                    const c = colorClasses(m.color);
                    return (
                      <button
                        key={t}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => pick(t)}
                        className={cn(
                          "flex items-start gap-2.5 rounded-2xl border p-2.5 text-left transition-all focus-visible:focus-ring",
                          on ? cn(c.border, c.soft, "shadow-sm ring-1", c.ring) : "border-slate-200 bg-white hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-sm",
                        )}
                      >
                        <TypeChip meta={m} size="sm" />
                        <span className="min-w-0">
                          <span className={cn("block text-sm font-semibold", on ? c.text : "text-slate-900")}>{m.label}</span>
                          <span className="line-clamp-2 block text-2xs leading-snug text-muted-foreground">{m.description}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </fieldset>
          {media && (
            <MediaField
              label={media.label}
              required
              url={String(content[media.key] ?? "")}
              fileId={(content.file_id as string) ?? null}
              accept={media.accept}
              onChange={(v) => setContent({ [media.key]: v.url, ...(v.file_id ? { file_id: v.file_id } : {}) })}
            />
          )}
          {linkField && <LinkPicker kind={type as LinkKind} value={link?.id ?? null} courseId={courseId} defaultNewTitle={title} onChange={setLink} />}
          {error && <Alert tone="danger">{error}</Alert>}
          <DialogFooter className={STICKY_DIALOG_FOOTER}>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" leftIcon={<Plus />} loading={create.isPending} disabled={!module}>
              Add lesson
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
