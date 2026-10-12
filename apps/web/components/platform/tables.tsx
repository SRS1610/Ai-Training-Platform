"use client";

import type { Page } from "@praxis/types";
import {
  Avatar,
  Badge,
  ConfirmDialog,
  DataTable,
  FilterBar,
  SimpleSelect,
  StatusPill,
  cn,
  colorClasses,
  colorFor,
  toast,
  type ColumnDef,
} from "@praxis/ui";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crown, Eye, Globe2, ShieldCheck, ShieldOff } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { ak } from "@/components/admin/keys";
import type { PlatformOrgOut, PlatformUserOut } from "@/components/admin/types";
import { PlanBadge, fmtNumber, toastError } from "@/components/admin/ui";
import { ErrorState } from "@/components/common/error-state";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatRelative } from "@/lib/format";

const ALL = "all";

export function OrganisationsTable() {
  const router = useRouter();
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState(ALL);
  const [plan, setPlan] = React.useState(ALL);
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize: 20 });
  const params = { q: q || undefined, status: status === ALL ? undefined : status, plan: plan === ALL ? undefined : plan, page: pagination.pageIndex + 1, page_size: pagination.pageSize };
  const list = useQuery({
    queryKey: ak.platform.orgs(params),
    queryFn: ({ signal }) => api.get<Page<PlatformOrgOut>>("/platform/organisations", { signal, query: params }),
    placeholderData: keepPreviousData,
  });
  const reset = () => setPagination((p) => ({ ...p, pageIndex: 0 }));
  const columns = React.useMemo<ColumnDef<PlatformOrgOut, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Organisation",
        cell: ({ row }) => {
          const c = colorClasses(colorFor(row.original.name));
          return (
            <div className="flex min-w-[14rem] items-center gap-3">
              <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-sm font-bold text-white", c.gradient)} aria-hidden>
                {row.original.name.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-900">{row.original.name}</p>
                <p className="truncate font-mono text-xs text-slate-500">{row.original.slug}</p>
              </div>
            </div>
          );
        },
      },
      { accessorKey: "plan_code", header: "Plan", cell: ({ row }) => <PlanBadge code={row.original.plan_code} /> },
      { accessorKey: "status", header: "Status", cell: ({ row }) => <StatusPill status={row.original.deleted_at ? "archived" : row.original.status} label={row.original.deleted_at ? "Deleted" : undefined} size="sm" /> },
      { accessorKey: "kind", header: "Type", cell: ({ row }) => <span className="capitalize text-slate-700">{row.original.kind.replace(/_/g, " ")}</span> },
      { accessorKey: "member_count", header: "Members", cell: ({ row }) => <span className="font-semibold tabular-nums text-slate-900">{fmtNumber(row.original.member_count)}</span> },
      { accessorKey: "course_count", header: "Courses", cell: ({ row }) => <span className="tabular-nums text-slate-700">{fmtNumber(row.original.course_count)}</span> },
      {
        id: "extras",
        header: "Overrides",
        enableSorting: false,
        cell: ({ row }) => {
          const o = Object.entries(row.original.feature_overrides ?? {});
          return (
            <div className="flex flex-wrap items-center gap-1">
              {row.original.custom_domain && (
                <Badge tone="info" size="sm" title={row.original.custom_domain}>
                  <Globe2 aria-hidden /> Domain
                </Badge>
              )}
              {o.length > 0 ? (
                <Badge tone="violet" size="sm" title={o.map(([k, v]) => `${k}: ${v ? "on" : "off"}`).join(", ")}>
                  {o.length} override{o.length === 1 ? "" : "s"}
                </Badge>
              ) : (
                !row.original.custom_domain && <span className="text-slate-400">—</span>
              )}
            </div>
          );
        },
      },
      { accessorKey: "created_at", header: "Created", cell: ({ row }) => <span className="whitespace-nowrap text-slate-600">{formatDate(row.original.created_at)}</span> },
    ],
    [],
  );
  if (list.isError) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  return (
    <DataTable
      aria-label="Organisations"
      columns={columns}
      data={list.data?.items ?? []}
      loading={list.isLoading}
      total={list.data?.total ?? 0}
      pagination={pagination}
      onPaginationChange={setPagination}
      getRowId={(r) => r.id}
      onRowClick={(r) => router.push(`/app/platform/organisations/${r.id}`)}
      rowActions={[{ label: "Open", icon: <Eye className="size-4" />, onSelect: (r) => router.push(`/app/platform/organisations/${r.id}`) }]}
      toolbar={
        <FilterBar search={q} onSearchChange={(v) => { setQ(v); reset(); }} searchPlaceholder="Search name or slug…">
          <SimpleSelect
            aria-label="Status"
            value={status}
            onValueChange={(v) => { setStatus(v); reset(); }}
            className="h-9 w-36"
            options={[
              { value: ALL, label: "Any status" },
              { value: "active", label: "Active" },
              { value: "suspended", label: "Suspended" },
              { value: "closed", label: "Closed" },
            ]}
          />
          <SimpleSelect
            aria-label="Plan"
            value={plan}
            onValueChange={(v) => { setPlan(v); reset(); }}
            className="h-9 w-36"
            options={[{ value: ALL, label: "Any plan" }, ...["free", "individual", "professional", "business", "enterprise"].map((p) => ({ value: p, label: p[0]!.toUpperCase() + p.slice(1) }))]}
          />
        </FilterBar>
      }
      empty={{ title: "No organisations match", description: "Try a different search or filter." }}
    />
  );
}

