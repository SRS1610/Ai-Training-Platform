/**
 * Active organisation persistence: localStorage (source of truth in the browser) + a cookie
 * (`praxis_org`) so server components / middleware can read it later if needed.
 */
export const ORG_STORAGE_KEY = "praxis.activeOrg";
export const ORG_COOKIE = "praxis_org";

let memory: string | null = null;
const listeners = new Set<(id: string | null) => void>();

export function getActiveOrgId(): string | null {
  if (memory) return memory;
  if (typeof window === "undefined") return null;
  try {
    memory = window.localStorage.getItem(ORG_STORAGE_KEY);
  } catch {
    memory = null;
  }
  return memory;
}

export function setActiveOrgId(id: string | null) {
  memory = id;
  if (typeof window !== "undefined") {
    try {
      if (id) window.localStorage.setItem(ORG_STORAGE_KEY, id);
      else window.localStorage.removeItem(ORG_STORAGE_KEY);
    } catch {
      /* storage blocked */
    }
    document.cookie = id
      ? `${ORG_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=31536000; samesite=lax`
      : `${ORG_COOKIE}=; path=/; max-age=0`;
  }
  listeners.forEach((l) => l(id));
}

export function clearActiveOrgId() {
  setActiveOrgId(null);
}

export function onActiveOrgChange(fn: (id: string | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
