"use client";

import { useParams } from "next/navigation";
import { BankDetail } from "@/components/authoring/questions/bank-detail";

export default function QuestionBankPage() {
  const { bankId } = useParams<{ bankId: string }>();
  return <BankDetail bankId={bankId} />;
}
