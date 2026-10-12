"use client";

import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@praxis/ui";
import { Keyboard, LogOut, ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";

export function UserMenu({ onOpenShortcuts }: { onOpenShortcuts?: () => void }) {
  const { user, logout } = useAuth();
  if (!user) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-full p-0.5 transition hover:ring-4 hover:ring-brand-100 focus-visible:focus-ring" aria-label="Account menu">
        <Avatar name={user.full_name} src={user.avatar_url} size="sm" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <div className="flex items-center gap-3 px-2.5 py-2">
          <Avatar name={user.full_name} src={user.avatar_url} size="md" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{user.full_name}</p>
            <p className="truncate text-xs text-slate-500">{user.email}</p>
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Account</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link href="/app/profile">
            <UserRound /> Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/app/profile/security">
            <ShieldCheck /> Security & sign-in
          </Link>
        </DropdownMenuItem>
        {onOpenShortcuts && (
          <DropdownMenuItem onSelect={onOpenShortcuts}>
            <Keyboard /> Search & shortcuts
            <DropdownMenuShortcut>⌘K</DropdownMenuShortcut>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={() => logout()} data-testid="sign-out">
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
