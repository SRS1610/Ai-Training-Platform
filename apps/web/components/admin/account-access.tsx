"use client";

/**
 * Workspace access gates used by `app/app/layout.tsx`:
 *
 * - `WorkspaceAccessGate` wraps the app shell. When `/me` is refused because the organisation is suspended
 *   (`organisation_suspended`) or the member's own access is paused (`membership_inactive`), it renders a
 *   branded full-page state with Sign out, an organisation switcher (other active memberships) and
 *   contact-your-admin copy — instead of the generic "couldn't load your workspace" error.
 * - `MfaRequiredGate` sits inside the shell. When the organisation requires two-step verification and the
 *   user hasn't enabled it, every org endpoint answers `mfa_required`; rather than a page of access errors
 *   we show one clear call to action to /app/profile/security (profile pages stay reachable).
 */

import type { OrgSummary } from "@praxis/types";
import { Avatar, Badge, Button, Skeleton, cn, colorClasses, colorFor, toast } from "@praxis/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Building2, LogOut, PauseCircle, ShieldAlert, ShieldCheck, UserRoundCog } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { LogoMark } from "@/components/common/logo";
import { api, ApiError, ORG_HEADER, errorMessage } from "@/lib/api";
import { useAuth, useMeQuery } from "@/lib/auth";
import { getActiveOrgId, setActiveOrgId } from "@/lib/org";
import { qk } from "@/lib/query-keys";

const BLOCKING_CODES = ["organisation_suspended", "membership_inactive"] as const;
type BlockCode = (typeof BLOCKING_CODES)[number];

function blockCode(err: unknown): BlockCode | null {
  if (!(err instanceof ApiError) || err.status !== 403) return null;
  return (BLOCKING_CODES as readonly string[]).includes(err.code) ? (err.code as BlockCode) : null;
}

async function signOut(qc: ReturnType<typeof useQueryClient>) {
  try {
    await api.post("/auth/logout", undefined, { redirectOn401: false });
  } catch {
    /* already signed out */
  }
  setActiveOrgId(null);
  qc.clear();
  window.location.assign("/login?signed_out=1");
}

export function WorkspaceAccessGate({ children }: { children: React.ReactNode }) {
  // Same query (and cache entry) as AuthProvider — no extra request.
  const me = useMeQuery();
  const code = blockCode(me.error);
  if (!code) return <>{children}</>;
  return <BlockedWorkspace code={code} />;
}

