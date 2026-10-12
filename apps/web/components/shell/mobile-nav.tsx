"use client";

import { Sheet, SheetContent, SheetTitle, cn } from "@praxis/ui";
import { Bot, LayoutDashboard, Library, Menu, MonitorPlay } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { useAuth } from "@/lib/auth";
import { OrgSwitcher } from "./org-switcher";
import { NavSections, isActive } from "./sidebar";

const PRIMARY = [
  { href: "/app/dashboard", label: "Home", icon: LayoutDashboard, perm: null },
  { href: "/app/catalog", label: "Catalog", icon: Library, perm: "learning.access" },
  { href: "/app/simulations", label: "Simulate", icon: MonitorPlay, perm: "learning.access" },
  { href: "/app/tutor", label: "Tutor", icon: Bot, perm: "learning.access" },
];

/** Mobile: bottom tab bar + "More" bottom sheet with the full navigation. */
export function MobileNav({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const pathname = usePathname();
  const { can } = useAuth();
  const items = PRIMARY.filter((i) => !i.perm || can(i.perm));
  return (
    <>
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/80 bg-white/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
      >
        <ul className="mx-auto flex max-w-lg items-stretch justify-around px-2">
          {items.map((i) => {
            const active = isActive(pathname, i.href);
            const Icon = i.icon;
            return (
              <li key={i.href} className="flex-1">
                <Link
                  href={i.href}
                  aria-current={active ? "page" : undefined}
                  className={cn("flex flex-col items-center gap-0.5 py-2 text-2xs font-semibold focus-visible:focus-ring", active ? "text-brand-700" : "text-slate-500")}
                >
                  <span className={cn("grid h-7 w-12 place-items-center rounded-full transition", active && "bg-brand-gradient text-white shadow-glow")}>
                    <Icon className="size-[18px]" aria-hidden />
                  </span>
                  {i.label}
                </Link>
              </li>
            );
          })}
          <li className="flex-1">
            <button
              type="button"
              onClick={() => onOpenChange(true)}
              className="flex w-full flex-col items-center gap-0.5 py-2 text-2xs font-semibold text-slate-500 focus-visible:focus-ring"
              aria-haspopup="dialog"
              aria-expanded={open}
            >
              <span className="grid h-7 w-12 place-items-center rounded-full">
                <Menu className="size-[18px]" aria-hidden />
              </span>
              More
            </button>
          </li>
        </ul>
      </nav>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="flex flex-col gap-0 px-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="px-5 pb-4 pt-2">
            <OrgSwitcher />
          </div>
          <div className="overflow-y-auto px-5 pb-6">
            <NavSections onNavigate={() => onOpenChange(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
