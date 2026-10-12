/** Display metadata for authoring enums: lesson types, activity blocks, question types, grading modes, statuses. */
import type { CategoryColor, Tone } from "@praxis/ui";
import {
  AlignLeft,
  ArrowDownUp,
  Blocks,
  Bot,
  ChartPie,
  CircleDot,
  ClipboardCheck,
  Code2,
  FileText,
  GitBranch,
  Globe,
  Headphones,
  HelpCircle,
  Image as ImageIcon,
  Layers,
  Lightbulb,
  Link2,
  ListChecks,
  type LucideIcon,
  Megaphone,
  MonitorPlay,
  MousePointerClick,
  Paperclip,
  PlayCircle,
  Presentation,
  SquareCheckBig,
  TextCursorInput,
  Theater,
  ToggleLeft,
  Type,
  Upload,
  Wrench,
} from "lucide-react";

export interface TypeMeta {
  label: string;
  icon: LucideIcon;
  color: CategoryColor;
  description: string;
}

/* ------------------------------------------------------------------ lessons (16 LessonType values) */

export const LESSON_TYPES = {
  text: { label: "Text", icon: FileText, color: "indigo", description: "Rich Markdown article with live preview" },
  video: { label: "Video", icon: PlayCircle, color: "rose", description: "Upload or embed a video with captions" },
  audio: { label: "Audio", icon: Headphones, color: "orange", description: "Podcast or narration with transcript" },
  pdf: { label: "PDF", icon: FileText, color: "emerald", description: "Readable PDF document" },
  powerpoint: { label: "Slides", icon: Presentation, color: "amber", description: "PowerPoint deck or embedded slides" },
  image: { label: "Image", icon: ImageIcon, color: "teal", description: "Diagram or photo with alt text" },
  infographic: { label: "Infographic", icon: ChartPie, color: "fuchsia", description: "Visual summary with notes" },
  interactive_html: { label: "Interactive HTML", icon: MousePointerClick, color: "violet", description: "Sandboxed HTML/JS widget" },
  code: { label: "Code", icon: Code2, color: "sky", description: "Code walkthrough with syntax highlighting" },
  flashcards: { label: "Flashcards", icon: Layers, color: "orange", description: "Spaced-repetition card deck" },
  scenario: { label: "Scenario", icon: Theater, color: "teal", description: "Branching decision scenario" },
  quiz: { label: "Quiz", icon: HelpCircle, color: "sky", description: "Linked graded assessment" },
  assignment: { label: "Assignment", icon: ClipboardCheck, color: "amber", description: "Practical task with rubric grading" },
  simulation: { label: "Simulation", icon: MonitorPlay, color: "violet", description: "Realistic work-environment simulation" },
  ai_tutor: { label: "AI tutor", icon: Bot, color: "fuchsia", description: "Guided conversation with the AI tutor" },
  mixed: { label: "Mixed blocks", icon: Blocks, color: "indigo", description: "Compose any blocks in one lesson" },
} satisfies Record<string, TypeMeta>;

export type LessonTypeKey = keyof typeof LESSON_TYPES;

export const LESSON_TYPE_GROUPS: { label: string; types: LessonTypeKey[] }[] = [
  { label: "Read, watch & listen", types: ["text", "video", "audio", "pdf", "powerpoint", "image", "infographic"] },
  { label: "Interactive", types: ["interactive_html", "code", "flashcards", "scenario", "ai_tutor", "mixed"] },
  { label: "Practise & assess", types: ["quiz", "assignment", "simulation"] },
];

export function lessonMeta(type: string | null | undefined): TypeMeta {
  return (LESSON_TYPES as Record<string, TypeMeta>)[type ?? ""] ?? LESSON_TYPES.text;
}

/** Lesson types whose completion is driven by a linked graded item. */
export const LINKED_LESSON_TYPES: Record<string, "assessment_id" | "assignment_id" | "simulation_id"> = {
  quiz: "assessment_id",
  assignment: "assignment_id",
  simulation: "simulation_id",
};

/* ------------------------------------------------------------------ activity blocks (13 types) */

