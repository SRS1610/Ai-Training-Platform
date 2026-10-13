"use client";

import type { Me, User } from "@praxis/types";
import { Button, Card, Progress, Skeleton, cn, colorClasses, toast, type CategoryColor } from "@praxis/ui";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, BookOpenCheck, Building2, CheckCircle2, CreditCard, GraduationCap, MailPlus, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { qk } from "@/lib/query-keys";

/** User preference key that hides the checklist (PATCH /me merges preferences server-side). */
export const ORG_SETUP_DISMISSED = "org_setup_dismissed";

type Total = { total: number };

interface Step {
  key: string;
  title: string;
  body: string;
  done: boolean | null; // null = unknown (no permission / not deployed) — shown as a to-do
  href: string;
  cta: string;
  icon: LucideIcon;
  color: CategoryColor;
  secondary?: { href: string; label: string };
}

/** Whether the org-admin setup checklist should render for the current user. */
export function useShowOrgSetup(): boolean {
  const { can, user } = useAuth();
  const dismissed = Boolean((user?.preferences as Record<string, unknown> | undefined)?.[ORG_SETUP_DISMISSED]);
  return can("organisation.manage") && !dismissed;
}

/**
 * "Set up your organisation" for org admins: each step checks itself off from real data (departments, members and
 * pending invitations, courses, enrolments, plan) and links to the page that completes it. Dismissal is stored in the
 * user's preferences so it follows them across devices.
 */
