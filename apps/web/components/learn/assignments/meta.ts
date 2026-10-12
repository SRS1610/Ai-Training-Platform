/** Display metadata + client-side helpers for learner assignment submissions. */
import type { CategoryColor } from "@praxis/ui";
import {
  Bot,
  CheckCircle2,
  CircleDashed,
  FileEdit,
  type LucideIcon,
  Hourglass,
  RotateCcw,
  Send,
  UserCheck,
  XCircle,
} from "lucide-react";
import type { EvidenceItem, FileRef, LearnerAssignment, StructuredField, Submission } from "../types";

export type SubmissionPhase =
  | "not_started"
  | "draft"
  | "submitted"
  | "ai_grading"
  | "ai_graded"
  | "under_review"
  | "graded_passed"
  | "graded_failed"
  | "returned";

export function submissionPhase(s: Submission | null | undefined): SubmissionPhase {
  if (!s) return "not_started";
  switch (s.status) {
    case "draft":
      return "draft";
    case "submitted":
      return "submitted";
    case "ai_grading":
      return "ai_grading";
    case "ai_graded":
      return "ai_graded";
    case "under_review":
      return "under_review";
    case "returned":
      return "returned";
    case "graded":
      return s.passed === false ? "graded_failed" : "graded_passed";
    default:
      return "submitted";
  }
}

export const PHASE_META: Record<SubmissionPhase, { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" | "violet" | "brand"; icon: LucideIcon; color: CategoryColor; hint: string }> = {
  not_started: { label: "Not started", tone: "neutral", icon: CircleDashed, color: "indigo", hint: "Read the brief, then start your draft." },
  draft: { label: "Draft", tone: "info", icon: FileEdit, color: "sky", hint: "Keep working — submit when every required item is ready." },
  submitted: { label: "Submitted", tone: "violet", icon: Send, color: "violet", hint: "Your work is with the assessors." },
  ai_grading: { label: "AI reviewing", tone: "violet", icon: Bot, color: "fuchsia", hint: "The AI assistant is preparing a recommendation." },
  ai_graded: { label: "Awaiting assessor", tone: "violet", icon: Hourglass, color: "fuchsia", hint: "AI recommendation ready — a human assessor makes the final call." },
  under_review: { label: "In review", tone: "violet", icon: UserCheck, color: "violet", hint: "An assessor is reviewing your submission." },
  graded_passed: { label: "Passed", tone: "success", icon: CheckCircle2, color: "emerald", hint: "Graded — nice work." },
  graded_failed: { label: "Not passed", tone: "danger", icon: XCircle, color: "rose", hint: "Review the feedback and resubmit if attempts remain." },
  returned: { label: "Returned", tone: "warning", icon: RotateCcw, color: "amber", hint: "Your assessor asked for changes — revise and resubmit." },
};

export const GRADING_MODE_LABEL: Record<string, string> = {
  auto: "Automatically graded",
  manual: "Graded by an assessor",
  ai_assisted: "AI-graded",
  ai_recommend_human_final: "AI recommendation · assessor decides",
};

/** Whether the learner can edit / save a new draft. */
export function canEdit(a: Pick<LearnerAssignment, "max_submissions" | "status">, s: Submission | null | undefined): boolean {
  if (a.status !== "published") return false;
  if (!s) return true;
  if (s.status === "draft" || s.status === "returned") return true;
  if (s.status === "graded" && s.passed === false) return a.max_submissions === null || s.submit_count < (a.max_submissions ?? Infinity);
  return false;
}

/** Mirror of the API's file categorisation (images count as screenshots). */
export function fileCategory(f: Pick<FileRef, "content_type">): "screenshot" | "video" | "audio" | "document" {
  const ct = (f.content_type || "").toLowerCase();
  if (ct.startsWith("image/")) return "screenshot";
  if (ct.startsWith("video/")) return "video";
  if (ct.startsWith("audio/")) return "audio";
  return "document";
}

const FILE_TYPES = new Set(["file", "screenshot", "video", "audio", "document"]);
const CODE_EXT = /\.(py|js|ts|tsx|jsx|java|cs|cpp|c|go|rb|php|sh|ps1|sql|rs|kt|swift|yaml|yml|json)$/i;

export interface DraftState {
  text: string;
  code: string;
  structured: Record<string, string>;
  files: Pick<FileRef, "id" | "filename" | "content_type" | "size_bytes">[];
}

/** Client-side evidence checklist (the API re-checks on submit and returns `missing_evidence`). */
export function evidenceStatus(required: EvidenceItem[], fields: StructuredField[], d: DraftState): { item: EvidenceItem; met: boolean }[] {
  const cats: Record<string, number> = {};
  for (const f of d.files) cats[fileCategory(f)] = (cats[fileCategory(f)] ?? 0) + 1;
  const used: Record<string, number> = {};
  return required.map((item) => {
    const t = item.type;
    let met = true;
    if (t === "text") met = !!d.text.trim();
    else if (t === "code") met = !!d.code.trim() || d.files.some((f) => CODE_EXT.test(f.filename));
    else if (t === "structured") {
      const req = fields.filter((f) => f.required !== false);
      met = req.length ? req.every((f) => !!String(d.structured[f.id] ?? "").trim()) : Object.values(d.structured).some((v) => String(v).trim());
    } else if (FILE_TYPES.has(t)) {
      const available = t === "file" ? d.files.length : (cats[t] ?? 0);
      used[t] = (used[t] ?? 0) + 1;
      met = used[t]! <= available;
    }
    return { item, met };
  });
}

/** True when every *required* evidence item is present (optional items never block submission). */
export function evidenceReady(items: { item: EvidenceItem; met: boolean }[]): boolean {
  return items.every((c) => c.met || c.item.required === false);
}

export function needsText(a: LearnerAssignment): boolean {
  return a.required_evidence.length === 0 || a.required_evidence.some((e) => e.type === "text");
}
export function needsCode(a: LearnerAssignment): boolean {
  return a.required_evidence.some((e) => e.type === "code");
}
export function needsFiles(a: LearnerAssignment): boolean {
  return a.required_evidence.some((e) => FILE_TYPES.has(e.type)) || a.allowed_file_types.length > 0;
}

export function wordCount(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}
