"use client";

import { Button, EmptyState, PageHeader, colorClasses } from "@praxis/ui";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { findNavItem } from "@/lib/nav";

/**
 * Placeholder for sections whose pages are still being built. Specific routes added later
 * (e.g. app/app/catalog/page.tsx) take precedence over this catch-all automatically.
 */
export default function ComingSoonPage() {
  const pathname = usePathname();
  const item = findNavItem(pathname);
  const { can, user } = useAuth();
  const allowed = item?.superadmin ? !!user?.is_superadmin : !item?.anyOf || item.anyOf.some((p) => can(p));
  const Icon = item?.icon;
  const c = colorClasses(item?.color ?? "indigo");

  if (!item)
    return (
      <EmptyState
        size="lg"
        illustration="search"
        title="Page not found"
        description="The page you're looking for doesn't exist or has moved."
        action={
          <Button asChild variant="gradient" leftIcon={<ArrowLeft />}>
            <Link href="/app/dashboard">Back to dashboard</Link>
          </Button>
        }
      />
    );

  return (
    <>
      <PageHeader
        title={item.label}
        description={item.description}
        icon={Icon ? <Icon /> : undefined}
        className="[&_h1+p]:max-w-xl"
      />
      <div className={`rounded-3xl border border-slate-200/80 bg-gradient-to-br ${c.tint} p-6 shadow-soft`}>
        {allowed ? (
          <EmptyState
            size="lg"
            illustration="rocket"
            title={`${item.label} is on its way`}
            description="We're putting the finishing touches on this area. In the meantime, keep learning from your dashboard."
            action={
              <Button asChild variant="gradient">
                <Link href="/app/dashboard">Go to dashboard</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            size="lg"
            illustration="shield"
            title="You don't have access to this area"
            description="Ask an organisation admin if you need access."
            action={
              <Button asChild variant="secondary">
                <Link href="/app/dashboard">Back to dashboard</Link>
              </Button>
            }
          />
        )}
      </div>
    </>
  );
}
