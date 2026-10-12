"use client";

import { Skeleton } from "@praxis/ui";
import { Suspense } from "react";
import { AssignmentList } from "@/components/authoring/assignments/assignment-list";

export default function AssignmentsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-3xl" />}>
      <AssignmentList />
    </Suspense>
  );
}
