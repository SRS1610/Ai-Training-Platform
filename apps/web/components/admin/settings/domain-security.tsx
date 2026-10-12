"use client";

/** Custom domain (DNS TXT verification), security policy (require MFA) and data retention. */

import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  FormField,
  Input,
  Skeleton,
  Switch,
  cn,
  toast,
} from "@praxis/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  BellOff,
  Bot,
  CheckCircle2,
  Clock3,
  Globe2,
  Hourglass,
  KeyRound,
  Lock,
  MessageSquareX,
  Play,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { ErrorState } from "@/components/common/error-state";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { ak } from "../keys";
import type { DomainStatus, OrgOut, RetentionOut, RetentionRunOut } from "../types";
import { CopyButton, SectionCard, UpgradeNotice, fmtNumber, isPlanLimit, toastError } from "../ui";
import { useOrg } from "./org";

/* ================================================================== custom domain */

export function DomainSettings() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ak.org.domain, queryFn: ({ signal }) => api.get<DomainStatus>("/organisations/current/domain", { signal }) });
  const [domain, setDomain] = React.useState("");
  const [remove, setRemove] = React.useState(false);
  const setStatus = (d: DomainStatus) => {
    qc.setQueryData(ak.org.domain, d);
    qc.invalidateQueries({ queryKey: ak.org.current });
  };
  const put = useMutation({
    mutationFn: () => api.put<DomainStatus>("/organisations/current/domain", { domain: domain.trim().toLowerCase() }),
    onSuccess: (d) => {
      setStatus(d);
      setDomain("");
      toast.success("Domain saved — add the DNS record to verify it");
    },
  });
  const verify = useMutation({
    mutationFn: () => api.post<DomainStatus>("/organisations/current/domain/verify"),
    onSuccess: (d) => {
      setStatus(d);
      if (d.verified) toast.success(`${d.domain} is verified`);
      else toast.error("We couldn't find the TXT record yet. DNS changes can take up to 48 hours.");
    },
    onError: (e) => toastError(e),
  });

  if (status.isLoading) return <Skeleton className="h-72 rounded-2xl" />;
  if (status.isError) return isPlanLimit(status.error) ? <UpgradeNotice error={status.error} title="Custom domains are a Business feature" /> : <ErrorState error={status.error} onRetry={() => status.refetch()} />;
  const d = status.data!;
  const validDomain = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.[a-z0-9-]{1,63})+$/i.test(domain.trim());

  return (
    <div className="grid gap-6 xl:grid-cols-5">
      <SectionCard
        title="Custom domain"
        description="Serve Praxis from your own domain, e.g. learn.yourcompany.com."
        icon={Globe2}
        color="sky"
        className="xl:col-span-3"
        action={
          d.status !== "none" && (
            <Badge tone={d.verified ? "success" : d.status === "unavailable" ? "danger" : "warning"} dot>
              {d.verified ? "Verified" : d.status === "unavailable" ? "Unavailable" : "Pending verification"}
            </Badge>
          )
        }
      >
        {d.status === "none" || !d.domain ? (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (validDomain) put.mutate();
            }}
          >
            <FormField label="Domain" hint="Use a subdomain you control. You'll verify ownership with a DNS TXT record." error={domain && !validDomain ? "Enter a domain like learn.example.com" : null}>
              <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="learn.yourcompany.com" className="font-mono" leftIcon={<Globe2 />} />
            </FormField>
            {put.isError &&
              (isPlanLimit(put.error) ? (
                <UpgradeNotice error={put.error} compact />
              ) : (
                <Alert tone="danger" title="Couldn't set the domain">
                  {errorMessage(put.error)}
                </Alert>
              ))}
            <Button type="submit" loading={put.isPending} disabled={!validDomain}>
              Set domain
            </Button>
          </form>
        ) : (
          <div className="space-y-5">
            <div className={cn("flex items-center gap-3 rounded-2xl p-4", d.verified ? "bg-gradient-to-r from-emerald-50 to-teal-50" : "bg-gradient-to-r from-amber-50 to-orange-50")}>
              <span className={cn("grid size-11 shrink-0 place-items-center rounded-2xl text-white", d.verified ? "bg-gradient-to-br from-emerald-400 to-teal-500" : "bg-gradient-to-br from-amber-400 to-orange-500")}>
                {d.verified ? <CheckCircle2 className="size-5" aria-hidden /> : <Hourglass className="size-5" aria-hidden />}
              </span>
              <div className="min-w-0">
                <p className="truncate font-mono text-base font-semibold text-slate-900">{d.domain}</p>
                <p className="text-sm text-slate-600">{d.verified ? `Verified ${formatDateTime(d.verified_at)}` : "Waiting for the DNS record below"}</p>
              </div>
            </div>
            {!d.verified && d.record_name && (
              <div className="space-y-3">
                <p className="text-sm text-slate-700">{d.instructions ?? "Add this TXT record at your DNS provider, then click Verify."}</p>
                <div className="overflow-hidden rounded-2xl border border-slate-200">
                  <dl className="divide-y divide-slate-100 text-sm">
                    {[
                      { k: "Type", v: d.record_type ?? "TXT" },
                      { k: "Name / host", v: d.record_name },
                      { k: "Value", v: d.record_value ?? "" },
                    ].map((row) => (
                      <div key={row.k} className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:gap-4">
                        <dt className="w-28 shrink-0 text-xs font-semibold uppercase tracking-wider text-slate-500">{row.k}</dt>
                        <dd className="min-w-0 flex-1 break-all font-mono text-xs text-slate-900">{row.v}</dd>
                        {row.k !== "Type" && <CopyButton value={row.v} size="xs" variant="ghost" />}
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {!d.verified && (
                <Button leftIcon={<RefreshCw />} loading={verify.isPending} onClick={() => verify.mutate()}>
                  Verify now
                </Button>
              )}
              <Button variant="destructive-soft" leftIcon={<Trash2 />} onClick={() => setRemove(true)}>
                Remove domain
              </Button>
            </div>
          </div>
        )}
      </SectionCard>
      <div className="space-y-4 xl:col-span-2">
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-soft">
          <h3 className="font-display font-semibold text-slate-900">How it works</h3>
          <ol className="mt-3 space-y-3 text-sm text-slate-600">
            {["Enter the subdomain you want to use.", "Add the TXT record at your DNS provider to prove ownership.", "Click Verify. Then point a CNAME at Praxis — your platform team will confirm the target."].map((t, i) => (
              <li key={i} className="flex gap-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-sky-100 text-xs font-bold text-sky-700">{i + 1}</span>
                {t}
              </li>
            ))}
          </ol>
        </div>
      </div>
      <ConfirmDialog
        open={remove}
        onOpenChange={setRemove}
        destructive
        title={`Remove ${d.domain}?`}
        description="People using the custom domain will need to use the default Praxis address. You can add it again later, but it will need re-verifying."
        confirmLabel="Remove domain"
        onConfirm={async () => {
          try {
            await api.delete("/organisations/current/domain");
            toast.success("Custom domain removed");
            qc.invalidateQueries({ queryKey: ak.org.domain });
            qc.invalidateQueries({ queryKey: ak.org.current });
          } catch (e) {
            toastError(e);
          }
        }}
      />
    </div>
  );
}

/* ================================================================== security */

export function SecuritySettings() {
  const qc = useQueryClient();
  const org = useOrg();
  const { user } = useAuth();
  const [confirm, setConfirm] = React.useState(false);
  const save = useMutation({
    mutationFn: (require_mfa: boolean) => api.patch<OrgOut>("/organisations/current", { settings: { require_mfa } }),
    onSuccess: (o) => {
      qc.setQueryData(ak.org.current, o);
      qc.invalidateQueries({ queryKey: qk.me });
      toast.success(o.settings.require_mfa ? "Two-step verification is now required" : "Two-step verification is now optional");
    },
    onError: (e) => toastError(e),
  });
  if (org.isLoading) return <Skeleton className="h-72 rounded-2xl" />;
  if (org.isError) return <ErrorState error={org.error} onRetry={() => org.refetch()} />;
  const required = org.data!.settings.require_mfa;
  return (
    <div className="grid gap-6 xl:grid-cols-5">
      <SectionCard title="Sign-in security" description="Policies that apply to everyone in the organisation." icon={ShieldCheck} color="emerald" className="xl:col-span-3">
        <div className="space-y-4">
          <div className={cn("flex items-start gap-4 rounded-2xl border p-4", required ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200")}>
            <span className={cn("grid size-11 shrink-0 place-items-center rounded-2xl text-white", required ? "bg-gradient-to-br from-emerald-400 to-teal-500" : "bg-slate-300")}>
              <Smartphone className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-slate-900">Require two-step verification</p>
              <p className="mt-0.5 text-sm text-slate-600">
                Members must set up an authenticator app. Until they do, they see a banner on every page prompting them to enable it.
              </p>
            </div>
            <Switch checked={required} disabled={save.isPending || (!required && !user?.mfa_enabled)} onCheckedChange={(v) => (v ? setConfirm(true) : save.mutate(false))} aria-label="Require two-step verification" />
          </div>
          {!user?.mfa_enabled && (
            <Alert tone="warning" title="Secure your own account first" action={<Button asChild size="sm" variant="secondary"><Link href="/app/profile/security">Set up MFA</Link></Button>}>
              You need two-step verification on your own account before you can require it for everyone.
            </Alert>
          )}
          <ul className="grid gap-3 sm:grid-cols-2">
            {[
              { icon: KeyRound, title: "Passwords", body: "At least 10 characters, common passwords rejected, hashed with Argon2." },
              { icon: Lock, title: "Sessions", body: "Short-lived access tokens with rotating refresh tokens; members can sign out other devices." },
              { icon: Clock3, title: "Lockout", body: "Accounts are temporarily locked after repeated failed sign-in attempts." },
              { icon: Archive, title: "Audit trail", body: "Every sign-in, role change and setting change is written to the immutable audit log." },
            ].map((f) => (
              <li key={f.title} className="flex gap-3 rounded-xl bg-slate-50 p-3">
                <f.icon className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
                <span>
                  <span className="block text-sm font-semibold text-slate-900">{f.title}</span>
                  <span className="block text-xs text-slate-600">{f.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </SectionCard>
      <div className="xl:col-span-2">
        <div className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-5">
          <h3 className="font-display font-semibold text-slate-900">Single sign-on</h3>
          <p className="mt-1 text-sm text-slate-600">Let people sign in with your identity provider (Okta, Entra ID, Google Workspace) and optionally enforce it for your email domains.</p>
          <p className="mt-3 text-sm font-medium text-violet-800">Configure it in the SSO tab.</p>
        </div>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Require two-step verification for everyone?"
        description="Members without MFA will be prompted to set it up the next time they use Praxis. Make sure your help desk is ready for questions."
        confirmLabel="Require MFA"
        onConfirm={() => save.mutateAsync(true).catch(() => undefined)}
      />
    </div>
  );
}

/* ================================================================== retention */

const RETENTION_PRESETS = [
  { days: 90, label: "90 days" },
  { days: 365, label: "1 year" },
  { days: 730, label: "2 years" },
  { days: 1825, label: "5 years" },
  { days: 2555, label: "7 years" },
];

export function RetentionSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ak.privacy.retention, queryFn: ({ signal }) => api.get<RetentionOut>("/privacy/retention", { signal }) });
  const [days, setDays] = React.useState<number>(2555);
  const [run, setRun] = React.useState(false);
  const [result, setResult] = React.useState<RetentionRunOut | null>(null);
  React.useEffect(() => {
    if (q.data) setDays(q.data.retention_days);
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => api.put<RetentionOut>("/privacy/retention", { retention_days: days }),
    onSuccess: (r) => {
      qc.setQueryData(ak.privacy.retention, { ...q.data, ...r });
      qc.invalidateQueries({ queryKey: ak.org.current });
      toast.success(`Retention set to ${fmtNumber(r.retention_days)} days`);
    },
  });
  if (q.isLoading) return <Skeleton className="h-72 rounded-2xl" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const r = q.data!;
  const invalid = !Number.isFinite(days) || days < 30 || days > 3650;
  const years = days / 365;
  return (
    <div className="grid gap-6 xl:grid-cols-5">
      <SectionCard title="Data retention" description="Automatically delete ephemeral data after a period. Runs nightly." icon={Hourglass} color="amber" className="xl:col-span-3">
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!invalid) save.mutate();
          }}
        >
          <div className="flex flex-wrap gap-2">
            {RETENTION_PRESETS.map((p) => (
              <button
                key={p.days}
                type="button"
                aria-pressed={days === p.days}
                onClick={() => setDays(p.days)}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-sm font-semibold ring-1 ring-inset transition-colors focus-visible:focus-ring",
                  days === p.days ? "bg-amber-500 text-white ring-amber-500" : "bg-white text-slate-700 ring-slate-200 hover:bg-amber-50",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <FormField label="Retention period (days)" hint={`Between 30 and 3,650 days · about ${years >= 1 ? `${years.toFixed(1)} years` : `${Math.round(days / 30)} months`}.`} error={invalid ? "Choose between 30 and 3,650 days" : null}>
            <Input type="number" min={30} max={3650} value={Number.isFinite(days) ? days : ""} onChange={(e) => setDays(Number(e.target.value))} className="sm:max-w-xs" />
          </FormField>
          <div>
            <p className="mb-2 text-sm font-medium text-slate-800">Applies to</p>
            <ul className="flex flex-wrap gap-2">
              {r.applies_to.map((a) => (
                <li key={a} className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-sm font-medium text-amber-900 ring-1 ring-inset ring-amber-200">
                  {a === "notifications" ? <BellOff className="size-3.5" aria-hidden /> : a === "ai_messages" ? <Bot className="size-3.5" aria-hidden /> : <MessageSquareX className="size-3.5" aria-hidden />}
                  {a === "ai_messages" ? "AI tutor conversations" : a === "notifications" ? "Notifications" : a}
                </li>
              ))}
            </ul>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="size-3.5 text-emerald-600" aria-hidden />
              {r.note} Learning records and certificates are kept.
            </p>
          </div>
          {save.isError && (
            <Alert tone="danger" title="Couldn't save">
              {errorMessage(save.error)}
            </Alert>
          )}
          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            <Button type="submit" loading={save.isPending} disabled={invalid || days === r.retention_days}>
              Save retention period
            </Button>
            <Button variant="secondary" leftIcon={<Play />} onClick={() => setRun(true)}>
              Run cleanup now
            </Button>
          </div>
        </form>
      </SectionCard>
      <div className="xl:col-span-2">
        {result ? (
          <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-5" aria-live="polite">
            <p className="flex items-center gap-2 font-display font-semibold text-emerald-900">
              <CheckCircle2 className="size-5" aria-hidden /> Cleanup complete
            </p>
            <p className="mt-1 text-xs text-emerald-800">Removed data older than {formatDateTime(result.cutoff)}</p>
            <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
              {[
                { k: "Notifications", v: result.notifications_deleted },
                { k: "AI messages", v: result.ai_messages_deleted },
                { k: "AI sessions", v: result.ai_sessions_deleted },
              ].map((x) => (
                <div key={x.k} className="rounded-xl bg-white p-2.5 ring-1 ring-emerald-100">
                  <dd className="font-display text-xl font-bold tabular-nums text-slate-900">{fmtNumber(x.v)}</dd>
                  <dt className="text-2xs font-medium text-slate-600">{x.k}</dt>
                </div>
              ))}
            </dl>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-soft">
            <h3 className="font-display font-semibold text-slate-900">Privacy by design</h3>
            <p className="mt-1 text-sm text-slate-600">Retention keeps personal data only as long as needed. Members can also export or delete their own data from Privacy settings.</p>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={run}
        onOpenChange={setRun}
        destructive
        title="Run the retention cleanup now?"
        description={`Notifications and AI tutor conversations older than ${fmtNumber(r.retention_days)} days will be permanently deleted. This can't be undone.`}
        confirmLabel="Delete old data"
        onConfirm={async () => {
          try {
            const out = await api.post<RetentionRunOut>("/privacy/retention/run");
            setResult(out);
            toast.success("Retention cleanup complete");
          } catch (e) {
            toastError(e);
          }
        }}
      />
    </div>
  );
}
