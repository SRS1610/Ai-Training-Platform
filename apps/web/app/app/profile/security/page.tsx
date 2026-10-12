"use client";

import type { AuthSession, Me, MFAEnableOut, MFASetupOut } from "@praxis/types";
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
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  Label,
  Skeleton,
  Stepper,
  cn,
  toast,
} from "@praxis/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, KeyRound, LaptopMinimal, LogOut, ShieldCheck, ShieldOff, Smartphone, Tablet } from "lucide-react";
import * as React from "react";
import { z } from "zod";
import { OtpInput } from "@/components/auth/otp-input";
import { PasswordInput, PasswordStrength } from "@/components/auth/password-input";
import { ErrorState } from "@/components/common/error-state";
import { applyApiErrors, useZodForm } from "@/components/forms/form";
import { ProfileHeader } from "@/components/profile/profile-nav";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDateTime, formatRelative } from "@/lib/format";
import { qk } from "@/lib/query-keys";

/* ------------------------------------------------------------------ password */

const pwSchema = z
  .object({
    current_password: z.string().min(1, "Enter your current password"),
    new_password: z.string().min(10, "Use at least 10 characters").max(256),
    confirm: z.string(),
  })
  .refine((v) => v.new_password === v.confirm, { path: ["confirm"], message: "Passwords don't match" })
  .refine((v) => v.new_password !== v.current_password, { path: ["new_password"], message: "Choose a different password" });

function PasswordCard() {
  const qc = useQueryClient();
  const form = useZodForm(pwSchema, { defaultValues: { current_password: "", new_password: "", confirm: "" } });
  const [error, setError] = React.useState<string | null>(null);
  const pw = form.watch("new_password") ?? "";
  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await api.post("/auth/password/change", { current_password: v.current_password, new_password: v.new_password });
      form.reset();
      qc.invalidateQueries({ queryKey: qk.sessions });
      toast.success("Password updated");
    } catch (err) {
      setError(applyApiErrors(form, err));
    }
  });
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-sky-50 text-sky-600">
            <KeyRound className="size-5" aria-hidden />
          </span>
          <div>
            <CardTitle as="h2">Password</CardTitle>
            <CardDescription>Use a long, unique password. Other devices may be signed out.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="grid gap-4 md:grid-cols-2">
          {error && <Alert tone="danger" className="md:col-span-2">{error}</Alert>}
          <FormField label="Current password" error={form.formState.errors.current_password?.message} className="md:col-span-2" required>
            <PasswordInput autoComplete="current-password" {...form.register("current_password")} />
          </FormField>
          <FormField label="New password" error={form.formState.errors.new_password?.message} required>
            {(aria) => (
              <div className="space-y-2">
                <PasswordInput autoComplete="new-password" {...aria} {...form.register("new_password")} />
                <PasswordStrength password={pw} />
              </div>
            )}
          </FormField>
          <FormField label="Confirm new password" error={form.formState.errors.confirm?.message} required>
            <PasswordInput autoComplete="new-password" {...form.register("confirm")} />
          </FormField>
          <div className="md:col-span-2">
            <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
              Update password
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ MFA */

function svgDataUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function MfaSetupDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [step, setStep] = React.useState(0);
  const [code, setCode] = React.useState("");
  const [codes, setCodes] = React.useState<string[]>([]);
  const [saved, setSaved] = React.useState(false);
  const setup = useMutation({ mutationFn: () => api.post<MFASetupOut>("/auth/mfa/setup") });
  const enable = useMutation({
    mutationFn: (c: string) => api.post<MFAEnableOut>("/auth/mfa/enable", { code: c }),
    onSuccess: (r) => {
      setCodes(r.recovery_codes);
      setStep(2);
      qc.setQueryData<Me>(qk.me, (old) => (old ? { ...old, user: { ...old.user, mfa_enabled: true } } : old));
    },
  });

  React.useEffect(() => {
    if (open) {
      setStep(0);
      setCode("");
      setCodes([]);
      setSaved(false);
      setup.reset();
      enable.reset();
      setup.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied`);
    } catch {
      toast.error("Copy failed — select and copy manually");
    }
  };
  const download = () => {
    const blob = new Blob([`Praxis recovery codes\nGenerated ${new Date().toISOString()}\n\n${codes.join("\n")}\n\nEach code can be used once.\n`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "praxis-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  const finishing = step === 2;
  return (
    <Dialog open={open} onOpenChange={(o) => (finishing && !saved ? undefined : onOpenChange(o))}>
      <DialogContent size="lg" hideClose={finishing && !saved}>
        <DialogHeader>
          <DialogTitle>Set up two-step verification</DialogTitle>
          <DialogDescription>Protect your account with an authenticator app such as 1Password, Authy or Google Authenticator.</DialogDescription>
        </DialogHeader>
        <Stepper steps={[{ label: "Scan" }, { label: "Verify" }, { label: "Save codes" }]} current={step} className="my-2" />

        {step === 0 && (
          <div className="grid items-center gap-6 sm:grid-cols-[200px_1fr]">
            <div className="mx-auto grid size-[200px] place-items-center rounded-2xl border border-slate-200 bg-white p-3 shadow-soft">
              {setup.isPending ? (
                <Skeleton className="size-full" />
              ) : setup.data ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={svgDataUrl(setup.data.qr_svg)} alt="QR code for your authenticator app" className="size-full" />
              ) : (
                <p className="text-center text-sm text-rose-700">{errorMessage(setup.error)}</p>
              )}
            </div>
            <div className="space-y-3 text-sm text-slate-600">
              <p>
                <strong className="text-slate-900">1.</strong> Open your authenticator app and scan this QR code.
              </p>
              <p>
                <strong className="text-slate-900">2.</strong> Can&apos;t scan? Enter this key manually:
              </p>
              {setup.data && (
                <div className="flex items-center gap-2 rounded-xl bg-slate-50 p-2 ring-1 ring-slate-200">
                  <code className="flex-1 break-all px-1 font-mono text-xs text-slate-800">{setup.data.secret}</code>
                  <Button variant="ghost" size="icon-sm" aria-label="Copy setup key" onClick={() => copy(setup.data!.secret, "Setup key")}>
                    <Copy />
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        {step === 1 && (
          <form
            className="mx-auto w-full max-w-sm space-y-4 py-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.length === 6) enable.mutate(code);
            }}
          >
            <p className="text-center text-sm text-slate-600">Enter the 6-digit code your app shows for Praxis.</p>
            <OtpInput value={code} onChange={setCode} onComplete={(c) => enable.mutate(c)} invalid={enable.isError} autoFocus disabled={enable.isPending} />
            {enable.isError && (
              <p role="alert" className="text-center text-sm font-medium text-rose-700">
                {errorMessage(enable.error, "That code didn't work. Try the newest code.")}
              </p>
            )}
          </form>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <Alert tone="warning" title="Save these recovery codes now">
              Each code works once if you lose access to your authenticator. You won&apos;t be able to see them again.
            </Alert>
            <ul className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200 sm:grid-cols-3" aria-label="Recovery codes">
              {codes.map((c) => (
                <li key={c} className="rounded-lg bg-white px-3 py-2 text-center font-mono text-sm font-semibold tracking-wider text-slate-800 shadow-sm">
                  {c}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" leftIcon={<Copy />} onClick={() => copy(codes.join("\n"), "Recovery codes")}>
                Copy all
              </Button>
              <Button variant="secondary" leftIcon={<Download />} onClick={download}>
                Download .txt
              </Button>
            </div>
            <div className="flex items-center gap-2.5">
              <Checkbox id="saved-codes" checked={saved} onCheckedChange={(v) => setSaved(!!v)} />
              <Label htmlFor="saved-codes" className="font-normal">
                I&apos;ve saved my recovery codes somewhere safe
              </Label>
            </div>
          </div>
        )}

        <DialogFooter>
          {step === 0 && (
            <>
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button variant="gradient" disabled={!setup.data} onClick={() => setStep(1)}>
                Next
              </Button>
            </>
          )}
          {step === 1 && (
            <>
              <Button variant="secondary" onClick={() => setStep(0)}>
                Back
              </Button>
              <Button variant="gradient" loading={enable.isPending} disabled={code.length !== 6} onClick={() => enable.mutate(code)}>
                Verify & enable
              </Button>
            </>
          )}
          {step === 2 && (
            <Button
              variant="gradient"
              disabled={!saved}
              onClick={() => {
                onOpenChange(false);
                toast.success("Two-step verification is on");
              }}
            >
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const disableSchema = z.object({
  password: z.string().min(1, "Enter your password"),
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
});

function MfaDisableDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const form = useZodForm(disableSchema, { defaultValues: { password: "", code: "" } });
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) {
      form.reset();
      setError(null);
    }
  }, [open, form]);
  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await api.post("/auth/mfa/disable", v);
      qc.setQueryData<Me>(qk.me, (old) => (old ? { ...old, user: { ...old.user, mfa_enabled: false } } : old));
      toast.success("Two-step verification turned off");
      onOpenChange(false);
    } catch (err) {
      setError(applyApiErrors(form, err));
    }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <span className="mb-2 grid size-11 place-items-center rounded-2xl bg-rose-100 text-rose-600">
            <ShieldOff className="size-5" aria-hidden />
          </span>
          <DialogTitle>Turn off two-step verification?</DialogTitle>
          <DialogDescription>Your account will be protected by your password only.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <FormField label="Password" error={form.formState.errors.password?.message} required>
            <PasswordInput autoComplete="current-password" {...form.register("password")} />
          </FormField>
          <FormField label="Authenticator code" error={form.formState.errors.code?.message} required>
            <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="font-mono tracking-[0.4em]" {...form.register("code")} />
          </FormField>
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" loading={form.formState.isSubmitting}>
              Turn off
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MfaCard() {
  const { user, me } = useAuth();
  const [setupOpen, setSetupOpen] = React.useState(false);
  const [disableOpen, setDisableOpen] = React.useState(false);
  const enabled = !!user?.mfa_enabled;
  return (
    <Card className={cn("overflow-hidden", enabled ? "" : "ring-1 ring-amber-200")}>
      <div className={cn("h-1.5", enabled ? "bg-gradient-to-r from-emerald-400 to-teal-500" : "bg-gradient-to-r from-amber-400 to-orange-500")} aria-hidden />
      <CardHeader>
        <div className="flex items-center gap-3">
          <span className={cn("grid size-10 place-items-center rounded-xl", enabled ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600")}>
            <ShieldCheck className="size-5" aria-hidden />
          </span>
          <div>
            <CardTitle as="h2" className="flex items-center gap-2">
              Two-step verification
              <Badge tone={enabled ? "success" : "warning"} size="sm" dot>
                {enabled ? "On" : "Off"}
              </Badge>
            </CardTitle>
            <CardDescription>
              {enabled ? "You'll enter a code from your authenticator app when signing in." : "Add a second step at sign-in using an authenticator app."}
            </CardDescription>
          </div>
        </div>
        {enabled ? (
          <Button variant="destructive-soft" onClick={() => setDisableOpen(true)} disabled={me?.settings.require_mfa}>
            Turn off
          </Button>
        ) : (
          <Button variant="gradient" onClick={() => setSetupOpen(true)}>
            Set up
          </Button>
        )}
      </CardHeader>
      {enabled && me?.settings.require_mfa && (
        <CardContent>
          <p className="text-sm text-slate-600">Your organisation requires two-step verification, so it can&apos;t be turned off.</p>
        </CardContent>
      )}
      <MfaSetupDialog open={setupOpen} onOpenChange={setSetupOpen} />
      <MfaDisableDialog open={disableOpen} onOpenChange={setDisableOpen} />
    </Card>
  );
}

/* ------------------------------------------------------------------ sessions */

function parseUA(ua: string | null) {
  const s = ua ?? "";
  const browser = /Edg\//.test(s) ? "Edge" : /OPR\//.test(s) ? "Opera" : /Chrome\//.test(s) ? "Chrome" : /Firefox\//.test(s) ? "Firefox" : /Safari\//.test(s) ? "Safari" : s ? "Browser" : "Unknown client";
  const os = /Windows/.test(s) ? "Windows" : /iPhone/.test(s) ? "iPhone" : /iPad/.test(s) ? "iPad" : /Android/.test(s) ? "Android" : /Mac OS/.test(s) ? "macOS" : /Linux/.test(s) ? "Linux" : "";
  const kind = /iPhone|Android.*Mobile/.test(s) ? "phone" : /iPad|Tablet/.test(s) ? "tablet" : "desktop";
  return { browser, os, kind };
}

function SessionsCard() {
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: qk.sessions, queryFn: () => api.get<AuthSession[]>("/auth/sessions") });
  const [revoke, setRevoke] = React.useState<AuthSession | null>(null);
  const [revokeOthers, setRevokeOthers] = React.useState(false);
  const now = Date.now();
  const active = (sessions.data ?? []).filter((s) => !s.revoked_at && new Date(s.expires_at).getTime() > now);
  const others = active.filter((s) => !s.current).length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-violet-50 text-violet-600">
            <LaptopMinimal className="size-5" aria-hidden />
          </span>
          <div>
            <CardTitle as="h2">Sessions & devices</CardTitle>
            <CardDescription>Where you&apos;re signed in. Revoke anything you don&apos;t recognise.</CardDescription>
          </div>
        </div>
        {others > 0 && (
          <Button variant="secondary" size="sm" leftIcon={<LogOut />} onClick={() => setRevokeOthers(true)}>
            Sign out other devices
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {sessions.isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : sessions.isError ? (
          <ErrorState error={sessions.error} onRetry={() => sessions.refetch()} size="sm" />
        ) : (
          <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200">
            {active.map((s) => {
              const ua = parseUA(s.user_agent);
              const Icon = ua.kind === "phone" ? Smartphone : ua.kind === "tablet" ? Tablet : LaptopMinimal;
              return (
                <li key={s.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                  <span className={cn("grid size-11 shrink-0 place-items-center rounded-xl", s.current ? "bg-brand-gradient text-white shadow-glow" : "bg-slate-100 text-slate-600")}>
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                      {s.device_label || `${ua.browser}${ua.os ? ` on ${ua.os}` : ""}`}
                      {s.current && (
                        <Badge tone="success" size="sm" dot>
                          This device
                        </Badge>
                      )}
                      {s.mfa_verified && (
                        <Badge tone="violet" size="sm">
                          MFA
                        </Badge>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {s.ip_address ?? "Unknown IP"} · {s.auth_method} · Signed in {formatDateTime(s.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 sm:text-right">
                    <span className="text-xs text-slate-500">Active {formatRelative(s.last_used_at ?? s.created_at)}</span>
                    {!s.current && (
                      <Button variant="destructive-soft" size="sm" onClick={() => setRevoke(s)}>
                        Revoke
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
      <ConfirmDialog
        open={!!revoke}
        onOpenChange={(o) => !o && setRevoke(null)}
        destructive
        title="Revoke this session?"
        description="That device will be signed out immediately."
        confirmLabel="Revoke session"
        onConfirm={async () => {
          try {
            await api.delete(`/auth/sessions/${revoke!.id}`);
            toast.success("Session revoked");
            qc.invalidateQueries({ queryKey: qk.sessions });
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
      <ConfirmDialog
        open={revokeOthers}
        onOpenChange={setRevokeOthers}
        destructive
        title="Sign out all other devices?"
        description={`${others} other session${others === 1 ? "" : "s"} will be signed out. You'll stay signed in here.`}
        confirmLabel="Sign out others"
        onConfirm={async () => {
          try {
            await api.post("/auth/sessions/revoke-others");
            toast.success("Other devices signed out");
            qc.invalidateQueries({ queryKey: qk.sessions });
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </Card>
  );
}

export default function SecurityPage() {
  return (
    <>
      <ProfileHeader title="Security & sign-in" description="Manage your password, two-step verification and signed-in devices." />
      <div className="mx-auto max-w-4xl space-y-6">
        <MfaCard />
        <PasswordCard />
        <SessionsCard />
      </div>
    </>
  );
}
