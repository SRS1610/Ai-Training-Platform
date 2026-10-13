"use client";

import type { Page } from "@praxis/types";
import {
  Alert,
  Button,
  ConfirmDialog,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  PageHeader,
  Progress,
  ProgressRing,
  Skeleton,
  StatusPill,
  cn,
  colorClasses,
  humanize,
  toast,
  type CategoryColor,
  type ColumnDef,
} from "@praxis/ui";
import { Sparkline } from "@praxis/ui/charts";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Bot,
  Check,
  CreditCard,
  Crown,
  ExternalLink,
  FileText,
  Gem,
  Minus,
  PauseCircle,
  PlayCircle,
  Receipt,
  Rocket,
  Sparkles,
  UsersRound,
  Wrench,
} from "lucide-react";
import * as React from "react";
import { ak } from "@/components/admin/keys";
import type { BillingUsageOut, CheckoutOut, PaymentOut, PlanOut, SubscriptionOut } from "@/components/admin/types";
import { PageGate, SectionCard, deepGradient, fmtCents, fmtNumber, fmtUsd, toastError } from "@/components/admin/ui";
import { ErrorState } from "@/components/common/error-state";
import { api, errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";

const PLAN_STYLE: Record<string, { color: CategoryColor; icon: typeof Crown; tagline: string }> = {
  free: { color: "teal", icon: Sparkles, tagline: "Explore Praxis" },
  individual: { color: "sky", icon: Rocket, tagline: "For self-directed learners" },
  professional: { color: "indigo", icon: Gem, tagline: "For small teams & creators" },
  business: { color: "violet", icon: Crown, tagline: "For growing organisations" },
  enterprise: { color: "fuchsia", icon: Wrench, tagline: "Security, scale & support" },
};

const FEATURE_LABEL: Record<string, string> = {
  ai_tutor: "AI tutor",
  simulations: "Work simulations",
  ai_generation: "AI course generation",
  analytics_advanced: "Advanced analytics",
  sso: "SSO (SAML / OIDC)",
  custom_branding: "Custom branding & domain",
  api_access: "API access",
  gamification: "Gamification",
};

const LIMIT_LABEL = (k: string, v: number | null | undefined) => {
  const unlimited = v === null || v === undefined;
  switch (k) {
    case "max_users":
      return unlimited ? "Unlimited members" : `${v} member${v === 1 ? "" : "s"}`;
    case "max_courses":
      return unlimited ? "Unlimited courses" : `${v} courses`;
    case "max_simulations":
      return unlimited ? "Unlimited simulations" : v === 0 ? "No simulations" : `${v} simulations`;
    case "ai_monthly_budget_usd":
      return unlimited ? "Custom AI budget" : `${fmtUsd(v)} AI usage / month`;
    case "storage_gb":
      return unlimited ? "Custom storage" : `${v} GB storage`;
    default:
      return `${humanize(k)}: ${unlimited ? "Unlimited" : v}`;
  }
};

function planPrice(p: PlanOut, interval: "month" | "year") {
  if (p.contact_sales) return { main: "Custom", sub: "Talk to sales" };
  if (!p.monthly_price_cents) return { main: "$0", sub: "forever" };
  const cents = interval === "year" ? p.annual_price_cents / 12 : p.monthly_price_cents;
  return { main: fmtCents(Math.round(cents)), sub: `${p.seat_based ? "per seat / " : "/ "}month${interval === "year" ? ", billed yearly" : ""}` };
}

/* ------------------------------------------------------------------ current plan */

function CurrentPlan({ sub, onSeats, onCancel, onResume, onPortal, portalBusy }: { sub: SubscriptionOut; onSeats: () => void; onCancel: () => void; onResume: () => void; onPortal: () => void; portalBusy: boolean }) {
  const style = PLAN_STYLE[sub.plan.code] ?? PLAN_STYLE.business!;
  const Icon = style.icon;
  const price = planPrice(sub.plan, sub.billing_interval === "year" ? "year" : "month");
  // Enterprise ("contact sales") plans are invoiced under an agreement: no self-serve seats/cancel, and a
  // seat count of 1 is only the API's placeholder when no seat number has been recorded for the agreement.
  const agreement = sub.plan.contact_sales;
  const seatsUnset = agreement && (sub.seat_limit ?? 0) <= 1;
  const limit = seatsUnset ? null : (sub.seat_limit ?? sub.seats_purchased);
  const seatPct = limit ? Math.min(100, (sub.seats_used / limit) * 100) : 0;
  const paid = sub.plan.monthly_price_cents > 0 && !agreement;
  return (
    <section aria-labelledby="current-plan" className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-soft">
      <div className={cn("relative overflow-hidden bg-gradient-to-br p-6 text-white sm:p-8", deepGradient(style.color))}>
        <div className="pointer-events-none absolute inset-0 bg-grid-faint opacity-20 [background-size:28px_28px]" aria-hidden />
        <div className="pointer-events-none absolute -right-10 -top-16 size-64 rounded-full bg-white/20 blur-3xl" aria-hidden />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-white/20 ring-1 ring-white/30 backdrop-blur">
              <Icon className="size-7" aria-hidden />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-white/80">Current plan</p>
              <h2 id="current-plan" className="font-display text-3xl font-bold">
                {sub.plan.name}
              </h2>
              <p className="mt-1 text-sm text-white/90">
                {agreement ? (
                  <span className="font-semibold">Custom pricing under your Enterprise agreement</span>
                ) : (
                  <>
                    <span className="font-semibold">{price.main}</span> {price.sub}
                  </>
                )}
                {sub.coupon_code && <span className="ml-2 rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold">Coupon {sub.coupon_code}</span>}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <StatusPill status={sub.status === "trialing" ? "in_progress" : sub.status} label={humanize(sub.status)} className="bg-white" />
                {sub.cancel_at_period_end && (
                  <span className="rounded-full bg-rose-500/90 px-2.5 py-0.5 text-xs font-semibold text-white ring-1 ring-white/40">Cancels {formatDate(sub.current_period_end)}</span>
                )}
              </div>
            </div>
          </div>
          {sub.is_trialing && (
            <div className="flex items-center gap-4 self-start rounded-2xl bg-white/15 p-4 ring-1 ring-white/25 backdrop-blur lg:self-auto">
              <div className="rounded-full bg-white p-1">
                <ProgressRing value={Math.max(0, Math.min(100, (sub.trial_days_remaining / Math.max(1, sub.plan.trial_days || 14)) * 100))} size={64} stroke={7} label={<span className="font-display text-lg font-bold text-slate-900">{sub.trial_days_remaining}</span>} aria-label="Trial days remaining" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-white/80">Free trial</p>
                <p className="font-semibold">{sub.trial_days_remaining} days left</p>
                <p className="text-xs text-white/85">Ends {formatDate(sub.trial_ends_at)}</p>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6 p-6 sm:p-8 lg:grid-cols-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <UsersRound className="size-4 text-sky-600" aria-hidden /> Seats
          </p>
          <p className="mt-2 font-display text-3xl font-bold tabular-nums text-slate-900">
            {sub.seats_used}
            {limit ? <span className="text-lg font-medium text-slate-500"> / {limit}</span> : <span className="text-lg font-medium text-slate-500"> {sub.seats_used === 1 ? "member" : "members"}</span>}
          </p>
          {limit ? (
            <Progress value={seatPct} size="md" className="mt-2" color={seatPct >= 100 ? "rose" : seatPct >= 80 ? "amber" : "sky"} aria-label="Seats used" />
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">{agreement ? "Seats are set by your Enterprise agreement" : "No seat limit on this plan"}</p>
          )}
          <p className="mt-1.5 text-xs text-muted-foreground">
            {sub.seats_purchased && !seatsUnset ? `${sub.seats_purchased} purchased · ` : ""}Active members plus pending invitations
          </p>
        </div>
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Receipt className="size-4 text-violet-600" aria-hidden /> Billing period
          </p>
          {sub.current_period_end ? (
            <>
              <p className="mt-2 text-sm text-slate-700">
                {formatDate(sub.current_period_start)} – {formatDate(sub.current_period_end)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {sub.cancel_at_period_end ? "Access continues until the end of the period." : `Renews ${sub.billing_interval === "year" ? "yearly" : "monthly"} on ${formatDate(sub.current_period_end)}.`}
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-slate-600">
              {agreement ? "Invoiced under your Enterprise agreement — contact your account manager for billing questions." : paid ? "No active billing period yet." : "Free plans aren't billed."}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2 lg:items-end">
          <Button variant="secondary" leftIcon={<CreditCard />} rightIcon={<ExternalLink />} onClick={onPortal} loading={portalBusy} disabled={!sub.billing_configured || !sub.has_billing_account}>
            Manage billing
          </Button>
          {sub.plan.seat_based && paid && (
            <Button variant="secondary" leftIcon={<UsersRound />} onClick={onSeats} disabled={!sub.billing_configured}>
              Change seats
            </Button>
          )}
          {paid &&
            (sub.cancel_at_period_end ? (
              <Button variant="success" leftIcon={<PlayCircle />} onClick={onResume} disabled={!sub.billing_configured}>
                Resume subscription
              </Button>
            ) : (
              sub.status !== "canceled" && (
                <Button variant="ghost" className="text-rose-700 hover:bg-rose-50" leftIcon={<PauseCircle />} onClick={onCancel} disabled={!sub.billing_configured}>
                  Cancel subscription
                </Button>
              )
            ))}
          {!sub.has_billing_account && sub.billing_configured && <p className="text-xs text-muted-foreground lg:text-right">Billing portal is available after your first checkout.</p>}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ usage */

function AIUsageCard() {
  const usage = useQuery({ queryKey: ak.billing.usage, queryFn: ({ signal }) => api.get<BillingUsageOut>("/billing/usage", { signal }) });
  if (usage.isLoading) return <Skeleton className="h-72 rounded-2xl" />;
  if (usage.isError) return <ErrorState error={usage.error} onRetry={() => usage.refetch()} size="sm" />;
  const u = usage.data!;
  const pct = u.pct_used ?? 0;
  return (
    <SectionCard title="AI usage this period" description={`${formatDate(u.period_start)} – ${formatDate(u.period_end)}`} icon={Bot} color="fuchsia" className="h-full">
      <div className="space-y-4">
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-display text-3xl font-bold tabular-nums text-slate-900">{fmtUsd(u.spend_usd)}</p>
            <p className="text-sm text-slate-600">{u.budget_usd === null ? "spent · no monthly budget" : `of ${fmtUsd(u.budget_usd)}`}</p>
          </div>
          {u.budget_usd !== null && (
            <Progress value={pct} size="md" className="mt-2" color={pct >= 90 ? "rose" : pct >= 75 ? "orange" : pct >= 50 ? "amber" : "emerald"} aria-label="AI budget used" />
          )}
          <p className="mt-1.5 text-xs text-muted-foreground">
            {u.budget_usd === null
              ? "Set a monthly budget in AI settings to track spend against it"
              : u.budget_source === "plan"
                ? "Included in your plan"
                : u.budget_source === "custom" || u.budget_source === "ai_configuration"
                  ? "Budget set in AI settings"
                  : humanize(u.budget_source)}{" "}
            · {fmtNumber(u.requests)} {u.requests === 1 ? "request" : "requests"}
          </p>
        </div>
        {u.by_day.some((d) => d.cost_usd > 0) && (
          <div className="rounded-xl bg-gradient-to-br from-fuchsia-50 to-white p-3 ring-1 ring-inset ring-fuchsia-100">
            <p className="text-xs font-medium text-fuchsia-800">Daily AI spend</p>
            <Sparkline data={u.by_day.map((d) => d.cost_usd)} color="#d946ef" height={44} className="mt-1" />
          </div>
        )}
        <dl className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-emerald-50 p-3">
            <dt className="text-xs font-medium text-emerald-800">Included</dt>
            <dd className="font-semibold tabular-nums text-slate-900">{fmtUsd(u.included_usd)}</dd>
          </div>
          <div className="rounded-xl bg-sky-50 p-3">
            <dt className="text-xs font-medium text-sky-800">Remaining</dt>
            <dd className="font-semibold tabular-nums text-slate-900">{fmtUsd(u.remaining_usd)}</dd>
          </div>
          <div className={cn("rounded-xl p-3", u.overage_usd > 0 ? "bg-rose-50" : "bg-slate-50")}>
            <dt className={cn("text-xs font-medium", u.overage_usd > 0 ? "text-rose-800" : "text-slate-600")}>Overage</dt>
            <dd className="font-semibold tabular-nums text-slate-900">{fmtUsd(u.overage_usd)}</dd>
          </div>
          <div className="rounded-xl bg-violet-50 p-3">
            <dt className="text-xs font-medium text-violet-800">Overage cost</dt>
            <dd className="font-semibold tabular-nums text-slate-900">
              {fmtUsd(u.overage_cost_usd)} <span className="text-xs font-normal text-slate-500">×{u.overage_markup}</span>
            </dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">
          {u.metered_billing_enabled ? `Metered overage billing is on${u.reported_overage_cents ? ` — ${fmtCents(u.reported_overage_cents)} reported to Stripe` : ""}.` : "Metered overage billing is off — usage beyond the budget follows your AI hard-limit setting."}
        </p>
      </div>
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ plans */

function Plans({ sub, plans, onChoose, busy }: { sub: SubscriptionOut; plans: PlanOut[]; onChoose: (p: PlanOut, interval: "month" | "year") => void; busy: string | null }) {
  const [interval, setInterval] = React.useState<"month" | "year">(sub.billing_interval === "year" ? "year" : "month");
  const features = Object.keys(plans[0]?.features ?? {});
  const rank = (code: string) => plans.findIndex((x) => x.code === code);
  const agreement = sub.plan.contact_sales;
  return (
    <section aria-labelledby="plans-title" className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="plans-title" className="font-display text-xl font-semibold text-slate-900">
            Compare plans
          </h2>
          <p className="text-sm text-muted-foreground">
            {agreement ? "You're on a custom Enterprise agreement — your account manager handles any plan changes." : "Upgrade any time — paid plans start with a free trial where available."}
          </p>
        </div>
        <div className="inline-flex items-center rounded-xl bg-slate-100 p-1" role="group" aria-label="Billing interval">
          {(["month", "year"] as const).map((i) => (
            <button
              key={i}
              type="button"
              aria-pressed={interval === i}
              onClick={() => setInterval(i)}
              className={cn("rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-all focus-visible:focus-ring", interval === i ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900")}
            >
              {i === "month" ? "Monthly" : "Annual"}
              {i === "year" && <span className="ml-1.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-2xs font-bold text-emerald-700">Save ~17%</span>}
            </button>
          ))}
        </div>
      </div>
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        {plans.map((p) => {
          const style = PLAN_STYLE[p.code] ?? PLAN_STYLE.business!;
          const c = colorClasses(style.color);
          const current = p.code === sub.plan.code;
          const price = planPrice(p, interval);
          const popular = p.code === "business";
          const Icon = style.icon;
          return (
            <li key={p.code}>
              <article
                className={cn(
                  "relative flex h-full flex-col rounded-2xl border bg-white p-5 shadow-soft transition-all",
                  current ? cn("ring-2", c.ring, c.border) : popular ? "border-violet-300 shadow-lift" : "border-slate-200/80",
                )}
              >
                {popular && !current && <span className="absolute -top-3 left-5 rounded-full bg-brand-gradient px-2.5 py-0.5 text-2xs font-bold uppercase tracking-wide text-white shadow-glow">Most popular</span>}
                {current && <span className={cn("absolute -top-3 left-5 rounded-full px-2.5 py-0.5 text-2xs font-bold uppercase tracking-wide ring-1", c.soft, c.text, c.ring)}>Current plan</span>}
                <span className={cn("grid size-10 place-items-center rounded-xl bg-gradient-to-br text-white shadow-sm", c.gradient)}>
                  <Icon className="size-5" aria-hidden />
                </span>
                <h3 className="mt-3 font-display text-lg font-semibold text-slate-900">{p.name}</h3>
                <p className="text-xs text-muted-foreground">{style.tagline}</p>
                <p className="mt-3">
                  <span className="font-display text-3xl font-bold tabular-nums text-slate-900">{price.main}</span>
                  <span className="ml-1 text-xs text-slate-500">{price.sub}</span>
                </p>
                {p.trial_days > 0 && !current && !agreement && <p className="mt-1 text-xs font-semibold text-emerald-700">{p.trial_days}-day free trial</p>}
                <ul className="mt-4 space-y-1.5 text-sm">
                  {Object.entries(p.limits).map(([k, v]) => (
                    <li key={k} className="flex items-start gap-2 text-slate-700">
                      <Check className={cn("mt-0.5 size-4 shrink-0", c.icon)} aria-hidden />
                      {LIMIT_LABEL(k, v as number | null)}
                    </li>
                  ))}
                  {features.map((f) => (
                    <li key={f} className={cn("flex items-start gap-2", p.features[f] ? "text-slate-700" : "text-slate-400")}>
                      {p.features[f] ? <Check className={cn("mt-0.5 size-4 shrink-0", c.icon)} aria-hidden /> : <Minus className="mt-0.5 size-4 shrink-0" aria-hidden />}
                      <span>
                        {FEATURE_LABEL[f] ?? humanize(f)}
                        <span className="sr-only">{p.features[f] ? " included" : " not included"}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-auto pt-5">
                  {current ? (
                    <Button block variant="secondary" disabled>
                      Your plan
                    </Button>
                  ) : agreement ? null : p.contact_sales ? (
                    <Button block variant="outline" asChild>
                      <a href="mailto:sales@praxis.app?subject=Praxis%20Enterprise">Contact sales</a>
                    </Button>
                  ) : p.self_serve ? (
                    <Button block variant={popular ? "gradient" : "primary"} rightIcon={<ArrowRight />} loading={busy === p.code} disabled={!sub.billing_configured || !!busy} onClick={() => onChoose(p, interval)}>
                      {rank(p.code) > rank(sub.plan.code) ? "Upgrade" : "Downgrade"}
                    </Button>
                  ) : (
                    <Button block variant="ghost" disabled>
                      Included
                    </Button>
                  )}
                </div>
              </article>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ invoices */

function Invoices() {
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize: 10 });
  const q = useQuery({
    queryKey: ak.billing.invoices(pagination.pageIndex + 1),
    queryFn: ({ signal }) => api.get<Page<PaymentOut>>("/billing/invoices", { signal, query: { page: pagination.pageIndex + 1, page_size: pagination.pageSize } }),
    placeholderData: keepPreviousData,
  });
  const columns = React.useMemo<ColumnDef<PaymentOut, unknown>[]>(
    () => [
      { accessorKey: "created_at", header: "Date", cell: ({ row }) => <span className="whitespace-nowrap text-slate-800">{formatDate(row.original.paid_at ?? row.original.created_at)}</span> },
      {
        accessorKey: "description",
        header: "Description",
        cell: ({ row }) => (
          <div className="min-w-[9rem] max-w-[15rem]">
            <p className="font-medium text-slate-900">{row.original.description ?? "Subscription"}</p>
            {row.original.period_start && (
              <p className="text-xs text-muted-foreground">
                {formatDate(row.original.period_start)} – {formatDate(row.original.period_end)}
              </p>
            )}
          </div>
        ),
      },
      { accessorKey: "amount_cents", header: "Amount", cell: ({ row }) => <span className="font-semibold tabular-nums text-slate-900">{fmtCents(row.original.amount_cents, row.original.currency)}</span> },
      { accessorKey: "status", header: "Status", cell: ({ row }) => <StatusPill status={row.original.status === "paid" ? "completed" : row.original.status === "open" ? "pending" : row.original.status} label={humanize(row.original.status)} size="sm" /> },
      {
        id: "links",
        header: () => <span className="sr-only">Links</span>,
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex justify-end gap-1.5">
            {row.original.hosted_invoice_url && (
              <Button asChild size="xs" variant="soft" rightIcon={<ExternalLink />}>
                <a href={row.original.hosted_invoice_url} target="_blank" rel="noopener noreferrer">
                  View
                </a>
              </Button>
            )}
            {row.original.invoice_pdf_url && (
              <Button asChild size="xs" variant="secondary" leftIcon={<FileText />}>
                <a href={row.original.invoice_pdf_url} target="_blank" rel="noopener noreferrer">
                  PDF
                </a>
              </Button>
            )}
          </div>
        ),
      },
    ],
    [],
  );
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} size="sm" />;
  return (
    <DataTable
      aria-label="Invoices"
      columns={columns}
      data={q.data?.items ?? []}
      loading={q.isLoading}
      total={q.data?.total ?? 0}
      pagination={pagination}
      onPaginationChange={setPagination}
      getRowId={(r) => r.id}
      columnToggle={false}
      toolbar={
        <div>
          <h2 className="font-display text-base font-semibold text-slate-900">Invoices</h2>
          <p className="text-xs text-muted-foreground">Hosted invoices and PDFs are provided by Stripe.</p>
        </div>
      }
      empty={{ title: "No invoices yet", description: "Invoices appear here after your first paid billing period." }}
    />
  );
}

/* ------------------------------------------------------------------ page */

function BillingPage() {
  const qc = useQueryClient();
  const sub = useQuery({ queryKey: ak.billing.subscription, queryFn: ({ signal }) => api.get<SubscriptionOut>("/billing/subscription", { signal }) });
  const plans = useQuery({ queryKey: ak.billing.plans, queryFn: ({ signal }) => api.get<PlanOut[]>("/billing/plans", { signal }), staleTime: 300_000 });
  const [seatsOpen, setSeatsOpen] = React.useState(false);
  const [seats, setSeats] = React.useState(1);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [checkoutPlan, setCheckoutPlan] = React.useState<{ plan: PlanOut; interval: "month" | "year" } | null>(null);
  const [checkoutSeats, setCheckoutSeats] = React.useState(1);

  const portal = useMutation({
    mutationFn: () => api.post<{ url: string }>("/billing/portal"),
    onSuccess: (r) => window.location.assign(r.url),
    onError: (e) => toastError(e),
  });
  const checkout = useMutation({
    mutationFn: (v: { plan: PlanOut; interval: "month" | "year"; seats: number }) => api.post<CheckoutOut>("/billing/checkout", { plan_code: v.plan.code, interval: v.interval, seats: v.seats }),
    onSuccess: (r) => {
      toast.success("Redirecting to secure checkout…");
      window.location.assign(r.url);
    },
    onError: (e) => toastError(e),
  });
  const changeSeats = useMutation({
    mutationFn: () => api.post<SubscriptionOut>("/billing/subscription/seats", { seats }),
    onSuccess: (s) => {
      qc.setQueryData(ak.billing.subscription, s);
      toast.success(`Seats updated to ${seats}`);
      setSeatsOpen(false);
    },
  });

  if (sub.isLoading)
    return (
      <div className="space-y-6">
        <Skeleton className="h-80 rounded-3xl" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-96 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  if (sub.isError) return <ErrorState error={sub.error} onRetry={() => sub.refetch()} size="lg" />;
  const s = sub.data!;

  const choose = (plan: PlanOut, interval: "month" | "year") => {
    if (plan.seat_based) {
      setCheckoutSeats(Math.max(1, s.seats_used));
      setCheckoutPlan({ plan, interval });
    } else checkout.mutate({ plan, interval, seats: 1 });
  };

  return (
    <div className="space-y-8">
      {!s.billing_configured && (
        <Alert tone="info" title="Online billing isn't connected on this server" icon={<CreditCard aria-hidden />}>
          Stripe hasn&apos;t been configured, so upgrades, seat changes and the billing portal are unavailable. Your plan, seats and usage below are still accurate. Contact your Praxis
          administrator to enable payments.
        </Alert>
      )}
      <CurrentPlan
        sub={s}
        portalBusy={portal.isPending}
        onPortal={() => portal.mutate()}
        onSeats={() => {
          setSeats(s.seats_purchased ?? Math.max(1, s.seats_used));
          changeSeats.reset();
          setSeatsOpen(true);
        }}
        onCancel={() => setCancelOpen(true)}
        onResume={async () => {
          try {
            const r = await api.post<SubscriptionOut>("/billing/subscription/resume");
            qc.setQueryData(ak.billing.subscription, r);
            toast.success("Subscription resumed");
          } catch (e) {
            toastError(e);
          }
        }}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <AIUsageCard />
        </div>
        <div className="lg:col-span-3">
          <Invoices />
        </div>
      </div>
      {plans.isError ? (
        <ErrorState error={plans.error} onRetry={() => plans.refetch()} size="sm" />
      ) : plans.data ? (
        <Plans sub={s} plans={plans.data} onChoose={choose} busy={checkout.isPending ? (checkout.variables?.plan.code ?? null) : null} />
      ) : (
        <Skeleton className="h-96 rounded-2xl" />
      )}

      <Dialog open={seatsOpen} onOpenChange={setSeatsOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <span className="mb-1 grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-sky-400 to-indigo-500 text-white">
              <UsersRound className="size-5" aria-hidden />
            </span>
            <DialogTitle>Change seats</DialogTitle>
            <DialogDescription>
              You&apos;re using {s.seats_used} seat{s.seats_used === 1 ? "" : "s"}. Changes are prorated on your next invoice.
            </DialogDescription>
          </DialogHeader>
          <FormField label="Seats" error={seats < s.seats_used ? `You can't go below the ${s.seats_used} seats in use` : null}>
            <Input type="number" min={Math.max(1, s.seats_used)} max={100000} value={seats} onChange={(e) => setSeats(Number(e.target.value))} />
          </FormField>
          {changeSeats.isError && (
            <Alert tone="danger" title="Couldn't change seats">
              {errorMessage(changeSeats.error)}
            </Alert>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setSeatsOpen(false)}>
              Cancel
            </Button>
            <Button loading={changeSeats.isPending} disabled={seats < Math.max(1, s.seats_used) || seats === s.seats_purchased} onClick={() => changeSeats.mutate()}>
              Update seats
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!checkoutPlan} onOpenChange={(o) => !o && setCheckoutPlan(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <span className="mb-1 grid size-11 place-items-center rounded-2xl bg-brand-gradient text-white">
              <Crown className="size-5" aria-hidden />
            </span>
            <DialogTitle>Upgrade to {checkoutPlan?.plan.name}</DialogTitle>
            <DialogDescription>
              {checkoutPlan && `${planPrice(checkoutPlan.plan, checkoutPlan.interval).main} ${planPrice(checkoutPlan.plan, checkoutPlan.interval).sub}.`} You&apos;ll finish payment on Stripe&apos;s secure checkout.
            </DialogDescription>
          </DialogHeader>
          <FormField label="Seats" hint={`You currently have ${s.seats_used} people (including pending invitations).`}>
            <Input type="number" min={1} max={100000} value={checkoutSeats} onChange={(e) => setCheckoutSeats(Number(e.target.value))} />
          </FormField>
          {checkoutPlan && checkoutPlan.plan.monthly_price_cents > 0 && (
            <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
              Estimated{" "}
              <strong className="font-semibold tabular-nums text-slate-900">
                {fmtCents((checkoutPlan.interval === "year" ? checkoutPlan.plan.annual_price_cents : checkoutPlan.plan.monthly_price_cents) * Math.max(1, checkoutSeats), "usd")}
              </strong>{" "}
              per {checkoutPlan.interval}
              {checkoutPlan.plan.trial_days ? ` after a ${checkoutPlan.plan.trial_days}-day trial` : ""}.
            </p>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCheckoutPlan(null)}>
              Cancel
            </Button>
            <Button variant="gradient" rightIcon={<ArrowRight />} loading={checkout.isPending} disabled={checkoutSeats < 1} onClick={() => checkout.mutate({ ...checkoutPlan!, seats: checkoutSeats })}>
              Continue to checkout
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        destructive
        title="Cancel your subscription?"
        description={`Your ${s.plan.name} plan stays active until ${formatDate(s.current_period_end)}. After that, the organisation moves to the Free plan: paid features switch off and members beyond the free limit lose access. You can resume any time before then.`}
        confirmLabel="Cancel at period end"
        onConfirm={async () => {
          try {
            const r = await api.post<SubscriptionOut>("/billing/subscription/cancel");
            qc.setQueryData(ak.billing.subscription, r);
            toast.success("Subscription will cancel at the end of the period");
          } catch (e) {
            toastError(e);
          }
        }}
      />
    </div>
  );
}

export default function Page() {
  return (
    <PageGate permission="billing.manage">
      <PageHeader icon={<CreditCard />} eyebrow="Manage" title="Billing" description="Your plan, seats, AI usage and invoices." />
      <BillingPage />
    </PageGate>
  );
}
