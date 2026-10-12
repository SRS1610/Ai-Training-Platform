"use client";

import { Button, Skeleton, cn, toast } from "@praxis/ui";
import { useMutation } from "@tanstack/react-query";
import { MailWarning, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { ErrorState } from "@/components/common/error-state";
import { LogoMark } from "@/components/common/logo";
import { api, ApiError, errorMessage } from "@/lib/api";
import { AuthProvider, useAuth } from "@/lib/auth";
import { CommandPalette, useCommandPaletteHotkey } from "./command-palette";
import { MobileNav } from "./mobile-nav";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

const SIDEBAR_KEY = "praxis.sidebarCollapsed";

function ShellSkeleton() {
  return (
    <div className="flex min-h-dvh" aria-busy aria-label="Loading your workspace">
      <div className="hidden w-[272px] shrink-0 flex-col gap-6 border-r border-slate-200/80 bg-slate-50/80 p-5 lg:flex">
        <div className="flex items-center gap-2.5">
          <LogoMark />
          <Skeleton className="h-5 w-20" />
        </div>
        <Skeleton className="h-14 w-full rounded-2xl" />
        <div className="space-y-2.5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-7 rounded-lg" />
              <Skeleton className="h-4 flex-1" />
            </div>
          ))}
        </div>
      </div>
      <div className="flex-1">
        <div className="flex h-16 items-center justify-end gap-3 border-b border-slate-200/70 px-8">
          <Skeleton className="h-10 w-72 rounded-xl" />
          <Skeleton className="size-9 rounded-full" />
        </div>
        <div className="space-y-6 p-8">
          <Skeleton className="h-9 w-72" />
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-32 rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      </div>
    </div>
  );
}

function Banners() {
  const { user, me } = useAuth();
  const pathname = usePathname();
  const resend = useMutation({
    mutationFn: () => api.post("/auth/email/resend"),
    onSuccess: () => toast.success("Verification email sent — check your inbox"),
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!user) return null;
  const needsMfa = me?.settings.require_mfa && !user.mfa_enabled && !pathname.startsWith("/app/profile/security");
  return (
    <>
      {needsMfa && (
        <div role="alert" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-gradient-to-r from-amber-100 via-orange-50 to-amber-100 px-4 py-2 text-center text-sm text-amber-950">
          <ShieldAlert className="size-4 text-amber-700" aria-hidden />
          Your organisation requires two-step verification.
          <Link href="/app/profile/security" className="font-semibold underline underline-offset-2">
            Set it up now
          </Link>
        </div>
      )}
      {!user.email_verified && (
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-gradient-to-r from-sky-50 via-indigo-50 to-violet-50 px-4 py-2 text-center text-sm text-slate-700">
          <MailWarning className="size-4 text-brand-600" aria-hidden />
          Please verify <strong className="font-semibold text-slate-900">{user.email}</strong> to secure your account.
          <Button variant="link" size="xs" onClick={() => resend.mutate()} loading={resend.isPending}>
            Resend email
          </Button>
        </div>
      )}
    </>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { isLoading, error, refetch, me } = useAuth();
  const [collapsed, setCollapsed] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [moreOpen, setMoreOpen] = React.useState(false);
  const pathname = usePathname();
  useCommandPaletteHotkey(setSearchOpen);

  React.useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(SIDEBAR_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);
  React.useEffect(() => setMoreOpen(false), [pathname]);

  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, c ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !c;
    });

  if (isLoading || (error instanceof ApiError && error.status === 401)) return <ShellSkeleton />;
  if (error || !me)
    return (
      <div className="grid min-h-dvh place-items-center p-6">
        <ErrorState error={error} onRetry={() => refetch()} title="We couldn't load your workspace" size="lg" />
      </div>
    );

  return (
    <div className="min-h-dvh">
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <div className={cn("flex min-h-dvh flex-col transition-[padding] duration-300 ease-spring", collapsed ? "lg:pl-[76px]" : "lg:pl-[272px]")}>
        <Banners />
        <Topbar onOpenSearch={() => setSearchOpen(true)} />
        <main id="main" tabIndex={-1} className="flex-1 px-4 pb-28 pt-6 focus:outline-none sm:px-6 lg:px-8 lg:pb-12 lg:pt-8">
          <div className="mx-auto w-full max-w-[1400px]">{children}</div>
        </main>
      </div>
      <MobileNav open={moreOpen} onOpenChange={setMoreOpen} />
      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}

/** Authenticated application shell: auth context + guard + sidebar/topbar/mobile nav + command palette. */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <Shell>{children}</Shell>
    </AuthProvider>
  );
}
