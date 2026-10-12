"use client";

import { Badge, categoryClasses, cn, colorClasses, humanize } from "@praxis/ui";
import {
  BookOpen,
  Briefcase,
  CalendarClock,
  Cpu,
  GraduationCap,
  HeartPulse,
  Lightbulb,
  type LucideIcon,
  Megaphone,
  Shield,
  ShieldCheck,
  Users,
  Wallet,
} from "lucide-react";
import * as React from "react";
import { daysUntil } from "@/lib/format";
import { difficultyColor, difficultyLevel } from "./meta";

const CATEGORY_ICONS: [RegExp, LucideIcon][] = [
  [/secur|cyber|privacy/i, Shield],
  [/complian|policy|legal|risk/i, ShieldCheck],
  [/leader|manage/i, Users],
  [/\bit\b|tech|engineer|data|cloud|software|support/i, Cpu],
  [/health|clinic|safety|care/i, HeartPulse],
  [/sales|market/i, Megaphone],
  [/financ|account/i, Wallet],
  [/customer|service|success/i, Users],
  [/onboard|induct/i, GraduationCap],
  [/soft|communic|skill/i, Lightbulb],
  [/business|operat/i, Briefcase],
];

export function categoryIcon(category: string | null | undefined): LucideIcon {
  if (!category) return BookOpen;
  return CATEGORY_ICONS.find(([re]) => re.test(category))?.[1] ?? BookOpen;
}

/** Gradient course header with decorative shapes (or the course thumbnail when present). */
export function CourseCover({
  category,
  thumbnailUrl,
  className,
  iconSize = "md",
  children,
}: {
  category: string | null | undefined;
  thumbnailUrl?: string | null;
  className?: string;
  iconSize?: "sm" | "md" | "lg";
  children?: React.ReactNode;
}) {
  const c = categoryClasses(category);
  const Icon = categoryIcon(category);
  const [broken, setBroken] = React.useState(false);
  return (
    <div className={cn("relative overflow-hidden bg-gradient-to-br", c.gradient, className)}>
      {thumbnailUrl && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumbnailUrl}
          alt=""
          onError={() => setBroken(true)}
          className="absolute inset-0 size-full object-cover transition duration-500 group-hover:scale-105"
        />
      ) : (
        <>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.22)_1px,transparent_0)] [background-size:18px_18px]" aria-hidden />
          <div className="absolute -right-8 -top-10 size-36 rounded-full bg-white/20 transition duration-500 group-hover:scale-110" aria-hidden />
          <div className="absolute -bottom-12 left-10 size-28 rounded-full bg-white/10" aria-hidden />
          <div className="absolute right-10 top-1/2 size-10 rotate-12 rounded-xl bg-white/15" aria-hidden />
          <Icon
            className={cn(
              "absolute left-5 top-5 text-white/95 drop-shadow-sm",
              iconSize === "sm" ? "size-6" : iconSize === "lg" ? "size-12" : "size-8",
            )}
            aria-hidden
          />
        </>
      )}
      {children}
    </div>
  );
}

/** Four-bar difficulty meter with label. */
export function DifficultyMeter({ difficulty, className }: { difficulty: string | null | undefined; className?: string }) {
  if (!difficulty) return null;
  const level = difficultyLevel(difficulty);
  const c = colorClasses(difficultyColor(difficulty));
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium text-slate-600", className)}>
      <span className="flex items-end gap-0.5" aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={cn("w-1 rounded-full", i <= level ? c.solid : "bg-slate-200")} style={{ height: 4 + i * 2.5 }} />
        ))}
      </span>
      {humanize(difficulty)}
    </span>
  );
}

/** Due date chip: overdue (rose), soon (amber), later (sky), done (emerald). */
export function DueChip({
  date,
  overdue: forceOverdue,
  done,
  size = "sm",
}: {
  date: string | null | undefined;
  overdue?: boolean;
  done?: boolean;
  size?: "sm" | "md";
}) {
  const d = daysUntil(date);
  if (d === null) return null;
  if (done)
    return (
      <Badge tone="success" size={size}>
        <CalendarClock aria-hidden />
        Was due {new Date(date!).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
      </Badge>
    );
  const overdue = forceOverdue || d < 0;
  const soon = !overdue && d <= 3;
  const label = overdue ? (d < 0 ? `Overdue by ${Math.abs(d)}d` : "Overdue") : d === 0 ? "Due today" : d === 1 ? "Due tomorrow" : `Due in ${d}d`;
  return (
    <Badge tone={overdue ? "danger" : soon ? "warning" : "info"} size={size}>
      <CalendarClock aria-hidden />
      {label}
    </Badge>
  );
}

/** Coloured skill pills. */
export function SkillPills({ skills, max = 4, className }: { skills: { id: string; name: string }[]; max?: number; className?: string }) {
  if (!skills.length) return null;
  const shown = skills.slice(0, max);
  const rest = skills.length - shown.length;
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)} aria-label="Skills">
      {shown.map((s) => {
        const c = categoryClasses(s.name);
        return (
          <li key={s.id} className={cn("rounded-md px-1.5 py-0.5 text-2xs font-semibold ring-1 ring-inset", c.soft, c.text, c.ring)}>
            {s.name}
          </li>
        );
      })}
      {rest > 0 && <li className="rounded-md bg-slate-100 px-1.5 py-0.5 text-2xs font-semibold text-slate-600">+{rest}</li>}
    </ul>
  );
}

/** Decorative blurred colour blobs for hero panels. */
export function HeroGlow() {
  return (
    <>
      <div className="pointer-events-none absolute inset-0 bg-grid-faint opacity-30 [background-size:32px_32px]" aria-hidden />
      <div className="pointer-events-none absolute -right-10 -top-16 size-72 rounded-full bg-fuchsia-400/30 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -bottom-24 left-1/3 size-72 rounded-full bg-sky-400/25 blur-3xl" aria-hidden />
    </>
  );
}

/** Small "icon chip + title" card header used across learner pages. */
export function SectionTitle({
  icon: Icon,
  color = "indigo",
  title,
  description,
  action,
  as: Tag = "h2",
  id,
}: {
  icon: LucideIcon;
  color?: Parameters<typeof colorClasses>[0];
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  as?: "h2" | "h3";
  id?: string;
}) {
  const c = colorClasses(color);
  return (
    // The action wraps underneath the title on narrow screens instead of squeezing the heading column.
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", c.soft, c.icon)}>
          <Icon className="size-[18px]" aria-hidden />
        </span>
        <div className="min-w-0">
          <Tag id={id} className="font-display text-base font-semibold tracking-tight text-slate-900">
            {title}
          </Tag>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}
