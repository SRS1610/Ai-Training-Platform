"use client";

import { Alert, Button, FormField, Input } from "@praxis/ui";
import { ArrowLeft, KeyRound, Mail, MailCheck } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { z } from "zod";
import { AuthHeading } from "@/components/auth/auth-heading";
import { applyApiErrors, useZodForm } from "@/components/forms/form";
import { api } from "@/lib/api";

const schema = z.object({ email: z.string().trim().min(1, "Enter your email").email("Enter a valid email address") });

export default function ForgotPasswordPage() {
  const form = useZodForm(schema, { defaultValues: { email: "" } });
  const [sentTo, setSentTo] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const onSubmit = form.handleSubmit(async ({ email }) => {
    setError(null);
    try {
      await api.post("/auth/password/forgot", { email }, { redirectOn401: false, noOrg: true });
      setSentTo(email);
    } catch (err) {
      setError(applyApiErrors(form, err));
    }
  });

  if (sentTo)
    return (
      <div className="text-center">
        <span className="mx-auto mb-6 grid size-16 place-items-center rounded-3xl bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-lg">
          <MailCheck className="size-8" aria-hidden />
        </span>
        <h1 className="font-display text-3xl font-bold tracking-tight text-slate-900">Check your inbox</h1>
        <p className="mt-3 text-slate-600" role="status">
          If an account exists for <strong className="text-slate-900">{sentTo}</strong>, we&apos;ve sent a link to reset your password. It expires in 30 minutes.
        </p>
        <Button asChild variant="secondary" size="lg" className="mt-8" leftIcon={<ArrowLeft />}>
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    );

  return (
    <>
      <AuthHeading icon={<KeyRound />} title="Forgot your password?" description="Enter your email and we'll send you a secure link to reset it." />
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        {error && <Alert tone="danger">{error}</Alert>}
        <FormField label="Email" error={form.formState.errors.email?.message} required>
          <Input type="email" autoComplete="email" leftIcon={<Mail />} placeholder="you@company.com" autoFocus {...form.register("email")} />
        </FormField>
        <Button type="submit" variant="gradient" size="lg" block loading={form.formState.isSubmitting}>
          Send reset link
        </Button>
      </form>
      <p className="mt-8 text-center text-sm">
        <Link href="/login" className="inline-flex items-center gap-1.5 font-medium text-slate-600 hover:text-slate-900">
          <ArrowLeft className="size-4" aria-hidden /> Back to sign in
        </Link>
      </p>
    </>
  );
}
