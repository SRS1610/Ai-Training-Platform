"use client";

import type { Page } from "@praxis/types";
import {
  Alert,
  Badge,
  Button,
  DataTable,
  FilterBar,
  Input,
  PageHeader,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  cn,
  colorClasses,
  colorFor,
  humanize,
  toast,
  type ColumnDef,
} from "@praxis/ui";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Bot, Download, FileClock, Fingerprint, Globe, KeyRound, Link2, ShieldCheck, ShieldX, User, Workflow } from "lucide-react";
import * as React from "react";
import { Suspense } from "react";
import { ak } from "@/components/admin/keys";
import type { AuditLogOut, ChainVerification } from "@/components/admin/types";
import { CopyButton, JsonView, Meta, PageGate, fmtNumber, toastError, useSetUrlParams, useUrlState } from "@/components/admin/ui";
import { ErrorState } from "@/components/common/error-state";
import { api } from "@/lib/api";
import { formatDateTime, formatRelative } from "@/lib/format";

function ActionChip({ action }: { action: string }) {
  const [domain, ...rest] = action.split(".");
  const c = colorClasses(colorFor(domain));
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-2 py-0.5 font-mono text-xs font-semibold ring-1 ring-inset", c.soft, c.text, c.ring)}>
      <span className={cn("size-1.5 rounded-full", c.solid)} aria-hidden />
      {domain}
      {rest.length > 0 && <span className="font-normal opacity-80">.{rest.join(".")}</span>}
    </span>
  );
}

function ActorIcon({ type }: { type: string }) {
  const Icon = type === "api_key" ? KeyRound : type === "system" ? Workflow : type === "ai" ? Bot : User;
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-600" aria-hidden>
      <Icon className="size-4" />
    </span>
  );
}

const toIso = (d: string, end = false) => (d ? new Date(`${d}T${end ? "23:59:59" : "00:00:00"}`).toISOString() : undefined);

