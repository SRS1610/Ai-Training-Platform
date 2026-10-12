"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Spinner,
  StatusPill,
  Switch,
  cn,
  humanize,
  statusTone,
  toast,
  colorClasses,
  type CategoryColor,
  type Tone,
} from "@praxis/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  CloudCheck,
  Loader2,
  type LucideIcon,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { api, errorMessage } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import type { SaveStatus } from "./hooks";
import { ak } from "./keys";
import { QUESTION_DIFFICULTY, toneFor, type TypeMeta } from "./meta";
import type { Skill } from "./types";

/* ------------------------------------------------------------------ type chip */

export function TypeChip({
  meta,
  size = "md",
  className,
}: {
  meta: Pick<TypeMeta, "icon" | "color" | "label">;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}) {
  const c = colorClasses(meta.color);
  const Icon = meta.icon;
  const box = { xs: "size-6 rounded-md", sm: "size-7 rounded-lg", md: "size-9 rounded-xl", lg: "size-11 rounded-2xl" }[size];
  const icon = { xs: "size-3.5", sm: "size-4", md: "size-[18px]", lg: "size-5" }[size];
  return (
    <span className={cn("grid shrink-0 place-items-center bg-gradient-to-br text-white shadow-sm", c.gradient, box, className)} aria-hidden>
      <Icon className={icon} />
    </span>
  );
}

export function SoftIcon({ icon: Icon, color, className }: { icon: LucideIcon; color: CategoryColor; className?: string }) {
  const c = colorClasses(color);
  return (
    <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", c.soft, c.icon, className)} aria-hidden>
      <Icon className="size-[18px]" />
    </span>
  );
}

/** Status pill that also knows authoring statuses (running, ready, superseded, …). */
export function AStatus({ status, label, size }: { status: string | null | undefined; label?: string; size?: "sm" | "md" | "lg" }) {
  const tone: Tone = toneFor(status) ?? statusTone(status);
  return <StatusPill status={status} tone={tone} label={label ?? humanize(status)} size={size} />;
}

/* ------------------------------------------------------------------ section card */

