/**
 * Central query-key factory. Keys are arrays starting with the resource name so related queries
 * can be invalidated together, e.g. `queryClient.invalidateQueries({ queryKey: qk.notifications.all })`.
 * The active organisation is NOT part of keys: switching org resets the whole cache instead.
 */
export const qk = {
  me: ["me"] as const,
  providers: ["auth", "providers"] as const,
  sessions: ["auth", "sessions"] as const,
  dashboard: {
    learner: ["dashboard", "learner"] as const,
  },
  notifications: {
    all: ["notifications"] as const,
    unread: ["notifications", "unread-count"] as const,
    list: (params: Record<string, unknown> = {}) => ["notifications", "list", params] as const,
  },
  search: (q: string) => ["search", q] as const,
  invitation: (token: string) => ["invitations", "lookup", token] as const,
};
