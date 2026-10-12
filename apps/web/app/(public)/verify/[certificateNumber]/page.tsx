"use client";

import { Badge, Button, Card, EmptyState, Skeleton } from "@praxis/ui";
import { useQuery } from "@tanstack/react-query";
import { Award, BadgeCheck, ShieldX } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ErrorState } from "@/components/common/error-state";
import { Logo } from "@/components/common/logo";
import { api, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/format";

interface Verification {
  valid?: boolean;
  status?: string;
  certificate_number: string;
  recipient_name?: string;
  learner_name?: string;
  course_title?: string;
  organisation_name?: string;
  issued_at?: string;
  expires_at?: string | null;
  revoked_at?: string | null;
}

/** Public certificate verification page (/verify/[certificateNumber]). */
export default function VerifyCertificatePage() {
  const { certificateNumber } = useParams<{ certificateNumber: string }>();
  const q = useQuery({
    queryKey: ["verify", certificateNumber],
    queryFn: () => api.get<Verification>(`/verify/${encodeURIComponent(certificateNumber)}`, { redirectOn401: false, noOrg: true }),
    retry: false,
  });
  const v = q.data;
  const valid = v && (v.valid ?? (!v.revoked_at && v.status !== "revoked"));

  return (
    <div className="min-h-dvh bg-aurora">
      <header className="container flex h-16 items-center">
        <Logo />
      </header>
      <main id="main" className="container grid place-items-center py-10">
        <Card className="w-full max-w-xl overflow-hidden">
          {q.isLoading ? (
            <div className="space-y-4 p-8">
              <Skeleton className="size-14 rounded-2xl" />
              <Skeleton className="h-7 w-2/3" />
              <Skeleton className="h-4 w-full" />
            </div>
          ) : q.isError ? (
            q.error instanceof ApiError && q.error.status === 404 ? (
              <EmptyState illustration="search" title="Certificate not found" description={`We couldn't find certificate ${certificateNumber}. Check the number and try again.`} className="p-8" />
            ) : (
              <ErrorState error={q.error} onRetry={() => q.refetch()} className="p-8" />
            )
          ) : (
            <>
              <div className={valid ? "h-2 bg-gradient-to-r from-emerald-400 via-teal-400 to-sky-400" : "h-2 bg-gradient-to-r from-rose-500 to-orange-400"} aria-hidden />
              <div className="p-8">
                <span className={`grid size-14 place-items-center rounded-2xl text-white shadow-lg ${valid ? "bg-gradient-to-br from-emerald-400 to-teal-500" : "bg-gradient-to-br from-rose-500 to-orange-500"}`}>
                  {valid ? <BadgeCheck className="size-7" aria-hidden /> : <ShieldX className="size-7" aria-hidden />}
                </span>
                <h1 className="mt-5 font-display text-2xl font-bold text-slate-900">{valid ? "Valid certificate" : "Certificate not valid"}</h1>
                <dl className="mt-6 grid gap-4 sm:grid-cols-2">
                  {[
                    ["Recipient", v?.recipient_name ?? v?.learner_name],
                    ["Course", v?.course_title],
                    ["Issued by", v?.organisation_name],
                    ["Issued on", v?.issued_at ? formatDate(v.issued_at) : undefined],
                  ]
                    .filter(([, val]) => val)
                    .map(([k, val]) => (
                      <div key={k as string}>
                        <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">{k}</dt>
                        <dd className="mt-1 font-medium text-slate-900">{val}</dd>
                      </div>
                    ))}
                </dl>
                <p className="mt-6 flex items-center gap-2 text-sm text-slate-600">
                  <Award className="size-4 text-amber-500" aria-hidden />
                  <Badge tone="neutral" className="font-mono">
                    {certificateNumber}
                  </Badge>
                </p>
              </div>
            </>
          )}
          <div className="border-t border-slate-100 p-4 text-center">
            <Button asChild variant="link">
              <Link href="/">About Praxis</Link>
            </Button>
          </div>
        </Card>
      </main>
    </div>
  );
}