function BlockedWorkspace({ code }: { code: BlockCode }) {
  const qc = useQueryClient();
  const [switching, setSwitching] = React.useState<string | null>(null);
  const [leaving, setLeaving] = React.useState(false);
  // Every active membership, probed individually so we know which workspaces are actually reachable
  // (the list endpoint doesn't carry organisation status). Users rarely have more than a handful.
  const orgs = useQuery({
    queryKey: ["me", "organisations", "reachable"],
    queryFn: async ({ signal }) => {
      const list = await api.get<OrgSummary[]>("/me/organisations", { signal, noOrg: true });
      const probes = await Promise.allSettled(
        list.map((o) => api.get("/me", { signal, noOrg: true, redirectOn401: false, headers: { [ORG_HEADER]: o.id } })),
      );
      return list.map((o, i) => ({ ...o, reachable: probes[i]!.status === "fulfilled" }));
    },
  });
  const activeId = getActiveOrgId();
  const blocked = orgs.data?.find((o) => o.id === activeId) ?? orgs.data?.find((o) => !o.reachable);
  const others = (orgs.data ?? []).filter((o) => o.id !== blocked?.id && o.reachable);
  const suspended = code === "organisation_suspended";
  const orgName = blocked?.name ?? "your organisation";

  const switchTo = async (o: OrgSummary) => {
    setSwitching(o.id);
    try {
      setActiveOrgId(o.id);
      await api.patch("/me", { default_organisation_id: o.id }, { noOrg: true }).catch(() => undefined);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
      await qc.invalidateQueries({ queryKey: qk.me });
      const err = qc.getQueryState(qk.me)?.error;
      if (blockCode(err)) toast.error(`${o.name} isn't available either`);
      else toast.success(`Switched to ${o.name}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSwitching(null);
    }
  };

  return (
    <main id="main" tabIndex={-1} className="relative grid min-h-dvh place-items-center overflow-hidden bg-slate-50 px-4 py-10 focus:outline-none">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-gradient-to-br from-indigo-200/60 via-fuchsia-100/50 to-amber-100/60 blur-2xl" aria-hidden />
      <div className="relative w-full max-w-lg">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <LogoMark />
          <span className="font-display text-lg font-bold tracking-tight text-slate-900">Praxis</span>
        </div>
        <section aria-labelledby="blocked-title" className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-lift">
          <div className={cn("h-1.5 bg-gradient-to-r", suspended ? "from-amber-400 via-orange-500 to-rose-500" : "from-sky-400 via-indigo-500 to-violet-500")} aria-hidden />
          <div className="p-6 sm:p-8">
            <span
              className={cn(
                "grid size-14 place-items-center rounded-2xl bg-gradient-to-br text-white shadow-sm",
                suspended ? "from-amber-400 to-rose-500" : "from-sky-400 to-indigo-600",
              )}
              aria-hidden
            >
              {suspended ? <PauseCircle className="size-7" /> : <UserRoundCog className="size-7" />}
            </span>
            <h1 id="blocked-title" className="mt-5 font-display text-2xl font-bold tracking-tight text-slate-900">
              {suspended ? `${blocked?.name ?? "This organisation"} is currently suspended` : `Your access to ${orgName} is paused`}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              {suspended
                ? "Nobody can sign in to this organisation's workspace right now. This is usually temporary — for example while billing or an account review is sorted out."
                : "An administrator has suspended your membership, so you can't open this organisation's workspace right now."}{" "}
              Your learning records, certificates and progress are kept safe.
            </p>
            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-700">
              <p className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
                <span>
                  {suspended
                    ? `Contact ${orgName === "your organisation" ? "your organisation's" : `${orgName}'s`} administrator or your Praxis account manager to restore access.`
                    : `Contact an administrator at ${orgName} if you think this is a mistake.`}
                </span>
              </p>
            </div>

            {orgs.isLoading ? (
              <Skeleton className="mt-6 h-16 rounded-2xl" />
            ) : others.length > 0 ? (
              <div className="mt-6">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-brand-700">Your other workspaces</h2>
                <ul className="mt-2 space-y-2">
                  {others.map((o) => {
                    const c = colorClasses(colorFor(o.name));
                    return (
                      <li key={o.id}>
                        <button
                          type="button"
                          onClick={() => switchTo(o)}
                          disabled={!!switching}
                          className="group flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-left transition-all hover:border-brand-300 hover:shadow-soft focus-visible:focus-ring disabled:opacity-60"
                        >
                          <Avatar name={o.name} src={o.logo_url} size="md" className={cn("rounded-xl", c.soft)} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-semibold text-slate-900">{o.name}</span>
                            <span className="block truncate text-xs text-muted-foreground">{o.kind === "individual" ? "Personal workspace" : `${o.plan_code.charAt(0).toUpperCase()}${o.plan_code.slice(1)} plan`}</span>
                          </span>
                          {switching === o.id ? (
                            <Badge tone="info" size="sm">Switching…</Badge>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700">
                              Open <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            <div className="mt-6 flex flex-col-reverse gap-2 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Building2 className="size-3.5" aria-hidden />
                {others.length ? "Or sign out and use a different account." : "You can sign in with a different account."}
              </p>
              <Button
                variant="secondary"
                leftIcon={<LogOut />}
                loading={leaving}
                onClick={() => {
                  setLeaving(true);
                  void signOut(qc);
                }}
              >
                Sign out
              </Button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

/** Inside the shell: one clear "set up two-step verification" state while the org requires it. */
export function MfaRequiredGate({ children }: { children: React.ReactNode }) {
  const { me, user } = useAuth();
  const pathname = usePathname();
  const qc = useQueryClient();
  const blocked = !!me?.settings.require_mfa && !!user && !user.mfa_enabled && !pathname.startsWith("/app/profile");
  if (!blocked) return <>{children}</>;
  return (
    <div className="grid place-items-center py-6 sm:py-12">
      <section aria-labelledby="mfa-title" className="w-full max-w-xl overflow-hidden rounded-3xl border border-slate-200/80 bg-white text-center shadow-soft">
        <div className="h-1.5 bg-gradient-to-r from-amber-400 via-orange-500 to-fuchsia-500" aria-hidden />
        <div className="p-6 sm:p-10">
          <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-600 text-white shadow-sm" aria-hidden>
            <ShieldAlert className="size-8" />
          </span>
          <h1 id="mfa-title" className="mt-5 font-display text-2xl font-bold tracking-tight text-slate-900">
            Set up two-step verification to continue
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-600">
            {me?.organisation.name ?? "Your organisation"} requires two-step verification for everyone. It takes about a minute with an
            authenticator app — then you&apos;ll be straight back to your training.
          </p>
          <ol className="mx-auto mt-6 grid max-w-md gap-2 text-left text-sm text-slate-700 sm:grid-cols-3 sm:gap-3">
            {["Open Security & sign-in", "Scan the QR code", "Enter the 6-digit code"].map((s, i) => (
              <li key={s} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 sm:flex-col sm:items-start sm:gap-1 sm:py-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-xs font-bold text-white" aria-hidden>
                  {i + 1}
                </span>
                {s}
              </li>
            ))}
          </ol>
          <div className="mt-7 flex flex-col items-center justify-center gap-2 sm:flex-row">
            <Button asChild variant="gradient" size="lg" leftIcon={<ShieldCheck />}>
              <Link href="/app/profile/security">Set up two-step verification</Link>
            </Button>
            <Button variant="ghost" leftIcon={<LogOut />} onClick={() => void signOut(qc)}>
              Sign out
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
