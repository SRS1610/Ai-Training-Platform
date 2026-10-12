import { ChevronRight } from "lucide-react";
import * as React from "react";
import { cn } from "../lib/cn";

export interface Crumb {
  label: React.ReactNode;
  href?: string;
}

/**
 * Breadcrumbs. Pass `linkComponent` (e.g. Next.js Link) for client-side navigation.
 */
export function Breadcrumbs({
  items,
  className,
  linkComponent: LinkComp = "a",
}: {
  items: Crumb[];
  className?: string;
  linkComponent?: React.ElementType;
}) {
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-1 text-sm text-slate-500">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i} className="flex items-center gap-1">
              {c.href && !last ? (
                <LinkComp href={c.href} className="rounded px-0.5 transition-colors hover:text-brand-700 focus-visible:focus-ring">
                  {c.label}
                </LinkComp>
              ) : (
                <span aria-current={last ? "page" : undefined} className={cn(last && "font-medium text-slate-800")}>
                  {c.label}
                </span>
              )}
              {!last && <ChevronRight className="size-3.5 text-slate-400" aria-hidden />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  breadcrumbs?: Crumb[];
  actions?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
  linkComponent?: React.ElementType;
  children?: React.ReactNode;
}

/** Page title block: breadcrumbs, optional icon chip, title, description and right-aligned actions. */
export function PageHeader({
  title,
  description,
  eyebrow,
  breadcrumbs,
  actions,
  icon,
  className,
  linkComponent,
  children,
}: PageHeaderProps) {
  return (
    <header className={cn("mb-6 sm:mb-8", className)}>
      {breadcrumbs && breadcrumbs.length > 0 && <Breadcrumbs items={breadcrumbs} className="mb-3" linkComponent={linkComponent} />}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          {icon && (
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-brand-gradient text-white shadow-glow [&_svg]:size-6">
              {icon}
            </span>
          )}
          <div className="min-w-0">
            {eyebrow && <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-brand-700">{eyebrow}</p>}
            <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{title}</h1>
            {description && <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground sm:text-base">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

/** Section heading inside a page. */
export function SectionHeader({
  title,
  description,
  action,
  className,
  as: Tag = "h2",
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  as?: "h2" | "h3";
}) {
  return (
    <div className={cn("mb-4 flex items-end justify-between gap-4", className)}>
      <div>
        <Tag className="font-display text-lg font-semibold tracking-tight text-slate-900">{title}</Tag>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
