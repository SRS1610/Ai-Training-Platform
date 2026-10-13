"use client";

import type { TokenOut } from "@praxis/types";
import { Alert, Button, Checkbox, FormField, Input, Label, RadioCard, RadioGroup } from "@praxis/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, Mail, User, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { Controller } from "react-hook-form";
import { z } from "zod";
import { AuthHeading, safeNext } from "@/components/auth/auth-heading";
import { PasswordInput, PasswordStrength, passwordScore } from "@/components/auth/password-input";
import { ProviderButtons } from "@/components/auth/provider-buttons";
import { applyApiErrors, useZodForm } from "@/components/forms/form";
import { api } from "@/lib/api";
import { clearActiveOrgId } from "@/lib/org";

const schema = z
  .object({
    account_type: z.enum(["individual", "organisation"]),
    full_name: z.string().trim().min(1, "Enter your name").max(200),
    email: z.string().trim().min(1, "Enter your email").email("Enter a valid email address"),
    organisation_name: z.string().trim().max(200).optional(),
    password: z
      .string()
      .min(10, "Use at least 10 characters")
      .max(256)
      .refine((p) => new Set(p).size >= 5, "Use more varied characters"),
    accept_terms: z.boolean().refine((v) => v, "You need to accept the terms to continue"),
    marketing_opt_in: z.boolean(),
  })
  .refine((v) => v.account_type === "individual" || (v.organisation_name ?? "").length > 0, {
    path: ["organisation_name"],
    message: "Enter your organisation's name",
  });

export function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const next = safeNext(params.get("next"), "/app/dashboard?welcome=1");
  const [formError, setFormError] = React.useState<string | null>(null);
  const form = useZodForm(schema, {
    defaultValues: {
      account_type: params.get("type") === "organisation" || params.get("plan") === "business" ? "organisation" : "individual",
      full_name: "",
      email: params.get("email") ?? "",
      organisation_name: "",
      password: "",
      accept_terms: false,
      marketing_opt_in: false,
    },
  });
  const type = form.watch("account_type");
  const password = form.watch("password") ?? "";
  const e = form.formState.errors;

  const onSubmit = form.handleSubmit(async (v) => {
    setFormError(null);
    if (passwordScore(v.password).issues.includes("Avoid common words")) {
      form.setError("password", { message: "That password is too common — try a short phrase instead." });
      return;
    }
    try {
      await api.post<TokenOut>(
        "/auth/register",
        {
          email: v.email,
          password: v.password,
          full_name: v.full_name,
          organisation_name: v.account_type === "organisation" ? v.organisation_name : null,
          accept_terms: v.accept_terms,
          marketing_opt_in: v.marketing_opt_in,
        },
        { redirectOn401: false, noOrg: true },
      );
      clearActiveOrgId();
      qc.clear();
      router.replace(next);
      router.refresh();
    } catch (err) {
      setFormError(applyApiErrors(form, err));
    }
  });

  return (
    <>
      <AuthHeading title="Create your account" description="Start free — no credit card required." />
      <ProviderButtons returnTo={next} label="Sign up" />
      <form method="post" onSubmit={onSubmit} noValidate className="space-y-5">
        {formError && <Alert tone="danger">{formError}</Alert>}
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-slate-800">I&apos;m signing up as</legend>
          <Controller
            control={form.control}
            name="account_type"
            render={({ field }) => (
              <RadioGroup value={field.value} onValueChange={field.onChange} className="grid-cols-2 gap-3">
                <RadioCard value="individual" icon={<UserRound />} title="Individual" description="Learn for yourself" />
                <RadioCard value="organisation" icon={<Building2 />} title="Organisation" description="Train a team" />
              </RadioGroup>
            )}
          />
        </fieldset>

        <FormField label="Full name" error={e.full_name?.message} required>
          <Input autoComplete="name" leftIcon={<User />} placeholder="Alex Morgan" {...form.register("full_name")} />
        </FormField>
        <FormField label={type === "organisation" ? "Work email" : "Email"} error={e.email?.message} required>
          <Input type="email" autoComplete="email" leftIcon={<Mail />} placeholder="you@company.com" {...form.register("email")} />
        </FormField>
        {type === "organisation" && (
          <FormField label="Organisation name" error={e.organisation_name?.message} required hint="You can invite colleagues after signing up.">
            <Input autoComplete="organization" leftIcon={<Building2 />} placeholder="Acme Health" {...form.register("organisation_name")} />
          </FormField>
        )}
        <FormField label="Password" error={e.password?.message} required>
          {(aria) => (
            <div className="space-y-2">
              <PasswordInput autoComplete="new-password" placeholder="At least 10 characters" {...aria} {...form.register("password")} />
              <PasswordStrength password={password} />
            </div>
          )}
        </FormField>

        <div className="space-y-3">
          <Controller
            control={form.control}
            name="accept_terms"
            render={({ field }) => (
              <div>
                <div className="flex items-start gap-2.5">
                  <Checkbox
                    id="accept_terms"
                    checked={field.value}
                    onCheckedChange={(v) => field.onChange(!!v)}
                    aria-invalid={!!e.accept_terms || undefined}
                    aria-describedby={e.accept_terms ? "terms-error" : undefined}
                    className="mt-0.5"
                  />
                  <Label htmlFor="accept_terms" className="font-normal leading-snug text-slate-600">
                    I agree to the{" "}
                    <a href="/terms" className="font-medium text-brand-700 underline-offset-2 hover:underline">
                      Terms of Service
                    </a>{" "}
                    and{" "}
                    <a href="/privacy" className="font-medium text-brand-700 underline-offset-2 hover:underline">
                      Privacy Policy
                    </a>
                  </Label>
                </div>
                {e.accept_terms && (
                  <p id="terms-error" role="alert" className="mt-1.5 text-xs font-medium text-rose-700">
                    {e.accept_terms.message}
                  </p>
                )}
              </div>
            )}
          />
          <Controller
            control={form.control}
            name="marketing_opt_in"
            render={({ field }) => (
              <div className="flex items-start gap-2.5">
                <Checkbox id="marketing" checked={field.value} onCheckedChange={(v) => field.onChange(!!v)} className="mt-0.5" />
                <Label htmlFor="marketing" className="font-normal leading-snug text-slate-600">
                  Send me product tips and updates (optional)
                </Label>
              </div>
            )}
          />
        </div>

        <Button type="submit" variant="gradient" size="lg" block loading={form.formState.isSubmitting}>
          Create account
        </Button>
      </form>
      <p className="mt-8 text-center text-sm text-slate-600">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-brand-700 hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
