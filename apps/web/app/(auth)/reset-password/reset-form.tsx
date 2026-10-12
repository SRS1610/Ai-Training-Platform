"use client";

import { Alert, Button, EmptyState, FormField } from "@praxis/ui";
import { LockKeyhole } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { z } from "zod";
import { AuthHeading } from "@/components/auth/auth-heading";
import { PasswordInput, PasswordStrength } from "@/components/auth/password-input";
import { applyApiErrors, useZodForm } from "@/components/forms/form";
import { api } from "@/lib/api";

const schema = z
  .object({
    password: z.string().min(10, "Use at least 10 characters").max(256),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords don't match" });

export function ResetPasswordForm() {
  const token = useSearchParams().get("token");
  const router = useRouter();
  const form = useZodForm(schema, { defaultValues: { password: "", confirm: "" } });
  const [error, setError] = React.useState<string | null>(null);
  const pw = form.watch("password") ?? "";

  if (!token)
    return (
      <EmptyState
        illustration="error"
        title="This reset link is incomplete"
        description="Open the link from your email again, or request a new one."
        action={
          <Button asChild variant="gradient">
            <Link href="/forgot-password">Request a new link</Link>
          </Button>
        }
      />
    );

  const onSubmit = form.handleSubmit(async ({ password }) => {
    setError(null);
    try {
      await api.post("/auth/password/reset", { token, password }, { redirectOn401: false, noOrg: true });
      router.replace("/login?reset=1");
    } catch (err) {
      setError(applyApiErrors(form, err));
    }
  });

  return (
    <>
      <AuthHeading icon={<LockKeyhole />} title="Choose a new password" description="For your security, all other sessions will be signed out." />
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        {error && (
          <Alert tone="danger" action={<Link href="/forgot-password" className="text-sm font-semibold underline">New link</Link>}>
            {error}
          </Alert>
        )}
        <FormField label="New password" error={form.formState.errors.password?.message} required>
          {(aria) => (
            <div className="space-y-2">
              <PasswordInput autoComplete="new-password" autoFocus {...aria} {...form.register("password")} />
              <PasswordStrength password={pw} />
            </div>
          )}
        </FormField>
        <FormField label="Confirm new password" error={form.formState.errors.confirm?.message} required>
          <PasswordInput autoComplete="new-password" {...form.register("confirm")} />
        </FormField>
        <Button type="submit" variant="gradient" size="lg" block loading={form.formState.isSubmitting}>
          Update password
        </Button>
      </form>
    </>
  );
}
