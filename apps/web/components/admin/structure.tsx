"use client";

/**
 * Organisation structure: department tree (parent/child) with CRUD and a teams board with member management.
 */

import type { Page } from "@praxis/types";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FilterBar,
  FormField,
  Input,
  Pagination,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SimpleSelect,
  Skeleton,
  Textarea,
  cn,
  colorClasses,
  colorFor,
  toast,
} from "@praxis/ui";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  FolderTree,
  Pencil,
  Plus,
  Trash2,
  UserPlus,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { ErrorState } from "@/components/common/error-state";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ak } from "./keys";
import { DepartmentSelect, MemberMultiPicker, MemberSelect, useDepartments, useTeams, type Option } from "./pickers";
import type { DepartmentNode, DepartmentOut, TeamMemberOut, TeamOut } from "./types";
import { IconChip, Meta, deepGradient, fmtNumber, toastError } from "./ui";

/* ================================================================== departments */

function flatten(nodes: DepartmentNode[], depth = 0, out: { node: DepartmentNode; depth: number }[] = []) {
  for (const n of nodes) {
    out.push({ node: n, depth });
    flatten(n.children ?? [], depth + 1, out);
  }
  return out;
}

function descendantCount(n: DepartmentNode): number {
  return (n.children ?? []).reduce((a, c) => a + 1 + descendantCount(c), 0);
}

function totalMembers(n: DepartmentNode): number {
  return n.member_count + (n.children ?? []).reduce((a, c) => a + totalMembers(c), 0);
}