export function OrgSetupChecklist() {
  const { organisation, can } = useAuth();
  const qc = useQueryClient();
  const opts = { retry: false, staleTime: 60_000 } as const;
  const [departments, members, invites, courses, enrolments] = useQueries({
    queries: [
      { ...opts, queryKey: ["departments", "setup-count"], queryFn: ({ signal }) => api.get<unknown[]>("/departments", { signal }), enabled: can("users.view") },
      { ...opts, queryKey: ["users", "setup-count"], queryFn: ({ signal }) => api.get<Total>("/users", { signal, query: { page_size: 1 } }), enabled: can("users.view") },
      {
        ...opts,
        queryKey: ["invitations", "setup-count"],
        queryFn: ({ signal }) => api.get<Total>("/invitations", { signal, query: { status: "pending", page_size: 1 } }),
        enabled: can("users.create"),
      },
      { ...opts, queryKey: ["courses", "setup-count"], queryFn: ({ signal }) => api.get<Total>("/courses", { signal, query: { page_size: 1 } }), enabled: can("courses.view") },
      { ...opts, queryKey: ["enrolments", "setup-count"], queryFn: ({ signal }) => api.get<Total>("/enrolments", { signal, query: { page_size: 1 } }), enabled: can("enrolments.manage") },
    ],
  });

  const dismiss = useMutation({
    mutationFn: () => api.patch<User>("/me", { preferences: { [ORG_SETUP_DISMISSED]: true } }),
    onSuccess: (u) => {
      qc.setQueryData<Me>(qk.me, (old) => (old ? { ...old, user: { ...old.user, ...u } } : old));
      toast.success("Setup checklist hidden", { description: "Everything on it stays available from the Manage menu." });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const count = (q: { data?: unknown; isSuccess: boolean }) => (q.isSuccess ? (Array.isArray(q.data) ? q.data.length : ((q.data as Total | undefined)?.total ?? 0)) : null);
  const deptCount = count(departments);
  const memberCount = count(members);
  const inviteCount = count(invites);
  const courseCount = count(courses);
  const enrolCount = count(enrolments);
  const plan = organisation?.plan_code ?? null;

  const steps: Step[] = [
    {
      key: "departments",
      title: "Create departments",
      body: deptCount ? `${deptCount} department${deptCount === 1 ? "" : "s"} set up` : "Mirror your structure so you can assign and report by team.",
      done: deptCount === null ? null : deptCount > 0,
      href: "/app/admin/departments",
      cta: "Add departments",
      icon: Building2,
      color: "sky",
    },
    {
      key: "people",
      title: "Invite people",
      body:
        memberCount !== null && memberCount > 1
          ? `${memberCount} members${inviteCount ? ` · ${inviteCount} invitation${inviteCount === 1 ? "" : "s"} pending` : ""}`
          : inviteCount
            ? `${inviteCount} invitation${inviteCount === 1 ? "" : "s"} pending`
            : "Bring in learners, instructors and assessors.",
      done: memberCount === null ? null : memberCount > 1 || (inviteCount ?? 0) > 0,
      href: "/app/admin/users?invite=1",
      cta: "Invite people",
      icon: MailPlus,
      color: "violet",
    },
    {
      key: "course",
      title: "Build or generate a course",
      body: courseCount ? `${courseCount} course${courseCount === 1 ? "" : "s"} in your library` : "Author one yourself or let AI draft it for you to review.",
      done: courseCount === null ? null : courseCount > 0,
      href: "/app/instructor/courses?new=1",
      cta: "Create a course",
      icon: GraduationCap,
      color: "fuchsia",
      secondary: { href: "/app/instructor/ai-builder", label: "Generate with AI" },
    },
    {
      key: "assign",
      title: "Assign training",
      body: enrolCount ? `${enrolCount} enrolment${enrolCount === 1 ? "" : "s"} so far` : "Enrol people, departments or teams in a published course.",
      done: enrolCount === null ? null : enrolCount > 0,
      href: "/app/admin/learning-paths?tab=assign",
      cta: "Assign training",
      icon: BookOpenCheck,
      color: "emerald",
    },
    {
      key: "plan",
      title: "Choose a plan",
      body: plan && plan !== "free" ? `You're on the ${plan.charAt(0).toUpperCase()}${plan.slice(1)} plan` : "Unlock AI generation, simulations and more seats.",
      done: plan === null ? null : plan !== "free",
      href: "/app/admin/billing",
      cta: "Compare plans",
      icon: CreditCard,
      color: "amber",
    },
  ];

  const loading = [departments, members, courses, enrolments].some((q) => q.isLoading && q.fetchStatus !== "idle");
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);
  // Established organisations that have done everything never see the card (no need to dismiss it).
  if (!loading && done === steps.length) return null;

  return (
    <Card className="overflow-hidden">
      <section aria-labelledby="org-setup-title" className="grid grid-cols-1 gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <div className="relative flex min-w-0 flex-col justify-between gap-5 bg-gradient-to-br from-brand-50 via-violet-50 to-fuchsia-50 p-6 sm:p-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">For organisation admins</p>
            <h2 id="org-setup-title" className="mt-1 font-display text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
              Set up your organisation
            </h2>
            <p className="mt-1 text-sm text-slate-700">
              Five steps to get {organisation?.name ?? "your team"} learning. Each one ticks itself off as you go.
            </p>
          </div>
          <div>
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-semibold text-slate-900">
                {done} of {steps.length} done
              </span>
              {next && <span className="truncate pl-3 text-xs text-slate-600">Next: {next.title}</span>}
            </div>
            <Progress value={(done / steps.length) * 100} className="mt-2" size="sm" aria-label="Organisation setup progress" />
            <div className="mt-4 flex flex-wrap gap-2">
              {next && (
                <Button asChild variant="gradient" rightIcon={<ArrowRight />}>
                  <Link href={next.href}>{next.cta}</Link>
                </Button>
              )}
              <Button variant="ghost" leftIcon={<X />} loading={dismiss.isPending} onClick={() => dismiss.mutate()} aria-label="Dismiss the organisation setup checklist">
                Dismiss
              </Button>
            </div>
          </div>
        </div>
        <ol className="min-w-0 space-y-2.5 p-5 sm:p-6" aria-label="Setup steps">
          {steps.map((s, i) => {
            const c = colorClasses(s.color);
            const Icon = s.icon;
            return (
              <li key={s.key} className="flex min-w-0 items-center gap-2">
                <Link
                  href={s.href}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-slate-100 p-3 transition hover:border-slate-200 hover:bg-slate-50 focus-visible:focus-ring"
                >
                  <span
                    className={cn(
                      "grid size-9 shrink-0 place-items-center rounded-xl",
                      s.done ? "bg-emerald-500 text-white" : cn("bg-gradient-to-br text-white", c.gradient),
                    )}
                  >
                    {s.done ? <CheckCircle2 className="size-4" aria-hidden /> : <Icon className="size-4" aria-hidden />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-sm font-semibold", s.done ? "text-slate-500" : "text-slate-900")}>
                      <span className="sr-only">Step {i + 1}: </span>
                      {s.title}
                    </span>
                    {loading && s.done === null ? (
                      <Skeleton className="mt-1 h-3 w-40" />
                    ) : (
                      <span className="line-clamp-2 block text-xs text-slate-600">{s.body}</span>
                    )}
                  </span>
                  <span className="sr-only">{s.done ? "(done)" : "(to do)"}</span>
                  {!s.done && <ArrowRight className="size-4 shrink-0 text-slate-400" aria-hidden />}
                </Link>
                {s.secondary && !s.done && (
                  <Button asChild variant="soft" size="sm" className="hidden shrink-0 sm:inline-flex">
                    <Link href={s.secondary.href}>{s.secondary.label}</Link>
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      </section>
    </Card>
  );
}
