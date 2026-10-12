"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ak } from "./keys";
import type { Bank, Course, Page } from "./types";

/** Lightweight course list for pickers (first 100 by recency). */
export function useCourseOptions(enabled = true) {
  const q = useQuery({
    queryKey: ak.courses.options,
    enabled,
    queryFn: ({ signal }) => api.get<Page<Course>>("/courses", { signal, query: { page_size: 100 } }),
    staleTime: 60_000,
  });
  const items = q.data?.items ?? [];
  return {
    ...q,
    options: items.map((c) => ({ value: c.id, label: c.title })),
    titleOf: (id: string | null | undefined) => (id ? items.find((c) => c.id === id)?.title : undefined),
  };
}

/** Question banks for pickers. */
export function useBankOptions(enabled = true) {
  const q = useQuery({
    queryKey: ak.banks.list({ picker: true }),
    enabled,
    queryFn: ({ signal }) => api.get<Page<Bank>>("/question-banks", { signal, query: { page_size: 200 } }),
    staleTime: 30_000,
  });
  const items = q.data?.items ?? [];
  return { ...q, banks: items, titleOf: (id: string | null | undefined) => (id ? items.find((b) => b.id === id)?.title : undefined) };
}
