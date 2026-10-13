"use client";

import type { Page } from "@praxis/types";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  FormField,
  Input,
  PageHeader,
  Progress,
  SimpleSelect,
  Skeleton,
  StatusPill,
  cn,
  toast,
} from "@praxis/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpenCheck,
  Briefcase,
  Building2,
  CalendarDays,
  Clock,
  GraduationCap,
  KeyRound,
  Lock,
  PauseCircle,
  PlayCircle,
  Plus,
  Save,
  ShieldAlert,
  ShieldCheck,
  UserMinus,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import * as React from "react";
import { AssignTrainingDialog } from "@/components/admin/assign-training-dialog";
import { ak } from "@/components/admin/keys";
import { DepartmentSelect, MemberSelect, RolePicker, useRoles, useTeams, type Option } from "@/components/admin/pickers";
import type { EnrolmentOut, MemberDetail, MemberOut } from "@/components/admin/types";
import { Meta, PageGate, RoleChip, SectionCard, StackedBar, fmtDuration, toastError } from "@/components/admin/ui";
import { ErrorState } from "@/components/common/error-state";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatRelative } from "@/lib/format";

function DetailSkeleton() {
  return (
    <div className="space-y-6" aria-busy aria-label="Loading member">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-40 rounded-3xl" />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Skeleton className="h-96 rounded-2xl xl:col-span-2" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    </div>
  );
}

