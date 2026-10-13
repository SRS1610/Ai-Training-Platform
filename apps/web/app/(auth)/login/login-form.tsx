"use client";

import type { LoginOut, SSODiscoverOut } from "@praxis/types";
import { Alert, Button, FormField, Input, toast } from "@praxis/ui";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Building2, KeyRound, Mail, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { z } from "zod";
import { AuthHeading, safeNext } from "@/components/auth/auth-heading";
import { OtpInput } from "@/components/auth/otp-input";
import { PasswordInput } from "@/components/auth/password-input";
import { ProviderButtons, startOAuth } from "@/components/auth/provider-buttons";
import { applyApiErrors, useZodForm } from "@/components/forms/form";
import { api, ApiError, errorMessage } from "@/lib/api";
import { clearActiveOrgId } from "@/lib/org";

const schema = z.object({
  email: z.string().trim().min(1, "Enter your email").email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

function deviceLabel() {
  if (typeof navigator === "undefined") return undefined;
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
  return `${browser}${os ? ` on ${os}` : ""}`;
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const next = safeNext(params.get("next"));
  const form = useZodForm(schema, { defaultValues: { email: params.get("email") ?? "", password: "" } });
  const [formError, setFormError] = React.useState<string | null>(null);
  const [mfaToken, setMfaToken] = React.useState<string | null>(null);
  const [sso, setSso] = React.useState<SSODiscoverOut | null>(null);
  const email = form.watch("email");
  // Until React has hydrated, the form has no JS submit handler — keep submit disabled so a fast
  // Enter/click can never fall through to a native submission (method="post" is a second guard).
  const [hydrated, setHydrated] = React.useState(false);
  React.useEffect(() => setHydrated(true), []);

  // SSO discovery as the user types their email (debounced).
  React.useEffect(() => {
    const value = email?.trim();
    if (!value || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
      setSso(null);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api
        .get<SSODiscoverOut>("/auth/sso/discover", { query: { email: value }, signal: ctrl.signal, redirectOn401: false, noOrg: true })
        .then((r) => setSso(r.sso_available ? r : null))
        .catch(() => setSso(null));
    }, 400);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [email]);

  const done = () => {
    clearActiveOrgId();
    qc.clear();
    router.replace(next);
    router.refresh();
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const res = await api.post<LoginOut>(
        "/auth/login",
        { email: values.email, password: values.password, device_label: deviceLabel() },
        { redirectOn401: false, noOrg: true },
      );
      if (res.mfa_required && res.mfa_token) {
        setMfaToken(res.mfa_token);
        return;
      }
      done();
    } catch (err) {
      if (err instanceof ApiError && err.code === "sso_required") {
        setFormError("Your organisation requires single sign-on. Use “Continue with SSO” below.");
        return;
      }
      setFormError(
        err instanceof ApiError && err.status === 401 ? "That email and password don't match our records." : applyApiErrors(form, err),
      );
    }
  });

  if (mfaToken) return <MfaStep mfaToken={mfaToken} onBack={() => setMfaToken(null)} onDone={done} />;

  const notice = params.get("signed_out")
    ? { tone: "success" as const, text: "You've been signed out. See you soon!" }
    : params.get("reset")
      ? { tone: "success" as const, text: "Password updated. Sign in with your new password." }
      : params.get("expired")
        ? { tone: "warning" as const, text: "Your session expired. Please sign in again." }
        : null;
  const ssoOnly = !!sso?.enforce_sso;

  return (
    <>
      <AuthHeading title="Welcome back" description="Sign in to continue your learning journey." />
      {notice && (
        <Alert tone={notice.tone} className="mb-6">
          {notice.text}
        </Alert>
      )}
      <ProviderButtons returnTo={next} />
      <form method="post" onSubmit={onSubmit} noValidate className="space-y-5" aria-describedby={formError ? "login-error" : undefined}>
        {formError && (
          <Alert tone="danger" id="login-error">
            {formError}
          </Alert>
        )}
        <FormField label="Work email" error={form.formState.errors.email?.message} required>
          <Input type="email" autoComplete="username" leftIcon={<Mail />} placeholder="you@company.com" autoFocus {...form.register("email")} />
        </FormField>

        {sso && (
          <div className="rounded-2xl border border-brand-200 bg-brand-50/70 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-brand-900">
              <Building2 className="size-4" aria-hidden /> {sso.name ?? "Your organisation"} uses single sign-on
            </p>
            <Button
              variant="gradient"
              block
              className="mt-3"
              onClick={() => startOAuth(`sso-${sso.connection_id}`, next).catch((e) => toast.error(errorMessage(e)))}
            >
              Continue with SSO
            </Button>
          </div>
        )}

        {!ssoOnly && (
          <>
            <FormField
              label="Password"
              error={form.formState.errors.password?.message}
              required
              labelAction={
                <Link href="/forgot-password" className="text-sm font-medium text-brand-700 hover:underline">
                  Forgot password?
                </Link>
              }
            >
              <PasswordInput autoComplete="current-password" placeholder="••••••••••" {...form.register("password")} />
            </FormField>
            <Button type="submit" variant="gradient" size="lg" block loading={form.formState.isSubmitting} disabled={!hydrated}>
              Sign in
            </Button>
          </>
        )}
      </form>
      <p className="mt-8 text-center text-sm text-slate-600">
        New to Praxis?{" "}
        <Link href={`/register${next !== "/app/dashboard" ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-semibold text-brand-700 hover:underline">
          Create a free account
        </Link>
      </p>
    </>
  );
}

function MfaStep({ mfaToken, onBack, onDone }: { mfaToken: string; onBack: () => void; onDone: () => void }) {
  const [code, setCode] = React.useState("");
  const [recovery, setRecovery] = React.useState("");
  const [useRecovery, setUseRecovery] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const submit = async (c?: string) => {
    const otp = c ?? code;
    if (!useRecovery && otp.length !== 6) return setError("Enter the 6-digit code from your authenticator app.");
    if (useRecovery && !recovery.trim()) return setError("Enter one of your recovery codes.");
    setBusy(true);
    setError(null);
    try {
      await api.post(
        "/auth/mfa/verify",
        useRecovery ? { mfa_token: mfaToken, recovery_code: recovery.trim() } : { mfa_token: mfaToken, code: otp },
        { redirectOn401: false, noOrg: true },
      );
      onDone();
    } catch (err) {
      setError(err instanceof ApiError && (err.status === 400 || err.status === 401) ? "That code didn't work. Check it and try again." : errorMessage(err));
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" onClick={onBack} className="mb-6 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-slate-600 hover:text-slate-900 focus-visible:focus-ring">
        <ArrowLeft className="size-4" aria-hidden /> Back
      </button>
      <AuthHeading
        icon={useRecovery ? <KeyRound /> : <ShieldCheck />}
        title="Two-step verification"
        description={useRecovery ? "Enter one of the recovery codes you saved when you set up MFA." : "Enter the 6-digit code from your authenticator app."}
      />
      <form
        method="post"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="space-y-5"
        noValidate
      >
        {error && (
          <Alert tone="danger" id="mfa-error">
            {error}
          </Alert>
        )}
        {useRecovery ? (
          <FormField label="Recovery code">
            <Input value={recovery} onChange={(e) => setRecovery(e.target.value)} autoComplete="one-time-code" placeholder="xxxx-xxxx" autoFocus className="font-mono tracking-wider" />
          </FormField>
        ) : (
          <OtpInput value={code} onChange={setCode} onComplete={(c) => submit(c)} disabled={busy} invalid={!!error} autoFocus aria-describedby={error ? "mfa-error" : undefined} />
        )}
        <Button type="submit" variant="gradient" size="lg" block loading={busy}>
          Verify and sign in
        </Button>
        <button
          type="button"
          className="w-full rounded-lg text-center text-sm font-medium text-brand-700 hover:underline focus-visible:focus-ring"
          onClick={() => {
            setUseRecovery((u) => !u);
            setError(null);
          }}
        >
          {useRecovery ? "Use authenticator code instead" : "Use a recovery code instead"}
        </button>
      </form>
    </>
  );
}
