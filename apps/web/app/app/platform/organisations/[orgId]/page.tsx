"use client";

import {
  Alert,
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  FormField,
  Input,
  PageHeader,
  SimpleSelect,
  Skeleton,
  StatusPill,
  Textarea,
  cn,
  colorClasses,
  colorFor,
  humanize,
  toast,
} from "@praxis/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Bot, Building2, CreditCard, Crown, Globe2, HardDrive, PauseCircle, PlayCircle, RotateCcw, Save, SlidersHorizontal, UsersRound } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";
import { ak } from "@/components/admin/keys";
import type { PlanOut, PlatformOrgDetail } from "@/components/admin/types";
import { Meta, PageGate, PlanBadge, SectionCard, fmtBytes, fmtNumber, fmtUsd, toastError } from "@/components/admin/ui";
import { ErrorState } from "@/components/common/error-state";
import { api, ApiError, errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";

const FEATURE_LABEL: Record<string, string> = {
  ai_tutor: "AI tutor",
  simulations: "Simulations",
  ai_generation: "AI generation",
  analytics_advanced: "Advanced analytics",
  sso: "SSO",
  custom_branding: "Custom branding",
  api_access: "API access",
  gamification: "Gamification",
};

type Override = "plan" | "on" | "off";

function OrgDetail() {
  const { orgId } = useParams<{ orgId: string }>();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ak.platform.org(orgId), queryFn: ({ signal }) => api.get<PlatformOrgDetail>(`/platform/organisations/${orgId}`, { signal }) });
  const plans = useQuery({ queryKey: ak.billing.plans, queryFn: ({ signal }) => api.get<PlanOut[]>("/billing/plans", { signal }), staleTime: 300_000 });
  const [plan, setPlan] = React.useState("");
  const [seats, setSeats] = React.useState("");
  const [overrides, setOverrides] = React.useState<Record<string, Override>>({});
  const [statusDialog, setStatusDialog] = React.useState<"suspend" | "reactivate" | null>(null);
  const [reason, setReason] = React.useState("");

  const initOverrides = React.useCallback((o: PlatformOrgDetail) => {
    const out: Record<string, Override> = {};
    for (const k of Object.keys(FEATURE_LABEL)) out[k] = k in (o.feature_overrides ?? {}) ? (o.feature_overrides[k] ? "on" : "off") : "plan";
    return out;
  }, []);
  React.useEffect(() => {
    if (q.data) {
      setPlan(q.data.plan_code);
      setSeats(String((q.data.settings as { seats?: number }).seats ?? q.data.subscription?.seats ?? ""));
      setOverrides(initOverrides(q.data));
    }
  }, [q.data, initOverrides]);

  const save = useMutation({
    mutationFn: () => {
      const o = q.data!;
      const body: Record<string, unknown> = {};
      if (plan !== o.plan_code) body.plan_code = plan;
      const init = initOverrides(o);
      const changed = Object.entries(overrides).filter(([k, v]) => init[k] !== v);
      if (changed.length) body.feature_overrides = Object.fromEntries(changed.map(([k, v]) => [k, v === "plan" ? null : v === "on"]));
      const s = Number(seats);
      if (seats && s >= 1 && s !== ((o.settings as { seats?: number }).seats ?? o.subscription?.seats)) body.seats = s;
      return api.patch<PlatformOrgDetail>(`/platform/organisations/${o.id}/plan`, body);
    },
    onSuccess: (o) => {
      qc.setQueryData(ak.platform.org(orgId), o);
      qc.invalidateQueries({ queryKey: ["platform", "orgs"] });
      toast.success("Plan & features updated");
    },
  });

  if (q.isLoading)
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-44 rounded-3xl" />
        <div className="grid gap-6 xl:grid-cols-3">
          <Skeleton className="h-96 rounded-2xl xl:col-span-2" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      </div>
    );
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} size="lg" title={q.error instanceof ApiError && q.error.isNotFound ? "Organisation not found" : undefined} />;
  const o = q.data!;
  const c = colorClasses(colorFor(o.name));
  const planDef = plans.data?.find((p) => p.code === plan);
  const dirty = plan !== o.plan_code || JSON.stringify(overrides) !== JSON.stringify(initOverrides(o)) || (seats !== "" && Number(seats) !== ((o.settings as { seats?: number }).seats ?? o.subscription?.seats ?? NaN));
  const suspended = o.status === "suspended";

  return (
    <>
      <PageHeader
        title={o.name}
        breadcrumbs={[{ label: "Platform", href: "/app/platform?tab=organisations" }, { label: o.name }]}
        linkComponent={Link}
        className="mb-4 [&_h1]:sr-only"
      />
      <section className="mb-6 overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-soft">
        <div className={cn("relative flex flex-col gap-4 bg-gradient-to-br p-6 text-white sm:flex-row sm:items-center", c.gradient)}>
          <div className="pointer-events-none absolute -right-8 -top-12 size-48 rounded-full bg-white/20 blur-3xl" aria-hidden />
          <span className="relative grid size-16 shrink-0 place-items-center rounded-2xl bg-white/20 font-display text-2xl font-bold ring-1 ring-white/30 backdrop-blur">{o.name.slice(0, 1)}</span>
          <div className="relative flex-1">
            <h2 className="font-display text-2xl font-bold">{o.name}</h2>
            <p className="font-mono text-sm text-white/85">{o.slug}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <StatusPill status={o.status} className="bg-white" />
              <span className="rounded-full bg-white px-0.5 py-0.5">
                <PlanBadge code={o.plan_code} />
              </span>
              <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-semibold capitalize ring-1 ring-white/30">{o.kind.replace(/_/g, " ")}</span>
            </div>
          </div>
          <div className="relative">
            {suspended ? (
              <Button variant="white" leftIcon={<PlayCircle />} onClick={() => { setReason(""); setStatusDialog("reactivate"); }}>
                Reactivate
              </Button>
            ) : (
              <Button className="bg-white/15 text-white ring-1 ring-white/40 hover:bg-white/25" leftIcon={<PauseCircle />} onClick={() => { setReason(""); setStatusDialog("suspend"); }}>
                Suspend organisation
              </Button>
            )}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-4 p-6 sm:grid-cols-3 lg:grid-cols-6">
          <Meta label={<span className="inline-flex items-center gap-1"><UsersRound className="size-3.5 text-sky-600" aria-hidden />Members</span>}>{fmtNumber(o.member_count)}</Meta>
          <Meta label={<span className="inline-flex items-center gap-1"><BookOpen className="size-3.5 text-violet-600" aria-hidden />Courses</span>}>{fmtNumber(o.course_count)}</Meta>
          <Meta label="Enrolments">{fmtNumber(o.enrolment_count)}</Meta>
          <Meta label={<span className="inline-flex items-center gap-1"><Bot className="size-3.5 text-fuchsia-600" aria-hidden />AI cost (30d)</span>}>{fmtUsd(o.ai_cost_30d_usd)}</Meta>
          <Meta label={<span className="inline-flex items-center gap-1"><HardDrive className="size-3.5 text-amber-600" aria-hidden />Storage</span>}>{fmtBytes(o.storage_bytes)}</Meta>
          <Meta label="Created">{formatDate(o.created_at)}</Meta>
        </dl>
      </section>

      {suspended && (
        <Alert tone="danger" title="This organisation is suspended" className="mb-6">
          Members can&apos;t sign in to it. The suspension reason is recorded in the platform audit log.
        </Alert>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <form
          className="space-y-6 xl:col-span-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <SectionCard title="Plan & seats" description="Changes apply immediately and are recorded in the platform audit log. Stripe billing isn't changed." icon={Crown} color="violet">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Plan">
                <SimpleSelect value={plan} onValueChange={setPlan} options={(plans.data ?? []).map((p) => ({ value: p.code, label: p.name }))} placeholder={plans.isLoading ? "Loading…" : "Choose a plan"} />
              </FormField>
              <FormField label="Seats" hint={planDef?.seat_based ? "Seat-based plan: caps members" : "Only enforced on seat-based plans"}>
                <Input type="number" min={1} value={seats} onChange={(e) => setSeats(e.target.value)} />
              </FormField>
            </div>
          </SectionCard>
          <SectionCard title="Feature overrides" description="Force a feature on or off regardless of the plan." icon={SlidersHorizontal} color="indigo">
            <ul className="grid gap-2 sm:grid-cols-2">
              {Object.entries(FEATURE_LABEL).map(([k, label]) => {
                const fromPlan = planDef?.features[k] ?? false;
                const v = overrides[k] ?? "plan";
                const effective = v === "plan" ? fromPlan : v === "on";
                return (
                  <li key={k} className={cn("flex items-center gap-3 rounded-xl border p-3", v !== "plan" ? "border-violet-200 bg-violet-50/50" : "border-slate-200")}>
                    <span className={cn("size-2.5 shrink-0 rounded-full", effective ? "bg-emerald-500" : "bg-slate-300")} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-slate-900">{label}</span>
                      <span className="block text-xs text-muted-foreground">
                        {effective ? "On" : "Off"} · plan default {fromPlan ? "on" : "off"}
                      </span>
                    </span>
                    <div className="inline-flex rounded-lg bg-slate-100 p-0.5" role="radiogroup" aria-label={`${label} override`}>
                      {(["plan", "on", "off"] as const).map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          role="radio"
                          aria-checked={v === opt}
                          onClick={() => setOverrides((s) => ({ ...s, [k]: opt }))}
                          className={cn(
                            "rounded-md px-2 py-1 text-xs font-semibold capitalize transition-all focus-visible:focus-ring",
                            v === opt ? (opt === "on" ? "bg-emerald-600 text-white" : opt === "off" ? "bg-rose-600 text-white" : "bg-white text-slate-900 shadow-sm") : "text-slate-600 hover:text-slate-900",
                          )}
                        >
                          {opt === "plan" ? "Plan" : opt}
                        </button>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          </SectionCard>
          {save.isError && (
            <Alert tone="danger" title="Couldn't save">
              {errorMessage(save.error)}
            </Alert>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              leftIcon={<RotateCcw />}
              disabled={!dirty}
              onClick={() => {
                setPlan(o.plan_code);
                setOverrides(initOverrides(o));
                setSeats(String((o.settings as { seats?: number }).seats ?? o.subscription?.seats ?? ""));
              }}
            >
              Reset
            </Button>
            <Button type="submit" variant="gradient" leftIcon={<Save />} loading={save.isPending} disabled={!dirty}>
              Save plan &amp; features
            </Button>
          </div>
        </form>

        <div className="space-y-6">
          <SectionCard title="Admins" icon={UsersRound} color="sky">
            {o.admins.length ? (
              <ul className="space-y-2.5">
                {o.admins.map((a) => (
                  <li key={a.id} className="flex items-center gap-3">
                    <Avatar name={a.full_name} size="sm" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-slate-900">{a.full_name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{a.email}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No active admins.</p>
            )}
          </SectionCard>
          <SectionCard title="Subscription" icon={CreditCard} color="emerald">
            {o.subscription ? (
              <dl className="grid grid-cols-2 gap-3">
                <Meta label="Plan">{humanize(o.subscription.plan_code)}</Meta>
                <Meta label="Status">
                  <StatusPill status={o.subscription.status} size="sm" />
                </Meta>
                <Meta label="Seats">{o.subscription.seats}</Meta>
                <Meta label="Interval">{o.subscription.billing_interval === "year" ? "Annual" : "Monthly"}</Meta>
                <Meta label="Period ends">{formatDate(o.subscription.current_period_end)}</Meta>
                <Meta label="Cancels">{o.subscription.cancel_at_period_end ? <Badge tone="danger" size="sm">At period end</Badge> : "No"}</Meta>
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">No Stripe subscription — plan is managed manually.</p>
            )}
          </SectionCard>
          {o.custom_domain && (
            <SectionCard title="Custom domain" icon={Globe2} color="teal">
              <p className="font-mono text-sm text-slate-900">{o.custom_domain}</p>
            </SectionCard>
          )}
          <SectionCard title="Settings snapshot" icon={Building2} color="indigo">
            <dl className="grid grid-cols-2 gap-3">
              {Object.entries(o.settings)
                .filter(([k]) => !["feature_overrides", "seats"].includes(k))
                .slice(0, 8)
                .map(([k, v]) => (
                  <Meta key={k} label={humanize(k)}>
                    {typeof v === "boolean" ? (v ? "Yes" : "No") : String(v)}
                  </Meta>
                ))}
            </dl>
          </SectionCard>
        </div>
      </div>

      <ConfirmDialog
        open={!!statusDialog}
        onOpenChange={(v) => !v && setStatusDialog(null)}
        destructive={statusDialog === "suspend"}
        title={statusDialog === "suspend" ? `Suspend ${o.name}?` : `Reactivate ${o.name}?`}
        description={statusDialog === "suspend" ? `All ${fmtNumber(o.member_count)} members lose access immediately. Data is kept and the organisation can be reactivated later.` : "Members regain access straight away."}
        confirmText={statusDialog === "suspend" ? o.slug : undefined}
        confirmLabel={statusDialog === "suspend" ? "Suspend organisation" : "Reactivate"}
        onConfirm={async () => {
          try {
            const r = await api.post<PlatformOrgDetail>(`/platform/organisations/${o.id}/${statusDialog}`, { reason: reason.trim() || null });
            qc.setQueryData(ak.platform.org(orgId), r);
            qc.invalidateQueries({ queryKey: ["platform", "orgs"] });
            toast.success(statusDialog === "suspend" ? "Organisation suspended" : "Organisation reactivated");
          } catch (e) {
            toastError(e);
          }
        }}
      >
        <FormField label="Reason" hint="Recorded in the audit log">
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </FormField>
      </ConfirmDialog>
    </>
  );
}

export default function Page() {
  return (
    <PageGate superadmin>
      <OrgDetail />
    </PageGate>
  );
}
