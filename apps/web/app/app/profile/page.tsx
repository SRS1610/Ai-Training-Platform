"use client";

import type { Me, MeUpdate, User } from "@praxis/types";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  FormField,
  Input,
  SimpleSelect,
  humanize,
  toast,
} from "@praxis/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, CalendarDays, Globe, Mail, MailWarning, Target } from "lucide-react";
import * as React from "react";
import { Controller } from "react-hook-form";
import { z } from "zod";
import { applyApiErrors, useZodForm } from "@/components/forms/form";
import { ProfileHeader } from "@/components/profile/profile-nav";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatMinutes } from "@/lib/format";
import { qk } from "@/lib/query-keys";

const LOCALES = [
  { value: "en", label: "English" },
  { value: "en-GB", label: "English (UK)" },
  { value: "en-AU", label: "English (Australia)" },
  { value: "en-US", label: "English (US)" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "pt-BR", label: "Português (Brasil)" },
  { value: "ja", label: "日本語" },
  { value: "hi", label: "हिन्दी" },
];

const GOALS = [30, 60, 90, 120, 180, 240, 300].map((m) => ({ value: String(m), label: `${formatMinutes(m)} per week` }));

function timezones(current: string): string[] {
  let list: string[] = [];
  try {
    list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    list = [];
  }
  if (!list.length) list = ["UTC", "Europe/London", "America/New_York", "America/Los_Angeles", "Asia/Kolkata", "Australia/Sydney"];
  if (!list.includes("UTC")) list.unshift("UTC");
  if (current && !list.includes(current)) list.unshift(current);
  return list;
}

const schema = z.object({
  full_name: z.string().trim().min(1, "Enter your name").max(200),
  avatar_url: z.union([z.literal(""), z.string().trim().url("Enter a valid URL (https://…)").max(1024)]),
  locale: z.string().min(1),
  timezone: z.string().min(1),
  weekly_goal_minutes: z.string(),
});

