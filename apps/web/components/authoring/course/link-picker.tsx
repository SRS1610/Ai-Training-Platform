"use client";

import { Button, Input, Popover, PopoverContent, PopoverTrigger, Spinner, cn, colorClasses, toast } from "@praxis/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowUpRight, Check, Link2, Plus, Search } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useDebounced } from "../hooks";
import { lessonMeta } from "../meta";
import { AStatus, TypeChip } from "../shared";
import type { Assessment, Assignment, LinkedItem, Page, SimulationLite } from "../types";

export type LinkKind = "quiz" | "assignment" | "simulation";

interface Option {
  id: string;
  title: string;
  status: string;
  meta?: string;
}

const CONFIG: Record<LinkKind, { noun: string; path: string; perm: string; editHref: (id: string) => string }> = {
  quiz: { noun: "assessment", path: "/assessments", perm: "assessments.manage", editHref: (id) => `/app/instructor/assessments/${id}` },
  assignment: { noun: "assignment", path: "/assignments", perm: "assignments.manage", editHref: (id) => `/app/instructor/assignments/${id}` },
  simulation: { noun: "simulation", path: "/simulations", perm: "simulations.manage", editHref: (id) => `/app/instructor/simulations/${id}` },
};

export function editHrefFor(kind: string, id: string): string | null {
  return kind in CONFIG ? CONFIG[kind as LinkKind].editHref(id) : null;
}

function useOptions(kind: LinkKind, q: string, enabled: boolean) {
  const query = useDebounced(q, 250);
  return useQuery({
    queryKey: ["link-options", kind, query],
    enabled,
    queryFn: async ({ signal }): Promise<Option[]> => {
      if (kind === "simulation") {
        const r = await api.get<Page<SimulationLite>>("/simulations", { signal, query: { search: query, page_size: 30 } });
        return r.items.map((s) => ({ id: s.id, title: s.title, status: s.status, meta: `${s.environment_type} · ${s.estimated_minutes} min` }));
      }
      if (kind === "quiz") {
        const r = await api.get<Page<Assessment>>("/assessments", { signal, query: { q: query, page_size: 30 } });
        return r.items.map((a) => ({ id: a.id, title: a.title, status: a.status, meta: `${a.kind} · pass ${Math.round(a.pass_percentage)}%` }));
      }
      const r = await api.get<Page<Assignment>>("/assignments", { signal, query: { q: query, page_size: 30 } });
      return r.items.map((a) => ({ id: a.id, title: a.title, status: a.status, meta: `pass ${Math.round(a.passing_score)}%` }));
    },
  });
}

/**
 * Pick (or create) the assessment / assignment / simulation a linked lesson points to.
 * `onChange` receives the selected item's id and title.
 */
