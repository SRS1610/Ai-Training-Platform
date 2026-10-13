"use client";

import { Skeleton } from "@praxis/ui";
import { useParams } from "next/navigation";
import { Suspense } from "react";
import { BankDetail } from "@/components/authoring/questions/bank-detail";
import { AUTHORING_PERMS, AuthoringGate } from "@/components/authoring/gate";

export default function QuestionBankPage() {
  const { bankId } = useParams<{ bankId: string }>();
  return (
    <AuthoringGate anyOf={AUTHORING_PERMS.assessments} area="question banks">
      <Suspense fallback={<Skeleton className="h-96 rounded-3xl" />}>
        <BankDetail bankId={bankId} />
      </Suspense>
    </AuthoringGate>
  );
}
