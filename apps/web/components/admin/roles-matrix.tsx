"use client";

/**
 * Roles × permissions matrix editor. Rows are permissions grouped by category (colourful headers), columns are
 * roles. System roles are read-only unless the viewer is a super admin; custom roles are fully editable.
 * Edits are staged locally and saved per role (PATCH /roles/{id}).
 */

import {
  Alert,
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  FormField,
  Input,
  SimpleSelect,
  Skeleton,
  Textarea,
  Tooltip,
  cn,
  colorClasses,
  humanize,
  toast,
  type CategoryColor,
} from "@praxis/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  BookOpen,
  Bot,
  Check,
  Building2,
  ClipboardCheck,
  GraduationCap,
  Lock,
  type LucideIcon,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  ScrollText,
  ShieldCheck,
  Trash2,
  UsersRound,
} from "lucide-react";
import * as React from "react";
import { ErrorState } from "@/components/common/error-state";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ak } from "./keys";
import type { PermissionOut, RoleOut } from "./types";
import { roleColor, toastError } from "./ui";

const CATEGORY: Record<string, { label: string; color: CategoryColor; icon: LucideIcon; blurb: string }> = {
  users: { label: "People", color: "sky", icon: UsersRound, blurb: "Members, invitations and roles" },
  organisation: { label: "Organisation", color: "indigo", icon: Building2, blurb: "Settings, billing and integrations" },
  content: { label: "Content", color: "violet", icon: GraduationCap, blurb: "Courses, lessons, assessments and simulations" },
  learning: { label: "Learning", color: "emerald", icon: BookOpen, blurb: "Learner access and enrolments" },
  assessment: { label: "Assessment", color: "amber", icon: ClipboardCheck, blurb: "Grading and certificates" },
  insight: { label: "Insight", color: "teal", icon: BarChart3, blurb: "Analytics and reports" },
  ai: { label: "AI", color: "fuchsia", icon: Bot, blurb: "AI configuration and knowledge" },
  governance: { label: "Governance", color: "rose", icon: ScrollText, blurb: "Audit and compliance" },
};
const ORDER = ["users", "organisation", "content", "learning", "assessment", "insight", "ai", "governance"];

function catMeta(c: string) {
  return CATEGORY[c] ?? { label: humanize(c), color: "indigo" as CategoryColor, icon: ShieldCheck, blurb: "" };
}

const sameSet = (a: Set<string>, b: string[]) => a.size === b.length && b.every((x) => a.has(x));

