"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

/**
 * Read/write a set of string query params (filters, tabs, pagination) without scrolling.
 * `set({ tab: "graded", page: undefined })` removes keys set to undefined/empty.
 */
export function useUrlState<K extends string>(keys: readonly K[]) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const values = React.useMemo(() => {
    const out = {} as Record<K, string | undefined>;
    for (const k of keys) out[k] = params.get(k) ?? undefined;
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, keys.join("|")]);

  const set = React.useCallback(
    (patch: Partial<Record<K, string | number | boolean | undefined | null>>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch) as [string, unknown][]) {
        if (v === undefined || v === null || v === "" || v === false) next.delete(k);
        else next.set(k, String(v));
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  return [values, set] as const;
}
