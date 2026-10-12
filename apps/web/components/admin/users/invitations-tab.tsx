"use client";

import type { Page } from "@praxis/types";
import { Badge, Button, ConfirmDialog, DataTable, FilterBar, SimpleSelect, StatusPill, toast, type ColumnDef } from "@praxis/ui";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MailPlus, RotateCw, XCircle } from "lucide-react";
import * as React from "react";
import { ErrorState } from "@/components/common/error-state";
import { api } from "@/lib/api";
import { daysUntil, formatDate, formatRelative } from "@/lib/format";
import { ak } from "../keys";
import { useDepartments, useRoles } from "../pickers";
import type { InvitationOut } from "../types";
import { RoleChip, toastError } from "../ui";

export function InvitationsTab({ onInvite }: { onInvite: () => void }) {
  const qc = useQueryClient();
  const [status, setStatus] = React.useState("pending");
  const [q, setQ] = React.useState("");
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize: 20 });
  const [revoke, setRevoke] = React.useState<InvitationOut | null>(null);
  const roles = useRoles();
  const depts = useDepartments();
  const roleName = (k: string) => roles.data?.find((r) => r.key === k)?.name;
  const deptName = (id: string | null) => (id ? depts.data?.find((d) => d.id === id)?.name : null);

  const params = { status: status === "all" ? undefined : status, q: q || undefined, page: pagination.pageIndex + 1, page_size: pagination.pageSize };
  const list = useQuery({
    queryKey: ak.invitations.list(params),
    queryFn: ({ signal }) => api.get<Page<InvitationOut>>("/invitations", { signal, query: params }),
    placeholderData: keepPreviousData,
  });

  const resend = useMutation({
    mutationFn: (inv: InvitationOut) => api.post<InvitationOut>(`/invitations/${inv.id}/resend`),
    onSuccess: (inv) => {
      toast.success(`Invitation re-sent to ${inv.email}`);
      qc.invalidateQueries({ queryKey: ak.invitations.all });
    },
    onError: (e) => toastError(e),
  });

  const columns = React.useMemo<ColumnDef<InvitationOut, unknown>[]>(
    () => [
      {
        accessorKey: "email",
        header: "Email",
        cell: ({ row }) => <span className="font-medium text-slate-900">{row.original.email}</span>,
      },
      {
        id: "roles",
        header: "Roles",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.role_keys.map((k) => (
              <RoleChip key={k} roleKey={k} name={roleName(k)} />
            ))}
          </div>
        ),
      },
      {
        id: "department",
        header: "Department",
        enableSorting: false,
        cell: ({ row }) => <span className="text-slate-700">{deptName(row.original.department_id) ?? "—"}</span>,
      },
      { accessorKey: "status", header: "Status", cell: ({ row }) => <StatusPill status={row.original.status} size="sm" /> },
      {
        accessorKey: "created_at",
        header: "Sent",
        cell: ({ row }) => <span className="whitespace-nowrap text-slate-600">{formatRelative(row.original.created_at)}</span>,
      },
      {
        accessorKey: "expires_at",
        header: "Expires",
        cell: ({ row }) => {
          const d = daysUntil(row.original.expires_at);
          if (row.original.status !== "pending") return <span className="text-slate-500">{formatDate(row.original.expires_at)}</span>;
          return (
            <Badge tone={d !== null && d <= 1 ? "warning" : "neutral"} size="sm">
              {d !== null && d <= 0 ? "Today" : `In ${d} day${d === 1 ? "" : "s"}`}
            </Badge>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roles.data, depts.data],
  );

  if (list.isError) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;

  return (
    <>
      <DataTable
        aria-label="Invitations"
        columns={columns}
        data={list.data?.items ?? []}
        loading={list.isLoading}
        total={list.data?.total ?? 0}
        pagination={pagination}
        onPaginationChange={setPagination}
        getRowId={(r) => r.id}
        columnToggle={false}
        toolbar={
          <FilterBar search={q} onSearchChange={(v) => { setQ(v); setPagination((p) => ({ ...p, pageIndex: 0 })); }} searchPlaceholder="Search email…">
            <SimpleSelect
              aria-label="Invitation status"
              value={status}
              onValueChange={(v) => {
                setStatus(v);
                setPagination((p) => ({ ...p, pageIndex: 0 }));
              }}
              className="h-9 w-40"
              options={[
                { value: "pending", label: "Pending" },
                { value: "expired", label: "Expired" },
                { value: "accepted", label: "Accepted" },
                { value: "revoked", label: "Revoked" },
                { value: "all", label: "All statuses" },
              ]}
            />
          </FilterBar>
        }
        rowActions={[
          { label: "Resend invitation", icon: <RotateCw className="size-4" />, onSelect: (r) => resend.mutate(r), hidden: (r) => !["pending", "expired"].includes(r.status) },
          { label: "Revoke", icon: <XCircle className="size-4" />, destructive: true, onSelect: setRevoke, hidden: (r) => r.status !== "pending", separatorBefore: true },
        ]}
        empty={{
          title: status === "pending" ? "No pending invitations" : "No invitations found",
          description: "Invite colleagues by email or import a CSV — they'll show up here until they accept.",
          action: (
            <Button variant="soft" leftIcon={<MailPlus />} onClick={onInvite}>
              Invite people
            </Button>
          ),
        }}
      />
      <ConfirmDialog
        open={!!revoke}
        onOpenChange={(o) => !o && setRevoke(null)}
        destructive
        title="Revoke this invitation?"
        description={revoke ? `${revoke.email} will no longer be able to use their invitation link.` : undefined}
        confirmLabel="Revoke invitation"
        onConfirm={async () => {
          try {
            await api.delete(`/invitations/${revoke!.id}`);
            toast.success("Invitation revoked");
            qc.invalidateQueries({ queryKey: ak.invitations.all });
          } catch (e) {
            toastError(e);
          }
        }}
      />
    </>
  );
}
