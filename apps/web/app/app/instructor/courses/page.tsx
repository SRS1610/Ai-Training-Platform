"use client";

import { Skeleton } from "@praxis/ui";
import { Suspense } from "react";
import { CourseList } from "@/components/authoring/course/course-list";

export default function InstructorCoursesPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-3xl" />}>
      <CourseList />
    </Suspense>
  );
}
