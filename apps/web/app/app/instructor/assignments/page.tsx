"use client";

import { Skeleton } from "@praxis/ui";
import { Suspense } from "react";
import { AssignmentList } from "@/components/authoring/assignments/assignment-list";
import { AUTHORING_PERMS, AuthoringGate } from "@/components/authoring/gate";

export default function AssignmentsPage() {
  return (
    <AuthoringGate anyOf={AUTHORING_PERMS.assignments} area="assignment authoring">
      <Suspense fallback={<Skeleton className="h-96 rounded-3xl" />}>
        <AssignmentList />
      </Suspense>
    </AuthoringGate>
  );
}
