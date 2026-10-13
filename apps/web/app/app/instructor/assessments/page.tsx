"use client";

import { AssessmentList } from "@/components/authoring/assessments/assessment-list";
import { AUTHORING_PERMS, AuthoringGate } from "@/components/authoring/gate";

export default function AssessmentsPage() {
  return (
    <AuthoringGate anyOf={AUTHORING_PERMS.assessments} area="assessment authoring">
      <AssessmentList />
    </AuthoringGate>
  );
}
