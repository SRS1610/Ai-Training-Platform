"use client";

import { Button, EmptyState, Skeleton } from "@praxis/ui";
import Link from "next/link";
import * as React from "react";
import { useAuth } from "@/lib/auth";

/** Permission codes (apps/api/app/auth/rbac.py) needed for each authoring area. */
export const AUTHORING_PERMS = {
  courses: ["courses.create", "courses.edit"],
  aiBuilder: ["courses.create", "courses.edit"],
  assessments: ["assessments.manage"],
  assignments: ["assignments.manage"],
  knowledge: ["knowledge.manage"],
} as const;

/**
 * Route-level guard for the instructor authoring pages. The API is the real enforcement; this keeps
 * learners/assessors who deep-link here from seeing authoring tools that would only 403.
 */
export function AuthoringGate({
  anyOf,
  area,
  children,
}: {
  anyOf: readonly string[];
  /** Human name of the area for the no-access message, e.g. "the knowledge base". */
  area: string;
  children: React.ReactNode;
}) {
  const { me, isLoading, canAny } = useAuth();
  if (!me && isLoading) return <Skeleton className="h-96 rounded-3xl" />;
  if (canAny([...anyOf])) return <>{children}</>;
  return (
    <div className="rounded-3xl border border-slate-200 bg-white px-6 shadow-sm">
      <EmptyState
        size="lg"
        illustration="shield"
        title={`You don't have access to ${area}`}
        description="This area is for content authors. Ask an organisation admin to grant you an instructor or subject-matter-expert role if you need to manage it."
        action={
          <Button asChild variant="secondary">
            <Link href="/app/dashboard">Back to dashboard</Link>
          </Button>
        }
        secondaryAction={
          <Button asChild variant="ghost">
            <Link href="/app/catalog">Browse the catalog</Link>
          </Button>
        }
      />
    </div>
  );
}
