"use client";

import type { Page } from "@praxis/types";
import {
  Avatar,
  Button,
  ConfirmDialog,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FilterBar,
  FormField,
  KpiTile,
  SimpleSelect,
  StatusPill,
  Tooltip,
  cn,
  toast,
  type ColumnDef,
} from "@praxis/ui";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpenCheck, Eye, MailPlus, PauseCircle, PlayCircle, ShieldCheck, UserMinus, UserPlus, UsersRound, UserX, X } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { ErrorState } from "@/components/common/error-state";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatRelative } from "@/lib/format";
import { AssignTrainingDialog } from "../assign-training-dialog";
import { ak } from "../keys";
import { useDepartments, useRoles, useTeams, type Option } from "../pickers";
import type { MemberOut, TeamOut } from "../types";
import { RoleChip, toastError, useUrlState } from "../ui";

const ALL = "all";

function useCount(query: Record<string, unknown>, enabled = true) {
  return useQuery({
    queryKey: ak.members.list({ ...query, count: true }),
    queryFn: ({ signal }) => api.get<Page<MemberOut>>("/users", { signal, query: { ...(query as Record<string, string>), page_size: 1 } }),
    enabled,
    staleTime: 30_000,
  });
}

export function MemberStats() {
  const { can } = useAuth();
  const total = useCount({});
  const active = useCount({ status: "active" });
  const suspended = useCount({ status: "suspended" });
  const pending = useQuery({
    queryKey: ak.invitations.list({ status: "pending", count: true }),
    queryFn: ({ signal }) => api.get<Page<unknown>>("/invitations", { signal, query: { status: "pending", page_size: 1 } }),
    enabled: can("users.create"),
  });
  const v = (q: { data?: { total: number }; isLoading: boolean }) => (q.isLoading ? "…" : (q.data?.total ?? "—"));
  return (
    <section aria-label="Member statistics" className={cn("stagger grid grid-cols-2 gap-3 sm:gap-4", can("users.create") ? "lg:grid-cols-4" : "lg:grid-cols-3")}>
      <KpiTile label="Members" value={v(total)} icon={<UsersRound />} color="sky" hint="Everyone in the organisation" />
      <KpiTile label="Active" value={v(active)} icon={<ShieldCheck />} color="emerald" hint="Can sign in and learn" />
      <KpiTile label="Suspended" value={v(suspended)} icon={<PauseCircle />} color="rose" hint="Access paused" />
      {can("users.create") && <KpiTile label="Pending invites" value={v(pending)} icon={<MailPlus />} color="violet" hint="Awaiting acceptance" />}
    </section>
  );
}

