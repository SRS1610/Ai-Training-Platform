"use client";

import { useQuery } from "@tanstack/react-query";
import type { PlanOut } from "@/components/admin/types";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/** Display names for plan feature flags (shared with the billing page wording). */
export const PLAN_FEATURE_LABEL: Record<string, string> = {
  ai_tutor: "AI tutor",
  simulations: "Work simulations",
  ai_generation: "AI course generation",
  analytics_advanced: "Advanced analytics",
  sso: "SSO (SAML / OIDC)",
  custom_branding: "Custom branding & domain",
  api_access: "API access",
  gamification: "Gamification",
};

export const planKeys = { plans: ["billing", "plans"] as const };

/** The public plan catalogue (no billing permission needed); cached for the session. */
export function usePlans() {
  return useQuery({
    queryKey: planKeys.plans,
    queryFn: ({ signal }) => api.get<PlanOut[]>("/billing/plans", { signal }),
    staleTime: 300_000,
  });
}

/**
 * Whether the active organisation's plan includes ``feature``, read up front from the plan catalogue and the
 * organisation's ``plan_code`` (from ``/me``). ``enabled`` is ``null`` while unknown, so callers never block on a
 * failed lookup; the API stays the real enforcement (402) and per-organisation overrides are honoured there.
 */
export function usePlanFeature(feature: string) {
  const { organisation } = useAuth();
  const plans = usePlans();
  const plan = plans.data?.find((p) => p.code === organisation?.plan_code);
  const enabled = plan ? Boolean((plan.features as Record<string, boolean | undefined>)[feature]) : null;
  const upgradeTo = plans.data?.find((p) => (p.features as Record<string, boolean | undefined>)[feature]);
  return {
    loading: plans.isLoading,
    enabled,
    planName: plan?.name ?? null,
    upgradeTo: upgradeTo?.name ?? null,
    label: PLAN_FEATURE_LABEL[feature] ?? feature.replace(/_/g, " "),
  };
}