export function PlatformUsersTable() {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const [q, setQ] = React.useState("");
  const [role, setRole] = React.useState(ALL);
  const [status, setStatus] = React.useState(ALL);
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize: 20 });
  const [confirm, setConfirm] = React.useState<PlatformUserOut | null>(null);
  const params = {
    q: q || undefined,
    superadmin: role === ALL ? undefined : role === "super",
    status: status === ALL ? undefined : status,
    page: pagination.pageIndex + 1,
    page_size: pagination.pageSize,
  };
  const list = useQuery({
    queryKey: ak.platform.users(params),
    queryFn: ({ signal }) => api.get<Page<PlatformUserOut>>("/platform/users", { signal, query: params }),
    placeholderData: keepPreviousData,
  });
  const reset = () => setPagination((p) => ({ ...p, pageIndex: 0 }));
  const columns = React.useMemo<ColumnDef<PlatformUserOut, unknown>[]>(
    () => [
      {
        accessorKey: "full_name",
        header: "User",
        cell: ({ row }) => (
          <div className="flex min-w-[14rem] items-center gap-3">
            <Avatar name={row.original.full_name} size="sm" />
            <div className="min-w-0">
              <p className="truncate font-semibold text-slate-900">
                {row.original.full_name}
                {row.original.id === me?.id && <span className="ml-1.5 text-xs font-medium text-brand-700">(you)</span>}
              </p>
              <p className="truncate text-xs text-muted-foreground">{row.original.email}</p>
            </div>
          </div>
        ),
      },
      {
        id: "access",
        header: "Access",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.is_superadmin ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-rose-500 to-fuchsia-500 px-2 py-0.5 text-2xs font-bold text-white">
                <Crown className="size-3" aria-hidden /> Super admin
              </span>
            ) : (
              <span className="text-xs text-slate-500">Standard</span>
            )}
            {row.original.mfa_enabled && (
              <Badge tone="success" size="sm">
                <ShieldCheck aria-hidden /> MFA
              </Badge>
            )}
          </div>
        ),
      },
      { accessorKey: "status", header: "Status", cell: ({ row }) => <StatusPill status={row.original.status === "deleted" ? "archived" : row.original.status} label={row.original.status === "deleted" ? "Deleted" : undefined} size="sm" /> },
      { accessorKey: "organisation_count", header: "Orgs", cell: ({ row }) => <span className="tabular-nums text-slate-800">{row.original.organisation_count}</span> },
      {
        accessorKey: "last_login_at",
        header: "Last sign-in",
        cell: ({ row }) => <span className="whitespace-nowrap text-slate-600">{row.original.last_login_at ? formatRelative(row.original.last_login_at) : <span className="text-slate-400">Never</span>}</span>,
      },
      { accessorKey: "created_at", header: "Joined", cell: ({ row }) => <span className="whitespace-nowrap text-slate-600">{formatDate(row.original.created_at)}</span> },
    ],
    [me?.id],
  );
  if (list.isError) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  const granting = confirm && !confirm.is_superadmin;
  return (
    <>
      <DataTable
        aria-label="Platform users"
        columns={columns}
        data={list.data?.items ?? []}
        loading={list.isLoading}
        total={list.data?.total ?? 0}
        pagination={pagination}
        onPaginationChange={setPagination}
        getRowId={(r) => r.id}
        toolbar={
          <FilterBar search={q} onSearchChange={(v) => { setQ(v); reset(); }} searchPlaceholder="Search name or email…">
            <SimpleSelect aria-label="Access" value={role} onValueChange={(v) => { setRole(v); reset(); }} className="h-9 w-40" options={[{ value: ALL, label: "Everyone" }, { value: "super", label: "Super admins" }, { value: "standard", label: "Standard users" }]} />
            <SimpleSelect
              aria-label="Status"
              value={status}
              onValueChange={(v) => { setStatus(v); reset(); }}
              className="h-9 w-36"
              options={[
                { value: ALL, label: "Any status" },
                { value: "active", label: "Active" },
                { value: "suspended", label: "Suspended" },
                { value: "deleted", label: "Deleted" },
              ]}
            />
          </FilterBar>
        }
        rowActions={[
          { label: "Grant super admin", icon: <Crown className="size-4" />, onSelect: setConfirm, hidden: (r) => r.is_superadmin || r.status !== "active" },
          { label: "Revoke super admin", icon: <ShieldOff className="size-4" />, destructive: true, onSelect: setConfirm, hidden: (r) => !r.is_superadmin || r.id === me?.id },
        ]}
        empty={{ title: "No users match", description: "Try a different search or filter." }}
      />
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        destructive={!granting}
        title={granting ? `Make ${confirm?.full_name} a super admin?` : `Revoke super admin from ${confirm?.full_name}?`}
        description={
          granting
            ? "Super admins can see and change every organisation, user, plan and platform setting. Grant this only to trusted Praxis staff with MFA enabled."
            : "They'll keep their normal organisation memberships but lose access to the platform console."
        }
        confirmText={granting ? confirm?.email : undefined}
        confirmLabel={granting ? "Grant super admin" : "Revoke access"}
        onConfirm={async () => {
          try {
            await api.put(`/platform/users/${confirm!.id}/superadmin`, { is_superadmin: !confirm!.is_superadmin });
            toast.success(granting ? "Super admin granted" : "Super admin revoked");
            qc.invalidateQueries({ queryKey: ["platform", "users"] });
          } catch (e) {
            toastError(e);
          }
        }}
      >
        {granting && !confirm?.mfa_enabled && <p className="rounded-xl bg-amber-50 p-3 text-xs font-medium text-amber-900">This user doesn&apos;t have MFA enabled.</p>}
      </ConfirmDialog>
    </>
  );
}
