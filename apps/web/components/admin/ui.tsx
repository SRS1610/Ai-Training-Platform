"use client";

/**
 * Shared building blocks for the organisation-admin and platform consoles:
 * section cards, permission gates, plan-limit (402) upsell, copy buttons, JSON viewer, number formatting,
 * URL-synced state and small colourful data displays (bar lists, stacked bars, role chips).
 */

import {
  Badge,
  Button,
  CATEGORY_COLORS,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
  cn,
  colorClasses,
  colorFor,
  humanize,
  toast,
  type CategoryColor,
} from "@praxis/ui";
import { ArrowRight, Check, Copy, Crown, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { ApiError, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/* ------------------------------------------------------------------ formatting */

const nf = typeof Intl !== "undefined" ? new Intl.NumberFormat() : null;

export function fmtNumber(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return digits ? v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 }) : (nf?.format(Math.round(v)) ?? String(v));
}

export function fmtCompact(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(v);
}

export function fmtUsd(v: number | null | undefined, opts: { precise?: boolean } = {}): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const precise = opts.precise ?? Math.abs(v) < 10;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: precise ? 2 : 0,
    maximumFractionDigits: precise ? (Math.abs(v) < 1 && v !== 0 ? 4 : 2) : 0,
  }).format(v);
}

export function fmtCents(cents: number | null | undefined, currency = "usd"): string {
  if (cents === null || cents === undefined) return "—";
  return new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}

