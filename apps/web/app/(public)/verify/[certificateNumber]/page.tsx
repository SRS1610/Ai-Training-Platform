import type { Metadata } from "next";
import { VerifyView } from "@/components/learn/verify-view";

export const metadata: Metadata = {
  title: "Certificate verification · Praxis",
  description: "Check that a Praxis certificate is authentic and currently valid.",
  robots: { index: false, follow: false },
};

/** Public certificate verification page (/verify/[certificateNumber]); no sign-in required. */
export default async function VerifyCertificatePage({ params }: { params: Promise<{ certificateNumber: string }> }) {
  const { certificateNumber } = await params;
  return <VerifyView certificateNumber={decodeURIComponent(certificateNumber)} />;
}