export const ACTIVITY_TYPES = {
  text: { label: "Text", icon: Type, color: "indigo", description: "Markdown paragraph" },
  callout: { label: "Callout", icon: Megaphone, color: "amber", description: "Tip, warning or key point" },
  check: { label: "Knowledge check", icon: SquareCheckBig, color: "emerald", description: "Ungraded quick question" },
  video: { label: "Video", icon: PlayCircle, color: "rose", description: "Video clip" },
  audio: { label: "Audio", icon: Headphones, color: "orange", description: "Audio clip" },
  image: { label: "Image", icon: ImageIcon, color: "teal", description: "Image with caption" },
  code: { label: "Code", icon: Code2, color: "sky", description: "Code snippet" },
  flashcards: { label: "Flashcards", icon: Layers, color: "orange", description: "Mini card deck" },
  scenario: { label: "Scenario", icon: Theater, color: "teal", description: "Short decision scenario" },
  embed: { label: "Embed", icon: Globe, color: "violet", description: "External page or video" },
  pdf: { label: "PDF", icon: FileText, color: "emerald", description: "PDF document" },
  file: { label: "File", icon: Paperclip, color: "sky", description: "Downloadable resource" },
  interactive_html: { label: "Interactive HTML", icon: MousePointerClick, color: "violet", description: "Sandboxed widget" },
} satisfies Record<string, TypeMeta>;

export type ActivityTypeKey = keyof typeof ACTIVITY_TYPES;

export function activityMeta(type: string | null | undefined): TypeMeta {
  return (ACTIVITY_TYPES as Record<string, TypeMeta>)[type ?? ""] ?? ACTIVITY_TYPES.text;
}

export const CALLOUT_VARIANTS = [
  { value: "info", label: "Info", color: "sky" },
  { value: "tip", label: "Tip", color: "emerald" },
  { value: "warning", label: "Warning", color: "amber" },
  { value: "danger", label: "Danger", color: "rose" },
  { value: "success", label: "Success", color: "violet" },
] as const;

export const CALLOUT_ICON = Lightbulb;

/* ------------------------------------------------------------------ questions (14 types) */

export const QUESTION_TYPES = {
  multiple_choice: { label: "Multiple choice", icon: CircleDot, color: "indigo", description: "One correct answer" },
  multiple_select: { label: "Multiple select", icon: ListChecks, color: "sky", description: "Several correct answers, optional partial credit" },
  true_false: { label: "True / false", icon: ToggleLeft, color: "emerald", description: "A statement to judge" },
  short_answer: { label: "Short answer", icon: TextCursorInput, color: "amber", description: "Accepted answers or a pattern" },
  long_answer: { label: "Long answer", icon: AlignLeft, color: "rose", description: "Essay graded with a rubric" },
  matching: { label: "Matching", icon: Link2, color: "fuchsia", description: "Pair items from two lists" },
  ordering: { label: "Ordering", icon: ArrowDownUp, color: "teal", description: "Put steps in the right order" },
  fill_blank: { label: "Fill in the blanks", icon: Type, color: "orange", description: "Complete a sentence" },
  code: { label: "Code", icon: Code2, color: "violet", description: "Write code checked by patterns" },
  file_upload: { label: "File upload", icon: Upload, color: "sky", description: "Learner submits a file" },
  scenario: { label: "Scenario", icon: Theater, color: "teal", description: "Respond to a realistic situation" },
  decision_tree: { label: "Decision tree", icon: GitBranch, color: "violet", description: "Branching choices with points" },
  practical_task: { label: "Practical task", icon: Wrench, color: "amber", description: "Hands-on task with evidence" },
  simulation: { label: "Simulation", icon: MonitorPlay, color: "fuchsia", description: "Scored from a simulation run" },
} satisfies Record<string, TypeMeta>;

export type QuestionTypeKey = keyof typeof QUESTION_TYPES;

export function questionMeta(type: string | null | undefined): TypeMeta {
  return (QUESTION_TYPES as Record<string, TypeMeta>)[type ?? ""] ?? QUESTION_TYPES.multiple_choice;
}

export const AUTO_GRADED_TYPES = new Set([
  "multiple_choice",
  "multiple_select",
  "true_false",
  "short_answer",
  "matching",
  "ordering",
  "fill_blank",
  "decision_tree",
]);