export function fmtPct(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${v.toFixed(digits)}%`;
}

export function fmtBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

export function fmtDuration(seconds: number | null | undefined): string {
  if (!seconds) return "0m";
  if (seconds < 60) return "<1m";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h ? `${h}h ${m}m` : `${m}m`;
}

/** "1 request", "3 requests". */
export function plural(n: number | null | undefined, word: string, pluralWord = `${word}s`): string {
  const v = n ?? 0;
  return `${fmtNumber(v)} ${v === 1 ? word : pluralWord}`;
}

/* ------------------------------------------------------------------ errors */

export function isPlanLimit(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status === 402;
}

export function isUnavailable(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status === 503;
}

/** Toast an API error; 402s get an upgrade action. */
export function toastError(err: unknown, fallback?: string) {
  if (isPlanLimit(err)) {
    toast.error(errorMessage(err), {
      action: { label: "View plans", onClick: () => window.location.assign("/app/admin/billing") },
    });
    return;
  }
  toast.error(errorMessage(err, fallback));
}

/* ------------------------------------------------------------------ layout bits */

export function IconChip({
  icon: Icon,
  color = "indigo",
  size = "md",
  solid,
  className,
}: {
  icon: LucideIcon;
  color?: CategoryColor;
  size?: "sm" | "md" | "lg";
  solid?: boolean;
  className?: string;
}) {
  const c = colorClasses(color);
  const box = size === "sm" ? "size-8 rounded-lg [&_svg]:size-4" : size === "lg" ? "size-12 rounded-2xl [&_svg]:size-6" : "size-10 rounded-xl [&_svg]:size-5";
  return (
    <span className={cn("grid shrink-0 place-items-center", box, solid ? cn("bg-gradient-to-br text-white shadow-sm", c.gradient) : cn(c.soft, c.icon), className)} aria-hidden>
      <Icon />
    </span>
  );
}

export function SectionCard({
  title,
  description,
  icon,
  color = "indigo",
  action,
  children,
  className,
  contentClassName,
  id,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: LucideIcon;
  color?: CategoryColor;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  id?: string;
}) {
  return (
    <Card className={cn("flex flex-col", className)} id={id}>
      <CardHeader className="flex-wrap">
        <div className="flex min-w-0 items-center gap-3">
          {icon && <IconChip icon={icon} color={color} size="sm" />}
          <div className="min-w-0">
            <CardTitle as="h2">{title}</CardTitle>
            {description && <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">{description}</p>}
          </div>
        </div>
        {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
      </CardHeader>
      <CardContent className={cn("flex-1", contentClassName)}>{children}</CardContent>
    </Card>
  );
}

/** Label / value pair for detail panels. */
export function Meta({ label, children, className }: { label: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium text-slate-900">{children}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ gates */

/** Page-level permission gate (the API is the real enforcement). */
export function PageGate({
  permission,
  anyOf,
  superadmin,
  children,
}: {
  permission?: string;
  anyOf?: string[];
  superadmin?: boolean;
  children: React.ReactNode;
}) {
  const { can, canAny, user } = useAuth();
  const ok = superadmin ? !!user?.is_superadmin : (permission ? can(permission) : true) && (anyOf ? canAny(anyOf) : true);
  if (ok) return <>{children}</>;
  return (
    <EmptyState
      size="lg"
      illustration="shield"
      title="You don't have access to this area"
      description={
        superadmin
          ? "The platform console is only available to Praxis super administrators."
          : "Ask an organisation admin to grant you the right role if you need to manage this."
      }
      action={
        <Button asChild variant="secondary">
          <Link href="/app/dashboard">Back to dashboard</Link>
        </Button>
      }
    />
  );
}

/** Premium upsell shown when an endpoint answers 402 (plan feature or limit). */
export function UpgradeNotice({
  error,
  title = "Upgrade to unlock this",
  description,
  className,
  compact,
}: {
  error?: unknown;
  title?: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  const { can, organisation } = useAuth();
  const msg = description ?? (error ? errorMessage(error) : "Your current plan doesn't include this feature.");
  return (
    <div
      role="status"
      className={cn(
        "relative overflow-hidden rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 via-fuchsia-50 to-amber-50",
        compact ? "p-4" : "p-5 sm:p-6",
        className,
      )}
    >
      <div className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-fuchsia-300/30 blur-3xl" aria-hidden />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-amber-400 text-white shadow-glow">
          <Crown className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display font-semibold text-slate-900">{title}</p>
          <p className="mt-0.5 text-sm text-slate-700">
            {msg}
            {organisation?.plan_code && (
              <>
                {" "}
                You&apos;re on the <strong className="font-semibold">{humanize(organisation.plan_code)}</strong> plan.
              </>
            )}
          </p>
        </div>
        {can("billing.manage") ? (
          <Button asChild variant="gradient" rightIcon={<ArrowRight />} className="shrink-0">
            <Link href="/app/admin/billing">Compare plans</Link>
          </Button>
        ) : (
          <p className="shrink-0 text-xs font-medium text-violet-800">Ask your billing admin to upgrade.</p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ copy / json */

export function CopyButton({ value, label = "Copy", className, size = "sm", variant = "secondary" }: { value: string; label?: string; className?: string; size?: "xs" | "sm" | "md"; variant?: "secondary" | "soft" | "ghost" }) {
  const [done, setDone] = React.useState(false);
  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      className={className}
      leftIcon={done ? <Check /> : <Copy />}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          toast.success("Copied to clipboard");
          setTimeout(() => setDone(false), 1800);
        } catch {
          toast.error("Couldn't copy — select the text and copy it manually");
        }
      }}
    >
      {done ? "Copied" : label}
    </Button>
  );
}

/** Syntax-tinted, read-only JSON viewer (no HTML injection: plain text spans). */
export function JsonView({ value, className }: { value: unknown; className?: string }) {
  const text = React.useMemo(() => JSON.stringify(value ?? {}, null, 2), [value]);
  const parts = React.useMemo(() => {
    const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
    const out: React.ReactNode[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    let i = 0;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push(text.slice(last, m.index));
      if (m[1]) {
        out.push(
          <span key={i++} className={m[2] ? "text-violet-700" : "text-emerald-700"}>
            {m[1]}
          </span>,
        );
        if (m[2]) out.push(m[2]);
      } else if (m[3]) out.push(<span key={i++} className="text-rose-700">{m[3]}</span>);
      else if (m[4]) out.push(<span key={i++} className="text-sky-700">{m[4]}</span>);
      last = re.lastIndex;
    }
    out.push(text.slice(last));
    return out;
  }, [text]);
  return (
    <pre className={cn("max-h-96 overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-relaxed text-slate-800 scrollbar-thin", className)}>
      <code>{parts}</code>
    </pre>
  );
}

/* ------------------------------------------------------------------ URL state */

/** A string state mirrored to a URL search param (replace, no scroll). Wrap pages in <Suspense>. */
export function useUrlState(key: string, fallback = ""): [string, (v: string) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const value = params.get(key) || fallback;
  const set = React.useCallback(
    (v: string) => {
      const next = new URLSearchParams(Array.from(params.entries()));
      if (!v || v === fallback) next.delete(key);
      else next.set(key, v);
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, router, pathname, key, fallback],
  );
  return [value, set];
}

/** Update several search params in one navigation (avoids lost updates from sequential replaces). */
export function useSetUrlParams() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  return React.useCallback(
    (updates: Record<string, string | null | undefined>) => {
      const next = new URLSearchParams(Array.from(params.entries()));
      for (const [k, v] of Object.entries(updates)) {
        if (v === null || v === undefined || v === "") next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, router, pathname],
  );
}

/* ------------------------------------------------------------------ data displays */

export interface BarDatum {
  key: string;
  label: React.ReactNode;
  value: number;
  display?: React.ReactNode;
  hint?: React.ReactNode;
  color?: CategoryColor;
}

/** Colourful horizontal bar list (relative to the max value) with accessible text values. */
export function BarList({ data, className, empty = "No data yet" }: { data: BarDatum[]; className?: string; empty?: React.ReactNode }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data.length) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className={cn("space-y-3", className)}>
      {data.map((d, i) => {
        const c = colorClasses(d.color ?? CATEGORY_COLORS[i % CATEGORY_COLORS.length]!);
        return (
          <li key={d.key}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-medium text-slate-800">{d.label}</span>
              <span className="shrink-0 font-semibold tabular-nums text-slate-900">{d.display ?? fmtNumber(d.value)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className={cn("h-full rounded-full bg-gradient-to-r", c.gradient)} style={{ width: `${Math.max(2, (d.value / max) * 100)}%` }} />
            </div>
            {d.hint && <p className="mt-0.5 text-xs text-muted-foreground">{d.hint}</p>}
          </li>
        );
      })}
    </ul>
  );
}

export interface StackSegment {
  key: string;
  label: string;
  value: number;
  color: CategoryColor;
}

/** Single stacked bar with a legend (e.g. compliance: on time / late / overdue / pending). */
export function StackedBar({ segments, className, height = "h-3", showLegend = true }: { segments: StackSegment[]; className?: string; height?: string; showLegend?: boolean }) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  return (
    <div className={className}>
      <div className={cn("flex w-full overflow-hidden rounded-full bg-slate-100", height)} role="img" aria-label={segments.map((s) => `${s.label}: ${s.value}`).join(", ")}>
        {total > 0 &&
          segments.map((s) =>
            s.value > 0 ? <div key={s.key} className={cn("h-full first:rounded-l-full last:rounded-r-full", colorClasses(s.color).solid)} style={{ width: `${(s.value / total) * 100}%` }} /> : null,
          )}
      </div>
      {showLegend && (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
          {segments.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5 text-slate-600">
              <span className={cn("size-2.5 rounded-full", colorClasses(s.color).solid)} aria-hidden />
              {s.label}
              <span className="font-semibold tabular-nums text-slate-900">{fmtNumber(s.value)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ roles */

const ROLE_COLORS: Record<string, CategoryColor> = {
  org_admin: "violet",
  super_admin: "rose",
  training_manager: "indigo",
  instructor: "sky",
  sme: "teal",
  assessor: "amber",
  auditor: "orange",
  learner: "emerald",
};

export function roleColor(key: string): CategoryColor {
  return ROLE_COLORS[key] ?? colorFor(key);
}

export function RoleChip({ roleKey, name, size = "sm" }: { roleKey: string; name?: string; size?: "sm" | "md" }) {
  const c = colorClasses(roleColor(roleKey));
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full font-semibold ring-1 ring-inset", size === "sm" ? "px-2 py-0.5 text-2xs" : "px-2.5 py-0.5 text-xs", c.soft, c.text, c.ring)}>
      <span className={cn("size-1.5 rounded-full", c.solid)} aria-hidden />
      {name ?? humanize(roleKey)}
    </span>
  );
}

/* ------------------------------------------------------------------ deep gradients */

/** Darker gradient pairs that keep white text at >= 4.5:1 (category `gradient` is for decoration only). */
const DEEP_GRADIENT: Record<CategoryColor, string> = {
  indigo: "from-indigo-600 to-violet-700",
  sky: "from-sky-700 to-blue-700",
  emerald: "from-emerald-700 to-teal-700",
  amber: "from-amber-700 to-orange-700",
  rose: "from-rose-600 to-pink-700",
  fuchsia: "from-fuchsia-600 to-purple-700",
  teal: "from-teal-700 to-cyan-800",
  orange: "from-orange-700 to-rose-700",
  violet: "from-violet-600 to-fuchsia-700",
};

export function deepGradient(color: CategoryColor): string {
  return DEEP_GRADIENT[color] ?? DEEP_GRADIENT.indigo;
}

/* ------------------------------------------------------------------ misc */

export function LiveRegion({ children }: { children: React.ReactNode }) {
  return (
    <p className="sr-only" aria-live="polite">
      {children}
    </p>
  );
}

export function CardsSkeleton({ count = 3, className = "h-40" }: { count?: number; className?: string }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className={cn("rounded-2xl", className)} />
      ))}
    </>
  );
}

export function PlanBadge({ code }: { code: string | null | undefined }) {
  const map: Record<string, CategoryColor> = { free: "teal", individual: "sky", professional: "indigo", business: "violet", enterprise: "fuchsia" };
  const c = colorClasses(map[code ?? ""] ?? ("indigo" as CategoryColor));
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-semibold ring-1 ring-inset", c.soft, c.text, c.ring)}>
      <Crown className="size-3" aria-hidden />
      {humanize(code ?? "unknown")}
    </span>
  );
}

export function YesNo({ value }: { value: boolean }) {
  return value ? (
    <Badge tone="success" size="sm" dot>
      Yes
    </Badge>
  ) : (
    <Badge tone="neutral" size="sm" dot>
      No
    </Badge>
  );
}

const FEATURE_LABELS: Record<string, string> = {
  tutor: "AI tutor",
  tutor_hint: "Tutor hints",
  tutor_explain: "Tutor explanations",
  content_generation: "Content generation",
  course_generation: "Course generation",
  grading: "AI grading",
  simulation_ai: "Simulation AI",
  recommendations: "Recommendations",
  embeddings: "Knowledge embeddings",
  embedding: "Knowledge embeddings",
  simulation: "Simulations",
  simulation_character: "Simulation characters",
  simulation_feedback: "Simulation feedback",
  assessment_generation: "Assessment generation",
  question_generation: "Question generation",
};

export function humanizeFeature(key: string | null | undefined): string {
  if (!key) return "Other";
  return FEATURE_LABELS[key] ?? humanize(key);
}
