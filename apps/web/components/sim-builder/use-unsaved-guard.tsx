"use client";

import { ConfirmDialog } from "@praxis/ui";
import { useRouter } from "next/navigation";
import * as React from "react";

/**
 * Warn before leaving with unsaved changes: browser unload (refresh/close) and in-app link clicks
 * (App Router has no route-change events, so internal <a> clicks are intercepted in the capture phase).
 * Render the returned `dialog` once.
 */
export function useUnsavedGuard(dirty: boolean, message = "You have unsaved changes. Leave without saving?") {
  const router = useRouter();
  const [pending, setPending] = React.useState<string | null>(null);

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
      onOpenChange={(o) => !o && setPending(null)}
      destructive
      title="Leave without saving?"
      description={message}
      confirmLabel="Discard changes"
      cancelLabel="Keep editing"
      onConfirm={() => {
        const to = pending;
        setPending(null);
        if (to) router.push(to);
      }}
    />
  );
  return { dialog, confirmLeave: (to: string) => (dirty ? setPending(to) : router.push(to)) };
}
