"use client";

import type { Notification, Page } from "@praxis/types";
import { Button, EmptyState, Popover, PopoverContent, PopoverTrigger, Skeleton, categoryClasses, cn } from "@praxis/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, Bell, BookOpen, CheckCheck, ClipboardCheck, MessageSquare, Sparkles, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { isNotDeployed } from "@/components/common/error-state";
import { api } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { qk } from "@/lib/query-keys";

const TYPE_ICON: Record<string, typeof Bell> = {
  certificate_issued: Award,
  badge_earned: Award,
  course_completed: BookOpen,
  training_assigned: BookOpen,
  assignment_assigned: ClipboardCheck,
  assignment_due: ClipboardCheck,
  assignment_overdue: TriangleAlert,
  instructor_feedback: MessageSquare,
  generation_ready: Sparkles,
  ai_budget_alert: TriangleAlert,
};

const TYPE_COLOR: Record<string, string> = {
  certificate_issued: "amber",
  badge_earned: "amber",
  course_completed: "emerald",
  assessment_passed: "emerald",
  assessment_failed: "rose",
  assignment_overdue: "rose",
  ai_budget_alert: "rose",
  instructor_feedback: "violet",
  generation_ready: "fuchsia",
  training_assigned: "sky",
  assignment_assigned: "sky",
  assignment_due: "orange",
};

function unreadFrom(d: unknown): number {
  if (typeof d === "number") return d;
  const o = d as { count?: number; unread?: number; unread_count?: number } | null;
  return o?.count ?? o?.unread ?? o?.unread_count ?? 0;
}

export function NotificationsBell() {
  const qc = useQueryClient();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);

  const unread = useQuery({
    queryKey: qk.notifications.unread,
    queryFn: () => api.get<unknown>("/notifications/unread-count"),
    refetchInterval: (q) => (q.state.error ? false : 60_000),
    retry: false,
  });
  const list = useQuery({
    queryKey: qk.notifications.list({ page_size: 10 }),
    queryFn: () => api.get<Page<Notification> | Notification[]>("/notifications", { query: { page_size: 10 } }),
    enabled: open,
    retry: false,
  });
  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.notifications.all }),
  });
  const markAll = useMutation({
    mutationFn: () => api.post(`/notifications/read-all`),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.notifications.all }),
  });

  const count = unread.isError ? 0 : unreadFrom(unread.data);
  const items: Notification[] = Array.isArray(list.data) ? list.data : (list.data?.items ?? []);
  const unavailable = list.isError && isNotDeployed(list.error);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={count ? `Notifications, ${count} unread` : "Notifications"}>
          <Bell className="!size-5" />
          {count > 0 && (
            <span className="absolute right-1.5 top-1.5 grid min-w-[18px] place-items-center rounded-full bg-gradient-to-br from-rose-500 to-fuchsia-500 px-1 text-[10px] font-bold leading-[18px] text-white ring-2 ring-white">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[380px] p-0">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <p className="font-display font-semibold text-slate-900">Notifications</p>
          {count > 0 && (
            <Button variant="link" size="xs" leftIcon={<CheckCheck />} onClick={() => markAll.mutate()} loading={markAll.isPending}>
              Mark all read
            </Button>
          )}
        </div>
        <div className="max-h-[420px] overflow-y-auto scrollbar-thin">
          {list.isLoading ? (
            <div className="space-y-3 p-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex gap-3">
                  <Skeleton className="size-9 rounded-xl" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : unavailable || items.length === 0 ? (
            <EmptyState size="sm" illustration="inbox" title="You're all caught up" description={unavailable ? "Notifications will appear here soon." : "New activity will show up here."} />
          ) : list.isError ? (
            <p className="p-4 text-sm text-rose-700">Couldn&apos;t load notifications.</p>
          ) : (
            <ul>
              {items.map((n) => {
                const Icon = TYPE_ICON[n.type] ?? Bell;
                const c = categoryClasses(TYPE_COLOR[n.type] ?? "indigo");
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => {
                        if (!n.read_at) markRead.mutate(n.id);
                        if (n.link) {
                          setOpen(false);
                          router.push(n.link);
                        }
                      }}
                      className={cn("flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none", !n.read_at && "bg-brand-50/40")}
                    >
                      <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", c.soft, c.icon)}>
                        <Icon className="size-4" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start justify-between gap-2">
                          <span className={cn("text-sm text-slate-900", !n.read_at && "font-semibold")}>{n.title}</span>
                          {!n.read_at && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-500" aria-label="Unread" />}
                        </span>
                        {n.body && <span className="mt-0.5 line-clamp-2 block text-xs text-slate-600">{n.body}</span>}
                        <span className="mt-1 block text-2xs text-slate-500">{formatRelative(n.created_at)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="border-t border-slate-100 p-2">
          <Button asChild variant="ghost" size="sm" block>
            <Link href="/app/notifications" onClick={() => setOpen(false)}>
              View all notifications
            </Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
