"use client";

/** Gamification toggle and badge administration (create / edit / delete / award). */

import {
  Alert,
  Badge,
  Button,
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
  FormField,
  Input,
  SimpleSelect,
  Skeleton,
  Switch,
  Textarea,
  bandMeta,
  cn,
  colorClasses,
  colorFor,
  toast,
} from "@praxis/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Award,
  BookOpen,
  Cpu,
  Crown,
  Flame,
  Footprints,
  Gem,
  GraduationCap,
  Library,
  type LucideIcon,
  Medal,
  MoreHorizontal,
  Pencil,
  Plus,
  Rocket,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  Trash2,
  Trophy,
  UserPlus,
  Wrench,
  Zap,
} from "lucide-react";
import * as React from "react";
import { ErrorState } from "@/components/common/error-state";
import { api, errorMessage } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { ak } from "../keys";
import { MemberSelect, type Option } from "../pickers";
import type { BadgeListOut, BadgeOut, OrgOut } from "../types";
import { SectionCard, fmtNumber, toastError } from "../ui";
import { useOrg } from "./org";

export const BADGE_ICONS: Record<string, LucideIcon> = {
  award: Award,
  trophy: Trophy,
  medal: Medal,
  star: Star,
  flame: Flame,
  rocket: Rocket,
  target: Target,
  zap: Zap,
  crown: Crown,
  gem: Gem,
  sparkles: Sparkles,
  "shield-check": ShieldCheck,
  "book-open": BookOpen,
  library: Library,
  "graduation-cap": GraduationCap,
  footprints: Footprints,
  wrench: Wrench,
  cpu: Cpu,
};

export function badgeIcon(name: string): LucideIcon {
  return BADGE_ICONS[name] ?? Award;
}

function criteriaLabel(c: Record<string, unknown>, types: Record<string, string>): string {
  const t = String(c.type ?? "manual");
  if (t === "manual") return "Awarded manually";
  const n = Number(c.count ?? 1);
  if (t === "simulation_band") return `${n} simulation${n === 1 ? "" : "s"} at ${bandMeta(String(c.band)).label} band`;
  if (t === "streak_days") return `${n}-day learning streak`;
  if (t === "points") return `${fmtNumber(n)} points`;
  return `${fmtNumber(n)} × ${(types[t] ?? t).toLowerCase()}`;
}

