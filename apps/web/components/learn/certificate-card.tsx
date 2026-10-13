"use client";

import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogTitle, QrCode, cn, toast } from "@praxis/ui";
import { BadgeCheck, CalendarClock, Check, Copy, Download, ExternalLink, Medal, QrCode as QrIcon, ShieldX, Star } from "lucide-react";
import * as React from "react";
import { api, errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { Certificate } from "./types";

export type CertStatus = "valid" | "revoked" | "expired" | "invalid";

export function certStatus(c: { status: string; revoked_at?: string | null; expires_at?: string | null }): CertStatus {
  if (c.status === "revoked" || c.revoked_at) return "revoked";
  if (c.status === "invalid") return "invalid";
  if (c.status === "expired" || (c.expires_at && new Date(c.expires_at).getTime() < Date.now())) return "expired";
  return "valid";
}

export const CERT_STATUS_META: Record<CertStatus, { label: string; tone: "success" | "danger" | "warning"; bar: string }> = {
  valid: { label: "Valid", tone: "success", bar: "from-amber-400 via-orange-500 to-rose-500" },
  revoked: { label: "Revoked", tone: "danger", bar: "from-rose-500 to-rose-600" },
  expired: { label: "Expired", tone: "warning", bar: "from-slate-400 to-slate-500" },
  invalid: { label: "Invalid", tone: "danger", bar: "from-rose-500 to-rose-600" },
};

/** Public verification URL (prefers the API's absolute URL, falls back to this origin). */
export function verifyUrl(c: Pick<Certificate, "verification_url" | "certificate_number">): string {
  if (c.verification_url) return c.verification_url;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/verify/${encodeURIComponent(c.certificate_number)}`;
}

export function useCopy() {
  const [copied, setCopied] = React.useState(false);
  const copy = React.useCallback(async (text: string, message = "Link copied") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(message);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Couldn't copy automatically — select the link and copy it manually.");
    }
  }, []);
  return { copied, copy };
}

/** Seal with a rosette edge; decorative. */
export function Seal({ className, status = "valid" }: { className?: string; status?: CertStatus }) {
  const ok = status === "valid";
  return (
    <span className={cn("relative grid place-items-center", className)} aria-hidden>
      <span
        className={cn(
          "absolute inset-0 rounded-full bg-gradient-to-br [mask-image:radial-gradient(circle,black_62%,transparent_63%)] motion-safe:animate-[spin_40s_linear_infinite]",
          ok ? "from-amber-300 via-orange-400 to-rose-400" : "from-slate-300 to-slate-400",
        )}
        style={{ clipPath: "polygon(50% 0,61% 9%,75% 6%,80% 20%,94% 25%,91% 39%,100% 50%,91% 61%,94% 75%,80% 80%,75% 94%,61% 91%,50% 100%,39% 91%,25% 94%,20% 80%,6% 75%,9% 61%,0 50%,9% 39%,6% 25%,20% 20%,25% 6%,39% 9%)" }}
      />
      <span className={cn("relative grid size-[72%] place-items-center rounded-full text-white shadow-inner ring-2 ring-white/70", ok ? "bg-gradient-to-br from-amber-500 to-orange-600" : "bg-gradient-to-br from-slate-500 to-slate-600")}>
        {ok ? <Medal className="size-1/2" /> : <ShieldX className="size-1/2" />}
      </span>
    </span>
  );
}

export function CertificateCard({ cert }: { cert: Certificate }) {
  const status = certStatus(cert);
  const meta = CERT_STATUS_META[status];
  const url = verifyUrl(cert);
  const { copied, copy } = useCopy();
  const [busy, setBusy] = React.useState(false);
  const [qrOpen, setQrOpen] = React.useState(false);
  const skills = (cert.skills ?? []) as { id?: string; name?: string }[];

  const download = async () => {
    setBusy(true);
    try {
      await api.download(`/certificates/${cert.id}/pdf`, { filename: `${cert.certificate_number}.pdf` });
      toast.success("Certificate downloaded");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={cn("group relative overflow-hidden rounded-3xl bg-gradient-to-br p-px shadow-soft transition duration-300 hover:-translate-y-0.5 hover:shadow-lift", meta.bar)}>
      <div className="relative h-full overflow-hidden rounded-[calc(1.5rem-1px)] bg-white">
        {/* parchment wash + guilloche-ish rings */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-amber-50/80 via-white to-rose-50/40" aria-hidden />
        <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full border-[18px] border-amber-100/60" aria-hidden />
        <div className="pointer-events-none absolute -right-14 -top-14 size-52 rounded-full border border-dashed border-amber-200/80" aria-hidden />

        <div className="relative flex flex-col gap-6 p-6 sm:p-7 md:flex-row">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <Seal className="size-14 shrink-0" status={status} />
              <div className="min-w-0">
                <p className="text-2xs font-bold uppercase tracking-[0.18em] text-amber-700">Certificate of completion</p>
                <p className="truncate text-xs font-medium text-slate-500">{cert.organisation_name}</p>
              </div>
              <Badge tone={meta.tone} size="sm" className="ml-auto self-start" dot>
                {meta.label}
              </Badge>
            </div>

            <h3 className="mt-5 font-display text-xl font-bold leading-snug tracking-tight text-slate-900 sm:text-2xl">{cert.course_title}</h3>
            <p className="mt-1 text-sm text-slate-600">
              Awarded to <span className="font-semibold text-slate-900">{cert.learner_name}</span>
              {cert.instructor_name ? <> · Instructor {cert.instructor_name}</> : null}
            </p>

            <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-2xl bg-white/80 p-3 ring-1 ring-slate-200/80">
                <dt className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-slate-500">
                  <CalendarClock className="size-3.5 text-sky-600" aria-hidden /> Issued
                </dt>
                <dd className="mt-1 text-sm font-semibold text-slate-900">{formatDate(cert.issued_at)}</dd>
              </div>
              <div className="rounded-2xl bg-white/80 p-3 ring-1 ring-slate-200/80">
                <dt className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-slate-500">
                  <Star className="size-3.5 text-amber-500" aria-hidden /> Score
                </dt>
                <dd className="mt-1 text-sm font-semibold tabular-nums text-slate-900">{cert.score === null ? "Completion" : `${Math.round(cert.score)}%`}</dd>
              </div>
              <div className="col-span-2 rounded-2xl bg-white/80 p-3 ring-1 ring-slate-200/80 sm:col-span-1">
                <dt className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-slate-500">
                  {status === "revoked" ? <ShieldX className="size-3.5 text-rose-600" aria-hidden /> : <BadgeCheck className={cn("size-3.5", status === "expired" ? "text-slate-400" : "text-emerald-600")} aria-hidden />}{" "}
                  {status === "revoked" ? "Revoked" : status === "expired" ? "Expired" : "Expires"}
                </dt>
                <dd className="mt-1 text-sm font-semibold text-slate-900">
                  {status === "revoked" ? formatDate(cert.revoked_at) : cert.expires_at ? formatDate(cert.expires_at) : "Never"}
                </dd>
              </div>
            </dl>

            {status === "revoked" && cert.revoke_reason && (
              <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-200">Reason: {cert.revoke_reason}</p>
            )}

            {skills.length > 0 && (
              <ul className="mt-4 flex flex-wrap gap-1.5" aria-label={status === "valid" ? "Verified skills" : "Skills (no longer verified)"}>
                {skills.map((s, i) => (
                  <li
                    key={s.id ?? i}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset",
                      status === "valid" ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-slate-50 text-slate-600 ring-slate-200",
                    )}
                  >
                    {status === "valid" && <Check className="size-3" aria-hidden />} {s.name}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex shrink-0 flex-row items-center gap-4 md:flex-col md:items-center md:justify-between">
            <button
              type="button"
              onClick={() => setQrOpen(true)}
              className="rounded-2xl bg-white p-2 shadow-soft ring-1 ring-slate-200 transition hover:shadow-lift focus-visible:focus-ring"
              aria-label={`Show QR code for certificate ${cert.certificate_number}`}
            >
              <QrCode value={url} size={104} title={`QR code linking to the verification page for ${cert.certificate_number}`} />
            </button>
            <p className="font-mono text-2xs font-semibold tracking-wide text-slate-500">{cert.certificate_number}</p>
          </div>
        </div>

        <div className="relative flex flex-wrap items-center gap-2 border-t border-amber-100 bg-white/70 px-6 py-3.5 backdrop-blur sm:px-7">
          <Button size="sm" variant="primary" leftIcon={<Download />} loading={busy} onClick={download} disabled={status === "revoked"}>
            Download PDF
          </Button>
          <Button size="sm" variant="secondary" leftIcon={copied ? <Check /> : <Copy />} onClick={() => copy(url, "Verification link copied")}>
            {copied ? "Copied" : "Copy verify link"}
          </Button>
          <Button asChild size="sm" variant="ghost" rightIcon={<ExternalLink />} className="ml-auto">
            <a href={`/verify/${encodeURIComponent(cert.certificate_number)}`} target="_blank" rel="noopener noreferrer">
              Public page
            </a>
          </Button>
        </div>
      </div>

      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent size="sm" className="text-center">
          <DialogTitle className="flex items-center justify-center gap-2">
            <QrIcon className="size-5 text-brand-600" aria-hidden /> Scan to verify
          </DialogTitle>
          <DialogDescription>Anyone can scan this code to confirm the certificate is authentic.</DialogDescription>
          <div className="mx-auto mt-2 rounded-3xl bg-white p-3 shadow-soft ring-1 ring-slate-200">
            <QrCode value={url} size={232} margin={3} title={`QR code for ${cert.certificate_number}`} />
          </div>
          <p className="mt-3 break-all font-mono text-xs text-slate-500">{url}</p>
          <Button className="mx-auto mt-2" variant="secondary" leftIcon={copied ? <Check /> : <Copy />} onClick={() => copy(url, "Verification link copied")}>
            Copy link
          </Button>
        </DialogContent>
      </Dialog>
    </article>
  );
}
