"use client";

/**
 * Auth context: the signed-in user, active organisation, memberships and permissions (from GET /me).
 *
 *   const { user, organisation, can } = useAuth();
 *   const canEdit = usePermission("courses.edit");
 *   <Can permission="users.view">…</Can>
 */

import type { Me, OrgSummary, Permission } from "@praxis/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { api, type ApiError } from "./api";
import { applyBranding } from "./branding";
import { getActiveOrgId, setActiveOrgId } from "./org";
import { qk } from "./query-keys";

export interface AuthState {
  me: Me | undefined;
  user: Me["user"] | undefined;
  organisation: OrgSummary | undefined;
  organisations: OrgSummary[];
  permissions: Set<string>;
  isLoading: boolean;
  error: ApiError | null;
  refetch: () => Promise<unknown>;
  can: (permission: Permission | string) => boolean;
  canAny: (permissions: (Permission | string)[]) => boolean;
  switchOrganisation: (orgId: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = React.createContext<AuthState | null>(null);

export function useMeQuery(opts: { enabled?: boolean; redirectOn401?: boolean } = {}) {
  return useQuery({
    queryKey: qk.me,
    queryFn: ({ signal }) => api.get<Me>("/me", { signal, redirectOn401: opts.redirectOn401 ?? true }),
    enabled: opts.enabled ?? true,
    staleTime: 60_000,
  });
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const query = useMeQuery();
  const me = query.data;

  // Keep the stored org in sync with what the server resolved (first load / stale id).
  React.useEffect(() => {
    if (me && getActiveOrgId() !== me.organisation.id) setActiveOrgId(me.organisation.id);
  }, [me]);

  // Org branding: primary colour as the brand accent.
  React.useEffect(() => applyBranding(me?.organisation.branding?.primary_color), [me?.organisation.branding?.primary_color]);

  const permissions = React.useMemo(() => {
    const s = new Set<string>(me?.permissions ?? []);
    if (me?.user.is_superadmin) s.add("system.manage");
    return s;
  }, [me]);

  const switchOrganisation = React.useCallback(
    async (orgId: string) => {
      if (orgId === getActiveOrgId()) return;
      setActiveOrgId(orgId);
      await qc.cancelQueries();
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
      await qc.invalidateQueries({ queryKey: qk.me });
      api.patch("/me", { default_organisation_id: orgId }).catch(() => undefined);
    },
    [qc],
  );

  const logout = React.useCallback(async () => {
    try {
      await api.post("/auth/logout", undefined, { redirectOn401: false });
    } catch {
      /* already signed out */
    }
    setActiveOrgId(null);
    qc.clear();
    window.location.assign("/login?signed_out=1");
  }, [qc]);

  const value = React.useMemo<AuthState>(
    () => ({
      me,
      user: me?.user,
      organisation: me?.organisation,
      organisations: me?.organisations ?? [],
      permissions,
      isLoading: query.isLoading,
      error: (query.error as ApiError | null) ?? null,
      refetch: query.refetch,
      can: (p) => permissions.has(p),
      canAny: (ps) => ps.some((p) => permissions.has(p)),
      switchOrganisation,
      logout,
    }),
    [me, permissions, query.isLoading, query.error, query.refetch, switchOrganisation, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** True when the user holds the permission in the active organisation. */
export function usePermission(permission: Permission | string): boolean {
  return useAuth().can(permission);
}

/** Render children only when permitted. `anyOf` passes if any permission matches. */
export function Can({
  permission,
  anyOf,
  fallback = null,
  children,
}: {
  permission?: Permission | string;
  anyOf?: (Permission | string)[];
  fallback?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { can, canAny } = useAuth();
  const ok = (permission ? can(permission) : true) && (anyOf ? canAny(anyOf) : true);
  return <>{ok ? children : fallback}</>;
}