export function SectionCard({
  title,
  description,
  icon,
  color = "indigo",
  action,
  children,
  className,
  contentClassName,
  id,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: LucideIcon;
  color?: CategoryColor;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  id?: string;
}) {
  return (
    <Card className={className} id={id}>
      <CardHeader>
        <div className="flex min-w-0 items-center gap-3">
          {icon && <SoftIcon icon={icon} color={color} />}
          <div className="min-w-0">
            <CardTitle as="h2">{title}</CardTitle>
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
          </div>
        </div>
        {action}
      </CardHeader>
      <CardContent className={contentClassName}>{children}</CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ save indicator */

export function SaveIndicator({
  status,
  error,
  savedAt,
  onRetry,
  className,
}: {
  status: SaveStatus;
  error?: string | null;
  savedAt?: Date | null;
  onRetry?: () => void;
  className?: string;
}) {
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className={cn("flex min-h-7 items-center gap-1.5 text-xs font-medium", className)} aria-live="polite" role="status">
      {status === "saving" && (
        <>
          <Loader2 className="size-3.5 animate-spin text-brand-600" aria-hidden />
          <span className="text-slate-600">Saving…</span>
        </>
      )}
      {status === "dirty" && (
        <>
          <span className="size-2 rounded-full bg-amber-400 motion-safe:animate-pulse" aria-hidden />
          <span className="text-slate-600">Unsaved changes</span>
        </>
      )}
      {status === "saved" && (
        <>
          <CloudCheck className="size-4 text-emerald-600" aria-hidden />
          <span className="text-emerald-700">Saved{savedAt ? ` · ${formatRelative(savedAt)}` : ""}</span>
        </>
      )}
      {status === "error" && (
        <>
          <AlertCircle className="size-4 shrink-0 text-rose-600" aria-hidden />
          <span className="line-clamp-2 text-rose-700" title={error ?? undefined}>
            Not saved{error ? `: ${error}` : ""}
          </span>
          {onRetry && (
            <Button variant="link" size="xs" onClick={onRetry} leftIcon={<RotateCcw />} className="ml-1">
              Retry
            </Button>
          )}
        </>
      )}
      {status === "idle" && (
        <>
          <CloudCheck className="size-4 text-slate-400" aria-hidden />
          <span className="text-slate-500">All changes saved</span>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ list editors */

/** Editable list of strings (objectives, prerequisites, starter prompts…). */
export function StringListEditor({
  value,
  onChange,
  placeholder = "Add an item",
  addLabel = "Add",
  label,
  max = 100,
  numbered,
  color = "indigo",
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  addLabel?: string;
  label: string;
  max?: number;
  numbered?: boolean;
  color?: CategoryColor;
}) {
  const [draft, setDraft] = React.useState("");
  const c = colorClasses(color);
  const add = () => {
    const v = draft.trim();
    if (!v || value.length >= max) return;
    onChange([...value, v]);
    setDraft("");
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ol className="space-y-1.5">
          {value.map((item, i) => (
            <li key={`${i}-${item}`} className="group flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-2 py-1.5 shadow-sm">
              <span className={cn("grid size-6 shrink-0 place-items-center rounded-lg text-2xs font-bold", c.soft, c.text)} aria-hidden>
                {numbered ? i + 1 : <Check className="size-3.5" />}
              </span>
              <input
                className="min-w-0 flex-1 bg-transparent px-1 py-1 text-sm text-slate-800 outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-brand-500/30"
                value={item}
                aria-label={`${label} ${i + 1}`}
                onChange={(e) => {
                  const next = [...value];
                  next[i] = e.target.value;
                  onChange(next);
                }}
                onBlur={() => {
                  if (!item.trim()) onChange(value.filter((_, j) => j !== i));
                }}
              />
              <div className="flex shrink-0 items-center opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                <Button variant="ghost" size="icon-sm" aria-label={`Move ${label} ${i + 1} up`} onClick={() => move(i, -1)} disabled={i === 0}>
                  <ArrowUp />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label={`Move ${label} ${i + 1} down`} onClick={() => move(i, 1)} disabled={i === value.length - 1}>
                  <ArrowDown />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label={`Remove ${label} ${i + 1}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
                  <X />
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}
      <div className="flex gap-2">
        <Input
          inputSize="sm"
          value={draft}
          placeholder={placeholder}
          aria-label={`New ${label}`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button variant="secondary" size="sm" leftIcon={<Plus />} onClick={add} disabled={!draft.trim() || value.length >= max}>
          {addLabel}
        </Button>
      </div>
    </div>
  );
}

/** Tag input: type and press Enter/comma to add; Backspace removes the last tag. */
export function TagInput({
  value,
  onChange,
  placeholder = "Add tag…",
  id,
  max = 50,
  "aria-describedby": describedBy,
  lowercase,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  id?: string;
  max?: number;
  "aria-describedby"?: string;
  lowercase?: boolean;
}) {
  const [draft, setDraft] = React.useState("");
  const commit = () => {
    const parts = draft
      .split(",")
      .map((s) => (lowercase ? s.trim().toLowerCase() : s.trim()))
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    for (const p of parts) if (!next.includes(p) && next.length < max) next.push(p);
    onChange(next);
    setDraft("");
  };
  return (
    <div className="flex min-h-11 w-full flex-wrap items-center gap-1.5 rounded-xl border border-input bg-white px-2 py-1.5 shadow-sm transition-colors focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/15 hover:border-slate-400">
      {value.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-0.5 pl-2.5 pr-1 text-xs font-medium text-brand-800 ring-1 ring-inset ring-brand-200">
          {t}
          <button
            type="button"
            className="grid size-4 place-items-center rounded-full hover:bg-brand-100 focus-visible:focus-ring"
            aria-label={`Remove ${t}`}
            onClick={() => onChange(value.filter((x) => x !== t))}
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ))}
      <input
        id={id}
        className="min-w-[8rem] flex-1 bg-transparent px-1 py-1 text-sm outline-none placeholder:text-slate-400"
        value={draft}
        placeholder={value.length ? "" : placeholder}
        aria-describedby={describedBy}
        onChange={(e) => {
          if (e.target.value.endsWith(",")) {
            setDraft(e.target.value);
            setTimeout(commit, 0);
          } else setDraft(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Backspace" && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ skills */

export function useSkills() {
  return useQuery({
    queryKey: ak.skills(),
    queryFn: ({ signal }) => api.get<Skill[]>("/skills", { signal }),
    staleTime: 60_000,
  });
}

/** Multi-select skill picker with search and inline "create skill". */
export function SkillPicker({
  value,
  onChange,
  id,
  disabled,
  canCreate = true,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  id?: string;
  disabled?: boolean;
  canCreate?: boolean;
}) {
  const qc = useQueryClient();
  const skills = useSkills();
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const byId = new Map((skills.data ?? []).map((s) => [s.id, s]));
  const filtered = (skills.data ?? []).filter((s) => s.name.toLowerCase().includes(q.trim().toLowerCase()));
  const exact = (skills.data ?? []).some((s) => s.name.toLowerCase() === q.trim().toLowerCase());
  const create = useMutation({
    mutationFn: (name: string) => api.post<Skill>("/skills", { name }),
    onSuccess: (s) => {
      qc.setQueryData<Skill[]>(ak.skills(), (old) => [...(old ?? []), s]);
      onChange([...value, s.id]);
      setQ("");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const toggle = (sid: string) => onChange(value.includes(sid) ? value.filter((x) => x !== sid) : [...value, sid]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((sid) => {
          const s = byId.get(sid);
          return (
            <span key={sid} className="inline-flex items-center gap-1 rounded-full bg-teal-50 py-0.5 pl-2 pr-1 text-xs font-medium text-teal-800 ring-1 ring-inset ring-teal-200">
              <Target className="size-3" aria-hidden />
              {s?.name ?? "Skill"}
              {!disabled && (
                <button type="button" className="grid size-4 place-items-center rounded-full hover:bg-teal-100 focus-visible:focus-ring" aria-label={`Remove ${s?.name ?? "skill"}`} onClick={() => toggle(sid)}>
                  <X className="size-3" aria-hidden />
                </button>
              )}
            </span>
          );
        })}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button id={id} variant="soft" size="xs" leftIcon={<Plus />} disabled={disabled}>
              {value.length ? "Add skill" : "Tag skills"}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 p-2">
            <Input inputSize="sm" leftIcon={<Search />} placeholder="Search skills…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search skills" autoFocus />
            <div className="mt-2 max-h-64 overflow-y-auto scrollbar-thin" role="listbox" aria-label="Skills" aria-multiselectable>
              {skills.isLoading ? (
                <div className="grid place-items-center py-6">
                  <Spinner />
                </div>
              ) : filtered.length === 0 ? (
                <p className="px-2 py-4 text-center text-sm text-muted-foreground">No skills match.</p>
              ) : (
                filtered.map((s) => {
                  const on = value.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      role="option"
                      aria-selected={on}
                      onClick={() => toggle(s.id)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-brand-50 focus-visible:focus-ring",
                        on && "bg-teal-50/70",
                      )}
                    >
                      <span className={cn("grid size-4 place-items-center rounded border", on ? "border-teal-600 bg-teal-600 text-white" : "border-slate-300")}>
                        {on && <Check className="size-3" aria-hidden />}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{s.name}</span>
                      {s.category && <span className="text-2xs text-muted-foreground">{s.category}</span>}
                    </button>
                  );
                })
              )}
            </div>
            {canCreate && q.trim() && !exact && (
              <Button variant="ghost" size="sm" block className="mt-1 justify-start" leftIcon={<Plus />} loading={create.isPending} onClick={() => create.mutate(q.trim())}>
                Create “{q.trim()}”
              </Button>
            )}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ difficulty dots */

export function DifficultyDots({ value, className }: { value: number; className?: string }) {
  const v = Math.max(1, Math.min(5, Math.round(value || 1)));
  const meta = QUESTION_DIFFICULTY[v - 1]!;
  const c = colorClasses(meta.color);
  return (
    <span className={cn("inline-flex items-center gap-1", className)} title={`Difficulty: ${meta.label}`}>
      <span className="sr-only">Difficulty {v} of 5 ({meta.label})</span>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} aria-hidden className={cn("size-1.5 rounded-full", i <= v ? c.solid : "bg-slate-200")} />
      ))}
    </span>
  );
}

export function DifficultyPicker({ value, onChange, id }: { value: number; onChange: (v: number) => void; id?: string }) {
  return (
    <div id={id} role="radiogroup" aria-label="Difficulty" className="flex flex-wrap gap-1.5">
      {QUESTION_DIFFICULTY.map((d, i) => {
        const on = value === i + 1;
        const c = colorClasses(d.color);
        return (
          <button
            key={d.label}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(i + 1)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset transition-all focus-visible:focus-ring",
              on ? cn(c.soft, c.text, c.ring, "shadow-sm") : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50",
            )}
          >
            <span className={cn("size-2 rounded-full", on ? c.solid : "bg-slate-300")} aria-hidden />
            {i + 1} · {d.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ toggles & numbers */

export function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
  icon: Icon,
  color = "indigo",
  disabled,
}: {
  label: React.ReactNode;
  description?: React.ReactNode;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  icon?: LucideIcon;
  color?: CategoryColor;
  disabled?: boolean;
}) {
  const id = React.useId();
  const c = colorClasses(color);
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">
      {Icon && (
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", c.soft, c.icon)} aria-hidden>
          <Icon className="size-4" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="block cursor-pointer text-sm font-semibold text-slate-900">
          {label}
        </label>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  );
}

/** Number input that maps "" to null. */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  placeholder,
  suffix,
  ...rest
}: {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  suffix?: string;
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  "aria-label"?: string;
  inputSize?: "sm" | "md" | "lg";
  disabled?: boolean;
  className?: string;
}) {
  const [text, setText] = React.useState(value === null || value === undefined ? "" : String(value));
  React.useEffect(() => {
    const n = text === "" ? null : Number(text);
    if (n !== value) setText(value === null || value === undefined ? "" : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <Input
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      value={text}
      rightSlot={suffix ? <span className="pr-2 text-xs font-medium text-slate-500">{suffix}</span> : undefined}
      onChange={(e) => {
        setText(e.target.value);
        if (e.target.value === "") return onChange(null);
        const n = Number(e.target.value);
        if (!Number.isNaN(n)) onChange(n);
      }}
      {...rest}
    />
  );
}

/* ------------------------------------------------------------------ sub navigation */

export function SubNav({ items, className }: { items: { href: string; label: string; icon: LucideIcon; color: CategoryColor }[]; className?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Section" className={cn("no-scrollbar -mx-1 mb-6 flex gap-1 overflow-x-auto px-1", className)}>
      {items.map((it) => {
        const active = pathname === it.href || pathname.startsWith(`${it.href}/`);
        const c = colorClasses(it.color);
        const Icon = it.icon;
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition-all focus-visible:focus-ring",
              active ? "bg-white text-slate-900 shadow-soft ring-1 ring-slate-200" : "text-slate-600 hover:bg-white/70 hover:text-slate-900",
            )}
          >
            <span className={cn("grid size-6 place-items-center rounded-lg", active ? cn("bg-gradient-to-br text-white", c.gradient) : cn(c.soft, c.icon))}>
              <Icon className="size-3.5" aria-hidden />
            </span>
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}

/* ------------------------------------------------------------------ misc */

/** Textarea that grows with its content (titles, summaries). `singleLine` blocks newlines (Enter blurs). */
export function AutoGrowTextarea({
  value,
  onChange,
  singleLine,
  className,
  ...rest
}: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value"> & { value: string; onChange: (v: string) => void; singleLine?: boolean }) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onChange(singleLine ? e.target.value.replace(/[\r\n]+/g, " ") : e.target.value)}
      onKeyDown={(e) => {
        if (singleLine && e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
      className={cn("block resize-none overflow-hidden", className)}
      {...rest}
    />
  );
}

export function AIBadge({ className }: { className?: string }) {
  return (
    <Badge tone="violet" size="sm" className={className}>
      <Sparkles aria-hidden />
      AI
    </Badge>
  );
}

/** Inline-editable heading (Notion-like). Commits on blur / Enter; Esc reverts. */
export function InlineTitle({
  value,
  onCommit,
  className,
  placeholder = "Untitled",
  ariaLabel = "Title",
  as: Tag = "h1",
  disabled,
}: {
  value: string;
  onCommit: (v: string) => void;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
  as?: "h1" | "h2" | "h3";
  disabled?: boolean;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => setDraft(value), [value]);
  if (!editing || disabled)
    return (
      <Tag className={cn("min-w-0", className)}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setEditing(true)}
          className="line-clamp-2 max-w-full break-words rounded-lg text-left decoration-slate-300 decoration-dashed underline-offset-4 hover:underline focus-visible:focus-ring disabled:no-underline"
          aria-label={`${ariaLabel}: ${value || placeholder}. Click to edit`}
        >
          {value || <span className="text-slate-400">{placeholder}</span>}
        </button>
      </Tag>
    );
  return (
    <input
      autoFocus
      aria-label={ariaLabel}
      className={cn("w-full min-w-0 rounded-lg bg-white px-1 outline-none ring-2 ring-brand-500/40", className)}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false);
        const v = draft.trim();
        if (v && v !== value) onCommit(v);
        else setDraft(value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setDraft(value);
          setEditing(false);
        }
      }}
    />
  );
}

/** Coloured gradient banner used on authoring hero headers. */
export function GradientHeader({ color, children, className }: { color: CategoryColor; children: React.ReactNode; className?: string }) {
  const c = colorClasses(color);
  return (
    <div className={cn("relative overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-soft", className)}>
      <div className={cn("absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r", c.gradient)} aria-hidden />
      <div className={cn("pointer-events-none absolute -right-16 -top-20 size-64 rounded-full opacity-[0.08] blur-3xl", c.solid)} aria-hidden />
      <div className="relative">{children}</div>
    </div>
  );
}

export function Kv({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium text-slate-800">{children}</dd>
    </div>
  );
}

/** Keeps a long dialog's primary actions in view while its body scrolls (pass to DialogFooter's className). */
export const STICKY_DIALOG_FOOTER = "sticky -bottom-6 z-10 -mx-6 -mb-6 mt-2 border-t border-slate-100 bg-white/95 px-6 pb-5 pt-3 backdrop-blur";
