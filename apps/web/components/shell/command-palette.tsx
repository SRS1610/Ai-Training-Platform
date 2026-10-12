"use client";

import type { SearchGroup, SearchItem, SearchResponse } from "@praxis/types";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  Kbd,
  Spinner,
  categoryClasses,
  cn,
  colorClasses,
  humanize,
} from "@praxis/ui";
import { useQuery } from "@tanstack/react-query";
import { CornerDownLeft, FileText, LogOut, Search, ShieldCheck, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { isNotDeployed } from "@/components/common/error-state";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { visibleNav } from "@/lib/nav";
import { qk } from "@/lib/query-keys";

const TYPE_ROUTES: Record<string, (id: string) => string> = {
  course: (id) => `/app/learn/${id}`,
  courses: (id) => `/app/learn/${id}`,
  lesson: () => `/app/learning`,
  user: (id) => `/app/admin/users/${id}`,
  users: (id) => `/app/admin/users/${id}`,
  simulation: (id) => `/app/simulations/${id}`,
  simulations: (id) => `/app/simulations/${id}`,
  assignment: (id) => `/app/assignments/${id}`,
  assignments: (id) => `/app/assignments/${id}`,
  learning_path: () => `/app/learning`,
  certificate: () => `/app/certificates`,
};

/** Normalise the search response ({groups:[{type,label,items}]}) — tolerant of flat shapes too. */
export function normaliseSearch(data: unknown): SearchGroup[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Partial<SearchResponse> & { items?: SearchItem[]; results?: SearchItem[] };
  if (Array.isArray(d.groups)) return d.groups.filter((g) => g.items?.length);
  const flat = d.items ?? d.results ?? (Array.isArray(data) ? (data as SearchItem[]) : []);
  const byType = new Map<string, SearchItem[]>();
  for (const it of flat) byType.set(it.type, [...(byType.get(it.type) ?? []), it]);
  return [...byType.entries()].map(([type, items]) => ({ type, label: humanize(type), items }));
}

function hitHref(h: SearchItem): string {
  return h.link || TYPE_ROUTES[h.type]?.(String(h.id)) || "/app/dashboard";
}

export function useCommandPaletteHotkey(setOpen: React.Dispatch<React.SetStateAction<boolean>>) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "/" && !typing) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);
}

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const { can, user, logout } = useAuth();
  const [q, setQ] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  React.useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  const search = useQuery({
    queryKey: qk.search(debounced),
    queryFn: ({ signal }) => api.get<unknown>("/search", { query: { q: debounced, limit: 20 }, signal }),
    enabled: open && debounced.length >= 2,
    staleTime: 30_000,
    retry: false,
  });
  const groups = normaliseSearch(search.data);

  const nav = visibleNav(can, !!user?.is_superadmin).flatMap((s) => s.items.map((i) => ({ ...i, section: s.label })));
  const needle = q.trim().toLowerCase();
  const navMatches = needle ? nav.filter((n) => `${n.label} ${n.section} ${n.description ?? ""}`.toLowerCase().includes(needle)) : nav.slice(0, 8);

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };
  const account = [
    { id: "profile", label: "Profile", keywords: "profile name avatar language timezone goal", icon: UserRound, run: () => go("/app/profile") },
    { id: "security", label: "Security & sign-in", keywords: "security password mfa two-step sessions devices", icon: ShieldCheck, run: () => go("/app/profile/security") },
    { id: "logout", label: "Sign out", keywords: "sign out logout log out", icon: LogOut, run: () => logout() },
  ];
  const accountMatches = needle ? account.filter((a) => `${a.label} ${a.keywords}`.toLowerCase().includes(needle)) : account;

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      label="Search Praxis"
      shouldFilter={false}
      footer={
        <span className="flex items-center gap-4">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> navigate
          </span>
          <span className="flex items-center gap-1">
            <Kbd>
              <CornerDownLeft className="size-3" />
            </Kbd>{" "}
            open
          </span>
          <span className="flex items-center gap-1">
            <Kbd>esc</Kbd> close
          </span>
        </span>
      }
    >
      <CommandInput
        value={q}
        onValueChange={setQ}
        placeholder="Search courses, simulations, people, pages…"
        trailing={search.isFetching ? <Spinner label="Searching" /> : null}
      />
      <CommandList>
        {debounced.length >= 2 && search.isError && !isNotDeployed(search.error) && (
          <p className="px-3 py-2 text-xs text-rose-700">Search failed — showing pages only.</p>
        )}
        {debounced.length >= 2 && search.isError && isNotDeployed(search.error) && (
          <p className="px-3 py-2 text-xs text-slate-500">Content search is coming soon — showing matching pages.</p>
        )}
        <CommandEmpty>
          <span className="flex flex-col items-center gap-2">
            <Search className="size-6 text-slate-300" aria-hidden />
            No results for “{q}”
          </span>
        </CommandEmpty>

        {groups.map(({ type, label, items }) => {
          const c = categoryClasses(type);
          return (
            <CommandGroup key={type} heading={label}>
              {items.map((h) => (
                <CommandItem key={`${type}-${h.id}`} value={`${type}-${h.id}`} onSelect={() => go(hitHref(h))}>
                  <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", c.soft, c.icon)}>
                    <FileText className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-900">{h.title}</span>
                    {(h.subtitle || h.snippet) && <span className="block truncate text-xs text-slate-500">{h.subtitle ?? h.snippet}</span>}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}

        {navMatches.length > 0 && (
          <CommandGroup heading={needle ? "Pages" : "Jump to"}>
            {navMatches.map((n) => {
              const c = colorClasses(n.color);
              const Icon = n.icon;
              return (
                <CommandItem key={n.href} value={n.href} onSelect={() => go(n.href)}>
                  <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br text-white", c.gradient)}>
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-900">{n.label}</span>
                    <span className="block truncate text-xs text-slate-500">{n.description}</span>
                  </span>
                  <span className="text-2xs font-semibold uppercase tracking-wider text-slate-400">{n.section}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
        {accountMatches.length > 0 && (
          <>
            {navMatches.length > 0 && <CommandSeparator />}
            <CommandGroup heading="Account">
              {accountMatches.map((a) => {
                const Icon = a.icon;
                return (
                  <CommandItem key={a.id} value={a.id} onSelect={a.run}>
                    <Icon className="size-4 text-slate-500" aria-hidden /> {a.label}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
