"use client";

import type { InvitationAcceptOut, InvitationLookup, Me } from "@praxis/types";
import { Alert, Avatar, Button, EmptyState, FormField, Input, Skeleton, humanize } from "@praxis/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, User } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { z } from "zod";
import { PasswordInput, PasswordStrength } from "@/components/auth/password-input";
import { applyApiErrors, useZodForm } from "@/components/forms/form";
import { api, ApiError, errorMessage, readCookie } from "@/lib/api";
import { setActiveOrgId } from "@/lib/org";
import { qk } from "@/lib/query-keys";

const schema = z.object({
  full_name: z.string().trim().min(1, "Enter your name").max(200),
  password: z.string().min(10, "Use at least 10 characters").max(256),
});

export function AcceptInvite() {
  const token = useSearchParams().get("token") ?? "";
  const router = useRouter();
  const qc = useQueryClient();
  const [error, setError] = React.useState<string | null>(null);
  const [joining, setJoining] = React.useState(false);
  const lookup = useQuery({
    queryKey: qk.invitation(token),
    queryFn: () => api.get<InvitationLookup>("/invitations/lookup", { query: { token }, redirectOn401: false, noOrg: true }),
    enabled: !!token,
    retry: false,
  });
  const form = useZodForm(schema, { defaultValues: { full_name: "", password: "" } });
  const pw = form.watch("password") ?? "";

  const finish = async () => {
    // Accepting may or may not sign the user in; check and route accordingly.
    try {
      const me = await api.get<Me>("/me", { redirectOn401: false, noOrg: true });
      const orgId = lookup.data?.organisation_id;
      if (orgId && me.organisations.some((o) => o.id === orgId)) setActiveOrgId(orgId);
      qc.clear();
      router.replace("/app/dashboard?welcome=1");
    } catch {
      router.replace(`/login?next=${encodeURIComponent("/app/dashboard")}&email=${encodeURIComponent(lookup.data?.email ?? "")}`);
    }
  };

  const accept = async (body: Record<string, unknown>) => {
    setError(null);
    setJoining(true);
    try {
      await api.post<InvitationAcceptOut>("/invitations/accept", { token, accept_terms: true, ...body }, { redirectOn401: false, noOrg: true });
      await finish();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push(`/login?email=${encodeURIComponent(lookup.data?.email ?? "")}&next=${encodeURIComponent(`/accept-invite?token=${encodeURIComponent(token)}`)}`);
        return;
      }
      setError(err instanceof ApiError && err.status === 404 ? "This invitation is no longer valid." : applyApiErrors(form, err));
      setJoining(false);
    }
  };

  if (!token)
    return <EmptyState illustration="error" title="Missing invitation token" description="Open the link from your invitation email again." />;

  if (lookup.isLoading)
    return (
      <div className="space-y-4" aria-busy>
        <Skeleton className="h-14 w-14 rounded-2xl" />
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    );

  if (lookup.isError) {
    const err = lookup.error;
    // A bare FastAPI 404 ("Not Found") means the invitations module isn't deployed yet.
    const notReady =
      err instanceof ApiError && (err.isNetwork || err.status >= 500 || err.status === 405 || (err.status === 404 && err.message === "Not Found"));
    return (
      <EmptyState
        illustration="error"
        size="lg"
        title={notReady ? "Invitations are temporarily unavailable" : "This invitation can't be used"}
        description={
          notReady
            ? "Please try again in a few minutes."
            : err instanceof ApiError && (err.status === 404 || err.status === 410)
              ? "It may have expired, been revoked or already been accepted. Ask your administrator to send a new one."
              : errorMessage(err)
        }
        action={
          <Button asChild variant="gradient">
            <Link href="/login">Go to sign in</Link>
          </Button>
        }
      />
    );
  }

  const inv = lookup.data!;
  const signedIn = !!readCookie("praxis_csrf");
  const loginHref = `/login?email=${encodeURIComponent(inv.email)}&next=${encodeURIComponent(`/accept-invite?token=${encodeURIComponent(token)}`)}`;
  const orgName = inv.organisation_name || "your organisation";
  const role = inv.roles?.[0];

  return (
    <>
      <div className="mb-8">
        <Avatar name={orgName} src={inv.organisation_logo_url} size="xl" shape="rounded" className="mb-5 shadow-glow" />
        <h1 className="font-display text-3xl font-bold tracking-tight text-slate-900">Join {orgName}</h1>
        <p className="mt-2 text-slate-600">
          {inv.invited_by_name ? <>{inv.invited_by_name} invited you</> : <>You&apos;ve been invited</>} to train on Praxis
          {role ? (
            <>
              {" "}
              as <strong className="text-slate-900">{humanize(String(role))}</strong>
            </>
          ) : null}
          .
        </p>
      </div>
      {error && (
        <Alert tone="danger" className="mb-5">
          {error}
        </Alert>
      )}
      {inv.existing_account ? (
        <div className="space-y-4">
          <Alert tone="brand">
            You already have a Praxis account for <strong>{inv.email}</strong>.{" "}
            {signedIn ? <>Accept to add {orgName} to your organisations.</> : <>Sign in with that account to accept.</>}
          </Alert>
          {signedIn ? (
            <Button variant="gradient" size="lg" block loading={joining} onClick={() => accept({})}>
              Accept invitation
            </Button>
          ) : (
            <Button asChild variant="gradient" size="lg" block>
              <Link href={loginHref}>Sign in to accept</Link>
            </Button>
          )}
        </div>
      ) : (
        <form onSubmit={form.handleSubmit((v) => accept(v))} noValidate className="space-y-5">
          <FormField label="Email">
            <Input value={inv.email} readOnly disabled leftIcon={<Mail />} />
          </FormField>
          <FormField label="Full name" error={form.formState.errors.full_name?.message} required>
            <Input autoComplete="name" leftIcon={<User />} autoFocus {...form.register("full_name")} />
          </FormField>
          <FormField label="Create a password" error={form.formState.errors.password?.message} required>
            {(aria) => (
              <div className="space-y-2">
                <PasswordInput autoComplete="new-password" {...aria} {...form.register("password")} />
                <PasswordStrength password={pw} />
              </div>
            )}
          </FormField>
          <Button type="submit" variant="gradient" size="lg" block loading={joining}>
            Accept & join
          </Button>
          <p className="text-center text-xs text-slate-500">By joining you agree to the Terms of Service and Privacy Policy.</p>
        </form>
      )}
    </>
  );
}
