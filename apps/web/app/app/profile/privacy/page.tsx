"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  PageHeader,
  Skeleton,
  Spinner,
  StatusPill,
  Switch,
  cn,
  toast,
} from "@praxis/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  Bot,
  Check,
  Download,
  FileArchive,
  History,
  Lock,
  type LucideIcon,
  Mail,
  ShieldCheck,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { PasswordInput } from "@/components/auth/password-input";
import { ak } from "@/components/admin/keys";
import type { ConsentsOut, DataRequestOut } from "@/components/admin/types";
import { toastError } from "@/components/admin/ui";
import { ErrorState } from "@/components/common/error-state";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDateTime, formatRelative } from "@/lib/format";

const TABS = [
  { href: "/app/profile", label: "Profile", icon: UserRound },
  { href: "/app/profile/security", label: "Security & sign-in", icon: ShieldCheck },
  { href: "/app/profile/privacy", label: "Privacy & data", icon: Lock },
];

function AccountNav() {
  const pathname = usePathname();
  return (
    <>
      <PageHeader title="Privacy & data" description="Control how your data is used, download a copy, or delete your account." eyebrow="Account" />
      <nav aria-label="Account sections" className="-mt-2 mb-8 border-b border-slate-200">
        <ul className="no-scrollbar flex gap-6 overflow-x-auto">
          {TABS.map((t) => {
            const active = pathname === t.href;
            return (
              <li key={t.href}>
                <Link
                  href={t.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 pb-3 text-sm font-medium transition-colors focus-visible:focus-ring",
                    active ? "border-brand-600 text-brand-700" : "border-transparent text-slate-600 hover:text-slate-900",
                  )}
                >
                  <t.icon className="size-4" aria-hidden />
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}

/* ------------------------------------------------------------------ consents */

const PURPOSES: { key: "ai_processing" | "analytics" | "marketing"; title: string; body: string; icon: LucideIcon; color: string }[] = [
  {
    key: "ai_processing",
    title: "AI-powered features",
    body: "Let the AI tutor, feedback and recommendations process your questions and work. Turning this off limits AI help to non-personalised content.",
    icon: Bot,
    color: "from-fuchsia-500 to-violet-500",
  },
  {
    key: "analytics",
    title: "Product analytics",
    body: "Share anonymous usage data so we can improve Praxis. Your organisation's training records aren't affected.",
    icon: BarChart3,
    color: "from-sky-400 to-indigo-500",
  },
  {
    key: "marketing",
    title: "News & tips by email",
    body: "Occasional emails about new features, learning tips and events. You can unsubscribe at any time.",
    icon: Mail,
    color: "from-amber-400 to-orange-500",
  },
];

const PURPOSE_LABEL: Record<string, string> = { ai_processing: "AI processing", analytics: "Analytics", marketing: "Marketing", terms: "Terms of service", privacy_policy: "Privacy policy" };

function ConsentsCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ak.privacy.consents, queryFn: ({ signal }) => api.get<ConsentsOut>("/privacy/consents", { signal }) });
  const [showHistory, setShowHistory] = React.useState(false);
  const update = useMutation({
    mutationFn: (v: { purpose: string; granted: boolean }) => api.put<ConsentsOut>("/privacy/consents", { consents: [v] }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ak.privacy.consents });
      const prev = qc.getQueryData<ConsentsOut>(ak.privacy.consents);
      if (prev) {
        const cur = prev.current[v.purpose];
        qc.setQueryData<ConsentsOut>(ak.privacy.consents, {
          ...prev,
          current: { ...prev.current, [v.purpose]: { ...(cur ?? { id: "optimistic", purpose: v.purpose, policy_version: "2026-01", organisation_id: null, created_at: new Date().toISOString() }), granted: v.granted } },
        });
      }
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(ak.privacy.consents, ctx.prev);
      toastError(e);
    },
    onSuccess: (r, v) => {
      qc.setQueryData(ak.privacy.consents, r);
      toast.success(`${PURPOSE_LABEL[v.purpose]} ${v.granted ? "allowed" : "turned off"}`);
    },
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-emerald-50 text-emerald-600">
            <ShieldCheck className="size-5" aria-hidden />
          </span>
          <div>
            <CardTitle as="h2">Consent preferences</CardTitle>
            <CardDescription>Every change is recorded as a new consent record — nothing is overwritten.</CardDescription>
          </div>
        </div>
        <Button variant="ghost" size="sm" leftIcon={<History />} onClick={() => setShowHistory((s) => !s)} aria-expanded={showHistory}>
          {showHistory ? "Hide history" : "History"}
        </Button>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-2xl" />
            ))}
          </div>
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} size="sm" />
        ) : (
          <div className="space-y-3">
            {PURPOSES.map((p) => {
              const cur = q.data!.current[p.key];
              const granted = cur?.granted ?? false;
              const id = `consent-${p.key}`;
              return (
                <div key={p.key} className={cn("flex items-start gap-4 rounded-2xl border p-4 transition-colors", granted ? "border-emerald-200 bg-emerald-50/40" : "border-slate-200")}>
                  <span className={cn("grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br text-white shadow-sm", p.color, !granted && "opacity-60 grayscale")}>
                    <p.icon className="size-5" aria-hidden />
                  </span>
                  <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-900">{p.title}</span>
                      {cur ? (
                        <span className="text-xs text-muted-foreground">
                          {granted ? "Allowed" : "Declined"} {formatRelative(cur.created_at)} · policy {cur.policy_version}
                        </span>
                      ) : (
                        <Badge size="sm" tone="neutral">
                          Not set
                        </Badge>
                      )}
                    </span>
                    <span className="mt-1 block text-sm text-slate-600">{p.body}</span>
                  </label>
                  <Switch id={id} checked={granted} disabled={update.isPending && update.variables?.purpose === p.key} onCheckedChange={(v) => update.mutate({ purpose: p.key, granted: v })} />
                </div>
              );
            })}
            {showHistory && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                <h3 className="text-sm font-semibold text-slate-900">Consent history</h3>
                {!q.data!.history.length ? (
                  <p className="mt-2 text-sm text-muted-foreground">No consent records yet.</p>
                ) : (
                  <ol className="mt-3 space-y-2">
                    {q.data!.history.map((h) => (
                      <li key={h.id} className="flex items-center gap-3 text-sm">
                        <span className={cn("grid size-6 shrink-0 place-items-center rounded-full", h.granted ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700")}>
                          {h.granted ? <Check className="size-3.5" aria-hidden /> : <X className="size-3.5" aria-hidden />}
                        </span>
                        <span className="font-medium text-slate-800">{PURPOSE_LABEL[h.purpose] ?? h.purpose}</span>
                        <span className="text-slate-600">{h.granted ? "granted" : "withdrawn"}</span>
                        <span className="ml-auto whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(h.created_at)}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ export */

function ExportCard() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ak.privacy.requests,
    queryFn: ({ signal }) => api.get<DataRequestOut[]>("/privacy/requests", { signal }),
    refetchInterval: (query) => ((query.state.data ?? []).some((r) => r.status === "pending" || r.status === "processing") ? 4000 : false),
  });
  const request = useMutation({
    mutationFn: () => api.post<DataRequestOut>("/privacy/export"),
    onSuccess: () => {
      toast.success("Export requested — we'll prepare your archive");
      qc.invalidateQueries({ queryKey: ak.privacy.requests });
    },
    onError: (e) => toastError(e),
  });
  const download = useMutation({
    mutationFn: (id: string) => api.download(`/privacy/requests/${id}/download`),
    onSuccess: (f) => toast.success("Download started", { description: f }),
    onError: (e) => toastError(e),
  });
  const exports = (q.data ?? []).filter((r) => r.kind === "export");
  const inflight = exports.some((r) => r.status === "pending" || r.status === "processing");
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-sky-50 text-sky-600">
            <FileArchive className="size-5" aria-hidden />
          </span>
          <div>
            <CardTitle as="h2">Download your data</CardTitle>
            <CardDescription>A ZIP (JSON) of your profile, enrolments, progress, assessments, submissions, simulations, certificates and AI conversations.</CardDescription>
          </div>
        </div>
        <Button variant="secondary" leftIcon={<Download />} loading={request.isPending} disabled={inflight} onClick={() => request.mutate()}>
          {inflight ? "Preparing…" : "Request export"}
        </Button>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <Skeleton className="h-16 rounded-xl" />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} size="sm" />
        ) : !exports.length ? (
          <p className="rounded-xl bg-slate-50 px-4 py-5 text-center text-sm text-muted-foreground">No exports yet. Archives are available to download for 7 days.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200" aria-live="polite">
            {exports.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 p-3">
                <span className="grid size-9 place-items-center rounded-xl bg-sky-50 text-sky-600">
                  {r.status === "pending" || r.status === "processing" ? <Spinner label="Preparing export" /> : <FileArchive className="size-4" aria-hidden />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900">Data export · {formatDateTime(r.created_at)}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.status === "completed" && r.completed_at ? `Ready ${formatRelative(r.completed_at)}` : r.status === "failed" ? (r.error ?? "Export failed") : "We're preparing your archive — this usually takes a minute."}
                  </p>
                </div>
                <StatusPill status={r.status === "processing" ? "in_progress" : r.status} label={r.status === "processing" ? "Processing" : undefined} size="sm" />
                {r.status === "completed" && (
                  <Button size="sm" variant="soft" leftIcon={<Download />} loading={download.isPending && download.variables === r.id} onClick={() => download.mutate(r.id)}>
                    Download
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ delete */

function DeleteAccountCard() {
  const { user } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<"password" | "email">("password");
  const [password, setPassword] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [ack, setAck] = React.useState(false);
  React.useEffect(() => {
    if (open) {
      setPassword("");
      setEmail("");
      setAck(false);
      del.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const del = useMutation({
    mutationFn: () => api.post("/privacy/delete-account", mode === "password" ? { password } : { confirm_email: email.trim() }, { redirectOn401: false }),
    onSuccess: () => {
      window.location.assign("/login?deleted=1");
    },
  });
  const canSubmit = ack && (mode === "password" ? password.length > 0 : email.trim().toLowerCase() === (user?.email ?? "").toLowerCase());
  const sole = del.error instanceof ApiError && del.error.code === "sole_admin" ? ((del.error.details as { organisations?: string[] } | undefined)?.organisations ?? []) : null;

  return (
    <Card className="border-rose-200">
      <CardHeader>
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-rose-50 text-rose-600">
            <Trash2 className="size-5" aria-hidden />
          </span>
          <div>
            <CardTitle as="h2">Delete account</CardTitle>
            <CardDescription>Permanently delete your Praxis account and personal data.</CardDescription>
          </div>
        </div>
        <Button variant="destructive-soft" leftIcon={<Trash2 />} onClick={() => setOpen(true)}>
          Delete account
        </Button>
      </CardHeader>
      <Dialog open={open} onOpenChange={(o) => !del.isPending && setOpen(o)}>
        <DialogContent role="alertdialog">
          <DialogHeader>
            <span className="mb-1 grid size-11 place-items-center rounded-2xl bg-rose-100 text-rose-600">
              <Trash2 className="size-5" aria-hidden />
            </span>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>This can&apos;t be undone. Here&apos;s exactly what happens:</DialogDescription>
          </DialogHeader>
          <ul className="space-y-2 rounded-2xl bg-rose-50/60 p-4 text-sm text-slate-700">
            {[
              "You're signed out everywhere and can't sign in again with this account.",
              "Your name and email are anonymised; notifications and AI tutor conversations are deleted.",
              "Organisations where you're the only member are deleted.",
              "Training records your organisations need for compliance are kept, anonymised.",
              "Download your data first if you want a copy.",
            ].map((t) => (
              <li key={t} className="flex gap-2">
                <X className="mt-0.5 size-4 shrink-0 text-rose-600" aria-hidden />
                {t}
              </li>
            ))}
          </ul>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSubmit) del.mutate();
            }}
          >
            {mode === "password" ? (
              <FormField label="Confirm with your password" required>
                <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
              </FormField>
            ) : (
              <FormField label={<>Type <span className="font-mono font-semibold">{user?.email}</span> to confirm</>} required>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
              </FormField>
            )}
            <button type="button" className="text-xs font-semibold text-brand-700 hover:underline" onClick={() => setMode((m) => (m === "password" ? "email" : "password"))}>
              {mode === "password" ? "Signed up with Google, Microsoft or SSO? Confirm with your email instead" : "I have a password — confirm with it instead"}
            </button>
            <label className="flex items-start gap-3 text-sm text-slate-800">
              <Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} className="mt-0.5" />I understand my account will be permanently deleted.
            </label>
            {del.isError &&
              (sole ? (
                <Alert tone="danger" title="Make someone else an admin first">
                  You&apos;re the only admin of {sole.join(", ")}. Promote another member to Organisation Admin, then try again.
                </Alert>
              ) : (
                <Alert tone="danger" title="Couldn't delete your account">
                  {errorMessage(del.error)}
                </Alert>
              ))}
            <DialogFooter>
              <Button variant="secondary" onClick={() => setOpen(false)} disabled={del.isPending}>
                Keep my account
              </Button>
              <Button type="submit" variant="destructive" loading={del.isPending} disabled={!canSubmit}>
                Delete permanently
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default function PrivacyPage() {
  return (
    <>
      <AccountNav />
      <div className="mx-auto max-w-4xl space-y-6">
        <ConsentsCard />
        <ExportCard />
        <DeleteAccountCard />
      </div>
    </>
  );
}
