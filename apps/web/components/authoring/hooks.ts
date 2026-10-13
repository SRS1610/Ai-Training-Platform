"use client";

import * as React from "react";
import { ApiError, errorMessage } from "@/lib/api";

export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export interface AutosaveState {
  status: SaveStatus;
  error: string | null;
  savedAt: Date | null;
}

/**
 * Debounced autosave. `schedule(value)` queues a save `delay` ms after the last call;
 * `flush()` saves immediately (e.g. before switching lessons). Saves never overlap: a value scheduled
 * while a save is in flight is saved right after it finishes.
 */
export function useAutosave<T>(save: (value: T) => Promise<unknown>, delay = 900) {
  const [state, setState] = React.useState<AutosaveState>({ status: "idle", error: null, savedAt: null });
  const pending = React.useRef<{ value: T } | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = React.useRef<Promise<void> | null>(null);
  const saveRef = React.useRef(save);
  saveRef.current = save;

  const run = React.useCallback(async (): Promise<void> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (inflight.current) {
      await inflight.current;
    }
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    setState((s) => ({ ...s, status: "saving", error: null }));
    const p = (async () => {
      try {
        await saveRef.current(next.value);
        setState({ status: pending.current ? "dirty" : "saved", error: null, savedAt: new Date() });
      } catch (err) {
        // Keep the failed value so "Retry" can resend it (unless a newer edit superseded it).
        if (!pending.current) pending.current = next;
        setState((s) => ({ ...s, status: "error", error: problemsMessage(err) }));
      }
    })();
    inflight.current = p;
    await p;
    inflight.current = null;
  }, []);

  const schedule = React.useCallback(
    (value: T) => {
      pending.current = { value };
      setState((s) => ({ ...s, status: "dirty" }));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void run(), delay);
    },
    [delay, run],
  );

  const flush = React.useCallback(() => run(), [run]);
  const reset = React.useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
    setState({ status: "idle", error: null, savedAt: null });
  }, []);

  // Save pending edits when the component unmounts.
  React.useEffect(
    () => () => {
      if (pending.current) void run();
    },
    [run],
  );

  return { ...state, schedule, flush, reset, hasPending: () => !!pending.current };
}

/** Problem strings from an API error's details (`problems`, `errors`, `items`), if any. */
export function problemsFrom(err: unknown): string[] {
  if (!(err instanceof ApiError)) return [];
  const d = err.details as Record<string, unknown> | unknown[] | null | undefined;
  if (!d) return [];
  if (Array.isArray(d)) {
    return d
      .map((x) => {
        const o = x as { msg?: string; loc?: unknown[] };
        if (!o?.msg) return null;
        const parts = Array.isArray(o.loc) ? o.loc.filter((p) => p !== "body") : [];
        // ["questions", 3, "prompt"] → "Question 4 · prompt"
        const qi = parts[0] === "questions" && typeof parts[1] === "number" ? parts[1] : null;
        const loc = qi !== null ? [`Question ${qi + 1}`, ...parts.slice(2)].join(" · ") : parts.join(".");
        return `${loc ? `${loc}: ` : ""}${o.msg.replace(/^Value error, /, "")}`;
      })
      .filter((x): x is string => !!x);
  }
  const out: string[] = [];
  // Question import (`invalid_import`): {questions: [{index, errors: [...]}]} → "Question N: …"
  const qs = (d as Record<string, unknown>).questions;
  if (Array.isArray(qs)) {
    for (const q of qs) {
      const o = (q ?? {}) as { index?: unknown; errors?: unknown };
      const n = typeof o.index === "number" ? `Question ${o.index + 1}` : "Question";
      const errs = Array.isArray(o.errors) ? o.errors.map((x) => (typeof x === "string" ? x : JSON.stringify(x))) : [];
      if (errs.length) for (const e of errs) out.push(`${n}: ${e}`);
      else out.push(`${n}: ${JSON.stringify(q)}`);
    }
  }
  for (const key of ["errors", "problems", "items"]) {
    const v = (d as Record<string, unknown>)[key];
    if (Array.isArray(v)) {
      for (const p of v) {
        if (typeof p === "string") out.push(p);
        else if (p && typeof p === "object") {
          const o = p as Record<string, unknown>;
          out.push(String(o.message ?? o.problem ?? JSON.stringify(o)));
        }
      }
    }
  }
  if (!out.length && typeof (d as Record<string, unknown>).field === "string") {
    out.push(`${err.message}`);
  }
  return out;
}

/** One-line message that includes the first detailed problem when present. */
export function problemsMessage(err: unknown): string {
  const p = problemsFrom(err);
  const base = errorMessage(err);
  if (!p.length) return base;
  if (p.length === 1) return p[0]!.toLowerCase().startsWith(base.toLowerCase()) ? p[0]! : `${base}: ${p[0]}`;
  return `${base}: ${p[0]} (+${p.length - 1} more)`;
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

let counter = 0;
/** Short unique id for options/choices (stable enough for authoring). */
export function uid(prefix = ""): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}${Date.now().toString(36).slice(-4)}${counter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

/** Save a JSON object as a downloaded file. */
export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** URL search-param state for simple tabs/filters (keeps history clean with replace). */
export function useSearchParamState(
  searchParams: URLSearchParams,
  replace: (url: string) => void,
  pathname: string,
): [(key: string) => string | null, (updates: Record<string, string | null | undefined>) => void] {
  const get = React.useCallback((key: string) => searchParams.get(key), [searchParams]);
  const set = React.useCallback(
    (updates: Record<string, string | null | undefined>) => {
      const sp = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v === null || v === undefined || v === "") sp.delete(k);
        else sp.set(k, v);
      }
      const qs = sp.toString();
      replace(qs ? `${pathname}?${qs}` : pathname);
    },
    [searchParams, replace, pathname],
  );
  return [get, set];
}
