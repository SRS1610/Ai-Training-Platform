"use client";

import { Badge, Tooltip, cn, colorClasses } from "@praxis/ui";
import { ChevronsLeft, ChevronsRight, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/common/logo";
import { useAuth } from "@/lib/auth";
import { findNavItem, visibleNav, type NavItem } from "@/lib/nav";
import { OrgSwitcher } from "./org-switcher";

/** Exactly one nav item is active: the one the path belongs to (longest href match, plus player/quiz parents). */
export function isActive(pathname: string, href: string) {
  return findNavItem(pathname)?.href === href;
}

export function NavLink({ item, collapsed, onNavigate }: { item: NavItem; collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = isActive(pathname, item.href);
  const c = colorClasses(item.color);
  const Icon = item.icon;
  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? item.label : undefined}
      className={cn(
        "group relative flex items-center gap-3 rounded-xl px-2.5 py-2 text-sm font-medium transition-all focus-visible:focus-ring",
        active ? "bg-white text-slate-900 shadow-soft ring-1 ring-slate-200/80" : "text-slate-600 hover:bg-white/70 hover:text-slate-900",
        collapsed && "justify-center px-0",
      )}
    >
      {active && <span className={cn("absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-gradient-to-b", c.gradient)} aria-hidden />}
      <span
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-lg transition-colors",
          active ? cn("bg-gradient-to-br text-white shadow-sm", c.gradient) : cn(c.soft, c.icon, "group-hover:scale-105"),
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      {!collapsed && <span className="truncate">{item.label}</span>}
      {!collapsed && item.badge && (
        <Badge tone="gradient" size="sm" className="ml-auto">
          {item.badge}
        </Badge>
      )}
    </Link>
  );
  return collapsed ? (
    <Tooltip content={item.label} side="right">
      {link}
    </Tooltip>
  ) : (
    link
  );
}

export function NavSections({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const { can, user } = useAuth();
  const sections = visibleNav(can, !!user?.is_superadmin);
  return (
    <nav aria-label="Main" className="space-y-6">
      {sections.map((s) => (
        <div key={s.id}>
          {collapsed ? (
            <div className="mx-auto mb-2 h-px w-6 bg-slate-200" aria-hidden />
          ) : (
            <p className="mb-2 px-2.5 text-2xs font-semibold uppercase tracking-[0.12em] text-slate-500">{s.label}</p>
          )}
          <ul className="space-y-0.5" aria-label={s.label}>
            {s.items.map((i) => (
              <li key={i.href}>
                <NavLink item={i} collapsed={collapsed} onNavigate={onNavigate} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function UpgradeCard() {
  const { organisation, can } = useAuth();
  if (!organisation || !["free", "individual"].includes(organisation.plan_code)) return null;
  return (
    <div className="relative overflow-hidden rounded-2xl bg-brand-gradient p-4 text-white shadow-glow">
      <div className="absolute -right-6 -top-6 size-20 rounded-full bg-white/20 blur-xl" aria-hidden />
      <Sparkles className="size-5 text-amber-200" aria-hidden />
      <p className="mt-2 text-sm font-semibold">Unlock AI course builder</p>
      <p className="mt-0.5 text-xs text-indigo-100">Simulations, AI generation and advanced analytics.</p>
      <Link
        href={can("billing.manage") ? "/app/admin/billing" : "/#pricing"}
        className="mt-3 inline-flex rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-brand-700 shadow-sm hover:bg-brand-50 focus-visible:focus-ring"
      >
        View plans
      </Link>
    </div>
  );
}

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-slate-200/80 bg-slate-50/80 backdrop-blur-xl transition-[width] duration-300 ease-spring lg:flex",
        collapsed ? "w-[76px]" : "w-[272px]",
      )}
    >
      <div className={cn("flex h-16 shrink-0 items-center", collapsed ? "justify-center" : "px-5")}>
        <Logo href="/app/dashboard" collapsed={collapsed} />
      </div>
      <div className={cn("pb-4", collapsed ? "px-3" : "px-4")}>
        <OrgSwitcher collapsed={collapsed} />
      </div>
      <div className={cn("flex-1 overflow-y-auto pb-6 scrollbar-thin", collapsed ? "px-3" : "px-4")}>
        <NavSections collapsed={collapsed} />
      </div>
      <div className={cn("space-y-3 border-t border-slate-200/80 py-4", collapsed ? "px-3" : "px-4")}>
        {!collapsed && <UpgradeCard />}
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            "flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-sm font-medium text-slate-500 transition-colors hover:bg-white hover:text-slate-900 focus-visible:focus-ring",
            collapsed && "justify-center",
          )}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronsRight className="size-4" aria-hidden /> : <ChevronsLeft className="size-4" aria-hidden />}
          {!collapsed && "Collapse"}
        </button>
      </div>
    </aside>
  );
}