export function RolesMatrix() {
  const qc = useQueryClient();
  const { user, permissions: mine } = useAuth();
  const superadmin = !!user?.is_superadmin;
  const roles = useQuery({ queryKey: ak.roles.all, queryFn: ({ signal }) => api.get<RoleOut[]>("/roles", { signal }) });
  const catalogue = useQuery({ queryKey: ak.roles.permissions, queryFn: ({ signal }) => api.get<PermissionOut[]>("/roles/permissions", { signal }) });
  const [drafts, setDrafts] = React.useState<Record<string, Set<string>>>({});
  const [dialog, setDialog] = React.useState<DialogState>(null);
  const [del, setDel] = React.useState<RoleOut | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [filter, setFilter] = React.useState<"all" | "custom" | "system">("all");

  const grouped = React.useMemo(() => {
    const g = new Map<string, PermissionOut[]>();
    for (const p of catalogue.data ?? []) g.set(p.category, [...(g.get(p.category) ?? []), p]);
    const rank = (c: string) => (ORDER.includes(c) ? ORDER.indexOf(c) : ORDER.length);
    return [...g.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]));
  }, [catalogue.data]);

  const sorted = React.useMemo(
    () => [...(roles.data ?? [])].sort((a, b) => Number(b.is_system) - Number(a.is_system) || b.permissions.length - a.permissions.length || a.name.localeCompare(b.name)),
    [roles.data],
  );
  const shown = sorted.filter((r) => filter === "all" || (filter === "custom" ? !r.is_system : r.is_system));

  const editable = (r: RoleOut) => !r.is_system || superadmin;
  const current = (r: RoleOut) => drafts[r.id] ?? new Set(r.permissions);
  const changed = (roles.data ?? []).filter((r) => drafts[r.id] && !sameSet(drafts[r.id]!, r.permissions));

  const toggle = (r: RoleOut, codes: string[], on: boolean) => {
    setDrafts((d) => {
      const next = new Set(d[r.id] ?? r.permissions);
      codes.forEach((c) => (on ? next.add(c) : next.delete(c)));
      return { ...d, [r.id]: next };
    });
  };

  const saveAll = async () => {
    setSaving(true);
    let ok = 0;
    for (const r of changed) {
      try {
        await api.patch<RoleOut>(`/roles/${r.id}`, { permissions: [...drafts[r.id]!] });
        ok++;
        setDrafts((d) => {
          const n = { ...d };
          delete n[r.id];
          return n;
        });
      } catch (e) {
        toast.error(`${r.name}: ${errorMessage(e)}`);
      }
    }
    setSaving(false);
    if (ok) toast.success(`Saved permissions for ${ok} role${ok === 1 ? "" : "s"}`);
    qc.invalidateQueries({ queryKey: ak.roles.all });
    qc.invalidateQueries({ queryKey: ["me"] });
  };

  if (roles.isError || catalogue.isError) return <ErrorState error={roles.error ?? catalogue.error} onRetry={() => { roles.refetch(); catalogue.refetch(); }} />;
  if (roles.isLoading || catalogue.isLoading)
    return (
      <div className="space-y-4" aria-busy aria-label="Loading roles">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-[32rem] rounded-2xl" />
      </div>
    );

  const customCount = (roles.data ?? []).filter((r) => !r.is_system).length;

  return (
    <div className="space-y-6">
      {/* Role cards */}
      <section aria-label="Roles" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-xl bg-slate-100 p-1" role="group" aria-label="Show roles">
            {(["all", "system", "custom"] as const).map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
                className={cn("rounded-lg px-3 py-1.5 text-sm font-medium transition-all focus-visible:focus-ring", filter === f ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900")}
              >
                {f === "all" ? `All (${roles.data?.length ?? 0})` : f === "system" ? "System" : `Custom (${customCount})`}
              </button>
            ))}
          </div>
          <Button variant="gradient" leftIcon={<Plus />} onClick={() => setDialog({ mode: "new" })}>
            New custom role
          </Button>
        </div>
        <ul className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {shown.map((r) => {
            const c = colorClasses(roleColor(r.key));
            return (
              <li key={r.id}>
                <article className={cn("relative h-full overflow-hidden rounded-2xl border bg-gradient-to-br p-4 shadow-soft", c.border, c.tint)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="flex items-center gap-1.5 truncate font-display font-semibold text-slate-900">
                        <span className={cn("size-2.5 shrink-0 rounded-full", c.solid)} aria-hidden />
                        {r.name}
                      </h3>
                      <p className="mt-0.5 font-mono text-2xs text-slate-500">{r.key}</p>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`${r.name} actions`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setDialog({ mode: "edit", role: r })}>
                          <Pencil className="size-4" /> Edit name &amp; description
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setDialog({ mode: "new", template: r })}>
                          <Plus className="size-4" /> Duplicate as custom role
                        </DropdownMenuItem>
                        {!r.is_system && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem destructive onSelect={() => setDel(r)}>
                              <Trash2 className="size-4" /> Delete role
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  {r.description && <p className="mt-2 line-clamp-2 text-xs text-slate-600">{r.description}</p>}
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <Badge tone={r.is_system ? "neutral" : "violet"} size="sm">
                      {r.is_system ? <Lock aria-hidden /> : <Pencil aria-hidden />}
                      {r.is_system ? "System" : "Custom"}
                    </Badge>
                    <Badge tone="info" size="sm">
                      <UsersRound aria-hidden />
                      {r.member_count}
                    </Badge>
                    <Badge tone="brand" size="sm">
                      <ShieldCheck aria-hidden />
                      {r.permissions.length} perms
                    </Badge>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Matrix */}
      <section aria-labelledby="matrix-title" className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-soft">
        <div className="flex flex-col gap-2 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div>
            <h2 id="matrix-title" className="font-display text-lg font-semibold text-slate-900">
              Permission matrix
            </h2>
            <p className="text-sm text-muted-foreground">
              {superadmin ? "As a super admin you can also adjust system roles." : "System roles are locked. Duplicate one to customise it."} You can only grant permissions you hold.
            </p>
          </div>
        </div>
        {!shown.length ? (
          <EmptyState size="sm" illustration="shield" title="No custom roles yet" description="Create a custom role to tailor access for your organisation." />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[720px] border-separate border-spacing-0 text-sm">
              <caption className="sr-only">Permissions granted to each role</caption>
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 z-10 min-w-[15rem] border-b border-slate-200 bg-slate-50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Permission
                  </th>
                  {shown.map((r) => {
                    const c = colorClasses(roleColor(r.key));
                    const dirty = changed.some((x) => x.id === r.id);
                    return (
                      <th key={r.id} scope="col" className="min-w-[6.5rem] border-b border-slate-200 bg-slate-50 px-2 py-3 text-center align-bottom">
                        <span className={cn("inline-flex max-w-full items-center gap-1 truncate rounded-full px-2 py-0.5 text-2xs font-semibold ring-1 ring-inset", c.soft, c.text, c.ring)}>
                          {!editable(r) && <Lock className="size-3 shrink-0" aria-label="Locked" />}
                          <span className="truncate">{r.name}</span>
                        </span>
                        <span className="mt-1 block text-2xs font-medium tabular-nums text-slate-500">
                          {current(r).size} granted{dirty && <span className="ml-1 text-amber-700">· edited</span>}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              {grouped.map(([cat, perms]) => {
                const meta = catMeta(cat);
                const c = colorClasses(meta.color);
                const Icon = meta.icon;
                const codes = perms.map((p) => p.code);
                return (
                  <tbody key={cat}>
                    <tr>
                      <th scope="rowgroup" className={cn("sticky left-0 z-10 border-b border-slate-200 px-4 py-2.5 text-left", c.soft)}>
                        <span className="flex items-center gap-2.5">
                          <span className={cn("grid size-7 place-items-center rounded-lg bg-gradient-to-br text-white shadow-sm", c.gradient)} aria-hidden>
                            <Icon className="size-3.5" />
                          </span>
                          <span>
                            <span className={cn("block text-sm font-semibold", c.text)}>{meta.label}</span>
                            {meta.blurb && <span className="block text-2xs font-normal text-slate-500">{meta.blurb}</span>}
                          </span>
                        </span>
                      </th>
                      {shown.map((r) => {
                        const set = current(r);
                        const n = codes.filter((x) => set.has(x)).length;
                        const lockedCodes = codes.filter((x) => !superadmin && !mine.has(x));
                        return (
                          <td key={r.id} className={cn("border-b border-slate-200 px-2 py-2.5 text-center", c.soft)}>
                            {editable(r) ? (
                              <Checkbox
                                aria-label={`${meta.label}: all permissions for ${r.name}`}
                                checked={n === codes.length ? true : n > 0 ? "indeterminate" : false}
                                onCheckedChange={(v) => toggle(r, v === true ? codes.filter((x) => !lockedCodes.includes(x)) : codes, v === true)}
                              />
                            ) : (
                              <span className={cn("text-xs font-semibold tabular-nums", n ? c.text : "text-slate-400")}>
                                {n}/{codes.length}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                    {perms.map((p) => (
                      <tr key={p.code} className="group">
                        <th scope="row" className="sticky left-0 z-10 border-b border-slate-100 bg-white px-4 py-2.5 text-left font-normal group-hover:bg-slate-50">
                          <span className="block font-mono text-xs font-semibold text-slate-800">{p.code}</span>
                          <span className="block text-xs text-muted-foreground">{p.description}</span>
                        </th>
                        {shown.map((r) => {
                          const on = current(r).has(p.code);
                          const cantGrant = !superadmin && !mine.has(p.code) && !on;
                          const box = (
                            <Checkbox
                              aria-label={`${p.code} for ${r.name}`}
                              checked={on}
                              disabled={!editable(r) || cantGrant}
                              onCheckedChange={(v) => toggle(r, [p.code], v === true)}
                            />
                          );
                          return (
                            <td key={r.id} className="border-b border-slate-100 px-2 py-2.5 text-center group-hover:bg-slate-50">
                              {!editable(r) ? (
                                on ? (
                                  <span className="inline-grid size-5 place-items-center rounded-full bg-emerald-100 text-emerald-700">
                                    <Check className="size-3.5" strokeWidth={3} aria-hidden />
                                    <span className="sr-only">Granted</span>
                                  </span>
                                ) : (
                                  <span className="inline-block size-1.5 rounded-full bg-slate-300" aria-label="Not granted" role="img" />
                                )
                              ) : cantGrant ? (
                                <Tooltip content="You don't hold this permission">
                                  <span className="inline-flex">{box}</span>
                                </Tooltip>
                              ) : (
                                box
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                );
              })}
            </table>
          </div>
        )}
      </section>

      {changed.length > 0 && (
        <div className="sticky bottom-24 z-30 mx-auto flex max-w-3xl flex-col gap-3 rounded-2xl border border-amber-200 bg-white/95 p-3 shadow-lift backdrop-blur sm:flex-row sm:items-center lg:bottom-6" role="region" aria-label="Unsaved permission changes">
          <p className="flex-1 text-sm text-slate-700" aria-live="polite">
            <strong className="font-semibold text-slate-900">Unsaved changes</strong> to {changed.map((r) => r.name).join(", ")}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" leftIcon={<RotateCcw />} onClick={() => setDrafts({})} disabled={saving}>
              Discard
            </Button>
            <Button leftIcon={<Save />} loading={saving} onClick={saveAll}>
              Save changes
            </Button>
          </div>
        </div>
      )}

      <RoleDialog state={dialog} roles={roles.data ?? []} onClose={() => setDialog(null)} />
      <ConfirmDialog
        open={!!del}
        onOpenChange={(o) => !o && setDel(null)}
        destructive
        title={`Delete the ${del?.name} role?`}
        description={
          del?.member_count
            ? `${del.member_count} member${del.member_count === 1 ? " has" : "s have"} this role. Reassign them first — the role can't be deleted while in use.`
            : "This can't be undone. Members' other roles are unaffected."
        }
        confirmLabel="Delete role"
        onConfirm={async () => {
          try {
            await api.delete(`/roles/${del!.id}`);
            toast.success("Role deleted");
            qc.invalidateQueries({ queryKey: ak.roles.all });
          } catch (e) {
            toastError(e);
          }
        }}
      />
    </div>
  );
}

type DialogState = { mode: "new"; template?: RoleOut } | { mode: "edit"; role: RoleOut } | null;

function RoleDialog({ state, roles, onClose }: { state: DialogState; roles: RoleOut[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { user, permissions: mine } = useAuth();
  const editing = state?.mode === "edit" ? state.role : null;
  const [name, setName] = React.useState("");
  const [key, setKey] = React.useState("");
  const [keyTouched, setKeyTouched] = React.useState(false);
  const [description, setDescription] = React.useState("");
  const [template, setTemplate] = React.useState("none");

  React.useEffect(() => {
    if (!state) return;
    const tplRole = state.mode === "new" ? state.template : undefined;
    setName(editing?.name ?? (tplRole ? `${tplRole.name} (custom)` : ""));
    setKey(editing?.key ?? "");
    setKeyTouched(false);
    setDescription(editing?.description ?? tplRole?.description ?? "");
    setTemplate(tplRole?.id ?? "none");
    save.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  React.useEffect(() => {
    if (!editing && !keyTouched)
      setKey(
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "")
          .replace(/^(\d)/, "role_$1")
          .slice(0, 64),
      );
  }, [name, editing, keyTouched]);

  const tpl = roles.find((r) => r.id === template);
  const tplPerms = (tpl?.permissions ?? []).filter((p) => user?.is_superadmin || mine.has(p));
  const keyValid = /^[a-z][a-z0-9_]{1,63}$/.test(key);

  const save = useMutation({
    mutationFn: () =>
      editing
        ? api.patch<RoleOut>(`/roles/${editing.id}`, { name: name.trim(), description: description.trim() || null })
        : api.post<RoleOut>("/roles", { name: name.trim(), key, description: description.trim() || null, permissions: tplPerms }),
    onSuccess: (r) => {
      toast.success(editing ? "Role updated" : `${r.name} created — set its permissions in the matrix`);
      qc.invalidateQueries({ queryKey: ak.roles.all });
      onClose();
    },
  });

  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <span className="mb-1 grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white">
            <ShieldCheck className="size-5" aria-hidden />
          </span>
          <DialogTitle>{editing ? `Edit ${editing.name}` : "New custom role"}</DialogTitle>
          <DialogDescription>
            {editing ? (editing.is_system ? "System role names and descriptions can be tailored; permissions stay locked." : "Rename the role or update its description.") : "Start blank or copy permissions from an existing role, then fine-tune them in the matrix."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && (editing || keyValid)) save.mutate();
          }}
        >
          <FormField label="Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus placeholder="e.g. Regional Coordinator" />
          </FormField>
          {!editing && (
            <FormField label="Key" required hint="Used in CSV imports and the API. Lowercase letters, numbers and underscores." error={key && !keyValid ? "Start with a letter; use a–z, 0–9 and _" : null}>
              <Input
                value={key}
                onChange={(e) => {
                  setKey(e.target.value);
                  setKeyTouched(true);
                }}
                className="font-mono"
                maxLength={64}
              />
            </FormField>
          )}
          <FormField label="Description">
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
          </FormField>
          {!editing && (
            <FormField label="Start from" hint={tpl ? `Copies ${tplPerms.length} permission${tplPerms.length === 1 ? "" : "s"}${tplPerms.length < (tpl.permissions.length ?? 0) ? " (ones you hold)" : ""}.` : undefined}>
              <SimpleSelect value={template} onValueChange={setTemplate} options={[{ value: "none", label: "Blank role (no permissions)" }, ...roles.map((r) => ({ value: r.id, label: `${r.name} — ${r.permissions.length} permissions` }))]} />
            </FormField>
          )}
          {save.isError && (
            <Alert tone="danger" title="Couldn't save the role">
              {errorMessage(save.error)}
            </Alert>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="gradient" loading={save.isPending} disabled={!name.trim() || (!editing && !keyValid)}>
              {editing ? "Save" : "Create role"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
