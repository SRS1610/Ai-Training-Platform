"use client";

import { Skeleton } from "@praxis/ui";
import { Suspense } from "react";
import { CourseList } from "@/components/authoring/course/course-list";
import { AUTHORING_PERMS, AuthoringGate } from "@/components/authoring/gate";

export default function InstructorCoursesPage() {
  return (
    <AuthoringGate anyOf={AUTHORING_PERMS.courses} area="course authoring">
      <Suspense fallback={<Skeleton className="h-96 rounded-3xl" />}>
        <CourseList />
      </Suspense>
    </AuthoringGate>
  );
}
