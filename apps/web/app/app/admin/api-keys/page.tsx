"use client";

import type { Page } from "@praxis/types";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  PageHeader,
  SimpleSelect,
  StatusPill,
  Switch,
  cn,
  humanize,
  toast,
  type ColumnDef,
} from "@praxis/ui";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Code2, KeyRound, Plus, ShieldCheck, Trash2 } from "lucide-react";
import * as React from "react";
import { ak } from "@/components/admin/keys";
import type { ApiKeyCreated, ApiKeyOut, PermissionOut } from "@/components/admin/types";
import { CopyButton, PageGate, UpgradeNotice, isPlanLimit, toastError } from "@/components/admin/ui";
import { ErrorState } from "@/components/common/error-state";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { daysUntil, formatDate, formatRelative } from "@/lib/format";

const EXPIRY = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "180", label: "6 months" },
  { value: "365", label: "1 year" },
  { value: "730", label: "2 years" },
  { value: "never", label: "Never expires" },
];

function CreateKeyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { permissions, can } = useAuth();
  const catalogue = useQuery({
    queryKey: ak.roles.permissions,
    queryFn: ({ signal }) => api.get<PermissionOut[]>("/roles/permissions", { signal }),
    enabled: open && can("roles.manage"),
    staleTime: 300_000,
  });
  const [name, setName] = React.useState("");
  const [scopes, setScopes] = React.useState<string[]>([]);
  const [expiry, setExpiry] = React.useState("90");
  const [created, setCreated] = React.useState<ApiKeyCreated | null>(null);
  const [ack, setAck] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setName("");
      setScopes([]);
      setExpiry("90");
      setCreated(null);
      setAck(false);
      create.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const mine = [...permissions].filter((p) => p !== "system.manage").sort();
  const desc = new Map((catalogue.data ?? []).map((p) => [p.code, p.description]));
  const groups = new Map<string, string[]>();
  for (const p of mine) {
    const cat = catalogue.data?.find((x) => x.code === p)?.category ?? p.split(".")[0]!;
    groups.set(cat, [...(groups.get(cat) ?? []), p]);
  }

  const create = useMutation({
    mutationFn: () => api.post<ApiKeyCreated>("/api-keys", { name: name.trim(), scopes, expires_in_days: expiry === "never" ? null : Number(expiry) }),
    onSuccess: (k) => {
      setCreated(k);
      qc.invalidateQueries({ queryKey: ak.apiKeys.all });
      toast.success("API key created");
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => (created && !ack ? undefined : onOpenChange(o))}>
      <DialogContent size="lg" hideClose={!!created && !ack}>
        <DialogHeader>
          <span className="mb-1 grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-orange-400 to-rose-500 text-white shadow-sm">
            <KeyRound className="size-5" aria-hidden />
          </span>
          <DialogTitle>{created ? "Copy your new API key" : "Create API key"}</DialogTitle>
          <DialogDescription>
            {created ? "This is the only time the full key is shown. Store it in a secrets manager — Praxis keeps only a hash." : "Keys act on behalf of the organisation with the scopes you choose (a subset of your own permissions)."}
          </DialogDescription>
        </DialogHeader>
        {created ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-4">
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-900">
                <AlertTriangle className="size-4" aria-hidden /> Secret — shown once
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <code className="flex-1 select-all break-all rounded-xl bg-white px-3 py-2.5 font-mono text-sm text-slate-900 ring-1 ring-amber-200">{created.key}</code>
                <CopyButton value={created.key} label="Copy key" variant="secondary" />
              </div>
            </div>
            <div className="rounded-2xl bg-slate-900 p-4 text-xs text-slate-100">
              <p className="mb-1 font-semibold text-slate-300">Example</p>
              <code className="block whitespace-pre-wrap break-all font-mono">{`curl -H "X-API-Key: ${created.key}" \\\n  ${typeof window !== "undefined" ? window.location.origin : ""}/api/v1/courses`}</code>
            </div>
            <label htmlFor="api-key-ack" className="flex items-center gap-3 text-sm font-medium text-slate-800">
              <Checkbox id="api-key-ack" checked={ack} onCheckedChange={(v) => setAck(v === true)} />
              I&apos;ve stored this key somewhere safe
            </label>
            <DialogFooter>
              <Button disabled={!ack} onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim() && scopes.length) create.mutate();
            }}
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Name" required hint="Where will this key be used?">
                <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="e.g. HRIS sync" autoFocus />
              </FormField>
              <FormField label="Expires" hint="Rotate keys regularly.">
                <SimpleSelect value={expiry} onValueChange={setExpiry} options={EXPIRY} />
              </FormField>
            </div>
            <fieldset>
              <div className="mb-2 flex items-center justify-between">
                <legend className="text-sm font-medium text-slate-800">
                  Scopes <span className="text-rose-600">*</span>
                </legend>
                <span className="text-xs text-muted-foreground">
                  {scopes.length} selected ·{" "}
                  <button type="button" className="font-semibold text-brand-700 hover:underline" onClick={() => setScopes(scopes.length === mine.length ? [] : mine)}>
                    {scopes.length === mine.length ? "Clear" : "Select all"}
                  </button>
                </span>
              </div>
              <div className="max-h-72 space-y-3 overflow-y-auto rounded-2xl border border-slate-200 p-3 scrollbar-thin">
                {[...groups.entries()].map(([cat, codes]) => (
                  <div key={cat}>
                    <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-slate-500">{humanize(cat)}</p>
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      {codes.map((code) => {
                        const on = scopes.includes(code);
                        return (
                          <label key={code} className={cn("flex cursor-pointer items-start gap-2.5 rounded-xl p-2 transition-colors", on ? "bg-orange-50 ring-1 ring-orange-200" : "hover:bg-slate-50")}>
                            <Checkbox checked={on} onCheckedChange={(v) => setScopes((s) => (v ? [...s, code] : s.filter((x) => x !== code)))} className="mt-0.5" />
                            <span className="min-w-0">
                              <span className="block font-mono text-xs font-semibold text-slate-800">{code}</span>
                              {desc.get(code) && <span className="block text-xs text-muted-foreground">{desc.get(code)}</span>}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </fieldset>
            {create.isError &&
              (isPlanLimit(create.error) ? (
                <UpgradeNotice error={create.error} compact />
              ) : (
                <Alert tone="danger" title="Couldn't create the key">
                  {errorMessage(create.error)}
                </Alert>
              ))}
            <DialogFooter>
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="gradient" loading={create.isPending} disabled={!name.trim() || !scopes.length}>
                Create key
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ApiKeysPage() {
  const qc = useQueryClient();
  const [showRevoked, setShowRevoked] = React.useState(false);
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize: 20 });
  const [create, setCreate] = React.useState(false);
  const [revoke, setRevoke] = React.useState<ApiKeyOut | null>(null);
  const params = { include_revoked: showRevoked, page: pagination.pageIndex + 1, page_size: pagination.pageSize };
  const list = useQuery({
    queryKey: ak.apiKeys.list(params),
    queryFn: ({ signal }) => api.get<Page<ApiKeyOut>>("/api-keys", { signal, query: params }),
    placeholderData: keepPreviousData,
  });

  const columns = React.useMemo<ColumnDef<ApiKeyOut, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Key",
        cell: ({ row }) => (
          <div className="flex min-w-[12rem] items-center gap-3">
            <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", row.original.status === "active" ? "bg-gradient-to-br from-orange-400 to-rose-500 text-white" : "bg-slate-100 text-slate-400")}>
              <KeyRound className="size-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="truncate font-semibold text-slate-900">{row.original.name}</p>
              <p className="font-mono text-xs text-slate-500">{row.original.prefix}••••••••</p>
            </div>
          </div>
        ),
      },
      {
        id: "scopes",
        header: "Scopes",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex max-w-xs flex-wrap gap-1">
            {row.original.scopes.slice(0, 3).map((s) => (
              <span key={s} className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-2xs font-medium text-slate-700">
                {s}
              </span>
            ))}
            {row.original.scopes.length > 3 && (
              <span className="rounded-md bg-orange-50 px-1.5 py-0.5 text-2xs font-semibold text-orange-800" title={row.original.scopes.slice(3).join(", ")}>
                +{row.original.scopes.length - 3}
              </span>
            )}
          </div>
        ),
      },
      { accessorKey: "status", header: "Status", cell: ({ row }) => <StatusPill status={row.original.status} size="sm" /> },
      {
        accessorKey: "last_used_at",
        header: "Last used",
        cell: ({ row }) => <span className="whitespace-nowrap text-slate-600">{row.original.last_used_at ? formatRelative(row.original.last_used_at) : <span className="text-slate-400">Never</span>}</span>,
      },
      {
        accessorKey: "expires_at",
        header: "Expires",
        cell: ({ row }) => {
          const d = daysUntil(row.original.expires_at);
          if (!row.original.expires_at) return <span className="text-slate-500">Never</span>;
          return (
            <Badge tone={d !== null && d < 0 ? "danger" : d !== null && d <= 14 ? "warning" : "neutral"} size="sm">
              {formatDate(row.original.expires_at)}
            </Badge>
          );
        },
      },
      { accessorKey: "created_at", header: "Created", cell: ({ row }) => <span className="whitespace-nowrap text-slate-600">{formatDate(row.original.created_at)}</span> },
    ],
    [],
  );

  const gated = list.isError && isPlanLimit(list.error);

  return (
    <>
      <PageHeader
        icon={<KeyRound />}
        eyebrow="Manage"
        title="API keys"
        description="Connect HRIS, LMS and BI tools to Praxis with scoped, revocable keys."
        actions={
          !gated && (
            <Button variant="gradient" leftIcon={<Plus />} onClick={() => setCreate(true)}>
              Create API key
            </Button>
          )
        }
      />
      {gated ? (
        <div className="space-y-6">
          <UpgradeNotice error={list.error} title="API access isn't included in your plan" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {[
              { icon: Code2, title: "REST API", body: "Everything in the web app — users, enrolments, progress, reports — over a documented JSON API." },
              { icon: ShieldCheck, title: "Scoped & audited", body: "Keys carry only the permissions you grant, expire on schedule and every call is in the audit log." },
              { icon: KeyRound, title: "Instant revocation", body: "Revoke a key and it stops working immediately — no redeploys needed." },
            ].map((f) => (
              <div key={f.title} className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-soft">
                <f.icon className="size-6 text-orange-600" aria-hidden />
                <p className="mt-3 font-display font-semibold text-slate-900">{f.title}</p>
                <p className="mt-1 text-sm text-slate-600">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : (
        <DataTable
          aria-label="API keys"
          columns={columns}
          data={list.data?.items ?? []}
          loading={list.isLoading}
          total={list.data?.total ?? 0}
          pagination={pagination}
          onPaginationChange={setPagination}
          getRowId={(r) => r.id}
          columnToggle={false}
          toolbar={
            <label htmlFor="api-keys-show-revoked" className="flex items-center gap-2.5 text-sm font-medium text-slate-700">
              <Switch id="api-keys-show-revoked" checked={showRevoked} onCheckedChange={(v) => { setShowRevoked(v); setPagination((p) => ({ ...p, pageIndex: 0 })); }} aria-label="Show revoked keys" />
              Show revoked &amp; expired keys
            </label>
          }
          rowActions={[{ label: "Revoke key", icon: <Trash2 className="size-4" />, destructive: true, onSelect: setRevoke, hidden: (r) => r.status !== "active" }]}
          empty={{
            title: "No API keys yet",
            description: "Create a key to integrate Praxis with your other systems.",
            action: (
              <Button variant="soft" leftIcon={<Plus />} onClick={() => setCreate(true)}>
                Create API key
              </Button>
            ),
          }}
        />
      )}
      <CreateKeyDialog open={create} onOpenChange={setCreate} />
      <ConfirmDialog
        open={!!revoke}
        onOpenChange={(o) => !o && setRevoke(null)}
        destructive
        title={`Revoke “${revoke?.name}”?`}
        description="Any integration using this key will immediately get 401 errors. This can't be undone — create a new key to restore access."
        confirmText={revoke?.name}
        confirmLabel="Revoke key"
        onConfirm={async () => {
          try {
            await api.delete(`/api-keys/${revoke!.id}`);
            toast.success("API key revoked");
            qc.invalidateQueries({ queryKey: ak.apiKeys.all });
          } catch (e) {
            toastError(e);
          }
        }}
      />
    </>
  );
}

export default function Page() {
  return (
    <PageGate permission="api_keys.manage">
      <ApiKeysPage />
    </PageGate>
  );
}
