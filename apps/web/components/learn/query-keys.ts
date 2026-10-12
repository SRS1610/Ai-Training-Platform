/**
 * Query keys for the learner experience. Each key starts with its resource name so related queries can be
 * invalidated together (e.g. `qc.invalidateQueries({ queryKey: lk.learn.all })`).
 */
export const lk = {
  catalog: {
    all: ["catalog"] as const,
    list: (params: Record<string, unknown>) => ["catalog", "list", params] as const,
    categories: ["catalog", "categories"] as const,
    detail: (id: string) => ["catalog", "detail", id] as const,
  },
  skills: {
    all: ["skills"] as const,
    list: ["skills", "list"] as const,
    me: ["skills", "me"] as const,
  },
  enrolments: {
    all: ["enrolments"] as const,
    me: ["enrolments", "me"] as const,
  },
  paths: {
    all: ["learning-paths"] as const,
    me: ["learning-paths", "me"] as const,
    available: ["learning-paths", "available"] as const,
  },
  learn: {
    all: ["learn"] as const,
    course: (courseId: string) => ["learn", courseId] as const,
    lesson: (courseId: string, lessonId: string) => ["learn", courseId, "lesson", lessonId] as const,
  },
  quiz: {
    all: ["assessments"] as const,
    overview: (id: string) => ["assessments", "overview", id] as const,
    attempt: (id: string) => ["attempts", id] as const,
    result: (id: string) => ["attempts", id, "result"] as const,
  },
  assignments: {
    all: ["assignments"] as const,
    list: (params: Record<string, unknown> = {}) => ["assignments", "list", params] as const,
    detail: (id: string) => ["assignments", "detail", id] as const,
    submission: (id: string) => ["assignments", "submission", id] as const,
    versions: (id: string) => ["assignments", "versions", id] as const,
  },
  certificates: {
    all: ["certificates"] as const,
    me: ["certificates", "me"] as const,
  },
  verify: (n: string) => ["verify", n] as const,
  recommendations: {
    all: ["recommendations"] as const,
    me: ["recommendations", "me"] as const,
    plan: ["recommendations", "plan"] as const,
  },
  analytics: {
    me: ["analytics", "learner", "me"] as const,
  },
  gamification: {
    all: ["gamification"] as const,
    me: ["gamification", "me"] as const,
    badges: ["gamification", "badges"] as const,
    leaderboard: (period: string, department: string | null) => ["gamification", "leaderboard", period, department] as const,
  },
};
