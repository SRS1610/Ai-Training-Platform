"use client";

import { Button, EmptyState, KpiTile, PageHeader, Progress, Skeleton, cn, colorFor } from "@praxis/ui";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Award, BadgeCheck, Library, ShieldCheck, Sparkles, Star, Target, Trophy } from "lucide-react";
import Link from "next/link";
import { ErrorState } from "@/components/common/error-state";
import { CertificateCard, certStatus } from "@/components/learn/certificate-card";
import { lk } from "@/components/learn/query-keys";
import type { Certificate, MyEnrolment } from "@/components/learn/types";
import { CourseCover, SectionTitle } from "@/components/learn/visuals";
import { api } from "@/lib/api";

function UpNext({ items }: { items: MyEnrolment[] }) {
  if (!items.length) return null;
  return (
    <section aria-labelledby="up-next" className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-soft sm:p-6">
      <SectionTitle id="up-next" icon={Target} color="violet" title="Certificates within reach" description="Finish these courses to earn your next credential" />
      <ul className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
        {items.map((e) => (
          <li key={e.id}>
            <Link
              href={`/app/learn/${e.course_id}`}
              className="group flex items-center gap-4 rounded-2xl border border-slate-200 p-3 transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lift focus-visible:focus-ring"
            >
              <CourseCover category={e.category} thumbnailUrl={e.thumbnail_url} iconSize="sm" className="size-16 shrink-0 rounded-xl" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-slate-900">{e.title}</span>
                <span className="mt-1.5 flex items-center gap-2">
                  <Progress value={e.progress_pct} color={colorFor(e.category)} size="sm" className="flex-1" aria-label={`${e.title} progress`} />
                  <span className="text-xs font-semibold tabular-nums text-slate-700">{Math.round(e.progress_pct)}%</span>
                </span>
                <span className="mt-1 block text-xs text-slate-500">{e.progress_pct >= 75 ? "Almost there — keep going" : "Continue to unlock your certificate"}</span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-brand-600" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function CertificatesPage() {
  const q = useQuery({ queryKey: lk.certificates.me, queryFn: ({ signal }) => api.get<Certificate[]>("/certificates/me", { signal }) });
  const enrolments = useQuery({ queryKey: lk.enrolments.me, queryFn: ({ signal }) => api.get<MyEnrolment[]>("/enrolments/me", { signal }) });

  const certs = [...(q.data ?? [])].sort((a, b) => b.issued_at.localeCompare(a.issued_at));
  const valid = certs.filter((c) => certStatus(c) === "valid");
  const scored = certs.filter((c) => c.score !== null);
  const avg = scored.length ? Math.round(scored.reduce((a, c) => a + (c.score ?? 0), 0) / scored.length) : null;
  const skillCount = new Set(valid.flatMap((c) => ((c.skills ?? []) as { name?: string }[]).map((s) => s.name))).size;
  const certified = new Set(certs.map((c) => c.course_id));
  const upNext = (enrolments.data ?? [])
    .filter((e) => e.status !== "completed" && !certified.has(e.course_id))
    .sort((a, b) => b.progress_pct - a.progress_pct)
    .slice(0, 4);

  return (
    <>
      <PageHeader
        title="Certificates"
        description="Verifiable credentials for the courses you've completed — download, share or let anyone scan to verify."
        icon={<Award />}
        actions={
          <Button asChild variant="secondary" leftIcon={<Trophy />}>
            <Link href="/app/achievements">Achievements</Link>
          </Button>
        }
      />

      <section aria-label="Summary" className="stagger mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiTile label="Certificates" value={q.isLoading ? "—" : certs.length} icon={<Award />} color="amber" hint="Earned in total" />
        <KpiTile label="Valid now" value={q.isLoading ? "—" : valid.length} icon={<ShieldCheck />} color="emerald" hint="Publicly verifiable" />
        <KpiTile label="Average score" value={q.isLoading ? "—" : avg === null ? "—" : `${avg}%`} icon={<Star />} color="violet" hint={avg === null && !q.isLoading ? "No scored courses yet" : "Across certified courses"} />
        <KpiTile label="Verified skills" value={q.isLoading ? "—" : skillCount} icon={<BadgeCheck />} color="sky" hint="Backed by a credential" />
      </section>

      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2" aria-busy aria-label="Loading certificates">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-80 rounded-3xl" />
          ))}
        </div>
      ) : certs.length === 0 ? (
        <EmptyState
          bordered
          size="lg"
          illustration="trophy"
          title="Your first certificate is waiting"
          description="Complete every required lesson in a course (and pass its graded work) to earn a verifiable certificate with a QR code."
          action={
            <Button asChild variant="gradient" leftIcon={<Library />}>
              <Link href={upNext.length ? "/app/learning" : "/app/catalog"}>{upNext.length ? "Continue learning" : "Explore courses"}</Link>
            </Button>
          }
        />
      ) : (
        <ul className={cn("stagger grid gap-6", certs.length > 1 && "min-[1680px]:grid-cols-2")}>
          {certs.map((c) => (
            <li key={c.id}>
              <CertificateCard cert={c} />
            </li>
          ))}
        </ul>
      )}

      {!q.isLoading && !q.isError && (
        <div className="mt-6 space-y-6">
          <UpNext items={upNext} />
          <p className="flex items-center justify-center gap-2 text-center text-xs text-slate-500">
            <Sparkles className="size-3.5 shrink-0 text-amber-500" aria-hidden />
            Every certificate has a unique number and a public verification page — tamper-evident and revocable by your organisation.
          </p>
        </div>
      )}
    </>
  );
}
