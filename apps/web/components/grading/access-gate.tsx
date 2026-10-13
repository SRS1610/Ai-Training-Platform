"use client";

import { Button, EmptyState, Skeleton } from "@praxis/ui";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { useAuth } from "@/lib/auth";

/**
 * Page-level permission gate for the instructor areas (grading, simulation builder, analytics). Shows one
 * consistent access-denied state instead of a page full of controls that would 403.
 */
export function AccessGate({ anyOf, area, children }: { anyOf: string[]; area: string; children: React.ReactNode }) {
  const { canAny, isLoading, user } = useAuth();
  if (isLoading && !user) return <Skeleton className="h-96 rounded-3xl" aria-busy aria-label="Checking access" />;
  if (canAny(anyOf)) return <>{children}</>;
  return (
    <EmptyState
      bordered
      size="lg"
      illustration="shield"
      title={`You don't have access to ${area}`}
      description="Your role in this organisation doesn't include this area. Ask an organisation admin if you need access."
      action={
        <Button variant="secondary" asChild leftIcon={<ArrowLeft />}>
          <Link href="/app/dashboard">Back to dashboard</Link>
        </Button>
      }
    />
  );
}
