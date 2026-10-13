"use client";

import {
  Badge,
  Card,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Skeleton,
  StatusPill,
  cn,
  colorClasses,
  humanize,
  toast,
} from "@praxis/ui";
import type { Page } from "@praxis/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  BarChart3,
  Building2,
  Clock,
  Copy,
  HeartPulse,
  Landmark,
  Layers,
  Monitor,
  MoreHorizontal,
  PencilRuler,
  Plus,
  ShieldAlert,
  ShoppingBag,
  Sparkles,
  Trash2,
  Users,
  UtensilsCrossed,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { api, errorMessage } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { INDUSTRY_COLOR, industryLabel } from "./theme";
import { sk, type DraftOut, type SessionSummary, type SimulationOut, type TemplateOut } from "./types";

export function industryIcon(industry: string | null | undefined): LucideIcon {
  const k = (industry ?? "").toLowerCase();
  if (["it", "technology", "helpdesk"].includes(k)) return Monitor;
  if (["cybersecurity", "security", "soc"].includes(k)) return ShieldAlert;
  if (["hospitality", "restaurant", "food"].includes(k)) return UtensilsCrossed;
  if (["healthcare", "clinical"].includes(k)) return HeartPulse;
  if (["finance", "banking"].includes(k)) return Landmark;
  if (["sales", "retail"].includes(k)) return ShoppingBag;
  if (["customer_service", "customer service", "support"].includes(k)) return Users;
  return Building2;
}

/* ------------------------------------------------------------------ template gallery */

