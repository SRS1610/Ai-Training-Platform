"use client";

import { useParams } from "next/navigation";
import { RubricPage } from "@/components/authoring/rubrics/rubric-page";
import { AUTHORING_PERMS, AuthoringGate } from "@/components/authoring/gate";

export default function RubricEditorPage() {
  const { rubricId } = useParams<{ rubricId: string }>();
  return (
    <AuthoringGate anyOf={AUTHORING_PERMS.assignments} area="rubrics">
      <RubricPage rubricId={rubricId} />
    </AuthoringGate>
  );
}