function MemberPage() {
  const { userId } = useParams<{ userId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { can, user, permissions } = useAuth();
  const [assign, setAssign] = React.useState(false);
  const [confirm, setConfirm] = React.useState<"suspend" | "reactivate" | "remove" | null>(null);

  const q = useQuery({
    queryKey: ak.members.detail(userId),
    queryFn: ({ signal }) => api.get<MemberDetail>(`/users/${userId}`, { signal }),
  });

  if (q.isLoading) return <DetailSkeleton />;
  if (q.isError)
    return (
      <ErrorState
        error={q.error}
        onRetry={() => q.refetch()}
        size="lg"
        title={q.error instanceof ApiError && q.error.isNotFound ? "Member not found" : undefined}
      />
    );
  const m = q.data!;
  const self = m.user_id === user?.id;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ak.members.all });
  };

  return (
    <>
      <PageHeader
        title={m.full_name}
        breadcrumbs={[
          { label: "Admin", href: "/app/admin" },
          { label: "People", href: "/app/admin/users" },
          { label: m.full_name },
        ]}
        linkComponent={Link}
        className="mb-4 sm:mb-6 [&_h1]:sr-only"
      />

      <section className="relative mb-6 overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-soft">
        <div className="h-24 bg-gradient-to-r from-sky-400 via-indigo-500 to-fuchsia-500 sm:h-28" aria-hidden />
        <div className="flex flex-col gap-5 px-5 pb-5 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
            <Avatar name={m.full_name} src={m.avatar_url} size="2xl" className="-mt-12 shrink-0 ring-4 ring-white" />
            <div className="min-w-0 sm:pt-3">
              <h2 className="font-display text-2xl font-bold tracking-tight text-slate-900">
                {m.full_name}
                {self && <span className="ml-2 align-middle text-sm font-medium text-brand-700">(you)</span>}
              </h2>
              <p className="truncate text-sm text-muted-foreground">{m.email}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <StatusPill status={m.status} size="sm" />
                {m.mfa_enabled ? (
                  <Badge tone="success" size="sm">
                    <ShieldCheck aria-hidden /> MFA on
                  </Badge>
                ) : (
                  <Badge tone="neutral" size="sm">
                    <Lock aria-hidden /> MFA off
                  </Badge>
                )}
                {m.roles.map((r) => (
                  <RoleChip key={r} roleKey={r} />
                ))}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {can("enrolments.manage") && m.status === "active" && (
              <Button variant="gradient" leftIcon={<BookOpenCheck />} onClick={() => setAssign(true)}>
                Assign training
              </Button>
            )}
            {can("users.edit") && !self && m.status === "active" && (
              <Button variant="secondary" leftIcon={<PauseCircle />} onClick={() => setConfirm("suspend")}>
                Suspend
              </Button>
            )}
            {can("users.edit") && !self && m.status === "suspended" && (
              <Button variant="secondary" leftIcon={<PlayCircle />} onClick={() => setConfirm("reactivate")}>
                Reactivate
              </Button>
            )}
            {can("users.delete") && !self && (
              <Button variant="destructive-soft" leftIcon={<UserMinus />} onClick={() => setConfirm("remove")}>
                Remove
              </Button>
            )}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-4 border-t border-slate-100 px-5 py-4 sm:grid-cols-4 sm:px-6">
          <Meta label="Joined">{formatDate(m.joined_at ?? m.created_at)}</Meta>
          <Meta label="Last active">{m.last_login_at ? formatRelative(m.last_login_at) : "Never signed in"}</Meta>
          <Meta label="Department">{m.department_name ?? "—"}</Meta>
          <Meta label="Manager">{m.manager?.name ?? "—"}</Meta>
        </dl>
      </section>

      {m.status === "suspended" && (
        <Alert tone="warning" title="This member is suspended" className="mb-6">
          They can&apos;t sign in to this organisation. Reactivate them to restore access.
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <ProfileCard member={m} onSaved={refresh} />
          <RolesCard member={m} permissions={permissions} isSuperadmin={!!user?.is_superadmin} onSaved={refresh} />
        </div>
        <div className="space-y-6">
          <EnrolmentsCard member={m} onAssign={() => setAssign(true)} />
          <TeamsCard member={m} onChanged={refresh} />
        </div>
      </div>

      <AssignTrainingDialog open={assign} onOpenChange={setAssign} users={[{ value: m.user_id, label: m.full_name, hint: m.email }]} />
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        destructive={confirm !== "reactivate"}
        confirmText={confirm === "remove" ? "REMOVE" : undefined}
        title={confirm === "remove" ? `Remove ${m.full_name} from the organisation?` : confirm === "suspend" ? `Suspend ${m.full_name}?` : `Reactivate ${m.full_name}?`}
        description={
          confirm === "remove"
            ? "They immediately lose access to this organisation, its courses and teams. Their completed training records, certificates and audit history are retained. Their Praxis account itself is not deleted."
            : confirm === "suspend"
              ? "They won't be able to sign in to this organisation until reactivated. Enrolments, progress and roles are kept."
              : "They'll regain access with their existing roles and enrolments."
        }
        confirmLabel={confirm === "remove" ? "Remove member" : confirm === "suspend" ? "Suspend member" : "Reactivate"}
        onConfirm={async () => {
          try {
            if (confirm === "remove") {
              await api.delete(`/users/${m.user_id}`);
              toast.success(`${m.full_name} was removed`);
              refresh();
              router.push("/app/admin/users");
            } else {
              await api.post(`/users/${m.user_id}/${confirm}`);
              toast.success(confirm === "suspend" ? "Member suspended" : "Member reactivated");
              refresh();
            }
          } catch (e) {
            toastError(e);
          }
        }}
      />
    </>
  );
}

function ProfileCard({ member: m, onSaved }: { member: MemberDetail; onSaved: () => void }) {
  const { can } = useAuth();
  const editable = can("users.edit");
  const [job, setJob] = React.useState(m.job_title ?? "");
  const [emp, setEmp] = React.useState(m.employee_id ?? "");
  const [dept, setDept] = React.useState<string | null>(m.department_id ?? null);
  const [manager, setManager] = React.useState<Option | null>(m.manager ? { value: m.manager.id, label: m.manager.name } : null);
  React.useEffect(() => {
    setJob(m.job_title ?? "");
    setEmp(m.employee_id ?? "");
    setDept(m.department_id ?? null);
    setManager(m.manager ? { value: m.manager.id, label: m.manager.name } : null);
  }, [m]);

  const dirty =
    job !== (m.job_title ?? "") || emp !== (m.employee_id ?? "") || dept !== (m.department_id ?? null) || (manager?.value ?? null) !== (m.manager_user_id ?? null);

  const save = useMutation({
    mutationFn: () =>
      api.patch<MemberOut>(`/users/${m.user_id}`, {
        job_title: job.trim() || null,
        employee_id: emp.trim() || null,
        department_id: dept,
        manager_user_id: manager?.value ?? null,
      }),
    onSuccess: () => {
      toast.success("Profile updated");
      onSaved();
    },
    onError: (e) => toastError(e),
  });

  return (
    <SectionCard title="Work profile" description="Organisation details used for reporting, assignments and manager views." icon={Briefcase} color="sky">
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Job title">
            <Input value={job} onChange={(e) => setJob(e.target.value)} disabled={!editable} maxLength={200} placeholder="e.g. Service Desk Analyst" />
          </FormField>
          <FormField label="Employee ID">
            <Input value={emp} onChange={(e) => setEmp(e.target.value)} disabled={!editable} maxLength={100} className="font-mono" placeholder="e.g. NW-1042" />
          </FormField>
          <FormField label={<span className="inline-flex items-center gap-1.5"><Building2 className="size-4 text-teal-600" aria-hidden />Department</span>}>
            {(aria) => (editable ? <DepartmentSelect id={aria.id} value={dept} onChange={setDept} /> : <Input id={aria.id} disabled value={m.department_name ?? "—"} />)}
          </FormField>
          <FormField label={<span className="inline-flex items-center gap-1.5"><UserRound className="size-4 text-violet-600" aria-hidden />Manager</span>}>
            {(aria) =>
              editable ? <MemberSelect id={aria.id} value={manager} onChange={setManager} exclude={[m.user_id]} placeholder="No manager" /> : <Input id={aria.id} disabled value={m.manager?.name ?? "—"} />
            }
          </FormField>
        </div>
        {editable && (
          <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
            {dirty && <span className="mr-auto text-xs font-medium text-amber-800">Unsaved changes</span>}
            <Button type="submit" leftIcon={<Save />} loading={save.isPending} disabled={!dirty}>
              Save profile
            </Button>
          </div>
        )}
      </form>
    </SectionCard>
  );
}

function RolesCard({ member: m, permissions, isSuperadmin, onSaved }: { member: MemberDetail; permissions: Set<string>; isSuperadmin: boolean; onSaved: () => void }) {
  const { can } = useAuth();
  const roles = useRoles();
  const [value, setValue] = React.useState<string[]>(m.roles);
  React.useEffect(() => setValue(m.roles), [m.roles]);
  const admins = useQuery({
    queryKey: ak.members.list({ role: "org_admin", status: "active", count: true }),
    queryFn: ({ signal }) => api.get<Page<MemberOut>>("/users", { signal, query: { role: "org_admin", status: "active", page_size: 1 } }),
    enabled: m.roles.includes("org_admin"),
  });
  const lastAdmin = m.roles.includes("org_admin") && m.status === "active" && (admins.data?.total ?? 2) <= 1;
  const removingAdmin = m.roles.includes("org_admin") && !value.includes("org_admin");
  const dirty = [...value].sort().join() !== [...m.roles].sort().join();
  const editable = can("roles.manage");

  const save = useMutation({
    mutationFn: () => api.put<MemberOut>(`/users/${m.user_id}/roles`, { roles: value }),
    onSuccess: () => {
      toast.success("Roles updated");
      onSaved();
    },
  });

  return (
    <SectionCard title="Roles & access" description="Roles bundle permissions. Members get the union of all their roles." icon={KeyRound} color="violet">
      {roles.isLoading ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : roles.isError ? (
        <ErrorState error={roles.error} onRetry={() => roles.refetch()} size="sm" />
      ) : (
        <div className="space-y-4">
          {lastAdmin && (
            <Alert tone="warning" title="Only active organisation admin" icon={<ShieldAlert aria-hidden />}>
              An organisation must always keep at least one active admin. Make someone else an admin before removing this role, suspending or removing {m.full_name}.
            </Alert>
          )}
          <RolePicker
            roles={roles.data ?? []}
            value={value}
            onChange={setValue}
            disabled={!editable}
            grantable={(r) => isSuperadmin || r.permissions.every((p) => permissions.has(p))}
          />
          {save.isError && (
            <Alert tone="danger" title={save.error instanceof ApiError && save.error.code === "last_admin" ? "Can't remove the last admin" : "Couldn't update roles"}>
              {errorMessage(save.error)}
            </Alert>
          )}
          {editable && (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
              {removingAdmin && lastAdmin && <span className="mr-auto text-xs font-medium text-rose-700">This would leave the organisation without an admin.</span>}
              {!value.length && <span className="mr-auto text-xs font-medium text-rose-700">Choose at least one role.</span>}
              <Button variant="ghost" onClick={() => setValue(m.roles)} disabled={!dirty}>
                Reset
              </Button>
              <Button leftIcon={<Save />} loading={save.isPending} disabled={!dirty || !value.length || (removingAdmin && lastAdmin)} onClick={() => save.mutate()}>
                Save roles
              </Button>
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}

function EnrolmentsCard({ member: m, onAssign }: { member: MemberDetail; onAssign: () => void }) {
  const { can } = useAuth();
  const e = m.enrolments ?? { total: 0, not_started: 0, in_progress: 0, completed: 0, withdrawn: 0 };
  const recent = useQuery({
    queryKey: ak.enrolments.byUser(m.user_id),
    queryFn: ({ signal }) => api.get<Page<EnrolmentOut>>("/enrolments", { signal, query: { user_id: m.user_id, page_size: 6 } }),
    enabled: can("enrolments.manage"),
  });
  const total = e.total ?? 0;
  const pct = total ? Math.round(((e.completed ?? 0) / total) * 100) : 0;
  return (
    <SectionCard title="Training" description={`${total} enrolment${total === 1 ? "" : "s"} · ${pct}% complete`} icon={GraduationCap} color="emerald">
      {total === 0 ? (
        <EmptyState
          size="sm"
          illustration="learning"
          title="No training yet"
          description="Assign a course to get them started."
          action={
            can("enrolments.manage") ? (
              <Button size="sm" variant="soft" leftIcon={<BookOpenCheck />} onClick={onAssign}>
                Assign training
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-5">
          <StackedBar
            segments={[
              { key: "completed", label: "Completed", value: e.completed ?? 0, color: "emerald" },
              { key: "in_progress", label: "In progress", value: e.in_progress ?? 0, color: "sky" },
              { key: "not_started", label: "Not started", value: e.not_started ?? 0, color: "amber" },
              { key: "withdrawn", label: "Withdrawn", value: e.withdrawn ?? 0, color: "rose" },
            ]}
          />
          {recent.data && recent.data.items.length > 0 && (
            <ul className="divide-y divide-slate-100 border-t border-slate-100">
              {recent.data.items.map((en) => (
                <li key={en.id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 truncate text-sm font-medium text-slate-900">{en.course?.title ?? "Course"}</p>
                    <StatusPill status={en.is_overdue ? "overdue" : en.status} size="sm" />
                  </div>
                  <Progress value={en.progress_pct} size="xs" className="mt-2" aria-label={`${en.course?.title} progress`} color={en.status === "completed" ? "emerald" : "brand"} />
                  <p className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="size-3" aria-hidden />
                      {fmtDuration(en.time_spent_seconds)}
                    </span>
                    {en.due_date && (
                      <span className={cn("inline-flex items-center gap-1", en.is_overdue && "font-medium text-rose-700")}>
                        <CalendarDays className="size-3" aria-hidden />
                        Due {formatDate(en.due_date)}
                      </span>
                    )}
                    {en.final_score !== null && <span>Score {Math.round(en.final_score)}%</span>}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </SectionCard>
  );
}

function TeamsCard({ member, onChanged }: { member: MemberDetail; onChanged: () => void }) {
  const m = { ...member, teams: member.teams ?? [] };
  const qc = useQueryClient();
  const { can } = useAuth();
  const teams = useTeams();
  const [adding, setAdding] = React.useState("");
  const [remove, setRemove] = React.useState<{ id: string; name: string } | null>(null);
  const available = (teams.data ?? []).filter((t) => !m.teams.some((x) => x.id === t.id));
  const add = useMutation({
    mutationFn: (teamId: string) => api.post(`/teams/${teamId}/members`, { user_ids: [m.user_id] }),
    onSuccess: () => {
      toast.success("Added to team");
      setAdding("");
      qc.invalidateQueries({ queryKey: ak.teams.all });
      onChanged();
    },
    onError: (e) => toastError(e),
  });
  return (
    <SectionCard title="Teams" description="Teams group people for assignments and reporting." icon={UsersRound} color="violet">
      {m.teams.length === 0 ? (
        <p className="rounded-xl bg-slate-50 px-3 py-4 text-center text-sm text-muted-foreground">Not in any team yet.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {m.teams.map((t) => (
            <li key={t.id} className="inline-flex items-center gap-1 rounded-full bg-violet-50 py-1 pl-3 pr-1 text-sm font-medium text-violet-800 ring-1 ring-inset ring-violet-200">
              {t.name}
              {can("users.edit") && (
                <button type="button" onClick={() => setRemove(t)} className="grid size-6 place-items-center rounded-full hover:bg-violet-100 focus-visible:focus-ring" aria-label={`Remove from ${t.name}`}>
                  <X className="size-3.5" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {can("users.edit") && available.length > 0 && (
        <div className="mt-4 flex gap-2">
          <SimpleSelect aria-label="Team to add" value={adding} onValueChange={setAdding} placeholder="Add to a team…" options={available.map((t) => ({ value: t.id, label: t.name }))} className="h-10" />
          <Button variant="soft" leftIcon={<Plus />} disabled={!adding} loading={add.isPending} onClick={() => add.mutate(adding)}>
            Add
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={!!remove}
        onOpenChange={(o) => !o && setRemove(null)}
        destructive
        title={`Remove from ${remove?.name}?`}
        description="Existing enrolments stay in place; future team assignments won't include them."
        confirmLabel="Remove from team"
        onConfirm={async () => {
          try {
            await api.delete(`/teams/${remove!.id}/members/${m.user_id}`);
            toast.success("Removed from team");
            qc.invalidateQueries({ queryKey: ak.teams.all });
            onChanged();
          } catch (e) {
            toastError(e);
          }
        }}
      />
    </SectionCard>
  );
}

export default function Page() {
  return (
    <PageGate permission="users.view">
      <MemberPage />
    </PageGate>
  );
}
