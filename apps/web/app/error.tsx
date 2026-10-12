"use client";

import { Button, EmptyState } from "@praxis/ui";
import { RefreshCw } from "lucide-react";
import * as React from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  React.useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main id="main" className="grid min-h-[70dvh] place-items-center p-6">
      <EmptyState
        size="lg"
        illustration="error"
        title="Something went wrong"
        description={
          <>
            An unexpected error occurred. Please try again.
            {error.digest && <span className="mt-1 block font-mono text-2xs text-slate-400">Ref: {error.digest}</span>}
          </>
        }
        action={
          <Button variant="gradient" leftIcon={<RefreshCw />} onClick={reset}>
            Try again
          </Button>
        }
      />
    </main>
  );
}
