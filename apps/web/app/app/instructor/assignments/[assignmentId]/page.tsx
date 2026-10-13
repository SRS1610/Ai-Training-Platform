"use client";

import { useParams } from "next/navigation";
import { AssignmentEditor } from "@/components/authoring/assignments/assignment-editor";
import { AUTHORING_PERMS, AuthoringGate } from "@/components/authoring/gate";

export default function AssignmentEditorPage() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  return (
    <AuthoringGate anyOf={AUTHORING_PERMS.assignments} area="assignment authoring">
      <AssignmentEditor assignmentId={assignmentId} />
    </AuthoringGate>
  );
}
