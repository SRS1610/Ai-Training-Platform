"use client";

import { PageHeader, cn } from "@praxis/ui";
import { ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/app/profile", label: "Profile", icon: UserRound },
  { href: "/app/profile/security", label: "Security & sign-in", icon: ShieldCheck },
];

export function ProfileHeader({ title, description }: { title: string; description: string }) {
  const pathname = usePathname();
  return (
    <>
      <PageHeader title={title} description={description} eyebrow="Account" />
      <nav aria-label="Account sections" className="-mt-2 mb-8 border-b border-slate-200">
        <ul className="flex gap-6">
          {TABS.map((t) => {
            const active = pathname === t.href;
            const Icon = t.icon;
            return (
              <li key={t.href}>
                <Link
                  href={t.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "-mb-px inline-flex items-center gap-2 border-b-2 pb-3 text-sm font-medium transition-colors focus-visible:focus-ring",
                    active ? "border-brand-600 text-brand-700" : "border-transparent text-slate-600 hover:text-slate-900",
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
