"use client";

import { Skeleton } from "@praxis/ui";
import { useParams } from "next/navigation";
import { Suspense } from "react";
import { CourseBuilder } from "@/components/authoring/course/builder";

export default function CourseBuilderPage() {
  const { courseId } = useParams<{ courseId: string }>();
  return (
    <Suspense fallback={<Skeleton className="h-[600px] rounded-3xl" />}>
      <CourseBuilder courseId={courseId} />
    </Suspense>
  );
}
