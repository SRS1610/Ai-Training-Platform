/** Display metadata for lesson types, difficulties and question types (icons, labels, category colours). */
import type { CategoryColor } from "@praxis/ui";
import {
  AudioLines,
  BookOpen,
  Bot,
  ClipboardCheck,
  Code2,
  FileText,
  FileType2,
  HelpCircle,
  Image as ImageIcon,
  Layers,
  LayoutGrid,
  type LucideIcon,
  MonitorPlay,
  MousePointerClick,
  PlayCircle,
  Presentation,
  Shapes,
  Theater,
} from "lucide-react";

export interface LessonMeta {
  label: string;
  icon: LucideIcon;
  color: CategoryColor;
}

const LESSON_META: Record<string, LessonMeta> = {
  video: { label: "Video", icon: PlayCircle, color: "rose" },
  audio: { label: "Audio", icon: AudioLines, color: "orange" },
  text: { label: "Reading", icon: FileText, color: "sky" },
  pdf: { label: "PDF", icon: FileType2, color: "rose" },
  powerpoint: { label: "Slides", icon: Presentation, color: "orange" },
  image: { label: "Image", icon: ImageIcon, color: "teal" },
  infographic: { label: "Infographic", icon: LayoutGrid, color: "teal" },
  interactive_html: { label: "Interactive", icon: MousePointerClick, color: "fuchsia" },
  code: { label: "Code", icon: Code2, color: "indigo" },
  flashcards: { label: "Flashcards", icon: Layers, color: "amber" },
  scenario: { label: "Scenario", icon: Theater, color: "violet" },
  quiz: { label: "Quiz", icon: HelpCircle, color: "emerald" },
  assignment: { label: "Assignment", icon: ClipboardCheck, color: "amber" },
  simulation: { label: "Simulation", icon: MonitorPlay, color: "violet" },
  ai_tutor: { label: "AI tutor", icon: Bot, color: "fuchsia" },
  mixed: { label: "Lesson", icon: Shapes, color: "indigo" },
};

export function lessonMeta(type: string | null | undefined): LessonMeta {
  return LESSON_META[(type ?? "").toLowerCase()] ?? { label: "Lesson", icon: BookOpen, color: "indigo" };
}

export const DIFFICULTIES = ["beginner", "intermediate", "advanced", "expert"] as const;

const DIFFICULTY_COLOR: Record<string, CategoryColor> = {
  beginner: "emerald",
  intermediate: "sky",
  advanced: "violet",
  expert: "rose",
};

export function difficultyColor(d: string | null | undefined): CategoryColor {
  return DIFFICULTY_COLOR[(d ?? "").toLowerCase()] ?? "indigo";
}

/** 1–4 bars for a difficulty meter. */
export function difficultyLevel(d: string | null | undefined): number {
  const i = DIFFICULTIES.indexOf((d ?? "").toLowerCase() as (typeof DIFFICULTIES)[number]);
  return i < 0 ? 0 : i + 1;
}

export const QUESTION_LABELS: Record<string, string> = {
  multiple_choice: "Multiple choice",
  multiple_select: "Select all that apply",
  true_false: "True or false",
  short_answer: "Short answer",
  long_answer: "Long answer",
  matching: "Matching",
  ordering: "Ordering",
  fill_blank: "Fill in the blanks",
  code: "Code",
  file_upload: "File upload",
  scenario: "Scenario",
  decision_tree: "Decision tree",
  practical_task: "Practical task",
  simulation: "Simulation",
};

/** Route for a recommendation / plan activity target. */
export function targetHref(t: { target_type?: string | null; type?: string | null; target_id?: string | null; course_id?: string | null; data?: Record<string, unknown> }): string {
  const link = typeof t.data?.link === "string" ? (t.data.link as string) : null;
  if (link && link.startsWith("/app/")) return link;
  const type = (t.target_type ?? t.type ?? "").toLowerCase();
  const id = t.target_id;
  if (id) {
    if (type === "simulation") return `/app/simulations/${id}`;
    if (type === "lesson" && t.course_id) return `/app/learn/${t.course_id}/lesson/${id}`;
    if (type === "assessment" || type === "practice" || type === "quiz") return `/app/quiz/${id}`;
    if (type === "assignment") return `/app/assignments/${id}`;
    if (type === "course") return `/app/catalog/${id}`;
  }
  if (t.course_id) return `/app/learn/${t.course_id}`;
  return "/app/catalog";
}