export default function ProfilePage() {
  const { user, organisations, organisation } = useAuth();
  const qc = useQueryClient();
  const [formError, setFormError] = React.useState<string | null>(null);
  const tzList = React.useMemo(() => timezones(user?.timezone ?? "UTC").map((t) => ({ value: t, label: t.replace(/_/g, " ") })), [user?.timezone]);

  const form = useZodForm(schema, {
    values: user
      ? {
          full_name: user.full_name,
          avatar_url: user.avatar_url ?? "",
          locale: user.locale || "en",
          timezone: user.timezone || "UTC",
          weekly_goal_minutes: String((user.preferences as { weekly_goal_minutes?: number })?.weekly_goal_minutes ?? 120),
        }
      : undefined,
  });

  const save = useMutation({
    mutationFn: (body: MeUpdate) => api.patch<User>("/me", body),
    onSuccess: (u) => {
      qc.setQueryData<Me>(qk.me, (old) => (old ? { ...old, user: { ...old.user, ...u } } : old));
      toast.success("Profile saved");
    },
  });

  if (!user) return null;
  const name = form.watch("full_name");
  const avatar = form.watch("avatar_url");

  const onSubmit = form.handleSubmit(async (v) => {
    setFormError(null);
    try {
      await save.mutateAsync({
        full_name: v.full_name,
        avatar_url: v.avatar_url || null,
        locale: v.locale,
        timezone: v.timezone,
        preferences: { weekly_goal_minutes: Number(v.weekly_goal_minutes) },
      });
      form.reset(v);
    } catch (err) {
      setFormError(applyApiErrors(form, err));
    }
  });

  const detectTz = () => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) form.setValue("timezone", tz, { shouldDirty: true });
  };

  return (
    <>
      <ProfileHeader title="Your profile" description="How you appear across Praxis, plus language and time settings." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <form onSubmit={onSubmit} noValidate>
          <Card>
            <CardHeader>
              <div>
                <CardTitle as="h2">Personal details</CardTitle>
                <CardDescription>Your name appears on certificates and in your organisation.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {formError && <Alert tone="danger">{formError}</Alert>}
              <div className="flex items-center gap-4">
                <Avatar name={name || user.full_name} src={avatar || null} size="xl" />
                <div className="min-w-0 flex-1">
                  <FormField label="Avatar image URL" error={form.formState.errors.avatar_url?.message} hint="Optional. Leave blank to use your initials.">
                    <Input placeholder="https://…" inputMode="url" {...form.register("avatar_url")} />
                  </FormField>
                </div>
              </div>
              <FormField label="Full name" error={form.formState.errors.full_name?.message} required>
                <Input autoComplete="name" {...form.register("full_name")} />
              </FormField>
              <FormField label="Email" hint="Contact your administrator to change your sign-in email.">
                <Input value={user.email} readOnly disabled leftIcon={<Mail />} />
              </FormField>
              <div className="grid gap-5 sm:grid-cols-2">
                <Controller
                  control={form.control}
                  name="locale"
                  render={({ field }) => (
                    <FormField label="Language">
                      {(aria) => <SimpleSelect {...aria} value={field.value} onValueChange={field.onChange} options={LOCALES} />}
                    </FormField>
                  )}
                />
                <Controller
                  control={form.control}
                  name="timezone"
                  render={({ field }) => (
                    <FormField
                      label="Time zone"
                      labelAction={
                        <button type="button" onClick={detectTz} className="text-xs font-semibold text-brand-700 hover:underline">
                          Detect
                        </button>
                      }
                    >
                      {(aria) => <SimpleSelect {...aria} value={field.value} onValueChange={field.onChange} options={tzList} />}
                    </FormField>
                  )}
                />
              </div>
              <Controller
                control={form.control}
                name="weekly_goal_minutes"
                render={({ field }) => (
                  <FormField label="Weekly learning goal" hint="Shown as the progress ring on your dashboard.">
                    {(aria) => <SimpleSelect {...aria} value={field.value} onValueChange={field.onChange} options={GOALS} />}
                  </FormField>
                )}
              />
            </CardContent>
            <CardFooter className="justify-end">
              <Button variant="ghost" disabled={!form.formState.isDirty || form.formState.isSubmitting} onClick={() => form.reset()}>
                Discard
              </Button>
              <Button type="submit" variant="gradient" loading={form.formState.isSubmitting} disabled={!form.formState.isDirty}>
                Save changes
              </Button>
            </CardFooter>
          </Card>
        </form>

        <div className="space-y-6">
          <Card className="overflow-hidden">
            <div className="h-20 bg-brand-gradient" aria-hidden />
            <CardContent className="-mt-10 pt-0">
              <Avatar name={user.full_name} src={user.avatar_url} size="xl" className="ring-4" />
              <p className="mt-3 font-display text-lg font-semibold text-slate-900">{user.full_name}</p>
              <p className="text-sm text-slate-500">{user.email}</p>
              <ul className="mt-4 space-y-2.5 text-sm">
                <li className="flex items-center gap-2.5 text-slate-700">
                  {user.email_verified ? <BadgeCheck className="size-4 text-emerald-600" aria-hidden /> : <MailWarning className="size-4 text-amber-600" aria-hidden />}
                  {user.email_verified ? "Email verified" : "Email not verified"}
                </li>
                <li className="flex items-center gap-2.5 text-slate-700">
                  <CalendarDays className="size-4 text-sky-600" aria-hidden /> Member since {formatDate(user.created_at, { month: "long", year: "numeric" })}
                </li>
                <li className="flex items-center gap-2.5 text-slate-700">
                  <Globe className="size-4 text-violet-600" aria-hidden /> {user.timezone}
                </li>
                <li className="flex items-center gap-2.5 text-slate-700">
                  <Target className="size-4 text-fuchsia-600" aria-hidden /> Goal: {(user.preferences as { weekly_goal_minutes?: number })?.weekly_goal_minutes ?? 120} min / week
                </li>
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle as="h2">Organisations</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {organisations.map((o) => (
                  <li key={o.id} className="flex items-center gap-3">
                    <Avatar name={o.name} src={o.logo_url} size="sm" shape="rounded" className="ring-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {o.name}
                        {o.id === organisation?.id && (
                          <Badge tone="brand" size="sm" className="ml-2 align-middle">
                            Active
                          </Badge>
                        )}
                      </p>
                      <p className="truncate text-xs text-slate-500">{o.roles.map((r) => humanize(String(r))).join(", ")}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
