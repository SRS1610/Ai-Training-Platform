"use client";

import { useParams } from "next/navigation";
import { RubricPage } from "@/components/authoring/rubrics/rubric-page";

export default function RubricEditorPage() {
  const { rubricId } = useParams<{ rubricId: string }>();
  return <RubricPage rubricId={rubricId} />;
}