export function MembersTab({ onInvite }: { onInvite: () => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const { can, user, permissions } = useAuth();
  const [q, setQ] = useUrlState("q");
  const [role, setRole] = useUrlState("role", ALL);
  const [dept, setDept] = useUrlState("department", ALL);
  const [team, setTeam] = useUrlState("team", ALL);
  const [status, setStatus] = useUrlState("status", ALL);
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize: 20 });
  const [selected, setSelected] = React.useState<MemberOut[]>([]);
  const [tableKey, setTableKey] = React.useState(0);
  const [assignFor, setAssignFor] = React.useState<Option[] | null>(null);
  const [teamFor, setTeamFor] = React.useState<MemberOut[] | null>(null);
  const [confirm, setConfirm] = React.useState<{ kind: "suspend" | "reactivate" | "remove"; members: MemberOut[] } | null>(null);
  const roles = useRoles();
  const depts = useDepartments();
  const teams = useTeams();
  const roleName = (k: string) => roles.data?.find((r) => r.key === k)?.name;
  // Members holding permissions the viewer lacks can't be suspended/removed by them (the API refuses).
  const outranks = (r: MemberOut) =>
    !user?.is_superadmin && (!roles.data || (roles.data ?? []).some((role) => r.roles.includes(role.key) && role.permissions.some((p) => !permissions.has(p))));

  const params = {
    q: q || undefined,
    role: role === ALL ? undefined : role,
    department_id: dept === ALL ? undefined : dept,
    team_id: team === ALL ? undefined : team,
    status: status === ALL ? undefined : status,
    page: pagination.pageIndex + 1,
    page_size: pagination.pageSize,
  };
  React.useEffect(() => setPagination((p) => ({ ...p, pageIndex: 0 })), [q, role, dept, team, status]);

  const list = useQuery({
    queryKey: ak.members.list(params),
    queryFn: ({ signal }) => api.get<Page<MemberOut>>("/users", { signal, query: params }),
    placeholderData: keepPreviousData,
  });

  const clearSelection = () => {
    setSelected([]);
    setTableKey((k) => k + 1);
  };

  const runBulk = async (kind: "suspend" | "reactivate" | "remove", members: MemberOut[]) => {
    const results = await Promise.allSettled(
      members.map((m) =>
        kind === "remove" ? api.delete(`/users/${m.user_id}`) : api.post(`/users/${m.user_id}/${kind}`),
      ),
    );
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.map((r, i) => ({ r, m: members[i]! })).filter((x) => x.r.status === "rejected");
    const verb = kind === "remove" ? "Removed" : kind === "suspend" ? "Suspended" : "Reactivated";
    if (ok) toast.success(`${verb} ${ok} member${ok === 1 ? "" : "s"}`);
    if (failed.length) {
      const first = failed[0]!;
      toast.error(`${failed.length} couldn't be ${verb.toLowerCase()}: ${first.m.full_name} — ${errorMessage((first.r as PromiseRejectedResult).reason)}`);
    }
    qc.invalidateQueries({ queryKey: ak.members.all });
    clearSelection();
  };

  const columns = React.useMemo<ColumnDef<MemberOut, unknown>[]>(
    () => [
      {
        id: "person",
        accessorKey: "full_name",
        header: "Person",
        meta: { label: "Person" },
        cell: ({ row }) => {
          const m = row.original;
          return (
            <div className="flex min-w-[14rem] items-center gap-3">
              <Avatar name={m.full_name} src={m.avatar_url} size="sm" />
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-900">
                  {m.full_name}
                  {m.user_id === user?.id && <span className="ml-1.5 text-xs font-medium text-brand-700">(you)</span>}
                </p>
                <p className="truncate text-xs text-muted-foreground">{m.email}</p>
              </div>
            </div>
          );
        },
      },
      {
        id: "roles",
        header: "Roles",
        enableSorting: false,
        meta: { label: "Roles" },
        cell: ({ row }) => (
          <div className="flex max-w-[16rem] flex-wrap gap-1">
            {row.original.roles.map((k) => (
              <RoleChip key={k} roleKey={k} name={roleName(k)} />
            ))}
          </div>
        ),
      },
      {
        id: "department",
        accessorKey: "department_name",
        header: "Department",
        meta: { label: "Department" },
        cell: ({ row }) => (
          <div className="min-w-[8rem]">
            <p className="text-slate-800">{row.original.department_name ?? <span className="text-slate-400">—</span>}</p>
            {row.original.job_title && <p className="truncate text-xs text-muted-foreground">{row.original.job_title}</p>}
          </div>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        meta: { label: "Status" },
        cell: ({ row }) => (
          <div className="flex items-center gap-1.5">
            <StatusPill status={row.original.status} size="sm" />
            {row.original.mfa_enabled && (
              <Tooltip content="Two-step verification on">
                <span className="grid size-5 place-items-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200">
                  <ShieldCheck className="size-3" aria-label="MFA enabled" />
                </span>
              </Tooltip>
            )}
          </div>
        ),
      },
      {
        id: "last_active",
        accessorKey: "last_login_at",
        header: "Last active",
        meta: { label: "Last active" },
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-slate-600">{row.original.last_login_at ? formatRelative(row.original.last_login_at) : <span className="text-slate-400">Never</span>}</span>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roles.data, user?.id],
  );

  const chips = [
    q && { key: "q", label: `“${q}”`, onRemove: () => setQ("") },
    role !== ALL && { key: "role", label: `Role: ${roleName(role) ?? role}`, onRemove: () => setRole(ALL) },
    dept !== ALL && { key: "dept", label: `Dept: ${depts.data?.find((d) => d.id === dept)?.name ?? "…"}`, onRemove: () => setDept(ALL) },
    team !== ALL && { key: "team", label: `Team: ${teams.data?.find((t) => t.id === team)?.name ?? "…"}`, onRemove: () => setTeam(ALL) },
    status !== ALL && { key: "status", label: `Status: ${status}`, onRemove: () => setStatus(ALL) },
  ].filter(Boolean) as { key: string; label: string; onRemove: () => void }[];

  if (list.isError) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;

  const canEdit = can("users.edit");
  const selfSelected = selected.some((m) => m.user_id === user?.id);
  const outrankedSelected = selected.filter(outranks);
  const statusBlocked = selfSelected || outrankedSelected.length > 0;
  const blockedHint = selfSelected
    ? "You can't change your own status"
    : outrankedSelected.length
      ? `${outrankedSelected[0]!.full_name}${outrankedSelected.length > 1 ? ` and ${outrankedSelected.length - 1} more` : ""} hold permissions you don't have`
      : undefined;

  return (
    <div className="space-y-4">
      {selected.length > 0 && (
        <div
          role="region"
          aria-label="Bulk actions"
          className="sticky top-20 z-20 flex flex-col gap-3 rounded-2xl border border-brand-200 bg-gradient-to-r from-brand-50 via-violet-50 to-fuchsia-50 p-3 shadow-lift sm:flex-row sm:items-center"
        >
          <p className="flex items-center gap-2 text-sm font-semibold text-brand-900" aria-live="polite">
            <span className="grid size-7 place-items-center rounded-full bg-brand-600 text-xs text-white">{selected.length}</span>
            selected
          </p>
          <div className="flex flex-1 flex-wrap gap-2">
            {can("enrolments.manage") && (
              <Button size="sm" variant="secondary" leftIcon={<BookOpenCheck />} onClick={() => setAssignFor(selected.map((m) => ({ value: m.user_id, label: m.full_name, hint: m.email })))}>
                Assign training
              </Button>
            )}
            {canEdit && (
              <Button size="sm" variant="secondary" leftIcon={<UsersRound />} onClick={() => setTeamFor(selected)}>
                Add to team
              </Button>
            )}
            {canEdit && (
              <Button size="sm" variant="secondary" leftIcon={<PlayCircle />} disabled={statusBlocked} title={blockedHint} onClick={() => setConfirm({ kind: "reactivate", members: selected })}>
                Reactivate
              </Button>
            )}
            {canEdit && (
              <Button size="sm" variant="destructive-soft" leftIcon={<PauseCircle />} disabled={statusBlocked} title={blockedHint} onClick={() => setConfirm({ kind: "suspend", members: selected })}>
                Suspend
              </Button>
            )}
          </div>
          {canEdit && blockedHint && <p className="text-xs font-medium text-amber-800 sm:max-w-[14rem]">{blockedHint} — suspend and reactivate are unavailable for this selection.</p>}
          <Button size="sm" variant="ghost" leftIcon={<X />} onClick={clearSelection}>
            Clear
          </Button>
        </div>
      )}

      <DataTable
        key={tableKey}
        aria-label="Members"
        columns={columns}
        data={list.data?.items ?? []}
        loading={list.isLoading}
        total={list.data?.total ?? 0}
        pagination={pagination}
        onPaginationChange={setPagination}
        getRowId={(r) => r.user_id}
        enableSelection={canEdit || can("enrolments.manage")}
        onSelectionChange={setSelected}
        onRowClick={(r) => router.push(`/app/admin/users/${r.user_id}`)}
        toolbar={
          <FilterBar search={q} onSearchChange={setQ} searchPlaceholder="Search name, email, ID, title…" chips={chips} onClearAll={chips.length > 1 ? () => router.replace("/app/admin/users") : undefined}>
            <SimpleSelect
              aria-label="Filter by role"
              value={role}
              onValueChange={setRole}
              className="h-9 w-[9.5rem]"
              options={[{ value: ALL, label: "All roles" }, ...(roles.data ?? []).map((r) => ({ value: r.key, label: r.name }))]}
            />
            <SimpleSelect
              aria-label="Filter by department"
              value={dept}
              onValueChange={setDept}
              className="h-9 w-[10.5rem]"
              options={[{ value: ALL, label: "All departments" }, ...(depts.data ?? []).map((d) => ({ value: d.id, label: d.name }))]}
            />
            <SimpleSelect
              aria-label="Filter by team"
              value={team}
              onValueChange={setTeam}
              className="h-9 w-[9.5rem]"
              options={[{ value: ALL, label: "All teams" }, ...(teams.data ?? []).map((t) => ({ value: t.id, label: t.name }))]}
            />
            <SimpleSelect
              aria-label="Filter by status"
              value={status}
              onValueChange={setStatus}
              className="h-9 w-[9rem]"
              options={[
                { value: ALL, label: "Any status" },
                { value: "active", label: "Active" },
                { value: "suspended", label: "Suspended" },
                { value: "invited", label: "Invited" },
              ]}
            />
          </FilterBar>
        }
        rowActions={[
          { label: "View profile", icon: <Eye className="size-4" />, onSelect: (r) => router.push(`/app/admin/users/${r.user_id}`) },
          ...(can("enrolments.manage")
            ? [{ label: "Assign training", icon: <BookOpenCheck className="size-4" />, onSelect: (r: MemberOut) => setAssignFor([{ value: r.user_id, label: r.full_name, hint: r.email }]) }]
            : []),
          ...(canEdit
            ? [
                { label: "Suspend", icon: <PauseCircle className="size-4" />, onSelect: (r: MemberOut) => setConfirm({ kind: "suspend", members: [r] }), hidden: (r: MemberOut) => r.status !== "active" || r.user_id === user?.id || outranks(r), separatorBefore: true },
                { label: "Reactivate", icon: <PlayCircle className="size-4" />, onSelect: (r: MemberOut) => setConfirm({ kind: "reactivate", members: [r] }), hidden: (r: MemberOut) => r.status !== "suspended" || outranks(r) },
              ]
            : []),
          ...(can("users.delete")
            ? [{ label: "Remove from organisation", icon: <UserMinus className="size-4" />, destructive: true, onSelect: (r: MemberOut) => setConfirm({ kind: "remove", members: [r] }), hidden: (r: MemberOut) => r.user_id === user?.id || outranks(r) }]
            : []),
        ]}
        empty={{
          title: chips.length ? "No members match these filters" : "No members yet",
          description: chips.length ? "Try removing a filter or searching for something else." : "Invite your colleagues to start assigning training.",
          action: chips.length ? (
            <Button variant="secondary" onClick={() => router.replace("/app/admin/users")}>
              Clear filters
            </Button>
          ) : can("users.create") ? (
            <Button variant="soft" leftIcon={<UserPlus />} onClick={onInvite}>
              Invite people
            </Button>
          ) : undefined,
        }}
      />

      <AssignTrainingDialog open={!!assignFor} onOpenChange={(o) => !o && setAssignFor(null)} users={assignFor ?? []} />
      <AddToTeamDialog members={teamFor} teams={teams.data ?? []} onClose={() => setTeamFor(null)} onDone={clearSelection} />
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        destructive={confirm?.kind !== "reactivate"}
        title={
          confirm?.kind === "remove"
            ? `Remove ${confirm.members[0]?.full_name}?`
            : confirm?.kind === "suspend"
              ? `Suspend ${confirm.members.length === 1 ? confirm.members[0]?.full_name : `${confirm.members.length} members`}?`
              : `Reactivate ${confirm?.members.length === 1 ? confirm.members[0]?.full_name : `${confirm?.members.length} members`}?`
        }
        description={
          confirm?.kind === "remove"
            ? "They lose access to this organisation immediately. Their learning records and certificates are kept for reporting. You can invite them again later."
            : confirm?.kind === "suspend"
              ? "Suspended members can't sign in to this organisation until reactivated. Enrolments and history are kept. The last active admin can't be suspended."
              : "They'll regain access with their existing roles and enrolments."
        }
        confirmLabel={confirm?.kind === "remove" ? "Remove member" : confirm?.kind === "suspend" ? "Suspend" : "Reactivate"}
        onConfirm={() => runBulk(confirm!.kind, confirm!.members)}
      >
        {confirm && confirm.members.length > 1 && (
          <ul className="flex max-h-32 flex-wrap gap-1.5 overflow-auto">
            {confirm.members.map((m) => (
              <li key={m.user_id} className={cn("rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700")}>
                {m.full_name}
              </li>
            ))}
          </ul>
        )}
      </ConfirmDialog>
    </div>
  );
}

function AddToTeamDialog({ members, teams, onClose, onDone }: { members: MemberOut[] | null; teams: TeamOut[]; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const [team, setTeam] = React.useState<string>("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => setTeam(""), [members]);
  return (
    <Dialog open={!!members} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <span className="mb-1 grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white">
            <UsersRound className="size-5" aria-hidden />
          </span>
          <DialogTitle>Add to team</DialogTitle>
          <DialogDescription>
            Add {members?.length ?? 0} member{members?.length === 1 ? "" : "s"} to a team. People already in the team are skipped.
          </DialogDescription>
        </DialogHeader>
        {teams.length ? (
          <FormField label="Team">
            <SimpleSelect value={team} onValueChange={setTeam} placeholder="Choose a team" options={teams.map((t) => ({ value: t.id, label: `${t.name} · ${t.member_count} members` }))} />
          </FormField>
        ) : (
          <p className="flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
            <UserX className="size-4" aria-hidden /> No teams yet — create one under Departments &amp; teams.
          </p>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={!team}
            onClick={async () => {
              setBusy(true);
              try {
                await api.post(`/teams/${team}/members`, { user_ids: members!.map((m) => m.user_id) });
                toast.success(`Added to ${teams.find((t) => t.id === team)?.name}`);
                qc.invalidateQueries({ queryKey: ak.teams.all });
                onClose();
                onDone();
              } catch (e) {
                toastError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            Add to team
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
