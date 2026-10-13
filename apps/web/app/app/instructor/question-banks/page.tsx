"use client";

import { BanksList } from "@/components/authoring/questions/banks-list";
import { AUTHORING_PERMS, AuthoringGate } from "@/components/authoring/gate";

export default function QuestionBanksPage() {
  return (
    <AuthoringGate anyOf={AUTHORING_PERMS.assessments} area="question banks">
      <BanksList />
    </AuthoringGate>
  );
}
