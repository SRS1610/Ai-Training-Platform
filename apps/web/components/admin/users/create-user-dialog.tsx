"use client";

/** Create a member directly (POST /users) with a generated temporary password or a set password. */

import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  RadioCard,
  RadioGroup,
  Switch,
  toast,
} from "@praxis/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, ShieldCheck, Sparkles, UserPlus } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { z } from "zod";
import { PasswordInput } from "@/components/auth/password-input";
import { applyApiErrors, TextField, useZodForm } from "@/components/forms/form";
import { api } from "@/lib/api";
import { ak } from "../keys";
import { DepartmentSelect, RolePicker, useRoles } from "../pickers";
import type { MemberCreated } from "../types";
import { CopyButton, UpgradeNotice, isPlanLimit } from "../ui";

const schema = z.object({
  full_name: z.string().trim().min(1, "Enter their full name").max(200),
  email: z.string().trim().email("Enter a valid email address"),
  job_title: z.string().max(200).optional(),
  employee_id: z.string().max(100).optional(),
});

export function CreateUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const rolesQ = useRoles(open);
  const form = useZodForm(schema, { defaultValues: { full_name: "", email: "", job_title: "", employee_id: "" } });
  const [roles, setRoles] = React.useState<string[]>(["learner"]);
  const [department, setDepartment] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<"temp" | "set">("temp");
  const [password, setPassword] = React.useState("");
  const [sendEmail, setSendEmail] = React.useState(true);
  const [error, setError] = React.useState<unknown>(null);
  const [created, setCreated] = React.useState<MemberCreated | null>(null);

  React.useEffect(() => {
    if (open) {
      form.reset();
      setRoles(["learner"]);
      setDepartment(null);
      setMode("temp");
      setPassword("");
      setSendEmail(true);
      setError(null);
      setCreated(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const create = useMutation({
    mutationFn: (v: z.output<typeof schema>) =>
      api.post<MemberCreated>("/users", {
        full_name: v.full_name,
        email: v.email,
        roles,
        department_id: department,
        job_title: v.job_title || null,
        employee_id: v.employee_id || null,
        password: mode === "set" ? password : null,
        send_email: sendEmail,
      }),
    onSuccess: (m) => {
      qc.invalidateQueries({ queryKey: ak.members.all });
      setCreated(m);
      toast.success(`${m.full_name} was added`);
    },
    onError: (err) => {
      const left = applyApiErrors(form, err);
      setError(isPlanLimit(err) ? err : left ? err : null);
    },
  });

  const submit = form.handleSubmit((v) => {
    setError(null);
    if (!roles.length) return setError(new Error("Choose at least one role"));
    if (mode === "set" && password.length < 10) return setError(new Error("Passwords need at least 10 characters"));
    create.mutate(v);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <span className="mb-1 grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-sm">
            <UserPlus className="size-5" aria-hidden />
          </span>
          <DialogTitle>{created ? "Member created" : "Create a member"}</DialogTitle>
          <DialogDescription>
            {created
              ? created.existing_account
                ? "This person already had a Praxis account — they've been added to your organisation."
                : "Share the sign-in details securely. They'll be asked to change a temporary password on first sign-in."
              : "Add someone directly without waiting for them to accept an invitation."}
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-4">
              <p className="font-semibold text-slate-900">{created.full_name}</p>
              <p className="text-sm text-slate-600">{created.email}</p>
            </div>
            {created.temporary_password && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                  <KeyRound className="size-4" aria-hidden /> Temporary password — shown only once
                </p>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <code className="flex-1 select-all break-all rounded-xl bg-white px-3 py-2 font-mono text-sm text-slate-900 ring-1 ring-amber-200">
                    {created.temporary_password}
                  </code>
                  <CopyButton value={created.temporary_password} />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="secondary" asChild>
                <Link href={`/app/admin/users/${created.user_id}`}>Open profile</Link>
              </Button>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField form={form} name="full_name" label="Full name" required autoComplete="off" />
              <TextField form={form} name="email" label="Email" type="email" required autoComplete="off" />
              <TextField form={form} name="job_title" label="Job title" />
              <TextField form={form} name="employee_id" label="Employee ID" />
            </div>
            <FormField label="Department">{(aria) => <DepartmentSelect id={aria.id} value={department} onChange={setDepartment} />}</FormField>
            <div>
              <p id="create-roles-label" className="mb-2 text-sm font-medium text-slate-800">
                Roles <span className="text-rose-600">*</span>
              </p>
              <RolePicker roles={rolesQ.data ?? []} value={roles} onChange={setRoles} labelledBy="create-roles-label" />
            </div>
            <fieldset className="space-y-3">
              <legend className="mb-2 text-sm font-medium text-slate-800">Password</legend>
              <RadioGroup value={mode} onValueChange={(v) => setMode(v as "temp" | "set")} className="grid gap-3 sm:grid-cols-2">
                <RadioCard value="temp" title="Generate a temporary password" description="Shown once after creation; must be changed at first sign-in." icon={<Sparkles />} />
                <RadioCard value="set" title="Set a password" description="You choose the initial password." icon={<ShieldCheck />} />
              </RadioGroup>
              {mode === "set" && (
                <FormField label="Initial password" required hint="At least 10 characters.">
                  <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
                </FormField>
              )}
            </fieldset>
            <label className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 p-3">
              <span>
                <span className="block text-sm font-medium text-slate-900">Send a welcome email</span>
                <span className="block text-xs text-muted-foreground">Includes a sign-in link (never the password).</span>
              </span>
              <Switch checked={sendEmail} onCheckedChange={setSendEmail} aria-label="Send a welcome email" />
            </label>
            {error !== null &&
              (isPlanLimit(error) ? (
                <UpgradeNotice error={error} title="You've reached your plan's seat limit" compact />
              ) : (
                <Alert tone="danger" title="Couldn't create the member">
                  {error instanceof Error ? error.message : String(error)}
                </Alert>
              ))}
            <DialogFooter>
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="gradient" loading={create.isPending}>
                Create member
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