export function TemplateCard({ t, onUse }: { t: TemplateOut; onUse: () => void }) {
  const c = colorClasses(INDUSTRY_COLOR(t.industry));
  const Icon = industryIcon(t.industry);
  return (
    <button
      type="button"
      onClick={onUse}
      className="group flex h-full flex-col overflow-hidden rounded-3xl border border-slate-200/80 bg-white text-left shadow-soft transition-all duration-200 ease-spring hover:-translate-y-1 hover:shadow-lift focus-visible:focus-ring"
    >
      <div className={cn("relative h-28 overflow-hidden bg-gradient-to-br p-4", c.gradient)}>
        <div className="absolute -right-6 -top-8 size-32 rounded-full bg-white/15" aria-hidden />
        <div className="absolute -bottom-10 right-10 size-24 rounded-full bg-white/10" aria-hidden />
        <Icon className="absolute bottom-3 right-4 size-14 text-white/35 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3" aria-hidden />
        <span className="relative inline-flex items-center gap-1 rounded-full bg-white/20 px-2.5 py-1 text-2xs font-bold uppercase tracking-wider text-white ring-1 ring-white/30">
          {industryLabel(t.industry)}
        </span>
        {t.tags.includes("flagship") && (
          <span className="relative ml-1.5 inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-2xs font-bold text-slate-900">
            <Sparkles className="size-3 text-amber-500" aria-hidden /> Flagship
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <p className="font-display text-base font-semibold leading-snug text-slate-900">{t.title}</p>
        <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{t.description}</p>
        <p className="mt-2 text-xs font-medium text-slate-600">{t.learner_role}</p>
        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
          <Badge tone="neutral" size="sm">
            <Layers aria-hidden /> {t.actions} actions
          </Badge>
          <Badge tone="neutral" size="sm">
            {t.phases.length} phases
          </Badge>
          {t.estimated_minutes && (
            <Badge tone="neutral" size="sm">
              <Clock aria-hidden /> {t.estimated_minutes}m
            </Badge>
          )}
          <span className={cn("ml-auto inline-flex items-center gap-1 text-xs font-semibold", c.text)}>
            Use <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </span>
        </div>
      </div>
    </button>
  );
}

export function StartCards({ onBlank, onAI }: { onBlank: () => void; onAI: () => void }) {
  return (
    <>
      <button
        type="button"
        onClick={onAI}
        className="group relative flex h-full flex-col justify-between overflow-hidden rounded-3xl bg-brand-gradient p-5 text-left text-white shadow-glow transition-all duration-200 ease-spring hover:-translate-y-1 hover:brightness-110 focus-visible:focus-ring"
      >
        <div className="pointer-events-none absolute -right-8 -top-8 size-40 rounded-full bg-white/10 blur-xl" aria-hidden />
        <span className="grid size-11 place-items-center rounded-2xl bg-white/15 ring-1 ring-white/30">
          <Wand2 className="size-5" aria-hidden />
        </span>
        <div className="mt-6">
          <p className="font-display text-lg font-bold">AI Simulation Builder</p>
          <p className="mt-1 text-sm text-white/85">Describe a work situation and get a validated draft with phases, consequences and scoring.</p>
          <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold">
            Describe it <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </span>
        </div>
      </button>
      <button
        type="button"
        onClick={onBlank}
        className="group flex h-full flex-col justify-between rounded-3xl border-2 border-dashed border-slate-300 bg-gradient-to-br from-white to-slate-50 p-5 text-left transition-all duration-200 hover:-translate-y-1 hover:border-brand-300 hover:bg-brand-50/40 focus-visible:focus-ring"
      >
        <span className="grid size-11 place-items-center rounded-2xl bg-slate-100 text-slate-600 transition-colors group-hover:bg-brand-100 group-hover:text-brand-700">
          <PencilRuler className="size-5" aria-hidden />
        </span>
        <div className="mt-6">
          <p className="font-display text-lg font-bold text-slate-900">Start blank</p>
          <p className="mt-1 text-sm text-muted-foreground">Default phases and scoring model — design every action yourself in the visual builder.</p>
          <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-700">
            <Plus className="size-4" aria-hidden /> New simulation
          </span>
        </div>
      </button>
    </>
  );
}

/* ------------------------------------------------------------------ simulation cards */

function SessionsCount({ id }: { id: string }) {
  const q = useQuery({
    queryKey: sk.sessionsCount(id),
    queryFn: ({ signal }) => api.get<{ total: number; items: SessionSummary[] }>(`/simulations/${id}/sessions`, { signal, query: { page_size: 1 } }),
    select: (d) => d.total,
    staleTime: 60_000,
  });
  return (
    <span className="inline-flex items-center gap-1 tabular-nums" title="Learner sessions">
      <Users className="size-3.5" aria-hidden />
      {q.isLoading ? "…" : q.isError ? "—" : `${q.data} session${q.data === 1 ? "" : "s"}`}
    </span>
  );
}

export function SimulationCard({ s }: { s: SimulationOut }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [confirm, setConfirm] = React.useState(false);
  const c = colorClasses(INDUSTRY_COLOR(s.industry));
  const Icon = industryIcon(s.industry);

  const duplicate = useMutation({
    mutationFn: async () => {
      const d = await api.get<DraftOut>(`/simulations/${s.id}/draft`);
      return api.post<SimulationOut>("/simulations", {
        definition: d.definition,
        title: `${s.title} (copy)`.slice(0, 255),
        industry: s.industry,
        environment_type: s.environment_type,
        difficulty: s.difficulty,
        estimated_minutes: s.estimated_minutes,
        is_graded: s.is_graded,
        max_attempts: s.max_attempts,
        course_id: s.course_id,
      });
    },
    onSuccess: (n) => {
      toast.success("Duplicated as a new draft");
      qc.invalidateQueries({ queryKey: sk.all });
      router.push(`/app/instructor/simulations/${n.id}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/simulations/${s.id}`),
    onSuccess: () => {
      toast.success("Simulation archived");
      // Drop the card immediately and forget its per-simulation queries (refetching them would 404).
      for (const k of [sk.sessionsCount(s.id), sk.detail(s.id), sk.draft(s.id), sk.graph(s.id), sk.analytics(s.id)]) qc.removeQueries({ queryKey: k, exact: true });
      qc.setQueriesData<Page<SimulationOut>>({ queryKey: ["simulations", "list"] }, (old) =>
        old && old.items.some((x) => x.id === s.id) ? { ...old, items: old.items.filter((x) => x.id !== s.id), total: Math.max(0, old.total - 1) } : old,
      );
      qc.invalidateQueries({ queryKey: ["simulations", "list"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Card interactive className="group flex flex-col overflow-hidden">
      <div className={cn("relative flex h-20 items-start justify-between bg-gradient-to-br p-4", c.gradient)}>
        <div className="absolute -right-4 -top-6 size-24 rounded-full bg-white/15" aria-hidden />
        <span className="relative grid size-10 place-items-center rounded-xl bg-white/20 text-white ring-1 ring-white/30">
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="relative flex gap-1.5">
          {s.ai_generated && (
            <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-2xs font-bold text-fuchsia-700 shadow-sm">
              <Sparkles className="size-3" aria-hidden /> AI-generated
            </span>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label={`Actions for ${s.title}`} className="grid size-7 place-items-center rounded-lg bg-white/20 text-white ring-1 ring-white/30 hover:bg-white/30 focus-visible:focus-ring">
                <MoreHorizontal className="size-4" aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => router.push(`/app/instructor/simulations/${s.id}`)}>
                <PencilRuler /> Open builder
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => router.push(`/app/instructor/simulations/${s.id}/analytics`)}>
                <BarChart3 /> Analytics
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => duplicate.mutate()} disabled={duplicate.isPending}>
                <Copy /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={() => setConfirm(true)}>
                <Trash2 /> Archive
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <Link href={`/app/instructor/simulations/${s.id}`} className="flex flex-1 flex-col p-4 focus-visible:focus-ring">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusPill status={s.status} size="sm" />
          {s.published_version ? <Badge tone="success" size="sm">Live v{s.published_version}</Badge> : null}
          {s.draft_version ? <Badge tone="info" size="sm">Draft v{s.draft_version}</Badge> : null}
          {!s.is_graded && <Badge tone="violet" size="sm">Practice</Badge>}
        </div>
        <p className="mt-2 line-clamp-2 font-display text-base font-semibold leading-snug text-slate-900 group-hover:text-brand-700">{s.title}</p>
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{s.description || "No description yet."}</p>
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-3 text-xs text-slate-500">
          <span className={cn("font-semibold", c.text)}>{industryLabel(s.industry)}</span>
          <span>{humanize(s.difficulty)}</span>
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3.5" aria-hidden />
            {s.estimated_minutes}m
          </span>
          <SessionsCount id={s.id} />
          <span className="ml-auto">Updated {formatRelative(s.updated_at)}</span>
        </div>
      </Link>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        destructive
        title={`Archive “${s.title}”?`}
        description="The simulation disappears from the catalogue and the builder. Completed sessions and their results are kept."
        confirmLabel="Archive"
        onConfirm={() => remove.mutateAsync().then(() => undefined)}
      />
    </Card>
  );
}

export function SimulationGridSkeleton({ n = 6 }: { n?: number }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3" aria-busy aria-label="Loading simulations">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <Skeleton className="h-20 rounded-none" />
          <div className="space-y-2 p-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
