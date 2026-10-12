"use client";

import { Button, EmptyState, Spinner, toast } from "@praxis/ui";
import { useMutation } from "@tanstack/react-query";
import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as React from "react";
import { api, errorMessage, readCookie } from "@/lib/api";

export function VerifyEmail() {
  const token = useSearchParams().get("token");
  const verify = useMutation({
    mutationFn: (t: string) => api.post<{ verified: boolean; email: string }>("/auth/email/verify", { token: t }, { redirectOn401: false, noOrg: true }),
  });
  const resend = useMutation({
    mutationFn: () => api.post("/auth/email/resend", undefined, { redirectOn401: false }),
    onSuccess: () => toast.success("Verification email sent"),
    onError: (e) => toast.error(e instanceof Error && /401|unauthor/i.test(e.message) ? "Sign in first to resend the email." : errorMessage(e)),
  });
  const started = React.useRef(false);
  React.useEffect(() => {
    if (token && !started.current) {
      started.current = true;
      verify.mutate(token);
    }
  }, [token, verify]);

  const signedIn = typeof document !== "undefined" && !!readCookie("praxis_csrf");

  if (!token)
    return (
      <EmptyState
        illustration="inbox"
        size="lg"
        title="Verify your email"
        description="We sent a verification link to your inbox. Click it to confirm your address."
        action={
          signedIn ? (
            <Button variant="gradient" onClick={() => resend.mutate()} loading={resend.isPending}>
              Resend email
            </Button>
          ) : (
            <Button asChild variant="gradient">
              <Link href="/login">Sign in</Link>
            </Button>
          )
        }
      />
    );

  if (verify.isPending || verify.isIdle)
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <Spinner />
        <p className="text-slate-600">Verifying your email…</p>
      </div>
    );

  if (verify.isError)
    return (
      <EmptyState
        illustration="error"
        size="lg"
        title="This link is invalid or has expired"
        description={errorMessage(verify.error)}
        action={
          signedIn ? (
            <Button variant="gradient" onClick={() => resend.mutate()} loading={resend.isPending}>
              Send a new link
            </Button>
          ) : (
            <Button asChild variant="gradient">
              <Link href="/login">Sign in to resend</Link>
            </Button>
          )
        }
      />
    );

  return (
    <div className="text-center" role="status">
      <span className="mx-auto mb-6 grid size-16 place-items-center rounded-3xl bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-lg">
        <MailCheck className="size-8" aria-hidden />
      </span>
      <h1 className="font-display text-3xl font-bold tracking-tight text-slate-900">Email verified</h1>
      <p className="mt-3 text-slate-600">
        Thanks — <strong className="text-slate-900">{verify.data?.email}</strong> is confirmed.
      </p>
      <Button asChild variant="gradient" size="lg" className="mt-8">
        <Link href={signedIn ? "/app/dashboard" : "/login"}>{signedIn ? "Go to dashboard" : "Sign in"}</Link>
      </Button>
    </div>
  );
}
