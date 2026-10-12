"use client";

import type { AuthProviders, OAuthAuthorizeOut } from "@praxis/types";
import { Button, toast } from "@praxis/ui";
import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import { api, errorMessage } from "@/lib/api";
import { qk } from "@/lib/query-keys";

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
    </svg>
  );
}

function MicrosoftGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path fill="#F25022" d="M1 1h10.5v10.5H1z" />
      <path fill="#7FBA00" d="M12.5 1H23v10.5H12.5z" />
      <path fill="#00A4EF" d="M1 12.5h10.5V23H1z" />
      <path fill="#FFB900" d="M12.5 12.5H23V23H12.5z" />
    </svg>
  );
}

export async function startOAuth(provider: string, returnTo: string) {
  const res = await api.get<OAuthAuthorizeOut>(`/auth/oauth/${encodeURIComponent(provider)}/authorize`, {
    query: { return_to: returnTo },
    redirectOn401: false,
    noOrg: true,
  });
  window.location.assign(res.authorize_url);
}

/** Google / Microsoft buttons, shown only when GET /auth/providers reports them configured. */
export function ProviderButtons({ returnTo, label = "Continue" }: { returnTo: string; label?: string }) {
  const { data } = useQuery({
    queryKey: qk.providers,
    queryFn: () => api.get<AuthProviders>("/auth/providers", { redirectOn401: false, noOrg: true }),
    staleTime: 5 * 60_000,
  });
  const [busy, setBusy] = React.useState<string | null>(null);
  if (!data || (!data.google && !data.microsoft)) return null;

  const go = async (p: string) => {
    setBusy(p);
    try {
      await startOAuth(p, returnTo);
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2">
        {data.google && (
          <Button variant="secondary" size="lg" leftIcon={<GoogleGlyph />} loading={busy === "google"} onClick={() => go("google")}>
            {label} with Google
          </Button>
        )}
        {data.microsoft && (
          <Button variant="secondary" size="lg" leftIcon={<MicrosoftGlyph />} loading={busy === "microsoft"} onClick={() => go("microsoft")} className={!data.google ? "sm:col-span-2" : undefined}>
            {label} with Microsoft
          </Button>
        )}
      </div>
      <div className="flex items-center gap-3 text-xs font-medium uppercase tracking-wider text-slate-400" aria-hidden>
        <span className="h-px flex-1 bg-slate-200" />
        or
        <span className="h-px flex-1 bg-slate-200" />
      </div>
    </div>
  );
}
