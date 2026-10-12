"use client";

import type { Notification, Page } from "@praxis/types";
import { Button, Card, EmptyState, PageHeader, Pagination, Skeleton, Tabs, TabsList, TabsTrigger, cn, toast } from "@praxis/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { ErrorState, isNotDeployed } from "@/components/common/error-state";
import { api, errorMessage } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { qk } from "@/lib/query-keys";

const PAGE_SIZE = 20;

export default function NotificationsPage() {
  const qc = useQueryClient();
  const [page, setPage] = React.useState(1);
  const [filter, setFilter] = React.useState<"all" | "unread">("all");
  const params = { page, page_size: PAGE_SIZE, unread: filter === "unread" ? true : undefined };
  const q = useQuery({
    queryKey: qk.notifications.list(params),
    queryFn: () => api.get<Page<Notification>>("/notifications", { query: params }),
    retry: false,
  });
  const markAll = useMutation({
    mutationFn: () => api.post("/notifications/read-all"),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.notifications.all }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.notifications.all }),
  });
  const items = q.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Assignments, feedback, certificates and other updates."
        icon={<Bell />}
        actions={
          <Button variant="secondary" leftIcon={<CheckCheck />} onClick={() => markAll.mutate()} loading={markAll.isPending}>
            Mark all as read
          </Button>
        }
      />
      <Tabs value={filter} onValueChange={(v) => { setFilter(v as "all" | "unread"); setPage(1); }}>
        <TabsList className="mb-4">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="unread">Unread</TabsTrigger>
        </TabsList>
      </Tabs>
      <Card>
        {q.isLoading ? (
          <div className="space-y-4 p-6">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : q.isError && !isNotDeployed(q.error) ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState illustration="inbox" title="You're all caught up" description="New notifications will appear here." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((n) => (
              <li key={n.id} className={cn("flex items-start gap-4 p-4 sm:px-6", !n.read_at && "bg-brand-50/40")}>
                <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", n.read_at ? "bg-slate-200" : "bg-brand-500")} aria-label={n.read_at ? "Read" : "Unread"} />
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm text-slate-900", !n.read_at && "font-semibold")}>
                    {n.link ? (
                      <Link href={n.link} onClick={() => !n.read_at && markRead.mutate(n.id)} className="hover:underline">
                        {n.title}
                      </Link>
                    ) : (
                      n.title
                    )}
                  </p>
                  {n.body && <p className="mt-0.5 text-sm text-slate-600">{n.body}</p>}
                  <p className="mt-1 text-xs text-slate-500">{formatRelative(n.created_at)}</p>
                </div>
                {!n.read_at && (
                  <Button variant="ghost" size="xs" onClick={() => markRead.mutate(n.id)}>
                    Mark read
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {(q.data?.total ?? 0) > PAGE_SIZE && (
          <div className="border-t border-slate-100 p-4">
            <Pagination page={page} pageSize={PAGE_SIZE} total={q.data!.total} onPageChange={setPage} />
          </div>
        )}
      </Card>
    </>
  );
}
