"use client";

import { useParams } from "next/navigation";
import { AssignmentEditor } from "@/components/authoring/assignments/assignment-editor";

export default function AssignmentEditorPage() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  return <AssignmentEditor assignmentId={assignmentId} />;
}
