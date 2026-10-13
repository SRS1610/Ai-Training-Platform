"use client";

/**
 * Data hooks + pickers shared by admin pages: departments, teams, roles, courses and member search.
 */

import type { Page } from "@praxis/types";
import {
  Avatar,
  Button,
  Checkbox,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SimpleSelect,
  Spinner,
  cn,
  humanize,
} from "@praxis/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, X } from "lucide-react";
import * as React from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ak } from "./keys";
import type { CourseOut, DepartmentOut, MemberOut, RoleOut, TeamOut } from "./types";
import { RoleChip, roleColor } from "./ui";

/* ------------------------------------------------------------------ queries */

export function useDepartments(enabled = true) {
  const { can } = useAuth();
  return useQuery({
    queryKey: ak.departments.list,
    queryFn: ({ signal }) => api.get<DepartmentOut[]>("/departments", { signal }),
    enabled: enabled && can("users.view"),
    staleTime: 60_000,
  });
}

export function useTeams(enabled = true) {
  const { can } = useAuth();
  return useQuery({
    queryKey: ak.teams.list(),
    queryFn: ({ signal }) => api.get<TeamOut[]>("/teams", { signal }),
    enabled: enabled && can("users.view"),
    staleTime: 60_000,
  });
}

export function useRoles(enabled = true) {
  const { canAny } = useAuth();
  return useQuery({
    queryKey: ak.roles.all,
    queryFn: ({ signal }) => api.get<RoleOut[]>("/roles", { signal }),
    enabled: enabled && canAny(["roles.manage", "users.view", "users.create"]),
    staleTime: 60_000,
  });
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useCourseOptions(search: string, enabled = true) {
  const q = useDebounced(search);
  return useQuery({
    queryKey: ak.courses.options(q),
    queryFn: ({ signal }) => api.get<Page<CourseOut>>("/courses", { signal, query: { search: q || undefined, page_size: 50 } }),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useMemberSearch(search: string, enabled = true, anyStatus = false) {
  const q = useDebounced(search);
  return useQuery({
    queryKey: [...ak.members.search(q), anyStatus],
    queryFn: ({ signal }) => api.get<Page<MemberOut>>("/users", { signal, query: { q: q || undefined, status: anyStatus ? undefined : "active", page_size: 30 } }),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

/* ------------------------------------------------------------------ generic multi combobox */

export interface Option {
  value: string;
  label: string;
  hint?: string;
  icon?: React.ReactNode;
}

/**
 * Multi-select combobox: a trigger showing the selected chips and a searchable popover list.
 * Pass `onSearch` for server-side search (the list is then not filtered client-side).
 */
export function MultiCombobox({
  options,
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No matches",
  onSearch,
  loading,
  id,
  className,
  "aria-label": ariaLabel,
  "aria-describedby": describedBy,
  renderChip,
}: {
  options: Option[];
  value: Option[];
  onChange: (next: Option[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  onSearch?: (q: string) => void;
  loading?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  renderChip?: (o: Option) => React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const selected = new Set(value.map((v) => v.value));
  const toggle = (o: Option) => onChange(selected.has(o.value) ? value.filter((v) => v.value !== o.value) : [...value, o]);

  return (
    <div className={cn("space-y-2", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            aria-label={ariaLabel}
            aria-describedby={describedBy}
            aria-expanded={open}
            className="flex h-11 w-full items-center justify-between gap-2 rounded-xl border border-input bg-white px-3.5 text-left text-sm shadow-sm transition-colors hover:border-slate-400 focus-visible:border-brand-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/15"
          >
            <span className={cn("truncate", value.length ? "text-slate-900" : "text-slate-400")}>
              {value.length ? `${value.length} selected` : placeholder}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-slate-500" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-[18rem] p-0">
          <Command shouldFilter={!onSearch} className="rounded-2xl">
            <CommandInput
              value={q}
              onValueChange={(v) => {
                setQ(v);
                onSearch?.(v);
              }}
              placeholder={searchPlaceholder}
              className="h-11 text-sm"
              trailing={loading ? <Spinner className="shrink-0" label="Searching" /> : undefined}
            />
            <CommandList className="max-h-72">
              <CommandEmpty>{loading ? "Searching…" : emptyText}</CommandEmpty>
              <CommandGroup>
                {options.map((o) => {
                  const on = selected.has(o.value);
                  return (
                    <CommandItem key={o.value} value={`${o.label} ${o.hint ?? ""} ${o.value}`} onSelect={() => toggle(o)} className="py-2">
                      <span
                        className={cn(
                          "grid size-4 shrink-0 place-items-center rounded border",
                          on ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white",
                        )}
                        aria-hidden
                      >
                        {on && <Check className="size-3" strokeWidth={3} />}
                      </span>
                      {o.icon}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-slate-800">{o.label}</span>
                        {o.hint && <span className="block truncate text-xs text-muted-foreground">{o.hint}</span>}
                      </span>
                      <span className="sr-only">{on ? "selected" : "not selected"}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Selected">
          {value.map((o) => (
            <li key={o.value}>
              {renderChip ? (
                renderChip(o)
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-0.5 pl-2.5 pr-0.5 text-xs font-medium text-brand-800 ring-1 ring-inset ring-brand-200">
                  {o.label}
                  <button
                    type="button"
                    onClick={() => onChange(value.filter((v) => v.value !== o.value))}
                    className="grid size-5 place-items-center rounded-full hover:bg-brand-100 focus-visible:focus-ring"
                    aria-label={`Remove ${o.label}`}
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ concrete pickers */

export function MemberMultiPicker({
  value,
  onChange,
  id,
  placeholder = "Search people by name or email",
  exclude,
}: {
  value: Option[];
  onChange: (v: Option[]) => void;
  id?: string;
  placeholder?: string;
  exclude?: Set<string>;
}) {
  const [q, setQ] = React.useState("");
  const res = useMemberSearch(q);
  const options: Option[] = (res.data?.items ?? [])
    .filter((m) => !exclude?.has(m.user_id))
    .map((m) => ({ value: m.user_id, label: m.full_name, hint: m.email, icon: <Avatar name={m.full_name} src={m.avatar_url} size="xs" /> }));
  return (
    <MultiCombobox
      id={id}
      options={options}
      value={value}
      onChange={onChange}
      onSearch={setQ}
      loading={res.isFetching}
      placeholder={placeholder}
      searchPlaceholder="Name, email or employee ID"
      emptyText="No active members match"
    />
  );
}

export function DepartmentMultiPicker({ value, onChange, id }: { value: Option[]; onChange: (v: Option[]) => void; id?: string }) {
  const q = useDepartments();
  const options = (q.data ?? []).map((d) => ({ value: d.id, label: d.name, hint: `${d.member_count} members` }));
  return <MultiCombobox id={id} options={options} value={value} onChange={onChange} loading={q.isLoading} placeholder="Choose departments" searchPlaceholder="Search departments" />;
}

export function TeamMultiPicker({ value, onChange, id }: { value: Option[]; onChange: (v: Option[]) => void; id?: string }) {
  const q = useTeams();
  const options = (q.data ?? []).map((t) => ({ value: t.id, label: t.name, hint: `${t.member_count} members` }));
  return <MultiCombobox id={id} options={options} value={value} onChange={onChange} loading={q.isLoading} placeholder="Choose teams" searchPlaceholder="Search teams" />;
}

const NONE = "__none";

/** Single department select with a "No department" option. */
export function DepartmentSelect({
  value,
  onChange,
  id,
  placeholder = "No department",
  allowNone = true,
  noneLabel = "No department",
  exclude,
  "aria-label": ariaLabel,
}: {
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  id?: string;
  placeholder?: string;
  allowNone?: boolean;
  noneLabel?: string;
  exclude?: string[];
  "aria-label"?: string;
}) {
  const q = useDepartments();
  const options = [
    ...(allowNone ? [{ value: NONE, label: noneLabel }] : []),
    ...(q.data ?? []).filter((d) => !exclude?.includes(d.id)).map((d) => ({ value: d.id, label: d.name })),
  ];
  return (
    <SimpleSelect
      id={id}
      aria-label={ariaLabel}
      value={value ?? (allowNone ? NONE : undefined)}
      onValueChange={(v) => onChange(v === NONE ? null : v)}
      options={options}
      placeholder={q.isLoading ? "Loading…" : placeholder}
    />
  );
}

/** Single course combobox (server search). */
export function CourseSelect({
  value,
  onChange,
  id,
  placeholder = "Choose a course",
  publishedOnly,
}: {
  value: Option | null;
  onChange: (v: Option | null) => void;
  id?: string;
  placeholder?: string;
  publishedOnly?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const res = useCourseOptions(q, open);
  const items = (res.data?.items ?? []).filter((c) => !publishedOnly || c.status === "published");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          aria-expanded={open}
          className="flex h-11 w-full items-center justify-between gap-2 rounded-xl border border-input bg-white px-3.5 text-left text-sm shadow-sm transition-colors hover:border-slate-400 focus-visible:border-brand-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/15"
        >
          <span className={cn("truncate", value ? "text-slate-900" : "text-slate-400")}>{value?.label ?? placeholder}</span>
          <ChevronsUpDown className="size-4 shrink-0 text-slate-500" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-[18rem] p-0">
        <Command shouldFilter={false}>
          <CommandInput value={q} onValueChange={setQ} placeholder="Search courses" className="h-11 text-sm" trailing={res.isFetching ? <Spinner label="Searching" /> : undefined} />
          <CommandList className="max-h-72">
            <CommandEmpty>{res.isFetching ? "Searching…" : "No courses found"}</CommandEmpty>
            <CommandGroup>
              {items.map((c) => (
                <CommandItem
                  key={c.id}
                  value={c.id}
                  onSelect={() => {
                    onChange({ value: c.id, label: c.title, hint: c.status });
                    setOpen(false);
                  }}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-800">{c.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[c.category, humanize(c.status)].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {value?.value === c.id && <Check className="size-4 text-brand-600" aria-hidden />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Toggleable role chips (checkbox semantics). */
export function RolePicker({
  roles,
  value,
  onChange,
  disabled,
  grantable,
  labelledBy,
}: {
  roles: RoleOut[];
  value: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
  /** Only roles whose permissions the caller holds can be granted. */
  grantable?: (r: RoleOut) => boolean;
  labelledBy?: string;
}) {
  return (
    <div role="group" aria-labelledby={labelledBy} className="grid gap-2 sm:grid-cols-2">
      {roles.map((r) => {
        const on = value.includes(r.key);
        const can = grantable ? grantable(r) : true;
        const id = `role-${r.key}`;
        return (
          <label
            key={r.id}
            htmlFor={id}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors",
              on ? "border-brand-300 bg-brand-50/60" : "border-slate-200 bg-white hover:border-slate-300",
              (disabled || !can) && "cursor-not-allowed opacity-60",
            )}
          >
            <Checkbox
              id={id}
              checked={on}
              disabled={disabled || !can}
              onCheckedChange={(v) => onChange(v ? [...value, r.key] : value.filter((k) => k !== r.key))}
              className="mt-0.5"
            />
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-1.5">
                <RoleChip roleKey={r.key} name={r.name} />
                {!r.is_system && <span className="text-2xs font-semibold uppercase tracking-wide text-fuchsia-700">Custom</span>}
              </span>
              {r.description && <span className="mt-1 block text-xs text-muted-foreground">{r.description}</span>}
              {!can && <span className="mt-1 block text-xs font-medium text-amber-800">Includes permissions you don&apos;t hold</span>}
            </span>
          </label>
        );
      })}
    </div>
  );
}

export { roleColor };

/** Quick "Select all on page" helper used by bulk pickers. */
export function ClearButton({ onClick, label = "Clear" }: { onClick: () => void; label?: string }) {
  return (
    <Button variant="link" size="xs" onClick={onClick}>
      {label}
    </Button>
  );
}

/** Single member combobox (server search), e.g. choosing a manager. */
export function MemberSelect({
  value,
  onChange,
  id,
  placeholder = "Choose a person",
  exclude,
  allowClear = true,
  compact,
  anyStatus,
  className,
  "aria-label": ariaLabel,
}: {
  value: Option | null;
  onChange: (v: Option | null) => void;
  id?: string;
  placeholder?: string;
  exclude?: string[];
  allowClear?: boolean;
  /** 36px trigger for filter bars. */
  compact?: boolean;
  /** Include suspended / invited members in the search. */
  anyStatus?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const res = useMemberSearch(q, open, anyStatus);
  const items = (res.data?.items ?? []).filter((m) => !exclude?.includes(m.user_id));
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            aria-expanded={open}
            aria-label={ariaLabel ? `${ariaLabel}: ${value?.label ?? placeholder}` : undefined}
            className={cn("flex w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-input bg-white text-left text-sm shadow-sm", "transition-colors hover:border-slate-400 focus-visible:border-brand-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/15", compact ? "h-9 px-3" : "h-11 px-3.5")}
          >
            <span className={cn("flex min-w-0 items-center gap-2 truncate", value ? "text-slate-900" : "text-slate-400")}>
              {value && <Avatar name={value.label} size="xs" />}
              <span className="truncate">{value?.label ?? placeholder}</span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-slate-500" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-[18rem] p-0">
          <Command shouldFilter={false}>
            <CommandInput value={q} onValueChange={setQ} placeholder="Search people" className="h-11 text-sm" trailing={res.isFetching ? <Spinner label="Searching" /> : undefined} />
            <CommandList className="max-h-72">
              <CommandEmpty>{res.isFetching ? "Searching…" : anyStatus ? "No members match" : "No active members match"}</CommandEmpty>
              <CommandGroup>
                {items.map((m) => (
                  <CommandItem
                    key={m.user_id}
                    value={m.user_id}
                    onSelect={() => {
                      onChange({ value: m.user_id, label: m.full_name, hint: m.email });
                      setOpen(false);
                    }}
                  >
                    <Avatar name={m.full_name} src={m.avatar_url} size="xs" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-slate-800">{m.full_name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{m.email}</span>
                    </span>
                    {value?.value === m.user_id && <Check className="size-4 text-brand-600" aria-hidden />}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {allowClear && value && (
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Clear selection" onClick={() => onChange(null)}>
          <X />
        </Button>
      )}
    </div>
  );
}
