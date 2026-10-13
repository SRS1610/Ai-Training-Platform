import { cn } from "@praxis/ui";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import type * as React from "react";
import { Logo } from "@/components/common/logo";

export interface LegalSection {
  id: string;
  title: string;
  body: React.ReactNode;
}

/** Public legal document (Terms, Privacy): gradient hero, sticky contents on desktop, readable prose. */
export function LegalPage({
  icon: Icon,
  eyebrow,
  title,
  intro,
  version,
  sections,
  related,
}: {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  intro: React.ReactNode;
  /** Policy version recorded with each consent (privacy module `policy_version`). */
  version: string;
  sections: LegalSection[];
  related: { href: string; label: string };
}) {
  return (
    <div className="min-h-dvh bg-aurora">
      <header className="container flex h-16 items-center justify-between">
        <Logo />
        <nav aria-label="Legal" className="flex items-center gap-4 text-sm font-medium text-slate-600">
          <Link href={related.href} className="hover:text-slate-900 focus-visible:focus-ring">
            {related.label}
          </Link>
          <Link href="/login" className="hover:text-slate-900 focus-visible:focus-ring">
            Sign in
          </Link>
        </nav>
      </header>
      <main id="main" className="container pb-20">
        <div className="relative overflow-hidden rounded-3xl bg-brand-gradient p-6 text-white shadow-glow sm:p-10">
          <div className="pointer-events-none absolute -right-12 -top-12 size-56 rounded-full bg-white/20 blur-3xl" aria-hidden />
          <span className="grid size-12 place-items-center rounded-2xl bg-white/20 ring-1 ring-white/30">
            <Icon className="size-6" aria-hidden />
          </span>
          <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-white/80">{eyebrow}</p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
          <div className="mt-2 max-w-2xl text-sm text-white/90 sm:text-base">{intro}</div>
          <p className="mt-4 inline-flex rounded-full bg-white/20 px-3 py-1 text-xs font-semibold ring-1 ring-white/30">Version {version}</p>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[240px_minmax(0,1fr)]">
          <nav aria-label="On this page" className="hidden lg:block">
            <div className="sticky top-6 rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-soft backdrop-blur">
              <p className="mb-2 text-2xs font-semibold uppercase tracking-[0.12em] text-slate-500">On this page</p>
              <ol className="space-y-1 text-sm">
                {sections.map((s, i) => (
                  <li key={s.id}>
                    <a href={`#${s.id}`} className="flex gap-2 rounded-lg px-2 py-1 text-slate-600 hover:bg-slate-50 hover:text-slate-900 focus-visible:focus-ring">
                      <span className="tabular-nums text-slate-400">{i + 1}.</span>
                      {s.title}
                    </a>
                  </li>
                ))}
              </ol>
            </div>
          </nav>
          <article className="space-y-4">
            {sections.map((s, i) => (
              <section
                key={s.id}
                id={s.id}
                aria-labelledby={`${s.id}-title`}
                className={cn("scroll-mt-6 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-soft sm:p-6")}
              >
                <h2 id={`${s.id}-title`} className="flex items-baseline gap-2 font-display text-lg font-semibold text-slate-900">
                  <span className="text-sm tabular-nums text-brand-600">{i + 1}.</span>
                  {s.title}
                </h2>
                <div className="mt-2 space-y-2 text-sm leading-relaxed text-slate-700 [&_a]:font-medium [&_a]:text-brand-700 [&_a]:underline-offset-2 hover:[&_a]:underline [&_li]:ml-4 [&_li]:list-disc">
                  {s.body}
                </div>
              </section>
            ))}
          </article>
        </div>
      </main>
    </div>
  );
}