function AuditPage() {
  const [action, setAction] = useUrlState("action");
  const [actor, setActor] = useUrlState("actor");
  const [entity, setEntity] = useUrlState("entity");
  const [from, setFrom] = useUrlState("from");
  const [to, setTo] = useUrlState("to");
  const setMany = useSetUrlParams();
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize: 25 });
  const [open, setOpen] = React.useState<AuditLogOut | null>(null);
  const [verify, setVerify] = React.useState<ChainVerification | null>(null);
  React.useEffect(() => setPagination((p) => ({ ...p, pageIndex: 0 })), [action, actor, entity, from, to]);

  const filters = { action: action || undefined, actor: actor || undefined, entity_type: entity || undefined, date_from: toIso(from), date_to: toIso(to, true) };
  const params = { ...filters, page: pagination.pageIndex + 1, page_size: pagination.pageSize };
  const list = useQuery({
    queryKey: ak.audit.list(params),
    queryFn: ({ signal }) => api.get<Page<AuditLogOut>>("/audit-logs", { signal, query: params }),
    placeholderData: keepPreviousData,
  });
  const verifyM = useMutation({
    mutationFn: () => api.get<ChainVerification>("/audit-logs/verify"),
    onSuccess: (r) => setVerify(r),
    onError: (e) => toastError(e),
  });
  const exportM = useMutation({
    mutationFn: () => api.download("/audit-logs/export", { query: filters }),
    onSuccess: (f) => toast.success("Audit log exported", { description: f }),
    onError: (e) => toastError(e),
  });

  const columns = React.useMemo<ColumnDef<AuditLogOut, unknown>[]>(
    () => [
      {
        accessorKey: "created_at",
        header: "When",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="whitespace-nowrap">
            <p className="text-slate-900">{formatDateTime(row.original.created_at)}</p>
            <p className="text-xs text-muted-foreground">{formatRelative(row.original.created_at)}</p>
          </div>
        ),
      },
      {
        id: "actor",
        header: "Actor",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex min-w-[11rem] items-center gap-2.5">
            <ActorIcon type={row.original.actor_type} />
            <div className="min-w-0">
              <p className="truncate font-medium text-slate-900">{row.original.actor_label ?? "System"}</p>
              <p className="text-xs text-muted-foreground">{humanize(row.original.actor_type)}</p>
            </div>
          </div>
        ),
      },
      { accessorKey: "action", header: "Action", enableSorting: false, cell: ({ row }) => <ActionChip action={row.original.action} /> },
      {
        id: "entity",
        header: "Entity",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.entity_type ? (
            <div className="min-w-[8rem]">
              <p className="text-slate-800">{humanize(row.original.entity_type)}</p>
              {row.original.entity_id && <p className="truncate font-mono text-2xs text-slate-500">{row.original.entity_id.slice(0, 13)}…</p>}
            </div>
          ) : (
            <span className="text-slate-400">—</span>
          ),
      },
      { accessorKey: "ip_address", header: "IP", enableSorting: false, meta: { label: "IP" }, cell: ({ row }) => <span className="font-mono text-xs text-slate-600">{row.original.ip_address ?? "—"}</span> },
    ],
    [],
  );

  const chips = [
    action && { key: "action", label: `Action: ${action}`, onRemove: () => setAction("") },
    actor && { key: "actor", label: `Actor: ${actor}`, onRemove: () => setActor("") },
    entity && { key: "entity", label: `Entity: ${entity}`, onRemove: () => setEntity("") },
    from && { key: "from", label: `From ${from}`, onRemove: () => setFrom("") },
    to && { key: "to", label: `To ${to}`, onRemove: () => setTo("") },
  ].filter(Boolean) as { key: string; label: string; onRemove: () => void }[];

  return (
    <>
      <PageHeader
        icon={<FileClock />}
        eyebrow="Governance"
        title="Audit log"
        description="An append-only, hash-chained record of every administrative and security event."
        actions={
          <>
            <Button variant="secondary" leftIcon={<Download />} loading={exportM.isPending} onClick={() => exportM.mutate()}>
              Export CSV
            </Button>
            <Button variant="gradient" leftIcon={<Fingerprint />} loading={verifyM.isPending} onClick={() => verifyM.mutate()}>
              Verify integrity
            </Button>
          </>
        }
      />
      {verify && (
        <div aria-live="polite" className="mb-6">
          {verify.valid ? (
            <div className="flex flex-col gap-3 rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 via-teal-50 to-white p-4 sm:flex-row sm:items-center">
              <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-sm">
                <ShieldCheck className="size-6" aria-hidden />
              </span>
              <div className="flex-1">
                <p className="font-display font-semibold text-emerald-900">Audit chain verified</p>
                <p className="text-sm text-emerald-800">
                  All {fmtNumber(verify.checked)} entries were checked — every hash links to the previous one, so no record has been altered or removed.
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setVerify(null)}>
                Dismiss
              </Button>
            </div>
          ) : (
            <Alert tone="danger" title="Integrity check failed" icon={<ShieldX aria-hidden />} action={<Button variant="secondary" size="sm" onClick={() => setVerify(null)}>Dismiss</Button>}>
              The hash chain breaks {verify.broken_at ? <>at entry <code className="font-mono font-semibold">{verify.broken_at}</code></> : "in the log"} after checking {fmtNumber(verify.checked)} entries.
              Records may have been modified outside Praxis — escalate to your security team.
            </Alert>
          )}
        </div>
      )}
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : (
        <DataTable
          aria-label="Audit log entries"
          columns={columns}
          data={list.data?.items ?? []}
          loading={list.isLoading}
          total={list.data?.total ?? 0}
          pagination={pagination}
          onPaginationChange={setPagination}
          getRowId={(r) => r.id}
          onRowClick={setOpen}
          toolbar={
            <FilterBar
              search={actor}
              onSearchChange={setActor}
              searchPlaceholder="Actor email or key…"
              chips={chips}
              onClearAll={chips.length > 1 ? () => setMany({ action: null, actor: null, entity: null, from: null, to: null }) : undefined}
            >
              <DebouncedInput value={action} onChange={setAction} placeholder="Action, e.g. member. or role.updated" label="Action" className="w-full sm:w-64" />
              <DebouncedInput value={entity} onChange={setEntity} placeholder="Entity type" label="Entity type" className="w-full sm:w-36" />
              <label htmlFor="audit-from" className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                From
                <Input id="audit-from" type="date" inputSize="sm" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="w-[9.5rem]" />
              </label>
              <label htmlFor="audit-to" className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                To
                <Input id="audit-to" type="date" inputSize="sm" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="w-[9.5rem]" />
              </label>
            </FilterBar>
          }
          empty={{ title: chips.length ? "No entries match these filters" : "No audit events yet", description: "Administrative and security events are recorded here automatically." }}
        />
      )}

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent className="max-w-xl overflow-y-auto">
          {open && (
            <>
              <SheetHeader>
                <div className="mb-1">
                  <ActionChip action={open.action} />
                </div>
                <SheetTitle>{humanize(open.action.replace(/\./g, " "))}</SheetTitle>
                <SheetDescription>{formatDateTime(open.created_at)} · {formatRelative(open.created_at)}</SheetDescription>
              </SheetHeader>
              <div className="space-y-6 px-6 pb-8">
                <dl className="grid grid-cols-2 gap-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                  <Meta label="Actor">{open.actor_label ?? "System"}</Meta>
                  <Meta label="Actor type">{humanize(open.actor_type)}</Meta>
                  <Meta label="Entity">{open.entity_type ? humanize(open.entity_type) : "—"}</Meta>
                  <Meta label="Entity ID">
                    <span className="font-mono text-xs">{open.entity_id ?? "—"}</span>
                  </Meta>
                  <Meta label={<span className="inline-flex items-center gap-1"><Globe className="size-3" aria-hidden />IP address</span>}>
                    <span className="font-mono text-xs">{open.ip_address ?? "—"}</span>
                  </Meta>
                  <Meta label="Request ID">
                    <span className="font-mono text-xs">{open.request_id ?? "—"}</span>
                  </Meta>
                  <Meta label="User agent" className="col-span-2">
                    <span className="whitespace-normal break-words text-xs font-normal text-slate-700">{open.user_agent ?? "—"}</span>
                  </Meta>
                </dl>
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-900">Metadata</h3>
                    <CopyButton value={JSON.stringify(open.meta, null, 2)} size="xs" variant="ghost" />
                  </div>
                  <JsonView value={open.meta} />
                </div>
                <div className="space-y-2 rounded-2xl border border-violet-200 bg-violet-50/50 p-4">
                  <p className="flex items-center gap-2 text-sm font-semibold text-violet-900">
                    <Link2 className="size-4" aria-hidden /> Hash chain
                  </p>
                  <div>
                    <p className="text-xs font-medium text-violet-800">This entry</p>
                    <p className="break-all font-mono text-2xs text-slate-700">{open.hash}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-violet-800">Previous entry</p>
                    <p className="break-all font-mono text-2xs text-slate-700">{open.prev_hash ?? "— (first entry)"}</p>
                  </div>
                </div>
                <Badge tone="neutral">Entries are immutable and can&apos;t be edited or deleted.</Badge>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

function DebouncedInput({ value, onChange, placeholder, label, className }: { value: string; onChange: (v: string) => void; placeholder: string; label: string; className?: string }) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => setV(value), [value]);
  React.useEffect(() => {
    if (v === value) return;
    const t = setTimeout(() => onChange(v.trim()), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);
  return (
    <div className={className}>
      <Input inputSize="sm" value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} aria-label={label} className="font-mono text-xs" />
    </div>
  );
}

export default function Page() {
  return (
    <PageGate permission="audit.view">
      <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
        <AuditPage />
      </Suspense>
    </PageGate>
  );
}
