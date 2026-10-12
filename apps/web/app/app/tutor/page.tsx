"use client";

import { Skeleton } from "@praxis/ui";
import { Suspense } from "react";
import { TutorPage } from "@/components/tutor/tutor-page";

export default function AiTutorPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[70dvh] rounded-3xl" />}>
      <TutorPage />
    </Suspense>
  );
}
