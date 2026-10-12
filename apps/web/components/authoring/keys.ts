/** Query keys for the authoring area (kept local; they start with the resource name like lib/query-keys.ts). */
export const ak = {
  courses: {
    all: ["courses"] as const,
    list: (p: Record<string, unknown>) => ["courses", "list", p] as const,
    detail: (id: string) => ["courses", "detail", id] as const,
    structure: (id: string) => ["courses", "structure", id] as const,
    versions: (id: string) => ["courses", "versions", id] as const,
    version: (id: string, n: number) => ["courses", "version", id, n] as const,
    diff: (id: string, from: number, to: string) => ["courses", "diff", id, from, to] as const,
    options: ["courses", "options"] as const,
  },
  skills: (search = "") => ["skills", search] as const,
  generations: {
    all: ["ai-generations"] as const,
    list: (p: Record<string, unknown>) => ["ai-generations", "list", p] as const,
    detail: (id: string) => ["ai-generations", "detail", id] as const,
  },
  banks: {
    all: ["question-banks"] as const,
    list: (p: Record<string, unknown>) => ["question-banks", "list", p] as const,
    detail: (id: string) => ["question-banks", "detail", id] as const,
  },
  questions: {
    all: ["questions"] as const,
    list: (p: Record<string, unknown>) => ["questions", "list", p] as const,
    detail: (id: string) => ["questions", "detail", id] as const,
  },
  assessments: {
    all: ["assessments"] as const,
    list: (p: Record<string, unknown>) => ["assessments", "list", p] as const,
    detail: (id: string) => ["assessments", "detail", id] as const,
    stats: (id: string) => ["assessments", "stats", id] as const,
  },
  assignments: {
    all: ["assignments"] as const,
    list: (p: Record<string, unknown>) => ["assignments", "list", p] as const,
    detail: (id: string) => ["assignments", "detail", id] as const,
  },
  rubrics: {
    all: ["rubrics"] as const,
    list: (p: Record<string, unknown>) => ["rubrics", "list", p] as const,
    detail: (id: string) => ["rubrics", "detail", id] as const,
  },
  knowledge: {
    all: ["knowledge"] as const,
    list: (p: Record<string, unknown>) => ["knowledge", "list", p] as const,
    detail: (id: string) => ["knowledge", "detail", id] as const,
    chunks: (id: string, page: number) => ["knowledge", "chunks", id, page] as const,
  },
  simulations: (search = "") => ["simulations", "picker", search] as const,
};