function BadgeDialog({ state, types, onClose }: { state: BadgeOut | "new" | null; types: Record<string, string>; onClose: () => void }) {
  const qc = useQueryClient();
  const editing = state && state !== "new" ? state : null;
  const [key, setKey] = React.useState("");
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [icon, setIcon] = React.useState("award");
  const [type, setType] = React.useState("manual");
  const [count, setCount] = React.useState(1);
  const [band, setBand] = React.useState("competent");
  React.useEffect(() => {
    if (!state) return;
    const c = (editing?.criteria ?? { type: "manual" }) as Record<string, unknown>;
    setKey(editing?.key ?? "");
    setName(editing?.name ?? "");
    setDescription(editing?.description ?? "");
    setIcon(editing?.icon ?? "award");
    setType(String(c.type ?? "manual"));
    setCount(Number(c.count ?? 1));
    setBand(String(c.band ?? "competent"));
    save.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  React.useEffect(() => {
    if (!editing) setKey(name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64));
  }, [name, editing]);
  const criteria = type === "manual" ? { type } : type === "simulation_band" ? { type, count, band } : { type, count };
  const save = useMutation({
    mutationFn: () =>
      editing
        ? api.patch<BadgeOut>(`/gamification/badges/${editing.id}`, { name: name.trim(), description: description.trim(), icon, criteria })
        : api.post<BadgeOut>("/gamification/badges", { key, name: name.trim(), description: description.trim(), icon, criteria }),
    onSuccess: () => {
      toast.success(editing ? "Badge updated" : "Badge created");
      qc.invalidateQueries({ queryKey: ak.badges.all });
      onClose();
    },
  });
  const valid = name.trim() && /^[a-z0-9_-]{2,64}$/.test(key) && (type === "manual" || count >= 1);
  const c = colorClasses(colorFor(key || name || "badge"));
  const Icon = badgeIcon(icon);
  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit “${editing.name}”` : "New badge"}</DialogTitle>
          <DialogDescription>Badges reward milestones automatically, or can be awarded by an admin.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) save.mutate();
          }}
        >
          <div className="flex items-center gap-4 rounded-2xl bg-slate-50 p-4">
            <span className={cn("grid size-16 shrink-0 place-items-center rounded-full bg-gradient-to-br text-white shadow-lift ring-4 ring-white", c.gradient)}>
              <Icon className="size-7" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="font-display font-semibold text-slate-900">{name || "Badge name"}</p>
              <p className="text-sm text-slate-600">{criteriaLabel(criteria, types)}</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Name" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus />
            </FormField>
            <FormField label="Key" hint="Lowercase letters, numbers, _ or -" error={key && !/^[a-z0-9_-]{2,64}$/.test(key) ? "2–64 characters: a–z, 0–9, _ or -" : null}>
              <Input value={key} onChange={(e) => setKey(e.target.value)} disabled={!!editing} className="font-mono" />
            </FormField>
          </div>
          <FormField label="Description">
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
          </FormField>
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-slate-800">Icon</legend>
            <div className="flex flex-wrap gap-2">
              {Object.entries(BADGE_ICONS).map(([k, I]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={icon === k}
                  aria-label={k.replace(/-/g, " ")}
                  onClick={() => setIcon(k)}
                  className={cn("grid size-10 place-items-center rounded-xl ring-1 ring-inset transition-colors focus-visible:focus-ring", icon === k ? cn("bg-gradient-to-br text-white ring-transparent", c.gradient) : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50")}
                >
                  <I className="size-5" aria-hidden />
                </button>
              ))}
            </div>
          </fieldset>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField label="Earned when" className="sm:col-span-2">
              <SimpleSelect value={type} onValueChange={setType} options={Object.entries(types).map(([k, v]) => ({ value: k, label: v }))} />
            </FormField>
            {type !== "manual" && (
              <FormField label={type === "points" ? "Points" : type === "streak_days" ? "Days" : "Count"}>
                <Input type="number" min={1} value={count} onChange={(e) => setCount(Math.max(1, Number(e.target.value)))} />
              </FormField>
            )}
            {type === "simulation_band" && (
              <FormField label="Minimum band" className="sm:col-span-3">
                <SimpleSelect
                  value={band}
                  onValueChange={setBand}
                  options={["competent", "advanced", "expert"].map((b) => ({ value: b, label: bandMeta(b).label }))}
                />
              </FormField>
            )}
          </div>
          {save.isError && (
            <Alert tone="danger" title="Couldn't save the badge">
              {errorMessage(save.error)}
            </Alert>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="gradient" loading={save.isPending} disabled={!valid}>
              {editing ? "Save badge" : "Create badge"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AwardDialog({ badge, onClose }: { badge: BadgeOut | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [person, setPerson] = React.useState<Option | null>(null);
  React.useEffect(() => setPerson(null), [badge]);
  const award = useMutation({
    mutationFn: () => api.post<BadgeOut>(`/gamification/badges/${badge!.id}/award`, { user_id: person!.value }),
    onSuccess: () => {
      toast.success(`${badge!.name} awarded to ${person!.label}`);
      qc.invalidateQueries({ queryKey: ak.badges.all });
      onClose();
    },
  });
  return (
    <Dialog open={!!badge} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Award “{badge?.name}”</DialogTitle>
          <DialogDescription>The person is notified and the badge appears on their profile.</DialogDescription>
        </DialogHeader>
        <FormField label="Person">{(aria) => <MemberSelect id={aria.id} value={person} onChange={setPerson} />}</FormField>
        {award.isError && (
          <Alert tone="danger" title="Couldn't award the badge">
            {errorMessage(award.error)}
          </Alert>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={award.isPending} disabled={!person} onClick={() => award.mutate()}>
            Award badge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function GamificationSettings() {
  const qc = useQueryClient();
  const org = useOrg();
  const badges = useQuery({ queryKey: ak.badges.all, queryFn: ({ signal }) => api.get<BadgeListOut>("/gamification/badges", { signal }) });
  const [dialog, setDialog] = React.useState<BadgeOut | "new" | null>(null);
  const [award, setAward] = React.useState<BadgeOut | null>(null);
  const [del, setDel] = React.useState<BadgeOut | null>(null);
  const toggle = useMutation({
    mutationFn: (v: boolean) => api.patch<OrgOut>("/organisations/current", { settings: { gamification_enabled: v } }),
    onSuccess: (o) => {
      qc.setQueryData(ak.org.current, o);
      qc.invalidateQueries({ queryKey: qk.me });
      qc.invalidateQueries({ queryKey: ak.badges.all });
      toast.success(o.settings.gamification_enabled ? "Gamification turned on" : "Gamification turned off");
    },
    onError: (e) => toastError(e),
  });
  const enabled = org.data?.settings.gamification_enabled ?? badges.data?.enabled ?? true;
  const types = badges.data?.criteria_types ?? { manual: "Awarded manually by an administrator" };

  return (
    <div className="space-y-6">
      <div className={cn("relative flex flex-col gap-4 overflow-hidden rounded-2xl border p-5 sm:flex-row sm:items-center", enabled ? "border-amber-200 bg-gradient-to-r from-amber-50 via-orange-50 to-rose-50" : "border-slate-200 bg-white")}>
        <span className={cn("grid size-12 shrink-0 place-items-center rounded-2xl text-white shadow-sm", enabled ? "bg-gradient-to-br from-amber-400 via-orange-500 to-rose-500" : "bg-slate-300")}>
          <Trophy className="size-6" aria-hidden />
        </span>
        <div className="flex-1">
          <p className="font-display text-lg font-semibold text-slate-900">Gamification</p>
          <p className="text-sm text-slate-600">Points, levels, streaks, badges and an opt-out leaderboard to keep learners motivated.</p>
        </div>
        {org.isLoading ? <Skeleton className="h-6 w-11 rounded-full" /> : <Switch checked={enabled} disabled={toggle.isPending} onCheckedChange={(v) => toggle.mutate(v)} aria-label="Enable gamification" />}
      </div>

      <SectionCard
        title="Badges"
        description="Default badges are created for you; add your own milestones or manual awards."
        icon={Award}
        color="amber"
        action={
          <Button size="sm" leftIcon={<Plus />} onClick={() => setDialog("new")}>
            New badge
          </Button>
        }
      >
        {badges.isLoading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-2xl" />
            ))}
          </div>
        ) : badges.isError ? (
          <ErrorState error={badges.error} onRetry={() => badges.refetch()} size="sm" />
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {badges.data!.items.map((b) => {
              const c = colorClasses(colorFor(b.key));
              const Icon = badgeIcon(b.icon);
              const isDefault = Boolean((b.criteria as Record<string, unknown>).default);
              return (
                <li key={b.id} className={cn("flex items-start gap-3 rounded-2xl border bg-gradient-to-br p-3.5", c.border, c.tint, !enabled && "opacity-70")}>
                  <span className={cn("grid size-12 shrink-0 place-items-center rounded-full bg-gradient-to-br text-white shadow-sm ring-2 ring-white", c.gradient)}>
                    <Icon className="size-6" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 font-semibold text-slate-900">
                      {b.name}
                      {isDefault && (
                        <Badge size="sm" tone="neutral">
                          Default
                        </Badge>
                      )}
                    </p>
                    <p className="text-xs text-slate-600">{criteriaLabel(b.criteria as Record<string, unknown>, types)}</p>
                    <p className="mt-1 text-xs font-medium tabular-nums text-slate-500">
                      Earned by {fmtNumber(b.earned_count ?? 0)} {b.earned_count === 1 ? "person" : "people"}
                    </p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={`${b.name} actions`}>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setAward(b)} disabled={!enabled}>
                        <UserPlus className="size-4" /> Award to someone
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setDialog(b)}>
                        <Pencil className="size-4" /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem destructive onSelect={() => setDel(b)}>
                        <Trash2 className="size-4" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
      <BadgeDialog state={dialog} types={types} onClose={() => setDialog(null)} />
      <AwardDialog badge={award} onClose={() => setAward(null)} />
      <ConfirmDialog
        open={!!del}
        onOpenChange={(o) => !o && setDel(null)}
        destructive
        title={`Delete “${del?.name}”?`}
        description={del?.earned_count ? `${del.earned_count} ${del.earned_count === 1 ? "person has" : "people have"} earned it — it will be removed from their profiles.` : "This badge hasn't been earned yet."}
        confirmLabel="Delete badge"
        onConfirm={async () => {
          try {
            await api.delete(`/gamification/badges/${del!.id}`);
            toast.success("Badge deleted");
            qc.invalidateQueries({ queryKey: ak.badges.all });
          } catch (e) {
            toastError(e);
          }
        }}
      />
    </div>
  );
}
