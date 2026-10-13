"use client";

/**
 * /app/admin — organisation admin hub: a few live health numbers and a colourful map of every admin area
 * the viewer can open (gated by the same permissions as the navigation).
 */

import type { Page } from "@praxis/types";
import { EmptyState, KpiTile, PageHeader, Skeleton, cn, colorClasses, type CategoryColor } from "@praxis/ui";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Gauge, LayoutGrid, MailPlus, ShieldCheck, Sparkles, UsersRound, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { ak } from "@/components/admin/keys";
import type { AIUsageOut, MemberOut, OrgAnalytics, SubscriptionOut } from "@/components/admin/types";
import { PlanBadge, fmtNumber, fmtPct, fmtUsd } from "@/components/admin/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { NAV } from "@/lib/nav";

interface Area {
  label: string;
  href: string;
  icon: LucideIcon;
  color: CategoryColor;
  description: string;
  anyOf: string[];
}

function useAreas(): Area[] {
  const { canAny } = useAuth();
  const manage = NAV.find((s) => s.id === "manage")?.items ?? [];
  const areas: Area[] = manage
    .filter((i) => i.href !== "/app/admin")
    .map((i) => ({ label: i.label, href: i.href, icon: i.icon, color: i.color, description: i.description ?? "", anyOf: i.anyOf ?? [] }));
  return areas.filter((a) => !a.anyOf.length || canAny(a.anyOf));
}

function AdminHub() {
  const { can, organisation } = useAuth();
  const areas = useAreas();
  const members = useQuery({
    queryKey: ak.members.list({ count: true }),
    queryFn: ({ signal }) => api.get<Page<MemberOut>>("/users", { signal, query: { page_size: 1 } }),
    enabled: can("users.view"),
  });
  const invites = useQuery({
    queryKey: ak.invitations.list({ status: "pending", count: true }),
    queryFn: ({ signal }) => api.get<Page<unknown>>("/invitations", { signal, query: { status: "pending", page_size: 1 } }),
    enabled: can("users.create"),
  });
  const analytics = useQuery({
    queryKey: ak.analytics.org({ hub: true }),
    queryFn: ({ signal }) => api.get<OrgAnalytics>("/analytics/organisation", { signal }),
    enabled: can("analytics.view"),
  });
  const ai = useQuery({ queryKey: ak.ai.usage, queryFn: ({ signal }) => api.get<AIUsageOut>("/ai/usage", { signal }), enabled: can("ai.manage") });
  const sub = useQuery({
    queryKey: ak.billing.subscription,
    queryFn: ({ signal }) => api.get<SubscriptionOut>("/billing/subscription", { signal }),
    enabled: can("billing.manage"),
  });
  const v = <T,>(q: { isLoading: boolean; data?: T; isError: boolean }, f: (d: T) => string) => (q.isLoading ? "…" : q.data ? f(q.data) : "—");

  const tiles = [
    can("users.view") && <KpiTile key="m" label="Members" value={v(members, (d) => fmtNumber(d.total))} icon={<UsersRound />} color="sky" hint="People in the organisation" />,
    can("users.create") && <KpiTile key="i" label="Pending invites" value={v(invites, (d) => fmtNumber(d.total))} icon={<MailPlus />} color="violet" hint="Awaiting acceptance" />,
    can("analytics.view") && (
      <KpiTile key="c" label="Compliance" value={v(analytics, (d) => fmtPct(d.compliance.compliance_rate))} icon={<ShieldCheck />} color="emerald" hint={analytics.data ? `${fmtNumber(analytics.data.compliance.overdue)} overdue assignments` : "Assigned training on time"} />
    ),
    can("ai.manage") && (
      <KpiTile key="a" label="AI spend this month" value={v(ai, (d) => fmtUsd(d.totals.cost_usd))} icon={<Sparkles />} color="fuchsia" hint={ai.data?.budget.budget_usd ? `${fmtPct(ai.data.budget.pct_used, 1)} of ${fmtUsd(ai.data.budget.budget_usd)} budget` : "No budget set"} />
    ),
    can("billing.manage") && (
      <KpiTile key="s" label="Seats used" value={v(sub, (d) => `${fmtNumber(d.seats_used)}${d.seat_limit && !(d.plan.contact_sales && d.seat_limit <= 1) ? ` / ${fmtNumber(d.seat_limit)}` : ""}`)} icon={<Gauge />} color="amber" hint={sub.data ? `${sub.data.plan.name} plan` : "Your plan"} />
    ),
  ].filter(Boolean);

  return (
    <>
      <PageHeader
        icon={<LayoutGrid />}
        eyebrow="Manage"
        title="Administration"
        description={`Everything you need to run ${organisation?.name ?? "your organisation"} on Praxis — people, structure, training, AI and governance.`}
        actions={organisation?.plan_code ? <PlanBadge code={organisation.plan_code} /> : undefined}
      />
      <div className="space-y-8">
        {tiles.length > 0 && <section aria-label="Organisation at a glance" className={cn("stagger grid grid-cols-2 gap-3 sm:gap-4", tiles.length >= 5 ? "lg:grid-cols-5" : "lg:grid-cols-4")}>{tiles}</section>}
        {!areas.length ? (
          <EmptyState size="lg" illustration="shield" title="No admin areas available" description="Your roles don't include any administration permissions." />
        ) : (
          <section aria-labelledby="areas-title">
            <h2 id="areas-title" className="mb-3 text-xs font-semibold uppercase tracking-wider text-brand-700">
              Admin areas
            </h2>
            <ul className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {areas.map((a) => {
                const c = colorClasses(a.color);
                return (
                  <li key={a.href}>
                    <Link
                      href={a.href}
                      className={cn(
                        "group relative flex h-full items-start gap-4 overflow-hidden rounded-2xl border bg-white p-5 shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-lift focus-visible:focus-ring",
                        "border-slate-200/80",
                      )}
                    >
                      <span className={cn("pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r", c.gradient)} aria-hidden />
                      <span className={cn("grid size-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br text-white shadow-sm", c.gradient)} aria-hidden>
                        <a.icon className="size-6" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 font-display font-semibold text-slate-900">
                          {a.label}
                          <ArrowRight className={cn("size-4 transition-transform group-hover:translate-x-0.5", c.icon)} aria-hidden />
                        </span>
                        <span className="mt-1 block text-sm text-slate-600">{a.description}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}

export default function Page() {
  const { isLoading } = useAuth();
  if (isLoading) return <Skeleton className="h-96 rounded-2xl" />;
  return <AdminHub />;
}
