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
  /** Type label shown on a single lesson ("Flashcards", "Reading"). */
  label: string;
  /** Count nouns: [singular, plural] — "1 flashcard deck", "3 quizzes". */
  nouns: [string, string];
  icon: LucideIcon;
  color: CategoryColor;
}

const LESSON_META: Record<string, LessonMeta> = {
  video: { label: "Video", nouns: ["video", "videos"], icon: PlayCircle, color: "rose" },
  audio: { label: "Audio", nouns: ["audio lesson", "audio lessons"], icon: AudioLines, color: "orange" },
  text: { label: "Reading", nouns: ["reading", "readings"], icon: FileText, color: "sky" },
  pdf: { label: "PDF", nouns: ["PDF", "PDFs"], icon: FileType2, color: "rose" },
  powerpoint: { label: "Slides", nouns: ["slide deck", "slide decks"], icon: Presentation, color: "orange" },
  image: { label: "Image", nouns: ["image", "images"], icon: ImageIcon, color: "teal" },
  infographic: { label: "Infographic", nouns: ["infographic", "infographics"], icon: LayoutGrid, color: "teal" },
  interactive_html: { label: "Interactive", nouns: ["interactive activity", "interactive activities"], icon: MousePointerClick, color: "fuchsia" },
  code: { label: "Code", nouns: ["code lab", "code labs"], icon: Code2, color: "indigo" },
  flashcards: { label: "Flashcards", nouns: ["flashcard deck", "flashcard decks"], icon: Layers, color: "amber" },
  scenario: { label: "Scenario", nouns: ["scenario", "scenarios"], icon: Theater, color: "violet" },
  quiz: { label: "Quiz", nouns: ["quiz", "quizzes"], icon: HelpCircle, color: "emerald" },
  assignment: { label: "Assignment", nouns: ["assignment", "assignments"], icon: ClipboardCheck, color: "amber" },
  simulation: { label: "Simulation", nouns: ["simulation", "simulations"], icon: MonitorPlay, color: "violet" },
  ai_tutor: { label: "AI tutor", nouns: ["AI tutor session", "AI tutor sessions"], icon: Bot, color: "fuchsia" },
  mixed: { label: "Lesson", nouns: ["mixed-media lesson", "mixed-media lessons"], icon: Shapes, color: "indigo" },
};

const FALLBACK_META: LessonMeta = { label: "Lesson", nouns: ["lesson", "lessons"], icon: BookOpen, color: "indigo" };

export function lessonMeta(type: string | null | undefined): LessonMeta {
  return LESSON_META[(type ?? "").toLowerCase()] ?? FALLBACK_META;
}

/** "1 quiz", "8 quizzes", "1 flashcard deck". */
export function lessonCountLabel(type: string | null | undefined, n: number): string {
  const { nouns } = lessonMeta(type);
  return `${n} ${n === 1 ? nouns[0] : nouns[1]}`;
}

/** Capitalised plural-aware type name for "This course includes" lists: "Quiz" / "Quizzes". */
export function lessonTypeName(type: string | null | undefined, n: number): string {
  const m = lessonMeta(type);
  if (n === 1) return m.label;
  const p = m.nouns[1];
  return p.charAt(0).toUpperCase() + p.slice(1);
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
