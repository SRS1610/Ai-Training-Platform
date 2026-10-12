"use client";

import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn,
  humanize,
  toast,
} from "@praxis/ui";
import { Check, ChevronsUpDown, Settings } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";

export function OrgSwitcher({ collapsed, className }: { collapsed?: boolean; className?: string }) {
  const { organisation, organisations, switchOrganisation, can } = useAuth();
  if (!organisation) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "group flex w-full items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-2 text-left shadow-soft transition hover:border-brand-200 focus-visible:focus-ring",
          collapsed && "justify-center border-transparent bg-transparent p-0 shadow-none",
          className,
        )}
        aria-label={`Organisation: ${organisation.name}. Switch organisation`}
      >
        <Avatar name={organisation.name} src={organisation.logo_url} size="sm" shape="rounded" className="ring-0" />
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-slate-900">{organisation.name}</span>
              <span className="block truncate text-2xs font-medium uppercase tracking-wider text-slate-500">
                {humanize(organisation.plan_code)} plan
              </span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-slate-400 group-hover:text-slate-600" aria-hidden />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>Organisations</DropdownMenuLabel>
        {organisations.map((o) => (
          <DropdownMenuItem
            key={o.id}
            onSelect={async () => {
              if (o.id === organisation.id) return;
              await switchOrganisation(o.id);
              toast.success(`Switched to ${o.name}`);
            }}
            className="gap-3"
          >
            <Avatar name={o.name} src={o.logo_url} size="xs" shape="rounded" className="ring-0" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-slate-900">{o.name}</span>
              <span className="block truncate text-xs text-slate-500">{o.roles.map((r) => humanize(String(r))).join(", ") || humanize(o.kind)}</span>
            </span>
            {o.id === organisation.id && <Check className="!text-brand-600" aria-label="Current" />}
          </DropdownMenuItem>
        ))}
        {can("organisation.manage") && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/app/admin/settings">
                <Settings /> Organisation settings
              </Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
