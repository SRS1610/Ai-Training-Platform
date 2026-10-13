"use client";

import { Breadcrumbs, Kbd } from "@praxis/ui";
import { Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoMark } from "@/components/common/logo";
import { findNavItem } from "@/lib/nav";
import { NotificationsBell } from "./notifications";
import { UserMenu } from "./user-menu";

function crumbsFor(pathname: string) {
  const item = findNavItem(pathname);
  const crumbs: { label: string; href?: string }[] = [];
  if (pathname.startsWith("/app/instructor")) crumbs.push({ label: "Teach" });
  else if (pathname.startsWith("/app/admin")) crumbs.push({ label: "Manage", href: "/app/admin" });
  else if (pathname.startsWith("/app/platform")) crumbs.push({ label: "Platform" });
  else if (pathname.startsWith("/app/profile") || pathname.startsWith("/app/notifications")) crumbs.push({ label: "Account", href: "/app/profile" });
  else crumbs.push({ label: "Learn" });
  if (item) crumbs.push({ label: item.label, href: item.href });
  else if (pathname.startsWith("/app/profile/security")) crumbs.push({ label: "Security" });
  else if (pathname.startsWith("/app/profile/privacy")) crumbs.push({ label: "Privacy & data" });
  else if (pathname.startsWith("/app/profile")) crumbs.push({ label: "Profile" });
  else if (pathname.startsWith("/app/notifications")) crumbs.push({ label: "Notifications" });
  return crumbs;
}

export function Topbar({ onOpenSearch }: { onOpenSearch: () => void }) {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/75 backdrop-blur-xl">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
        <Link href="/app/dashboard" className="rounded-lg focus-visible:focus-ring lg:hidden" aria-label="Dashboard">
          <LogoMark />
        </Link>
        <Breadcrumbs items={crumbsFor(pathname)} linkComponent={Link} className="hidden md:block" />
        <div className="ml-auto flex flex-1 items-center justify-end gap-1.5 sm:gap-2 md:flex-none">
          <button
            type="button"
            onClick={onOpenSearch}
            className="group flex h-10 w-full max-w-xs items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50/80 px-3 text-sm text-slate-500 transition hover:border-brand-200 hover:bg-white focus-visible:focus-ring md:w-72"
            aria-label="Search (Ctrl K)"
            aria-keyshortcuts="Control+K Meta+K /"
          >
            <Search className="size-4 text-slate-400 group-hover:text-brand-500" aria-hidden />
            <span className="flex-1 truncate text-left">Search anything…</span>
            <span className="hidden items-center gap-0.5 sm:flex" aria-hidden>
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </span>
          </button>
          <NotificationsBell />
          <UserMenu onOpenShortcuts={onOpenSearch} />
        </div>
      </div>
    </header>
  );
}