/** Question types the AI generator can produce (praxis_ai QuestionKind). */
export const GENERATABLE_QUESTION_TYPES = [
  "multiple_choice",
  "multiple_select",
  "true_false",
  "short_answer",
  "long_answer",
  "fill_blank",
  "scenario",
] as const;

/* ------------------------------------------------------------------ grading, difficulty, statuses */

export const GRADING_MODES: { value: string; label: string; description: string; color: CategoryColor }[] = [
  { value: "auto", label: "Automatic", description: "Objective questions scored instantly", color: "emerald" },
  { value: "manual", label: "Manual", description: "An assessor grades every submission", color: "sky" },
  { value: "ai_assisted", label: "AI-assisted", description: "AI grades with rubric; assessors can override", color: "violet" },
  {
    value: "ai_recommend_human_final",
    label: "AI recommends, human decides",
    description: "AI drafts a grade; an assessor must confirm it",
    color: "fuchsia",
  },
];

export function gradingLabel(mode: string | null | undefined): string {
  return GRADING_MODES.find((g) => g.value === mode)?.label ?? (mode ?? "—");
}

export const DIFFICULTIES: { value: string; label: string; color: CategoryColor; level: number }[] = [
  { value: "beginner", label: "Beginner", color: "emerald", level: 1 },
  { value: "intermediate", label: "Intermediate", color: "sky", level: 2 },
  { value: "advanced", label: "Advanced", color: "violet", level: 3 },
  { value: "expert", label: "Expert", color: "rose", level: 4 },
];

export function difficultyMeta(value: string | null | undefined) {
  return DIFFICULTIES.find((d) => d.value === value) ?? DIFFICULTIES[0]!;
}

/** Question difficulty 1-5 → colour. */
export const QUESTION_DIFFICULTY: { label: string; color: CategoryColor }[] = [
  { label: "Very easy", color: "emerald" },
  { label: "Easy", color: "teal" },
  { label: "Medium", color: "sky" },
  { label: "Hard", color: "amber" },
  { label: "Very hard", color: "rose" },
];

export const ASSESSMENT_KINDS: { value: string; label: string; color: CategoryColor; description: string }[] = [
  { value: "quiz", label: "Quiz", color: "sky", description: "Lesson or module check" },
  { value: "final", label: "Final exam", color: "violet", description: "End-of-course assessment" },
  { value: "practice", label: "Practice", color: "emerald", description: "Low-stakes practice" },
  { value: "survey", label: "Survey", color: "amber", description: "Ungraded feedback" },
];

export function kindMeta(kind: string | null | undefined) {
  return ASSESSMENT_KINDS.find((k) => k.value === kind) ?? ASSESSMENT_KINDS[0]!;
}

/** Extra tones for statuses the shared statusTone() does not know. */
export function toneFor(status: string | null | undefined): Tone | undefined {
  switch (status) {
    case "running":
    case "processing":
      return "info";
    case "ready":
    case "applied":
    case "active":
      return "success";
    case "superseded":
    case "retired":
      return "neutral";
    case "completed":
      return "violet"; // generation awaiting review
    default:
      return undefined;
  }
}

export const GENERATION_STATUS_LABEL: Record<string, string> = {
  pending: "Queued",
  running: "Generating",
  completed: "Ready for review",
  failed: "Failed",
  approved: "Approved",
  rejected: "Rejected",
  applied: "Applied",
};

export const EVIDENCE_TYPES: { value: string; label: string }[] = [
  { value: "text", label: "Written response" },
  { value: "file", label: "File" },
  { value: "screenshot", label: "Screenshot" },
  { value: "document", label: "Document" },
  { value: "code", label: "Code" },
  { value: "video", label: "Video" },
  { value: "audio", label: "Audio" },
  { value: "structured", label: "Structured form" },
];

export const CODE_LANGUAGES = [
  "python",
  "javascript",
  "typescript",
  "sql",
  "bash",
  "powershell",
  "java",
  "csharp",
  "go",
  "rust",
  "html",
  "css",
  "json",
  "yaml",
  "markdown",
];