export function DepartmentsPanel() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const tree = useQuery({
    queryKey: ak.departments.tree,
    queryFn: ({ signal }) => api.get<DepartmentNode[]>("/departments/tree", { signal }),
  });
  const [selected, setSelected] = React.useState<string | null>(null);
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());
  const [edit, setEdit] = React.useState<{ mode: "create"; parent?: string | null } | { mode: "edit"; dept: DepartmentOut } | null>(null);
  const [del, setDel] = React.useState<DepartmentNode | null>(null);
  const [filter, setFilter] = React.useState("");
  const editable = can("users.edit");

  const flat = React.useMemo(() => flatten(tree.data ?? []), [tree.data]);
  const byId = React.useMemo(() => new Map(flat.map((f) => [f.node.id, f.node])), [flat]);
  const parentOf = React.useMemo(() => {
    const m = new Map<string, string | null>();
    flat.forEach((f) => m.set(f.node.id, f.node.parent_id ?? null));
    return m;
  }, [flat]);
  const current = selected ? byId.get(selected) : (tree.data?.[0] ?? undefined);

  const visible = flat.filter((f) => {
    if (filter) return f.node.name.toLowerCase().includes(filter.toLowerCase());
    let p = parentOf.get(f.node.id);
    while (p) {
      if (collapsed.has(p)) return false;
      p = parentOf.get(p) ?? null;
    }
    return true;
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ak.departments.all });

  if (tree.isError) return <ErrorState error={tree.error} onRetry={() => tree.refetch()} />;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      <div className={cn(flat.length || tree.isLoading ? "lg:col-span-3" : "lg:col-span-5")}>
        <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-soft">
          <div className="flex flex-col gap-3 border-b border-slate-100 p-3 sm:flex-row sm:items-center sm:p-4">
            <FilterBar search={filter} onSearchChange={setFilter} searchPlaceholder="Find a department…" debounceMs={100} className="flex-1" />
            {editable && (
              <Button size="sm" leftIcon={<Plus />} onClick={() => setEdit({ mode: "create" })}>
                New department
              </Button>
            )}
          </div>
          {tree.isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className={cn("h-14 rounded-xl", i % 3 === 1 && "ml-8", i % 3 === 2 && "ml-16")} />
              ))}
            </div>
          ) : !flat.length ? (
            <EmptyState
              illustration="inbox"
              title="No departments yet"
              description="Model your organisation — departments power reporting, assignments and manager dashboards."
              action={
                editable ? (
                  <Button variant="gradient" leftIcon={<Plus />} onClick={() => setEdit({ mode: "create" })}>
                    Create the first department
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ul role="tree" aria-label="Departments" className="space-y-1 p-2 sm:p-3">
              {visible.map(({ node, depth }) => {
                const c = colorClasses(colorFor(node.name));
                const hasKids = (node.children ?? []).length > 0;
                const open = !collapsed.has(node.id);
                const active = current?.id === node.id;
                return (
                  <li key={node.id} role="treeitem" aria-level={depth + 1} aria-expanded={hasKids ? open : undefined} aria-selected={active}>
                    <div
                      className={cn(
                        "group flex items-center gap-2 rounded-xl border p-2 pr-3 transition-all",
                        active ? "border-brand-300 bg-brand-50/70 shadow-sm" : "border-transparent hover:border-slate-200 hover:bg-slate-50",
                      )}
                      style={{ marginLeft: filter ? 0 : depth * 20 }}
                    >
                      {hasKids && !filter ? (
                        <button
                          type="button"
                          className="grid size-7 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-white hover:text-slate-900 focus-visible:focus-ring"
                          aria-label={open ? `Collapse ${node.name}` : `Expand ${node.name}`}
                          onClick={() =>
                            setCollapsed((s) => {
                              const n = new Set(s);
                              if (n.has(node.id)) n.delete(node.id);
                              else n.add(node.id);
                              return n;
                            })
                          }
                        >
                          {open ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}
                        </button>
                      ) : (
                        <span className="grid size-7 shrink-0 place-items-center text-slate-300" aria-hidden>
                          {depth > 0 && <CornerDownRight className="size-3.5" />}
                        </span>
                      )}
                      <button type="button" onClick={() => setSelected(node.id)} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:focus-ring">
                        <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-sm font-bold text-white shadow-sm", c.gradient)} aria-hidden>
                          {node.name.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold text-slate-900">{node.name}</span>
                          {node.description && <span className="block truncate text-xs text-muted-foreground">{node.description}</span>}
                        </span>
                      </button>
                      <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
                        <Badge tone="info" size="sm">
                          <UserRound aria-hidden />
                          {node.member_count}
                        </Badge>
                        {node.team_count > 0 && (
                          <Badge tone="violet" size="sm">
                            <UsersRound aria-hidden />
                            {node.team_count}
                          </Badge>
                        )}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className={cn("lg:col-span-2", !flat.length && "hidden")}>
        {!flat.length ? null : current ? (
          <DepartmentDetail
            dept={current}
            parentName={current.parent_id ? byId.get(current.parent_id)?.name : null}
            editable={editable}
            onEdit={() => setEdit({ mode: "edit", dept: current })}
            onAddChild={() => setEdit({ mode: "create", parent: current.id })}
            onDelete={() => setDel(current)}
            onSelect={setSelected}
          />
        ) : (
          !tree.isLoading && (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 p-8 text-center text-sm text-muted-foreground">Select a department to see its details.</div>
          )
        )}
      </div>

      <DepartmentDialog state={edit} onClose={() => setEdit(null)} onSaved={(d) => { invalidate(); setSelected(d.id); }} />
      <ConfirmDialog
        open={!!del}
        onOpenChange={(o) => !o && setDel(null)}
        destructive
        title={`Delete ${del?.name}?`}
        description={
          del
            ? `${del.member_count} member${del.member_count === 1 ? "" : "s"} will become unassigned${descendantCount(del) ? ` and ${descendantCount(del)} sub-department${descendantCount(del) === 1 ? "" : "s"} will move up one level` : ""}. Teams in this department are kept. Learning records are not affected.`
            : undefined
        }
        confirmLabel="Delete department"
        onConfirm={async () => {
          try {
            await api.delete(`/departments/${del!.id}`);
            toast.success("Department deleted");
            setSelected(null);
            invalidate();
            qc.invalidateQueries({ queryKey: ak.members.all });
          } catch (e) {
            toastError(e);
          }
        }}
      />
    </div>
  );
}

function DepartmentDetail({
  dept,
  parentName,
  editable,
  onEdit,
  onAddChild,
  onDelete,
  onSelect,
}: {
  dept: DepartmentNode;
  parentName: string | null | undefined;
  editable: boolean;
  onEdit: () => void;
  onAddChild: () => void;
  onDelete: () => void;
  onSelect: (id: string) => void;
}) {
  const teams = useTeams();
  const deptTeams = (teams.data ?? []).filter((t) => t.department_id === dept.id);
  const manager = useQuery({
    queryKey: ["members", "detail", dept.manager_user_id],
    queryFn: ({ signal }) => api.get<{ full_name: string; email: string; avatar_url: string | null }>(`/users/${dept.manager_user_id}`, { signal }),
    enabled: !!dept.manager_user_id,
  });
  return (
    <section aria-label={`${dept.name} details`} className="sticky top-24 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-soft">
      <div className={cn("relative bg-gradient-to-br p-5 text-white", deepGradient(colorFor(dept.name)))}>
        <div className="pointer-events-none absolute -right-6 -top-10 size-32 rounded-full bg-white/20 blur-2xl" aria-hidden />
        <p className="text-xs font-semibold uppercase tracking-wider text-white/85">{parentName ? `Within ${parentName}` : "Top-level department"}</p>
        <h3 className="mt-1 font-display text-xl font-bold">{dept.name}</h3>
        {dept.description && <p className="mt-1 text-sm text-white/90">{dept.description}</p>}
      </div>
      <div className="space-y-5 p-5">
        <dl className="grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-sky-50 p-3 text-center">
            <dt className="text-xs font-medium text-sky-800">Direct members</dt>
            <dd className="font-display text-2xl font-bold tabular-nums text-slate-900">{dept.member_count}</dd>
          </div>
          <div className="rounded-xl bg-teal-50 p-3 text-center">
            <dt className="text-xs font-medium text-teal-800">Incl. sub-depts</dt>
            <dd className="font-display text-2xl font-bold tabular-nums text-slate-900">{totalMembers(dept)}</dd>
          </div>
          <div className="rounded-xl bg-violet-50 p-3 text-center">
            <dt className="text-xs font-medium text-violet-800">Teams</dt>
            <dd className="font-display text-2xl font-bold tabular-nums text-slate-900">{dept.team_count}</dd>
          </div>
        </dl>
        <dl>
          <Meta label="Manager">
            {dept.manager_user_id ? (
              manager.data ? (
                <span className="inline-flex items-center gap-2">
                  <Avatar name={manager.data.full_name} src={manager.data.avatar_url} size="xs" />
                  {manager.data.full_name}
                </span>
              ) : (
                "…"
              )
            ) : (
              <span className="text-slate-400">Not set</span>
            )}
          </Meta>
        </dl>
        {(dept.children ?? []).length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Sub-departments</p>
            <ul className="flex flex-wrap gap-1.5">
              {dept.children!.map((ch) => (
                <li key={ch.id}>
                  <button type="button" onClick={() => onSelect(ch.id)} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200 focus-visible:focus-ring">
                    {ch.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {deptTeams.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Teams</p>
            <ul className="flex flex-wrap gap-1.5">
              {deptTeams.map((t) => (
                <li key={t.id} className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-800 ring-1 ring-inset ring-violet-200">
                  {t.name} · {t.member_count}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          <Button asChild size="sm" variant="soft" leftIcon={<UserRound />}>
            <Link href={`/app/admin/users?department=${dept.id}`}>View members</Link>
          </Button>
          {editable && (
            <>
              <Button size="sm" variant="secondary" leftIcon={<Pencil />} onClick={onEdit}>
                Edit
              </Button>
              <Button size="sm" variant="secondary" leftIcon={<FolderTree />} onClick={onAddChild}>
                Add sub-department
              </Button>
              <Button size="sm" variant="destructive-soft" leftIcon={<Trash2 />} onClick={onDelete}>
                Delete
              </Button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function DepartmentDialog({
  state,
  onClose,
  onSaved,
}: {
  state: { mode: "create"; parent?: string | null } | { mode: "edit"; dept: DepartmentOut } | null;
  onClose: () => void;
  onSaved: (d: DepartmentOut) => void;
}) {
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [parent, setParent] = React.useState<string | null>(null);
  const [manager, setManager] = React.useState<Option | null>(null);
  const editing = state?.mode === "edit" ? state.dept : null;
  const managerQ = useQuery({
    queryKey: ["members", "detail", editing?.manager_user_id],
    queryFn: ({ signal }) => api.get<{ user_id: string; full_name: string }>(`/users/${editing!.manager_user_id}`, { signal }),
    enabled: !!editing?.manager_user_id,
  });

  React.useEffect(() => {
    if (!state) return;
    if (state.mode === "edit") {
      setName(state.dept.name);
      setDescription(state.dept.description ?? "");
      setParent(state.dept.parent_id ?? null);
      setManager(null);
    } else {
      setName("");
      setDescription("");
      setParent(state.parent ?? null);
      setManager(null);
    }
    save.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  React.useEffect(() => {
    if (managerQ.data) setManager({ value: managerQ.data.user_id, label: managerQ.data.full_name });
  }, [managerQ.data]);

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), description: description.trim() || null, parent_id: parent, manager_user_id: manager?.value ?? null };
      return editing ? api.patch<DepartmentOut>(`/departments/${editing.id}`, body) : api.post<DepartmentOut>("/departments", body);
    },
    onSuccess: (d) => {
      toast.success(editing ? "Department updated" : "Department created");
      onSaved(d);
      onClose();
    },
  });

  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <span className="mb-1 grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-teal-400 to-cyan-500 text-white">
            <Building2 className="size-5" aria-hidden />
          </span>
          <DialogTitle>{editing ? `Edit ${editing.name}` : "New department"}</DialogTitle>
          <DialogDescription>Departments can be nested to mirror your organisation chart.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) save.mutate();
          }}
        >
          <FormField label="Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus placeholder="e.g. Customer Operations" />
          </FormField>
          <FormField label="Description">
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} />
          </FormField>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Parent department">
              {(aria) => <DepartmentSelect id={aria.id} value={parent} onChange={setParent} noneLabel="None (top level)" placeholder="None (top level)" exclude={editing ? [editing.id] : undefined} />}
            </FormField>
            <FormField label="Manager">{(aria) => <MemberSelect id={aria.id} value={manager} onChange={setManager} placeholder="No manager" />}</FormField>
          </div>
          {save.isError && (
            <Alert tone="danger" title="Couldn't save the department">
              {errorMessage(save.error)}
            </Alert>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="gradient" loading={save.isPending} disabled={!name.trim()}>
              {editing ? "Save changes" : "Create department"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ================================================================== teams */

export function TeamsPanel() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = React.useState("");
  const [dept, setDept] = React.useState("all");
  const depts = useDepartments();
  const teams = useQuery({
    queryKey: ak.teams.list({ q, dept }),
    queryFn: ({ signal }) => api.get<TeamOut[]>("/teams", { signal, query: { q: q || undefined, department_id: dept === "all" ? undefined : dept } }),
    placeholderData: keepPreviousData,
  });
  const [edit, setEdit] = React.useState<TeamOut | "new" | null>(null);
  const [open, setOpen] = React.useState<TeamOut | null>(null);
  const [del, setDel] = React.useState<TeamOut | null>(null);
  const editable = can("users.edit");
  const deptName = (id: string | null | undefined) => (id ? depts.data?.find((d) => d.id === id)?.name : null);

  if (teams.isError) return <ErrorState error={teams.error} onRetry={() => teams.refetch()} />;

  return (
    <div className="space-y-4">
      <FilterBar
        search={q}
        onSearchChange={setQ}
        searchPlaceholder="Search teams…"
        actions={
          editable && (
            <Button size="sm" leftIcon={<Plus />} onClick={() => setEdit("new")}>
              New team
            </Button>
          )
        }
      >
        <SimpleSelect
          aria-label="Filter by department"
          value={dept}
          onValueChange={setDept}
          className="h-9 w-48"
          options={[{ value: "all", label: "All departments" }, ...(depts.data ?? []).map((d) => ({ value: d.id, label: d.name }))]}
        />
      </FilterBar>
      {teams.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-2xl" />
          ))}
        </div>
      ) : !teams.data?.length ? (
        <EmptyState
          bordered
          illustration="rocket"
          title={q || dept !== "all" ? "No teams match" : "No teams yet"}
          description="Teams are cross-functional groups — squads, cohorts, shifts — that you can assign training to in one go."
          action={
            editable ? (
              <Button variant="gradient" leftIcon={<Plus />} onClick={() => setEdit("new")}>
                Create a team
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {teams.data.map((t) => {
            const c = colorClasses(colorFor(t.name));
            return (
              <li key={t.id}>
                <article className="group flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-lift">
                  <div className={cn("h-1.5 bg-gradient-to-r", c.gradient)} aria-hidden />
                  <div className="flex flex-1 flex-col p-5">
                    <div className="flex items-start gap-3">
                      <IconChip icon={UsersRound} color={colorFor(t.name)} />
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate font-display font-semibold text-slate-900">{t.name}</h3>
                        <p className="truncate text-xs text-muted-foreground">{deptName(t.department_id) ?? "No department"}</p>
                      </div>
                      <Badge tone="violet" size="sm">
                        {t.member_count} member{t.member_count === 1 ? "" : "s"}
                      </Badge>
                    </div>
                    {t.description && <p className="mt-3 line-clamp-2 text-sm text-slate-600">{t.description}</p>}
                    <div className="mt-auto flex flex-wrap gap-2 pt-4">
                      <Button size="sm" variant="soft" leftIcon={<UsersRound />} onClick={() => setOpen(t)}>
                        Members
                      </Button>
                      {editable && (
                        <>
                          <Button size="sm" variant="ghost" leftIcon={<Pencil />} onClick={() => setEdit(t)}>
                            Edit
                          </Button>
                          <Button size="sm" variant="ghost" className="text-rose-700 hover:bg-rose-50" leftIcon={<Trash2 />} onClick={() => setDel(t)}>
                            Delete
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}

      <TeamDialog team={edit} onClose={() => setEdit(null)} />
      <TeamMembersSheet team={open} onClose={() => setOpen(null)} editable={editable} />
      <ConfirmDialog
        open={!!del}
        onOpenChange={(o) => !o && setDel(null)}
        destructive
        title={`Delete ${del?.name}?`}
        description="The team and its memberships are removed. People stay in the organisation and keep their enrolments."
        confirmLabel="Delete team"
        onConfirm={async () => {
          try {
            await api.delete(`/teams/${del!.id}`);
            toast.success("Team deleted");
            qc.invalidateQueries({ queryKey: ak.teams.all });
            qc.invalidateQueries({ queryKey: ak.departments.all });
          } catch (e) {
            toastError(e);
          }
        }}
      />
    </div>
  );
}

function TeamDialog({ team, onClose }: { team: TeamOut | "new" | null; onClose: () => void }) {
  const qc = useQueryClient();
  const editing = team && team !== "new" ? team : null;
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [dept, setDept] = React.useState<string | null>(null);
  const [lead, setLead] = React.useState<Option | null>(null);
  const leadQ = useQuery({
    queryKey: ["members", "detail", editing?.lead_user_id],
    queryFn: ({ signal }) => api.get<{ user_id: string; full_name: string }>(`/users/${editing!.lead_user_id}`, { signal }),
    enabled: !!editing?.lead_user_id,
  });
  React.useEffect(() => {
    if (!team) return;
    setName(editing?.name ?? "");
    setDescription(editing?.description ?? "");
    setDept(editing?.department_id ?? null);
    setLead(null);
    save.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team]);
  React.useEffect(() => {
    if (leadQ.data) setLead({ value: leadQ.data.user_id, label: leadQ.data.full_name });
  }, [leadQ.data]);
  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), description: description.trim() || null, department_id: dept, lead_user_id: lead?.value ?? null };
      return editing ? api.patch<TeamOut>(`/teams/${editing.id}`, body) : api.post<TeamOut>("/teams", body);
    },
    onSuccess: () => {
      toast.success(editing ? "Team updated" : "Team created");
      qc.invalidateQueries({ queryKey: ak.teams.all });
      qc.invalidateQueries({ queryKey: ak.departments.all });
      onClose();
    },
  });
  return (
    <Dialog open={!!team} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <span className="mb-1 grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white">
            <UsersRound className="size-5" aria-hidden />
          </span>
          <DialogTitle>{editing ? `Edit ${editing.name}` : "New team"}</DialogTitle>
          <DialogDescription>Give the team a clear name and an optional lead.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) save.mutate();
          }}
        >
          <FormField label="Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus placeholder="e.g. Tier-2 Support" />
          </FormField>
          <FormField label="Description">
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} />
          </FormField>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Department">{(aria) => <DepartmentSelect id={aria.id} value={dept} onChange={setDept} />}</FormField>
            <FormField label="Team lead">{(aria) => <MemberSelect id={aria.id} value={lead} onChange={setLead} placeholder="No lead" />}</FormField>
          </div>
          {save.isError && (
            <Alert tone="danger" title="Couldn't save the team">
              {errorMessage(save.error)}
            </Alert>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="gradient" loading={save.isPending} disabled={!name.trim()}>
              {editing ? "Save changes" : "Create team"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TeamMembersSheet({ team, onClose, editable }: { team: TeamOut | null; onClose: () => void; editable: boolean }) {
  const qc = useQueryClient();
  const [page, setPage] = React.useState(1);
  const [adding, setAdding] = React.useState<Option[]>([]);
  React.useEffect(() => {
    setPage(1);
    setAdding([]);
  }, [team?.id]);
  const members = useQuery({
    queryKey: ak.teams.members(team?.id ?? "", page),
    queryFn: ({ signal }) => api.get<Page<TeamMemberOut>>(`/teams/${team!.id}/members`, { signal, query: { page, page_size: 20 } }),
    enabled: !!team,
    placeholderData: keepPreviousData,
  });
  const add = useMutation({
    mutationFn: () => api.post<TeamOut>(`/teams/${team!.id}/members`, { user_ids: adding.map((a) => a.value) }),
    onSuccess: (t) => {
      toast.success(`Team now has ${fmtNumber(t.member_count)} members`);
      setAdding([]);
      qc.invalidateQueries({ queryKey: ak.teams.all });
    },
    onError: (e) => toastError(e),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => api.delete(`/teams/${team!.id}/members/${userId}`),
    onSuccess: () => {
      toast.success("Removed from team");
      qc.invalidateQueries({ queryKey: ak.teams.all });
    },
    onError: (e) => toastError(e),
  });
  const existing = new Set((members.data?.items ?? []).map((m) => m.user_id));
  return (
    <Sheet open={!!team} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{team?.name}</SheetTitle>
          <SheetDescription>{members.data ? `${members.data.total} member${members.data.total === 1 ? "" : "s"}` : "Team members"}</SheetDescription>
        </SheetHeader>
        <div className="space-y-5 px-6 pb-6">
          {editable && (
            <div className="space-y-2 rounded-2xl border border-violet-200 bg-violet-50/50 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-violet-900">
                <UserPlus className="size-4" aria-hidden /> Add members
              </p>
              <MemberMultiPicker value={adding} onChange={setAdding} exclude={existing} />
              <Button size="sm" disabled={!adding.length} loading={add.isPending} onClick={() => add.mutate()}>
                Add {adding.length || ""} to team
              </Button>
            </div>
          )}
          {members.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14 rounded-xl" />
              ))}
            </div>
          ) : members.isError ? (
            <ErrorState error={members.error} onRetry={() => members.refetch()} size="sm" />
          ) : !members.data?.items.length ? (
            <EmptyState size="sm" illustration="inbox" title="No members yet" description="Add people above to start assigning training to this team." />
          ) : (
            <>
              <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200">
                {members.data.items.map((m) => (
                  <li key={m.user_id} className="flex items-center gap-3 p-3">
                    <Avatar name={m.full_name} src={m.avatar_url} size="sm" />
                    <Link href={`/app/admin/users/${m.user_id}`} className="min-w-0 flex-1 rounded focus-visible:focus-ring">
                      <span className="block truncate text-sm font-semibold text-slate-900 hover:text-brand-700">{m.full_name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{m.job_title ?? m.email}</span>
                    </Link>
                    {editable && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${m.full_name} from team`}
                        onClick={() => remove.mutate(m.user_id)}
                        disabled={remove.isPending && remove.variables === m.user_id}
                      >
                        <X />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
              {members.data.total > 20 && <Pagination page={page} pageSize={20} total={members.data.total} onPageChange={setPage} />}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
