import { colorClasses, type CategoryColor } from "@praxis/ui";
import { Award, Bot, MonitorPlay, Quote } from "lucide-react";
import { Logo } from "@/components/common/logo";

const HIGHLIGHTS: { icon: typeof Bot; color: CategoryColor; title: string; body: string }[] = [
  { icon: Bot, color: "fuchsia", title: "AI tutor", body: "Grounded answers, hints during graded work" },
  { icon: MonitorPlay, color: "sky", title: "Simulations", body: "Practise real scenarios with live scoring" },
  { icon: Award, color: "amber", title: "Certificates", body: "Verifiable credentials with QR codes" },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="relative flex flex-col bg-white">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-aurora opacity-60 lg:hidden" aria-hidden />
        <header className="relative flex items-center justify-between px-6 py-5 sm:px-10">
          <Logo />
        </header>
        <main id="main" className="relative flex flex-1 items-center justify-center px-6 pb-12 pt-4 sm:px-10">
          <div className="w-full max-w-[420px] motion-safe:animate-fade-up">{children}</div>
        </main>
        <footer className="relative px-6 pb-6 text-center text-xs text-slate-500 sm:px-10 lg:text-left">
          Protected by MFA, SSO and row-level tenant isolation.
        </footer>
      </div>

      <aside className="relative hidden overflow-hidden bg-brand-gradient lg:block" aria-hidden>
        <div className="absolute inset-0 bg-grid-faint opacity-40 [background-size:40px_40px]" />
        <div className="absolute -right-24 -top-24 size-96 rounded-full bg-fuchsia-400/30 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 size-96 rounded-full bg-sky-400/30 blur-3xl" />
        <div className="relative flex h-full flex-col justify-between p-12 xl:p-16">
          <div>
            <p className="inline-flex rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white ring-1 ring-white/25">
              Learn → Practise → Simulate → Perform → Assess → Improve
            </p>
            <h2 className="mt-6 max-w-md font-display text-4xl font-bold leading-tight tracking-tight text-white">
              Build skills you can prove.
            </h2>
            <ul className="mt-10 space-y-4">
              {HIGHLIGHTS.map((h) => {
                const c = colorClasses(h.color);
                const Icon = h.icon;
                return (
                  <li key={h.title} className="flex max-w-sm items-center gap-4 rounded-2xl bg-white/10 p-4 ring-1 ring-white/20 backdrop-blur">
                    <span className={`grid size-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow-lg ${c.gradient}`}>
                      <Icon className="size-5" />
                    </span>
                    <span>
                      <span className="block font-semibold text-white">{h.title}</span>
                      <span className="block text-sm text-indigo-100">{h.body}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
          <figure className="max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <Quote className="size-6 text-violet-500" />
            <blockquote className="mt-3 text-slate-700">
              “Our service desk went from guessing to knowing. Simulation bands show exactly who is ready for tier 2.”
            </blockquote>
            <figcaption className="mt-4 flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 text-sm font-bold text-white">
                SL
              </span>
              <span className="text-sm">
                <span className="block font-semibold text-slate-900">Service Lead</span>
                <span className="block text-slate-500">IT operations team (pilot customer)</span>
              </span>
            </figcaption>
          </figure>
        </div>
      </aside>
    </div>
  );
}
