import { Badge, Button, colorClasses, type CategoryColor } from "@praxis/ui";
import {
  ArrowRight,
  Award,
  BarChart3,
  Bot,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Fingerprint,
  Globe2,
  KeyRound,
  Lock,
  MonitorPlay,
  ScrollText,
  ServerCog,
  ShieldCheck,
  Sparkles,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/common/logo";
import { LoopVisual } from "@/components/marketing/loop-visual";
import { SiteHeader } from "@/components/marketing/site-header";

export const metadata: Metadata = {
  title: "Praxis — AI-powered training that builds real competence",
};

const FEATURES: { icon: LucideIcon; color: CategoryColor; title: string; body: string }[] = [
  { icon: Bot, color: "fuchsia", title: "AI tutor that teaches, not tells", body: "Grounded in your own content with citations. Switches to hint-only mode during graded work so integrity stays intact." },
  { icon: MonitorPlay, color: "violet", title: "Realistic work simulations", body: "Helpdesk, SOC, CRM, clinical and more — deterministic scoring, branching consequences and AI-voiced characters." },
  { icon: Wand2, color: "indigo", title: "AI course builder", body: "Turn an outline or policy PDF into modules, lessons, quizzes and rubrics in minutes. Humans approve every change." },
  { icon: ClipboardCheck, color: "amber", title: "Assessments with evidence", body: "14 question types, practical assignments and explainable AI grading with rubric-level evidence and human override." },
  { icon: BarChart3, color: "emerald", title: "Analytics that drive action", body: "Spot skill gaps by team, question and scenario. Export board-ready PDF, CSV and Excel reports." },
  { icon: Award, color: "sky", title: "Verifiable certificates", body: "Auto-issued credentials with QR codes and a public verification page your auditors will love." },
];

const PLANS = [
  { code: "free", name: "Free", price: "$0", unit: "forever", blurb: "Core learning for small teams getting started.", features: ["Up to 5 users", "3 courses", "AI tutor (limited)", "Gamification"], color: "sky" as CategoryColor },
  { code: "individual", name: "Individual", price: "$19", unit: "per month", blurb: "Unlimited learning with AI tutor and simulations.", features: ["1 learner", "Unlimited courses", "5 simulations", "AI tutor"], color: "emerald" as CategoryColor },
  { code: "professional", name: "Professional", price: "$49", unit: "per month", blurb: "For creators: AI course builder and simulations.", features: ["3 seats", "AI course builder", "Unlimited simulations", "14-day trial"], color: "violet" as CategoryColor, featured: true },
  { code: "business", name: "Business", price: "$29", unit: "per user / month", blurb: "Departments, analytics, branding and API access.", features: ["Unlimited users", "Advanced analytics", "Custom branding", "API access"], color: "amber" as CategoryColor },
  { code: "enterprise", name: "Enterprise", price: "Custom", unit: "annual agreement", blurb: "SSO, dedicated infrastructure and governance.", features: ["SSO (OIDC / SAML)", "Unlimited AI budget", "Data residency", "Dedicated success"], color: "rose" as CategoryColor },
];

const SECURITY: { icon: LucideIcon; title: string; body: string; color: CategoryColor }[] = [
  { icon: Fingerprint, title: "SSO & MFA", body: "Google, Microsoft, OIDC SSO and TOTP MFA with recovery codes.", color: "indigo" },
  { icon: Lock, title: "Tenant isolation", body: "App-level scoping plus PostgreSQL row-level security on every table.", color: "violet" },
  { icon: ScrollText, title: "Immutable audit log", body: "Hash-chained audit trail for every material change.", color: "amber" },
  { icon: KeyRound, title: "Granular RBAC", body: "27 permissions, custom roles and scoped API keys.", color: "emerald" },
  { icon: Globe2, title: "Privacy by design", body: "GDPR / APP tooling: export, deletion, consent, retention.", color: "sky" },
  { icon: ServerCog, title: "AI guardrails", body: "Prompt isolation, budgets, moderation and human approval.", color: "rose" },
];

const INDUSTRIES = ["IT support", "Cybersecurity", "Healthcare", "Customer success", "Financial services", "Universities", "Public sector"];

function SectionIntro({ eyebrow, title, body, center = true }: { eyebrow: string; title: React.ReactNode; body: string; center?: boolean }) {
  return (
    <div className={center ? "mx-auto max-w-2xl text-center" : "max-w-xl"}>
      <p className="text-sm font-semibold uppercase tracking-wider text-brand-700">{eyebrow}</p>
      <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">{title}</h2>
      <p className="mt-4 text-lg text-slate-600">{body}</p>
    </div>
  );
}

function SimulationMock() {
  return (
    <div className="relative rounded-3xl border border-slate-200 bg-white p-2 shadow-lift">
      <div className="flex items-center gap-1.5 px-3 py-2" aria-hidden>
        <span className="size-2.5 rounded-full bg-rose-400" />
        <span className="size-2.5 rounded-full bg-amber-400" />
        <span className="size-2.5 rounded-full bg-emerald-400" />
        <span className="ml-3 text-xs font-medium text-slate-500">Service desk · Ticket #4821</span>
      </div>
      <div className="grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-5">
        <div className="space-y-3 sm:col-span-3">
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-900">VPN drops every 10 minutes</p>
              <Badge tone="danger" size="sm" dot>
                P2 · SLA 42m
              </Badge>
            </div>
            <p className="mt-1.5 text-xs text-slate-600">Reported by Jordan (Finance). Started after yesterday&apos;s client update.</p>
          </div>
          <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 text-xs">
            <p className="font-semibold text-slate-500">CONVERSATION</p>
            <p className="w-fit max-w-[90%] rounded-2xl rounded-tl-sm bg-slate-100 px-3 py-2 text-slate-700">It just disconnects — I&apos;ve restarted twice.</p>
            <p className="ml-auto w-fit max-w-[90%] rounded-2xl rounded-tr-sm bg-brand-600 px-3 py-2 text-white">Which client version is shown under Help → About?</p>
            <p className="w-fit max-w-[90%] rounded-2xl rounded-tl-sm bg-slate-100 px-3 py-2 text-slate-700">5.2.1 — it updated last night.</p>
          </div>
        </div>
        <div className="space-y-3 sm:col-span-2">
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-2xs font-semibold uppercase tracking-wider text-slate-500">Phase</p>
            <div className="mt-2 flex gap-1" aria-hidden>
              {["bg-indigo-500", "bg-sky-500", "bg-violet-500", "bg-slate-200", "bg-slate-200"].map((c, i) => (
                <span key={i} className={`h-1.5 flex-1 rounded-full ${c}`} />
              ))}
            </div>
            <p className="mt-2 text-xs font-semibold text-violet-700">Diagnosis</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-2xs font-semibold uppercase tracking-wider text-slate-500">Live score</p>
            <p className="mt-1 font-display text-3xl font-bold text-slate-900">
              86<span className="text-base text-slate-400">/100</span>
            </p>
            <ul className="mt-2 space-y-1.5 text-xs">
              {[
                ["Diagnosis", "w-[88%]", "bg-emerald-500"],
                ["Communication", "w-[92%]", "bg-sky-500"],
                ["SLA handling", "w-[64%]", "bg-amber-500"],
              ].map(([l, w, c]) => (
                <li key={l}>
                  <span className="text-slate-600">{l}</span>
                  <span className="mt-1 block h-1.5 rounded-full bg-slate-100">
                    <span className={`block h-full rounded-full ${w} ${c}`} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function TutorMock() {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-lift">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-violet-600 text-white">
          <Bot className="size-5" aria-hidden />
        </span>
        <div>
          <p className="text-sm font-semibold text-slate-900">AI Tutor</p>
          <p className="text-xs text-emerald-700">Grounded in “Incident Response Playbook v3”</p>
        </div>
        <Badge tone="warning" size="sm" className="ml-auto">
          Hint mode
        </Badge>
      </div>
      <div className="mt-4 space-y-3 text-sm">
        <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-tr-sm bg-brand-600 px-3.5 py-2.5 text-white">Is this alert a false positive?</p>
        <div className="max-w-[92%] rounded-2xl rounded-tl-sm bg-slate-50 px-3.5 py-2.5 text-slate-700 ring-1 ring-slate-100">
          Good question to ask! Before deciding, compare the source IP against the <strong>asset inventory</strong> and check whether the login
          time matches the user&apos;s usual pattern. What do you notice?
          <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-2xs font-semibold text-slate-600 ring-1 ring-slate-200">
            Source · Playbook §4.2
          </p>
        </div>
      </div>
    </div>
  );
}

function BuilderMock() {
  const steps: [string, CategoryColor, string][] = [
    ["Outline", "indigo", "6 modules · 24 lessons"],
    ["Lessons", "sky", "Drafted with examples"],
    ["Quizzes", "amber", "48 questions, 5 types"],
    ["Rubrics", "emerald", "3 practical assignments"],
  ];
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-lift">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-900">Generating “Customer De-escalation”</p>
        <Badge tone="gradient" size="sm">
          <Sparkles aria-hidden /> AI
        </Badge>
      </div>
      <ol className="mt-4 space-y-2.5">
        {steps.map(([label, color, hint], i) => {
          const c = colorClasses(color);
          return (
            <li key={label} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-2.5">
              <span className={`grid size-8 place-items-center rounded-lg bg-gradient-to-br text-xs font-bold text-white ${c.gradient}`}>{i + 1}</span>
              <span className="flex-1">
                <span className="block text-sm font-semibold text-slate-800">{label}</span>
                <span className="block text-xs text-slate-500">{hint}</span>
              </span>
              <CheckCircle2 className="size-5 text-emerald-500" aria-hidden />
            </li>
          );
        })}
      </ol>
      <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 ring-1 ring-amber-200">Awaiting instructor review — nothing is published until you approve.</p>
    </div>
  );
}

function AnalyticsMock() {
  const bars = [
    { team: "Service desk", v: 82, c: "bg-sky-500" },
    { team: "SOC tier 1", v: 74, c: "bg-violet-500" },
    { team: "Field ops", v: 61, c: "bg-amber-500" },
    { team: "Clinical", v: 89, c: "bg-emerald-500" },
    { team: "Sales", v: 56, c: "bg-rose-500" },
  ];
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-lift">
      <div className="grid grid-cols-3 gap-3">
        {[
          ["Completion", "87%", "from-emerald-50", "text-emerald-700"],
          ["Avg. score", "78", "from-sky-50", "text-sky-700"],
          ["Skill gaps", "12", "from-rose-50", "text-rose-700"],
        ].map(([l, v, bg, t]) => (
          <div key={l} className={`rounded-2xl bg-gradient-to-br ${bg} to-white p-3 ring-1 ring-slate-100`}>
            <p className="text-2xs font-semibold uppercase tracking-wide text-slate-500">{l}</p>
            <p className={`mt-1 font-display text-2xl font-bold ${t}`}>{v}</p>
          </div>
        ))}
      </div>
      <p className="mt-5 text-xs font-semibold uppercase tracking-wider text-slate-500">Competency by team</p>
      <ul className="mt-3 space-y-2.5">
        {bars.map((b) => (
          <li key={b.team} className="grid grid-cols-[96px_1fr_32px] items-center gap-3 text-xs">
            <span className="truncate text-slate-600">{b.team}</span>
            <span className="h-2.5 rounded-full bg-slate-100">
              <span className={`block h-full rounded-full ${b.c}`} style={{ width: `${b.v}%` }} />
            </span>
            <span className="text-right font-semibold tabular-nums text-slate-900">{b.v}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="relative overflow-x-clip bg-white">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[900px] bg-aurora" aria-hidden />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[900px] bg-grid-faint [background-size:44px_44px] [mask-image:linear-gradient(to_bottom,black,transparent)]" aria-hidden />
      <SiteHeader />

      <main id="main">
        {/* HERO */}
        <section className="relative">
          <div className="container grid items-center gap-12 pb-20 pt-10 sm:pt-16 lg:grid-cols-[1.05fr_1fr] lg:pb-28">
            <div className="stagger">
              <Link
                href="/register"
                className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-white/80 py-1 pl-1 pr-3 text-sm font-medium text-slate-700 shadow-sm backdrop-blur transition hover:border-brand-300"
              >
                <span className="rounded-full bg-brand-gradient px-2 py-0.5 text-xs font-semibold text-white">New</span>
                AI simulation builder is here
                <ArrowRight className="size-3.5 text-brand-600" aria-hidden />
              </Link>
              <h1 className="mt-6 font-display text-4xl font-extrabold leading-[1.08] tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
                Training that proves <span className="text-gradient">real competence</span>
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-600">
                Praxis takes your people through the full loop — <strong className="font-semibold text-slate-800">learn, practise, simulate, perform, get assessed and improve</strong> — with an AI tutor, realistic simulations and analytics that show who is truly job-ready.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button asChild variant="gradient" size="lg" rightIcon={<ArrowRight />}>
                  <Link href="/register">Start free</Link>
                </Button>
                <Button asChild variant="secondary" size="lg">
                  <Link href="#simulations">See a simulation</Link>
                </Button>
              </div>
              <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600">
                {["No credit card required", "SSO & MFA", "WCAG 2.2 AA"].map((t) => (
                  <li key={t} className="flex items-center gap-1.5">
                    <Check className="size-4 text-emerald-600" aria-hidden />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <LoopVisual />
          </div>
        </section>

        {/* INDUSTRIES */}
        <section aria-label="Industries" className="border-y border-slate-100 bg-slate-50/60">
          <div className="container flex flex-col items-center gap-4 py-8 lg:flex-row lg:justify-between">
            <p className="text-sm font-medium text-slate-500">Built for teams where skills matter</p>
            <ul className="flex flex-wrap justify-center gap-2">
              {INDUSTRIES.map((i, idx) => {
                const c = colorClasses((["indigo", "rose", "emerald", "teal", "amber", "violet", "sky"] as CategoryColor[])[idx % 7]!);
                return (
                  <li key={i} className={`rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset ${c.soft} ${c.text} ${c.ring}`}>
                    {i}
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* FEATURES */}
        <section id="features" className="container scroll-mt-20 py-20 sm:py-28">
          <SectionIntro eyebrow="Everything in one loop" title="From first lesson to proven performance" body="One platform for delivery, practice, simulation, assessment and insight — so you stop stitching together an LMS, a quiz tool and spreadsheets." />
          <ul className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => {
              const c = colorClasses(f.color);
              const Icon = f.icon;
              return (
                <li key={f.title} className={`group relative overflow-hidden rounded-3xl border border-slate-200/80 bg-gradient-to-br ${c.tint} p-6 shadow-soft transition duration-300 hover:-translate-y-1 hover:shadow-lift`}>
                  <span className={`grid size-12 place-items-center rounded-2xl bg-gradient-to-br text-white shadow-sm transition-transform duration-300 group-hover:scale-110 ${c.gradient}`}>
                    <Icon className="size-6" aria-hidden />
                  </span>
                  <h3 className="mt-5 font-display text-lg font-semibold text-slate-900">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.body}</p>
                </li>
              );
            })}
          </ul>
        </section>

        {/* SIMULATIONS */}
        <section id="simulations" className="scroll-mt-20 bg-gradient-to-b from-violet-50/70 via-white to-white py-20 sm:py-28">
          <div className="container grid items-center gap-12 lg:grid-cols-2">
            <div>
              <SectionIntro center={false} eyebrow="Interactive simulations" title={<>Practise the job, <span className="text-gradient">not just the theory</span></>} body="Learners work real tickets, alerts and patient cases in a safe environment. A deterministic engine owns the scoring — AI only voices the characters — so results are fair, explainable and auditable." />
              <ul className="mt-8 grid gap-3 sm:grid-cols-2">
                {[
                  ["Branching consequences", "violet"],
                  ["Weighted scoring bands", "emerald"],
                  ["Full replay & audit", "sky"],
                  ["Build with AI in minutes", "fuchsia"],
                ].map(([t, color]) => {
                  const c = colorClasses(color as CategoryColor);
                  return (
                    <li key={t} className="flex items-center gap-2.5 text-sm font-medium text-slate-700">
                      <span className={`grid size-6 place-items-center rounded-full ${c.soft} ${c.icon}`}>
                        <Check className="size-3.5" strokeWidth={3} aria-hidden />
                      </span>
                      {t}
                    </li>
                  );
                })}
              </ul>
              <div className="mt-8 flex flex-wrap gap-2" aria-label="Performance bands">
                {[
                  ["Fail", "rose"],
                  ["Needs improvement", "amber"],
                  ["Competent", "sky"],
                  ["Advanced", "violet"],
                  ["Expert", "emerald"],
                ].map(([b, color]) => {
                  const c = colorClasses(color as CategoryColor);
                  return (
                    <span key={b} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${c.soft} ${c.text} ${c.ring}`}>
                      <span className={`size-1.5 rounded-full ${c.solid}`} aria-hidden />
                      {b}
                    </span>
                  );
                })}
              </div>
            </div>
            <SimulationMock />
          </div>
        </section>

        {/* AI */}
        <section id="ai" className="container scroll-mt-20 py-20 sm:py-28">
          <SectionIntro eyebrow="AI where it helps" title="An AI tutor and course builder with guardrails" body="Grounded answers with citations, hint-only mode during graded work, budgets per organisation and human approval for every generated change." />
          <div className="mt-14 grid gap-6 lg:grid-cols-2">
            <TutorMock />
            <BuilderMock />
          </div>
        </section>

        {/* ANALYTICS */}
        <section className="bg-gradient-to-b from-emerald-50/60 via-white to-white py-20 sm:py-28">
          <div className="container grid items-center gap-12 lg:grid-cols-2">
            <AnalyticsMock />
            <SectionIntro center={false} eyebrow="Analytics" title="Know who is ready — and who needs help" body="Track completion, scores, competency and simulation bands by person, team and department. Personalised recommendations close the gap automatically, and reports export to PDF, CSV or Excel." />
          </div>
        </section>

        {/* SECURITY */}
        <section id="security" className="container scroll-mt-20 py-20 sm:py-28">
          <div className="overflow-hidden rounded-[2rem] border border-brand-100 bg-brand-gradient-soft p-6 sm:p-12">
            <div className="flex flex-col gap-10 lg:flex-row lg:items-center">
              <div className="lg:w-2/5">
                <span className="grid size-14 place-items-center rounded-2xl bg-brand-gradient text-white shadow-glow">
                  <ShieldCheck className="size-7" aria-hidden />
                </span>
                <h2 className="mt-5 font-display text-3xl font-bold tracking-tight text-slate-900">Enterprise-grade from day one</h2>
                <p className="mt-3 text-slate-600">Security, privacy and governance are built into the foundation — not bolted on in an enterprise tier.</p>
              </div>
              <ul className="grid flex-1 gap-4 sm:grid-cols-2">
                {SECURITY.map((s) => {
                  const c = colorClasses(s.color);
                  const Icon = s.icon;
                  return (
                    <li key={s.title} className="flex gap-3 rounded-2xl bg-white/80 p-4 shadow-soft ring-1 ring-white backdrop-blur">
                      <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${c.soft} ${c.icon}`}>
                        <Icon className="size-5" aria-hidden />
                      </span>
                      <span>
                        <span className="block text-sm font-semibold text-slate-900">{s.title}</span>
                        <span className="mt-0.5 block text-sm text-slate-600">{s.body}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </section>

        {/* PRICING */}
        <section id="pricing" className="container scroll-mt-20 pb-20 sm:pb-28">
          <SectionIntro eyebrow="Pricing" title="Start free. Scale when you’re ready." body="Simple plans for individuals, creators, teams and enterprises. Annual billing saves around 17%." />
          <ul className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
            {PLANS.map((p) => {
              const c = colorClasses(p.color);
              return (
                <li
                  key={p.code}
                  className={`relative flex flex-col rounded-3xl border bg-white p-6 shadow-soft transition hover:-translate-y-1 hover:shadow-lift ${p.featured ? "border-transparent ring-2 ring-violet-500" : "border-slate-200"}`}
                >
                  {p.featured && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-brand-gradient px-3 py-1 text-xs font-semibold text-white shadow-glow">Most popular</span>
                  )}
                  <span className={`h-1.5 w-10 rounded-full bg-gradient-to-r ${c.gradient}`} aria-hidden />
                  <h3 className="mt-4 font-display text-lg font-bold text-slate-900">{p.name}</h3>
                  <p className="mt-1 min-h-[40px] text-sm text-slate-600">{p.blurb}</p>
                  <p className="mt-4">
                    <span className="font-display text-3xl font-extrabold text-slate-900">{p.price}</span>
                    <span className="ml-1 text-sm text-slate-500">{p.unit}</span>
                  </p>
                  <ul className="mt-5 flex-1 space-y-2 text-sm">
                    {p.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-slate-700">
                        <Check className={`mt-0.5 size-4 shrink-0 ${c.icon}`} aria-hidden />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Button asChild variant={p.featured ? "gradient" : "secondary"} className="mt-6" block>
                    <Link href={p.code === "enterprise" ? "mailto:sales@praxis.example" : `/register?plan=${p.code}`}>
                      {p.code === "enterprise" ? "Talk to sales" : p.code === "free" ? "Start free" : "Start trial"}
                    </Link>
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>

        {/* CTA */}
        <section className="container pb-20">
          <div className="relative overflow-hidden rounded-[2rem] bg-brand-gradient px-6 py-14 text-center shadow-glow sm:px-12">
            <div className="pointer-events-none absolute -left-10 -top-10 size-48 rounded-full bg-white/10 blur-2xl" aria-hidden />
            <div className="pointer-events-none absolute -bottom-16 right-0 size-64 rounded-full bg-fuchsia-300/30 blur-3xl" aria-hidden />
            <h2 className="relative font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">Turn training into proven skill</h2>
            <p className="relative mx-auto mt-3 max-w-xl text-lg text-indigo-100">Set up your workspace in two minutes. Invite your team when you&apos;re ready.</p>
            <div className="relative mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Button asChild variant="white" size="lg" rightIcon={<ArrowRight />}>
                <Link href="/register">Create your free account</Link>
              </Button>
              <Button asChild size="lg" className="bg-white/10 text-white ring-1 ring-white/40 hover:bg-white/20">
                <Link href="/login">Sign in</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-100 bg-slate-50/60">
        <div className="container flex flex-col items-center justify-between gap-4 py-8 text-sm text-slate-600 sm:flex-row">
          <Logo />
          <p>
            © <span suppressHydrationWarning>{new Date().getUTCFullYear()}</span> Praxis. Learn → Practise → Simulate → Perform → Assess → Improve.</p>
          <nav aria-label="Footer" className="flex flex-wrap justify-center gap-x-4 gap-y-2">
            <Link href="/login" className="hover:text-slate-900">
              Sign in
            </Link>
            <a href="#security" className="hover:text-slate-900">
              Security
            </a>
            <a href="#pricing" className="hover:text-slate-900">
              Pricing
            </a>
            <Link href="/terms" className="hover:text-slate-900">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-slate-900">
              Privacy
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
