"use client";

import { ConfirmDialog } from "@praxis/ui";
import { useRouter } from "next/navigation";
import * as React from "react";

const BACK = "__back__";
const SENTINEL = "__praxisUnsavedGuard";

/**
 * Warn before leaving with unsaved changes: browser unload (refresh/close), in-app link clicks (App Router has
 * no route-change events, so internal <a> clicks are intercepted in the capture phase) and the browser Back
 * button (a same-URL sentinel history entry absorbs the first Back; we go back for real only on confirm).
 * Render the returned `dialog` once.
 */
export function useUnsavedGuard(dirty: boolean, message = "You have unsaved changes. Leave without saving?") {
  const router = useRouter();
  const [pending, setPending] = React.useState<string | null>(null);
  const dirtyRef = React.useRef(dirty);
  dirtyRef.current = dirty;
  const armed = React.useRef(false);
  const leaving = React.useRef(false);

  const arm = React.useCallback(() => {
    if (armed.current) return;
    // Keep the router's own state on the entry so Next.js treats it as one of its history entries.
    const state = (window.history.state ?? {}) as Record<string, unknown>;
    window.history.pushState({ ...state, [SENTINEL]: true }, "", window.location.href);
    armed.current = true;
  }, []);

  // Arm the Back-button guard the first time there is something to lose.
  React.useEffect(() => {
    if (dirty) arm();
  }, [dirty, arm]);

  React.useEffect(() => {
    const onPop = () => {
      if (leaving.current || !armed.current) return;
      armed.current = false; // the sentinel entry was just popped
      if (dirtyRef.current) setPending(BACK);
      else {
        // Saved since arming: skip the duplicate same-URL entry so Back behaves normally.
        leaving.current = true;
        window.history.back();
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  React.useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = message;
      return message;
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      setPending(url.pathname + url.search + url.hash);
    };
    window.addEventListener("beforeunload", onUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty, message]);

  const dialog = (
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={(o) => {
        if (o) return;
        // "Keep editing" after Back: restore the sentinel so the next Back is guarded too.
        if (pending === BACK && !leaving.current) arm();
        setPending(null);
      }}
      destructive
      title="Leave without saving?"
      description={message}
      confirmLabel="Discard changes"
      cancelLabel="Keep editing"
      onConfirm={() => {
        const to = pending;
        if (to === BACK) {
          leaving.current = true;
          setPending(null);
          window.history.back();
          return;
        }
        setPending(null);
        if (to) router.push(to);
      }}
    />
  );
  return { dialog, confirmLeave: (to: string) => (dirty ? setPending(to) : router.push(to)) };
}
