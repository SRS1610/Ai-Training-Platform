/**
 * Query keys for the admin + platform areas (kept local; `lib/query-keys.ts` is shared and read-only).
 * Each key starts with its resource name so related queries invalidate together.
 */
export const ak = {
  members: {
    all: ["members"] as const,
    list: (p: Record<string, unknown>) => ["members", "list", p] as const,
    detail: (id: string) => ["members", "detail", id] as const,
    search: (q: string) => ["members", "search", q] as const,
  },
  invitations: {
    all: ["invitations", "admin"] as const,
    list: (p: Record<string, unknown>) => ["invitations", "admin", p] as const,
  },
  roles: {
    all: ["roles"] as const,
    permissions: ["roles", "permissions"] as const,
  },
  departments: {
    all: ["departments"] as const,
    list: ["departments", "list"] as const,
    tree: ["departments", "tree"] as const,
  },
  teams: {
    all: ["teams"] as const,
    list: (p: Record<string, unknown> = {}) => ["teams", "list", p] as const,
    members: (id: string, page: number) => ["teams", "members", id, page] as const,
  },
  courses: {
    all: ["courses"] as const,
    options: (q: string) => ["courses", "admin-options", q] as const,
    list: (p: Record<string, unknown>) => ["courses", "admin-list", p] as const,
  },
  paths: {
    all: ["learning-paths"] as const,
    list: (p: Record<string, unknown>) => ["learning-paths", "list", p] as const,
    detail: (id: string) => ["learning-paths", "detail", id] as const,
  },
  enrolments: {
    all: ["enrolments"] as const,
    byUser: (id: string) => ["enrolments", "user", id] as const,
  },
  analytics: {
    org: (p: Record<string, unknown>) => ["analytics", "organisation", p] as const,
    platform: (p: Record<string, unknown>) => ["analytics", "platform", p] as const,
  },
  reports: { types: ["reports", "types"] as const },
  ai: {
    config: ["ai", "config"] as const,
    usage: ["ai", "usage"] as const,
    providers: ["ai", "providers"] as const,
  },
  billing: {
    plans: ["billing", "plans"] as const,
    subscription: ["billing", "subscription"] as const,
    invoices: (page: number) => ["billing", "invoices", page] as const,
    usage: ["billing", "usage"] as const,
  },
  audit: {
    all: ["audit"] as const,
    list: (p: Record<string, unknown>) => ["audit", "list", p] as const,
  },
  apiKeys: {
    all: ["api-keys"] as const,
    list: (p: Record<string, unknown>) => ["api-keys", "list", p] as const,
  },
  org: {
    current: ["organisation", "current"] as const,
    domain: ["organisation", "domain"] as const,
  },
  sso: { all: ["sso", "connections"] as const },
  badges: { all: ["badges"] as const },
  privacy: {
    consents: ["privacy", "consents"] as const,
    requests: ["privacy", "requests"] as const,
    retention: ["privacy", "retention"] as const,
  },
  platform: {
    orgs: (p: Record<string, unknown>) => ["platform", "orgs", p] as const,
    org: (id: string) => ["platform", "org", id] as const,
    users: (p: Record<string, unknown>) => ["platform", "users", p] as const,
    health: ["platform", "health"] as const,
  },
};
