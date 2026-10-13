"use client";

import { RubricList } from "@/components/authoring/rubrics/rubric-list";
import { AUTHORING_PERMS, AuthoringGate } from "@/components/authoring/gate";

export default function RubricsPage() {
  return (
    <AuthoringGate anyOf={AUTHORING_PERMS.assignments} area="rubrics">
      <RubricList />
    </AuthoringGate>
  );
}