export function LinkPicker({
  kind,
  value,
  linked,
  courseId,
  onChange,
  defaultNewTitle,
  error,
}: {
  kind: LinkKind;
  value: string | null;
  linked?: LinkedItem | null;
  courseId?: string;
  onChange: (item: { id: string; title: string; status?: string }) => void;
  defaultNewTitle?: string;
  /** Validation message from the parent form (e.g. nothing chosen yet). */
  error?: string | null;
}) {
  const cfg = CONFIG[kind];
  const meta = lessonMeta(kind);
  const c = colorClasses(meta.color);
  const qc = useQueryClient();
  const { can } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const options = useOptions(kind, q, open || !value);
  const [newTitle, setNewTitle] = React.useState(defaultNewTitle ?? "");
  React.useEffect(() => setNewTitle(defaultNewTitle ?? ""), [defaultNewTitle]);

  const create = useMutation({
    mutationFn: async (title: string) => {
      if (kind === "quiz") return api.post<Assessment>("/assessments", { title, course_id: courseId ?? null, kind: "quiz" });
      if (kind === "assignment") return api.post<Assignment>("/assignments", { title, course_id: courseId ?? null, objective: "", instructions: "" });
      return api.post<SimulationLite>("/simulations", { title, course_id: courseId ?? null });
    },
    onSuccess: (item) => {
      toast.success(`Created ${cfg.noun} “${item.title}” as a draft`);
      qc.invalidateQueries({ queryKey: ["link-options", kind] });
      onChange({ id: item.id, title: item.title, status: item.status });
      setOpen(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const submitNew = () => {
    if (newTitle.trim() && !create.isPending) create.mutate(newTitle.trim());
  };
  const current = linked && linked.id === value ? linked : options.data?.find((o) => o.id === value);
  const href = value ? cfg.editHref(value) : null;
  const notLive = !!value && !!current?.status && current.status !== "published";

  return (
    <div
      className={cn("rounded-2xl border bg-gradient-to-br p-4", error ? "border-rose-300 ring-2 ring-rose-100" : c.border, c.tint)}
      aria-invalid={error ? true : undefined}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <TypeChip meta={meta} size="lg" />
        <div className="min-w-0 flex-1">
          <p className={cn("text-2xs font-bold uppercase tracking-wider", c.text)}>Linked {cfg.noun}</p>
          {value ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate font-display text-base font-semibold text-slate-900">{current?.title ?? "Linked item"}</p>
              {current?.status && <AStatus status={current.status} size="sm" />}
            </div>
          ) : (
            <p className="text-sm text-slate-700">Learners complete this lesson by passing the linked {cfg.noun}. Pick one or create a draft.</p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {href && can(cfg.perm) && (
            <Button asChild variant="secondary" size="sm" rightIcon={<ArrowUpRight />}>
              <Link href={href}>Open editor</Link>
            </Button>
          )}
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button variant={value ? "soft" : "primary"} size="sm" leftIcon={<Link2 />}>
                {value ? "Change" : `Choose ${cfg.noun}`}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[22rem] p-2">
              <Input inputSize="sm" leftIcon={<Search />} placeholder={`Search ${cfg.noun}s…`} value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Search ${cfg.noun}s`} autoFocus />
              <div className="mt-2 max-h-64 overflow-y-auto scrollbar-thin" role="listbox" aria-label={`${cfg.noun}s`}>
                {options.isLoading ? (
                  <div className="grid place-items-center py-6">
                    <Spinner />
                  </div>
                ) : options.isError ? (
                  <p className="px-2 py-4 text-center text-sm text-rose-700">{errorMessage(options.error)}</p>
                ) : !options.data?.length ? (
                  <p className="px-2 py-4 text-center text-sm text-muted-foreground">No {cfg.noun}s found.</p>
                ) : (
                  options.data.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      role="option"
                      aria-selected={o.id === value}
                      onClick={() => {
                        onChange({ id: o.id, title: o.title, status: o.status });
                        setOpen(false);
                      }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-brand-50 focus-visible:focus-ring"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-900">{o.title}</span>
                        {o.meta && <span className="block truncate text-2xs capitalize text-muted-foreground">{o.meta}</span>}
                      </span>
                      <AStatus status={o.status} size="sm" />
                      {o.id === value && <Check className="size-4 text-brand-600" aria-hidden />}
                    </button>
                  ))
                )}
              </div>
              {can(cfg.perm) && (
                // Not a <form>: the popover is portaled but React events still bubble to the dialog's form.
                <div className="mt-2 flex gap-2 border-t border-slate-100 pt-2">
                  <Input
                    inputSize="sm"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      e.stopPropagation();
                      submitNew();
                    }}
                    placeholder={`New ${cfg.noun} title`}
                    aria-label={`New ${cfg.noun} title`}
                  />
                  <Button type="button" size="sm" leftIcon={<Plus />} loading={create.isPending} disabled={!newTitle.trim()} onClick={submitNew}>
                    Create
                  </Button>
                </div>
              )}
            </PopoverContent>
          </Popover>
        </div>
      </div>
      {notLive && (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200" role="status">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
          <span>
            <strong className="font-semibold capitalize">{current?.status}</strong> — publish it before learners can take it. The course can&apos;t be published until it is.
          </span>
        </p>
      )}
      {error && (
        <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-rose-700" role="alert">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}
