"use client";

import { Button, Input, QrCode, Skeleton, cn } from "@praxis/ui";
import { useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, BadgeCheck, Building2, CalendarCheck2, CalendarX2, Check, Copy, GraduationCap, Hash, Search, ShieldAlert, ShieldCheck, ShieldX, Star, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { ErrorState } from "@/components/common/error-state";
import { Logo } from "@/components/common/logo";
import { ApiError, api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { type CertStatus, Seal, certStatus, useCopy } from "./certificate-card";
import { lk } from "./query-keys";
import type { Verification } from "./types";

const STATUS: Record<CertStatus, { title: string; body: string; icon: typeof ShieldCheck; band: string; chip: string; ring: string }> = {
  valid: {
    title: "Verified certificate",
    body: "This certificate is authentic and currently valid.",
    icon: ShieldCheck,
    band: "from-emerald-700 via-teal-700 to-sky-700",
    chip: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    ring: "from-amber-300 via-orange-400 to-rose-400",
  },
  expired: {
    title: "Certificate expired",
    body: "This certificate was genuinely issued but has passed its expiry date.",
    icon: AlertTriangle,
    band: "from-amber-700 via-orange-700 to-amber-800",
    chip: "bg-amber-50 text-amber-900 ring-amber-200",
    ring: "from-slate-300 to-slate-400",
  },
  revoked: {
    title: "Certificate revoked",
    body: "The issuing organisation has revoked this certificate. It is no longer valid.",
    icon: ShieldX,
    band: "from-rose-600 via-rose-700 to-pink-700",
    chip: "bg-rose-50 text-rose-800 ring-rose-200",
    ring: "from-slate-300 to-slate-400",
  },
  invalid: {
    title: "Certificate could not be verified",
    body: "The record failed its integrity check. Contact the issuing organisation.",
    icon: ShieldAlert,
    band: "from-rose-600 via-rose-700 to-pink-700",
    chip: "bg-rose-50 text-rose-800 ring-rose-200",
    ring: "from-slate-300 to-slate-400",
  },
};

function Lookup({ initial = "", stacked = false }: { initial?: string; stacked?: boolean }) {
  const router = useRouter();
  const [value, setValue] = React.useState(initial);
  return (
    <form
      role="search"
      aria-label="Verify another certificate"
      className={cn("flex w-full flex-col gap-2", !stacked && "sm:flex-row")}
      onSubmit={(e) => {
        e.preventDefault();
        const n = value.trim();
        if (n) router.push(`/verify/${encodeURIComponent(n)}`);
      }}
    >
      <div className="flex-1">
        <Input value={value} onChange={(e) => setValue(e.target.value)} leftIcon={<Hash />} placeholder="e.g. CERT-2026-000111" aria-label="Certificate number" className="font-mono" />
      </div>
      <Button type="submit" variant="secondary" leftIcon={<Search />}>
        Verify
      </Button>
    </form>
  );
}

function Field({ icon: Icon, label, children, color }: { icon: typeof Hash; label: string; children: React.ReactNode; color: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-white/80 p-3.5 ring-1 ring-slate-200/80">
      <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", color)}>
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <dt className="text-2xs font-semibold uppercase tracking-wider text-slate-500">{label}</dt>
        <dd className="mt-0.5 break-words text-sm font-semibold text-slate-900">{children}</dd>
      </div>
    </div>
  );
}

export function VerifyView({ certificateNumber }: { certificateNumber: string }) {
  const reduce = useReducedMotion();
  const q = useQuery({
    queryKey: lk.verify(certificateNumber),
    queryFn: ({ signal }) => api.get<Verification>(`/verify/${encodeURIComponent(certificateNumber)}`, { signal, redirectOn401: false, noOrg: true }),
    retry: (n, err) => !(err instanceof ApiError && err.status < 500) && n < 2,
  });
  const [here, setHere] = React.useState("");
  React.useEffect(() => setHere(window.location.href.split("#")[0]!.split("?")[0]!), []);
  const { copied, copy } = useCopy();
  const v = q.data;
  const status = v ? certStatus(v) : "valid";
  const s = STATUS[status];
  const notFound = q.error instanceof ApiError && q.error.status === 404;

  return (
    <div className="relative min-h-dvh overflow-hidden bg-[#f7f8fc]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[28rem] bg-aurora opacity-80" aria-hidden />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[28rem] bg-grid-faint opacity-40 [background-size:36px_36px] [mask-image:linear-gradient(to_bottom,black,transparent)]" aria-hidden />
      <header className="relative mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
        <Logo />
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-slate-700 shadow-soft ring-1 ring-slate-200">
          <ShieldCheck className="size-3.5 text-emerald-600" aria-hidden /> Credential verification
        </span>
      </header>

      <main id="main" className="relative mx-auto max-w-5xl px-4 pb-16 pt-6 sm:px-6 sm:pt-10">
        {q.isLoading ? (
          <div className="space-y-4 rounded-3xl bg-white p-8 shadow-soft" aria-busy aria-label="Verifying certificate">
            <Skeleton className="h-16 w-full rounded-2xl" />
            <Skeleton className="mx-auto h-24 w-24 rounded-full" />
            <Skeleton className="mx-auto h-8 w-2/3" />
            <Skeleton className="mx-auto h-5 w-1/2" />
            <div className="grid gap-3 sm:grid-cols-3">
              <Skeleton className="h-16 rounded-2xl" />
              <Skeleton className="h-16 rounded-2xl" />
              <Skeleton className="h-16 rounded-2xl" />
            </div>
          </div>
        ) : q.isError ? (
          notFound ? (
            <section className="mx-auto max-w-xl rounded-3xl bg-white p-8 text-center shadow-lift ring-1 ring-slate-200/70" aria-labelledby="nf-title">
              <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-gradient-to-br from-slate-200 to-slate-100 text-slate-500">
                <Search className="size-7" aria-hidden />
              </span>
              <h1 id="nf-title" className="mt-5 font-display text-2xl font-bold text-slate-900">
                No certificate found
              </h1>
              <p className="mt-2 text-slate-600">
                We couldn&apos;t find a certificate numbered <span className="font-mono font-semibold text-slate-900">{certificateNumber}</span>. Check the
                number on the certificate and try again.
              </p>
              <div className="mt-6">
                <Lookup initial={certificateNumber} />
              </div>
            </section>
          ) : (
            <ErrorState error={q.error} onRetry={() => q.refetch()} size="lg" className="rounded-3xl bg-white shadow-soft" />
          )
        ) : v ? (
          <motion.article
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden rounded-[2rem] bg-white shadow-lift ring-1 ring-slate-200/70"
            aria-labelledby="cert-title"
          >
            <div className={cn("flex flex-col gap-3 bg-gradient-to-r px-5 py-4 text-white sm:flex-row sm:items-center sm:px-8", s.band)} role="status">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/20 ring-1 ring-white/30">
                <s.icon className="size-5" aria-hidden />
              </span>
              <div className="flex-1">
                <p className="font-display text-lg font-bold leading-tight">{s.title}</p>
                <p className="text-sm text-white/90">{s.body}</p>
              </div>
              <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-white px-3 py-1 font-mono text-xs font-bold text-slate-800 sm:self-center">
                <Hash className="size-3.5" aria-hidden />
                {v.certificate_number}
              </span>
            </div>

            <div className="relative grid gap-8 overflow-hidden p-6 sm:p-10 lg:grid-cols-[1fr_16rem]">
              <div className="pointer-events-none absolute -left-24 -top-28 size-80 rounded-full border-[24px] border-amber-50/80" aria-hidden />
              <div className="pointer-events-none absolute -bottom-32 right-1/3 size-80 rounded-full border border-dashed border-amber-100" aria-hidden />
              <div className="relative">
                
                <div className="relative text-center lg:text-left">
                  <div className="flex justify-center lg:justify-start">
                    <Seal className="size-20" status={status === "valid" ? "valid" : "revoked"} />
                  </div>
                  <p className="mt-5 text-xs font-bold uppercase tracking-[0.22em] text-amber-700">Certificate of completion</p>
                  <p className="mt-4 text-sm text-slate-500">This certifies that</p>
                  <h1 id="cert-title" className="mt-1 font-display text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
                    {v.learner_name}
                  </h1>
                  <p className="mt-3 text-sm text-slate-500">has successfully completed</p>
                  <p className="mt-1 text-balance font-display text-xl font-bold text-gradient sm:text-2xl">{v.course_title}</p>
                  <p className="mt-2 text-sm text-slate-600">
                    issued by <span className="font-semibold text-slate-900">{v.organisation_name}</span>
                  </p>
                </div>

                <dl className="relative mt-8 grid gap-3 sm:grid-cols-2">
                  <Field icon={CalendarCheck2} label="Issued" color="bg-sky-50 text-sky-600">
                    {formatDate(v.issued_at, { day: "numeric", month: "long", year: "numeric" })}
                  </Field>
                  <Field icon={status === "revoked" ? CalendarX2 : CalendarCheck2} label={status === "revoked" ? "Revoked" : "Valid until"} color={status === "valid" ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"}>
                    {status === "revoked"
                      ? formatDate(v.revoked_at, { day: "numeric", month: "long", year: "numeric" })
                      : v.expires_at
                        ? formatDate(v.expires_at, { day: "numeric", month: "long", year: "numeric" })
                        : "No expiry"}
                  </Field>
                  {v.score !== null && (
                    <Field icon={Star} label="Final score" color="bg-amber-50 text-amber-600">
                      <span className="tabular-nums">{Math.round(v.score)}%</span>
                    </Field>
                  )}
                  <Field icon={Building2} label="Organisation" color="bg-violet-50 text-violet-600">
                    {v.organisation_name}
                  </Field>
                  {v.instructor_name && (
                    <Field icon={UserRound} label="Instructor" color="bg-fuchsia-50 text-fuchsia-600">
                      {v.instructor_name}
                    </Field>
                  )}
                  <Field icon={GraduationCap} label="Recipient" color="bg-indigo-50 text-indigo-600">
                    {v.learner_name}
                  </Field>
                </dl>

                {v.skills.length > 0 && (
                  <div className="relative mt-6">
                    <p className="text-2xs font-semibold uppercase tracking-wider text-slate-500">Skills demonstrated</p>
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {v.skills.map((sk) => (
                        <li key={sk} className={cn("inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset", s.chip)}>
                          <BadgeCheck className="size-3.5" aria-hidden /> {sk}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <aside className="flex flex-col items-center gap-4 rounded-3xl bg-gradient-to-b from-slate-50 to-white p-5 text-center ring-1 ring-slate-200/80" aria-label="Share this verification">
                <div className="rounded-2xl bg-white p-2.5 shadow-soft ring-1 ring-slate-200">
                  {here ? <QrCode value={here} size={176} margin={2} title="QR code linking to this verification page" /> : <Skeleton className="size-44" />}
                </div>
                <p className="text-xs text-slate-600">Scan to open this verification page on another device.</p>
                <Button variant="secondary" size="sm" className="w-full" leftIcon={copied ? <Check /> : <Copy />} onClick={() => copy(here, "Verification link copied")}>
                  {copied ? "Copied" : "Copy link"}
                </Button>
                <div className="w-full border-t border-slate-200 pt-4 text-left">
                  <p className="text-2xs font-semibold uppercase tracking-wider text-slate-500">Verify another</p>
                  <div className="mt-2">
                    <Lookup stacked />
                  </div>
                </div>
              </aside>
            </div>

            <footer className="flex flex-col items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-4 text-xs text-slate-500 sm:flex-row sm:px-10">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="size-3.5 text-emerald-600" aria-hidden /> Checked live against the issuer&apos;s records · {formatDate(new Date())}
              </span>
              <Link href="/" className="font-semibold text-brand-700 hover:underline focus-visible:focus-ring">
                Issued with Praxis
              </Link>
            </footer>
          </motion.article>
        ) : null}
      </main>
    </div>
  );
}
