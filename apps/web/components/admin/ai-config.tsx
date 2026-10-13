"use client";

import {
  Alert,
  Badge,
  Button,
  FormField,
  Input,
  RadioCard,
  RadioGroup,
  SimpleSelect,
  Skeleton,
  Switch,
  cn,
  toast,
} from "@praxis/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  BrainCircuit,
  CheckCircle2,
  ClipboardCheck,
  Coins,
  GraduationCap,
  KeyRound,
  Library,
  type LucideIcon,
  MessageSquareQuote,
  MonitorPlay,
  RotateCcw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserCheck,
  Wand2,
  XCircle,
} from "lucide-react";
import * as React from "react";
import { ErrorState } from "@/components/common/error-state";
import { api, errorMessage } from "@/lib/api";
import { ak } from "./keys";
import type { AIConfigOut, AIConfigUpdate, ProviderInfo } from "./types";
import { SectionCard, fmtUsd, isPlanLimit, UpgradeNotice } from "./ui";

const FEATURES: { key: string; label: string; description: string; icon: LucideIcon; plan?: string; color: string }[] = [
  { key: "tutor", label: "AI tutor", description: "Learners ask questions, get explanations and graded-safe hints.", icon: Bot, plan: "ai_tutor", color: "from-fuchsia-500 to-purple-500" },
  { key: "content_generation", label: "Content generation", description: "Draft courses, lessons, quizzes and scenarios with AI.", icon: Wand2, plan: "ai_generation", color: "from-violet-500 to-indigo-500" },
  { key: "grading", label: "AI grading", description: "Rubric-based scoring and feedback suggestions for submissions.", icon: ClipboardCheck, color: "from-amber-400 to-orange-500" },
  { key: "simulation_ai", label: "Simulation AI", description: "Lifelike customers, colleagues and systems inside simulations.", icon: MonitorPlay, color: "from-sky-400 to-blue-500" },
  { key: "recommendations", label: "Recommendations", description: "Personalised next steps based on performance and skill gaps.", icon: Sparkles, color: "from-emerald-400 to-teal-500" },
];

const TONES = ["encouraging", "professional", "friendly", "concise", "formal"];
const THRESHOLDS = [50, 75, 90, 100];
const THRESHOLD_STYLE: Record<number, string> = {
  50: "data-[on=true]:bg-amber-100 data-[on=true]:text-amber-900 data-[on=true]:ring-amber-300",
  75: "data-[on=true]:bg-orange-100 data-[on=true]:text-orange-900 data-[on=true]:ring-orange-300",
  90: "data-[on=true]:bg-rose-100 data-[on=true]:text-rose-900 data-[on=true]:ring-rose-300",
  100: "data-[on=true]:bg-rose-600 data-[on=true]:text-white data-[on=true]:ring-rose-600",
};

interface Form {
  provider: string;
  model: string;
  embedding_model: string;
  temperature: number;
  max_output_tokens: number;
  features: Record<string, boolean>;
  use_plan_budget: boolean;
  monthly_budget_usd: string;
  hard_limit: boolean;
  alert_thresholds: number[];
  unlimited_daily: boolean;
  per_user_daily_requests: string;
  tone: string;
  socratic: boolean;
  cite_sources: boolean;
  language: string;
  grading_mode: string;
  knowledge_only: boolean;
}

function fromConfig(c: AIConfigOut): Form {
  const tb = (c.tutor_behaviour ?? {}) as Record<string, unknown>;
  return {
    provider: c.provider,
    model: c.model || "",
    embedding_model: c.embedding_model || "",
    temperature: c.temperature,
    max_output_tokens: c.max_output_tokens,
    features: { ...c.features },
    use_plan_budget: c.monthly_budget_usd === null,
    monthly_budget_usd: c.monthly_budget_usd === null ? "" : String(c.monthly_budget_usd),
    hard_limit: c.hard_limit,
    alert_thresholds: [...c.alert_thresholds],
    unlimited_daily: c.per_user_daily_requests === null,
    per_user_daily_requests: c.per_user_daily_requests === null ? "" : String(c.per_user_daily_requests),
    tone: String(tb.tone ?? "encouraging"),
    socratic: Boolean(tb.socratic ?? true),
    cite_sources: Boolean(tb.cite_sources ?? tb.citations ?? true),
    language: String(tb.language ?? ""),
    grading_mode: c.grading_mode,
    knowledge_only: c.knowledge_only,
  };
}

function toUpdate(f: Form): AIConfigUpdate {
  const out: AIConfigUpdate = {
    provider: f.provider as AIConfigUpdate["provider"],
    model: f.model.trim() || "",
    embedding_model: f.embedding_model.trim() || "",
    temperature: Number(f.temperature),
    max_output_tokens: Math.round(Number(f.max_output_tokens)),
    features: f.features,
    hard_limit: f.hard_limit,
    alert_thresholds: f.alert_thresholds,
    per_user_daily_requests: f.unlimited_daily ? null : Math.max(0, Math.round(Number(f.per_user_daily_requests) || 0)),
    tutor_behaviour: { tone: f.tone.trim() || "encouraging", socratic: f.socratic, cite_sources: f.cite_sources, ...(f.language.trim() ? { language: f.language.trim() } : {}) },
    grading_mode: f.grading_mode as AIConfigUpdate["grading_mode"],
    knowledge_only: f.knowledge_only,
    clear_budget: false,
  };
  if (f.use_plan_budget) out.clear_budget = true;
  else out.monthly_budget_usd = Math.max(0, Number(f.monthly_budget_usd) || 0);
  return out;
}

export function AIConfigForm() {
  const qc = useQueryClient();
  const config = useQuery({ queryKey: ak.ai.config, queryFn: ({ signal }) => api.get<AIConfigOut>("/ai/config", { signal }) });
  const providers = useQuery({ queryKey: ak.ai.providers, queryFn: ({ signal }) => api.get<ProviderInfo[]>("/ai/providers", { signal }) });
  const [form, setForm] = React.useState<Form | null>(null);
  React.useEffect(() => {
    if (config.data) setForm(fromConfig(config.data));
  }, [config.data]);

  const save = useMutation({
    mutationFn: (f: Form) => api.put<AIConfigOut>("/ai/config", toUpdate(f)),
    onSuccess: (c) => {
      qc.setQueryData(ak.ai.config, c);
      qc.invalidateQueries({ queryKey: ak.ai.usage });
      toast.success("AI settings saved");
    },
  });

  if (config.isError) return <ErrorState error={config.error} onRetry={() => config.refetch()} />;
  if (!form || !config.data)
    return (
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Skeleton className="h-[30rem] rounded-2xl xl:col-span-2" />
        <Skeleton className="h-[30rem] rounded-2xl" />
      </div>
    );

  const c = config.data;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const dirty = JSON.stringify(form) !== JSON.stringify(fromConfig(c));
  const provider = providers.data?.find((p) => p.id === form.provider);
  const hasKey = c.server_keys[form.provider] ?? provider?.configured ?? false;
  const modelOptions = provider?.models.filter((m) => !m.startsWith("<")) ?? [];
  const budgetInvalid = !form.use_plan_budget && (form.monthly_budget_usd === "" || Number(form.monthly_budget_usd) < 0);

  return (
    <form
      className="space-y-6 pb-24"
      onSubmit={(e) => {
        e.preventDefault();
        if (!budgetInvalid) save.mutate(form);
      }}
    >
      {/* Provider */}
      <SectionCard
        title="Provider & model"
        description="API keys live only in the server environment — they're never stored here or shown in the browser."
        icon={BrainCircuit}
        color="fuchsia"
        action={
          <Badge tone={c.offline ? "info" : "success"} dot>
            Now using {c.effective_provider === "offline" ? "Offline demo" : (providers.data?.find((p) => p.id === c.effective_provider)?.name ?? c.effective_provider)} · {c.effective_model}
          </Badge>
        }
      >
        {providers.isLoading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-2xl" />
            ))}
          </div>
        ) : (
          <RadioGroup
            value={form.provider}
            onValueChange={(v) => {
              const p = providers.data?.find((x) => x.id === v);
              setForm((f) => (f ? { ...f, provider: v, model: p && !p.models[0]?.startsWith("<") ? p.default_model : "" } : f));
            }}
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
            aria-label="AI provider"
          >
            {(providers.data ?? []).map((p) => {
              const key = c.server_keys[p.id] ?? p.configured;
              return (
                <RadioCard
                  key={p.id}
                  value={p.id}
                  icon={p.id === "offline" ? <Library /> : <BrainCircuit />}
                  title={p.name}
                  description={
                    <span className="block space-y-1.5">
                      {key ? (
                        <Badge tone="success" size="sm">
                          <KeyRound aria-hidden /> {p.id === "offline" ? "Built in" : "Server key configured"}
                        </Badge>
                      ) : (
                        <Badge tone="neutral" size="sm">
                          No server key
                        </Badge>
                      )}
                      <span className="block">{p.notes ?? `Default model ${p.default_model}${p.supports_embeddings ? " · embeddings" : ""}`}</span>
                    </span>
                  }
                />
              );
            })}
          </RadioGroup>
        )}
        {!hasKey && form.provider !== "offline" && (
          <Alert tone="warning" title="No server key for this provider" className="mt-4">
            Requests will fall back to the offline demo provider until a platform administrator adds the {provider?.name ?? form.provider} API key to the server environment.
          </Alert>
        )}
        {form.provider === "offline" && (
          <Alert tone="info" title="About the offline provider" className="mt-4">
            A deterministic demo engine with no network calls and zero cost. Answers are extractive and template-based — great for evaluation and air-gapped
            environments, but not a substitute for a live model.
          </Alert>
        )}
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <FormField label="Chat model" hint={provider?.id === "azure_openai" ? "Your Azure chat deployment name" : `Default: ${provider?.default_model ?? "—"}`}>
            {(aria) =>
              modelOptions.length > 1 ? (
                <SimpleSelect id={aria.id} value={form.model || provider?.default_model} onValueChange={(v) => set("model", v)} options={modelOptions.map((m) => ({ value: m, label: m }))} />
              ) : (
                <Input id={aria.id} value={form.model} onChange={(e) => set("model", e.target.value)} placeholder={provider?.default_model} maxLength={100} className="font-mono" />
              )
            }
          </FormField>
          <FormField label="Embedding model" hint="Optional — used to index the knowledge base. Leave blank for the provider default.">
            <Input value={form.embedding_model} onChange={(e) => set("embedding_model", e.target.value)} maxLength={100} className="font-mono" placeholder="Provider default" />
          </FormField>
          <FormField label={`Temperature · ${form.temperature.toFixed(1)}`} hint="Lower is more focused and repeatable; higher is more creative.">
            {(aria) => (
              <div className="flex items-center gap-3 pt-2">
                <span className="text-xs text-muted-foreground">Precise</span>
                <input
                  {...aria}
                  type="range"
                  min={0}
                  max={2}
                  step={0.1}
                  value={form.temperature}
                  onChange={(e) => set("temperature", Number(e.target.value))}
                  className="h-2 flex-1 cursor-pointer accent-brand-600"
                />
                <span className="text-xs text-muted-foreground">Creative</span>
              </div>
            )}
          </FormField>
          <FormField label="Max output tokens" hint="Upper bound per response (64 – 32,000).">
            <Input type="number" min={64} max={32000} step={64} value={form.max_output_tokens} onChange={(e) => set("max_output_tokens", Number(e.target.value))} />
          </FormField>
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* Features */}
        <SectionCard title="Features" description="Turn AI capabilities on or off for everyone in the organisation." icon={SlidersHorizontal} color="violet">
          <ul className="space-y-2.5">
            {FEATURES.map((f) => {
              const planOff = f.plan ? c.plan_features[f.plan] === false : false;
              return (
                <li key={f.key} className={cn("flex items-center gap-3 rounded-2xl border p-3", form.features[f.key] && !planOff ? "border-slate-200 bg-white" : "border-slate-200 bg-slate-50/70")}>
                  <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow-sm", f.color, (planOff || !form.features[f.key]) && "opacity-50 grayscale")}>
                    <f.icon className="size-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-slate-900">
                      {f.label}
                      {planOff && (
                        <Badge tone="violet" size="sm">
                          Upgrade to enable
                        </Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">{f.description}</p>
                  </div>
                  <Switch checked={!!form.features[f.key]} onCheckedChange={(v) => set("features", { ...form.features, [f.key]: v })} aria-label={f.label} />
                </li>
              );
            })}
          </ul>
        </SectionCard>

        {/* Tutor */}
        <SectionCard title="Tutor behaviour" description="How the AI tutor talks to learners." icon={MessageSquareQuote} color="sky">
          <div className="space-y-5">
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-slate-800">Tone</legend>
              <div className="flex flex-wrap gap-2">
                {TONES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={form.tone === t}
                    onClick={() => set("tone", t)}
                    className={cn(
                      "rounded-full px-3 py-1.5 text-sm font-medium capitalize ring-1 ring-inset transition-colors focus-visible:focus-ring",
                      form.tone === t ? "bg-sky-600 text-white ring-sky-600" : "bg-white text-slate-700 ring-slate-200 hover:bg-sky-50",
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <Input className="mt-2" inputSize="sm" value={form.tone} onChange={(e) => set("tone", e.target.value)} maxLength={80} aria-label="Custom tone" placeholder="Or describe a tone, e.g. warm and practical" />
            </fieldset>
            <ToggleRow icon={GraduationCap} title="Socratic questioning" description="End explanations with a question that checks understanding." checked={form.socratic} onChange={(v) => set("socratic", v)} />
            <ToggleRow icon={Library} title="Cite sources" description="Reference knowledge-base passages the answer is grounded in." checked={form.cite_sources} onChange={(v) => set("cite_sources", v)} />
            <ToggleRow
              icon={ShieldCheck}
              title="Knowledge-only mode"
              description="Answer strictly from course content and the knowledge base — never from general knowledge."
              checked={form.knowledge_only}
              onChange={(v) => set("knowledge_only", v)}
            />
            <FormField label="Response language" hint="Leave blank to reply in the learner's language.">
              <Input value={form.language} onChange={(e) => set("language", e.target.value)} maxLength={40} placeholder="e.g. English (Australia)" />
            </FormField>
          </div>
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* Grading */}
        <SectionCard title="Grading mode" description="How AI participates in grading practical work." icon={ClipboardCheck} color="amber">
          <RadioGroup value={form.grading_mode} onValueChange={(v) => set("grading_mode", v)} className="gap-2.5">
            <RadioCard value="ai_assisted" icon={<Sparkles />} title="AI-assisted" description="AI scores and gives feedback; assessors review and can override." />
            <RadioCard value="ai_recommend_human_final" icon={<UserCheck />} title="AI recommends, human decides" description="AI suggests scores; nothing is released until an assessor confirms." />
            <RadioCard value="manual" icon={<ClipboardCheck />} title="Manual only" description="No AI involvement in grading." />
          </RadioGroup>
        </SectionCard>

        {/* Budget */}
        <SectionCard title="Budget & limits" description="Control AI spend for the month." icon={Coins} color="emerald">
          <div className="space-y-5">
            <label htmlFor="ai-use-plan-budget" className="flex items-start gap-3 rounded-xl border border-slate-200 p-3">
              <Switch id="ai-use-plan-budget" checked={form.use_plan_budget} onCheckedChange={(v) => set("use_plan_budget", v)} aria-label="Use plan budget" className="mt-0.5" />
              <span>
                <span className="block text-sm font-medium text-slate-900">Use the plan&apos;s included budget</span>
                <span className="block text-xs text-muted-foreground">{c.plan_budget_usd === null ? "Your plan has no included AI budget." : `${fmtUsd(c.plan_budget_usd)} per month on your plan.`}</span>
              </span>
            </label>
            {!form.use_plan_budget && (
              <FormField label="Monthly budget (USD)" required error={budgetInvalid ? "Enter a budget of 0 or more" : null}>
                <Input type="number" min={0} step={1} value={form.monthly_budget_usd} onChange={(e) => set("monthly_budget_usd", e.target.value)} leftIcon={<span className="text-sm font-semibold">$</span>} />
              </FormField>
            )}
            <ToggleRow icon={XCircle} title="Hard limit" description="Block AI requests once the budget is used up (otherwise only alert)." checked={form.hard_limit} onChange={(v) => set("hard_limit", v)} />
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-slate-800">Alert thresholds</legend>
              <div className="flex flex-wrap gap-2">
                {THRESHOLDS.map((t) => {
                  const on = form.alert_thresholds.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      data-on={on}
                      aria-pressed={on}
                      onClick={() => set("alert_thresholds", on ? form.alert_thresholds.filter((x) => x !== t) : [...form.alert_thresholds, t].sort((a, b) => a - b))}
                      className={cn("inline-flex items-center gap-1 rounded-full bg-white px-3.5 py-1.5 text-sm font-semibold tabular-nums text-slate-600 ring-1 ring-inset ring-slate-200 transition-colors focus-visible:focus-ring", THRESHOLD_STYLE[t])}
                    >
                      {on && <CheckCircle2 className="size-3.5" aria-hidden />}
                      {t}%
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">Admins with AI settings access are notified when spend crosses each threshold.</p>
            </fieldset>
            <div className="space-y-2">
              <label htmlFor="ai-unlimited-daily" className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-slate-800">Per-user daily request limit</span>
                <span className="flex items-center gap-2 text-xs text-slate-600">
                  Unlimited
                  <Switch id="ai-unlimited-daily" checked={form.unlimited_daily} onCheckedChange={(v) => set("unlimited_daily", v)} aria-label="Unlimited daily requests" />
                </span>
              </label>
              {!form.unlimited_daily && (
                <Input type="number" min={0} max={100000} value={form.per_user_daily_requests} onChange={(e) => set("per_user_daily_requests", e.target.value)} aria-label="Requests per user per day" />
              )}
            </div>
          </div>
        </SectionCard>
      </div>

      {save.isError &&
        (isPlanLimit(save.error) ? (
          <UpgradeNotice error={save.error} />
        ) : (
          <Alert tone="danger" title="Couldn't save AI settings">
            {errorMessage(save.error)}
          </Alert>
        ))}

      <div
        className={cn(
          "sticky bottom-24 z-30 flex flex-col gap-3 rounded-2xl border border-amber-200 bg-white/95 p-3 shadow-lift backdrop-blur transition-all motion-safe:animate-fade-up sm:flex-row sm:items-center lg:bottom-6",
          !dirty && !save.isPending && "hidden",
        )}
        role="region"
        aria-label="Save AI settings"
      >
        <p className="flex-1 text-sm text-slate-600" aria-live="polite">
          {dirty ? <strong className="font-semibold text-amber-800">You have unsaved changes</strong> : "All changes saved"}
          {c.updated_at && <span className="ml-2 text-xs text-muted-foreground">Last updated {new Date(c.updated_at).toLocaleString()}</span>}
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" leftIcon={<RotateCcw />} disabled={!dirty || save.isPending} onClick={() => setForm(fromConfig(c))}>
            Discard
          </Button>
          <Button type="submit" variant="gradient" leftIcon={<Save />} loading={save.isPending} disabled={!dirty || budgetInvalid}>
            Save settings
          </Button>
        </div>
      </div>
    </form>
  );
}

function ToggleRow({ icon: Icon, title, description, checked, onChange }: { icon: LucideIcon; title: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = React.useId();
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600">
        <Icon className="size-4" aria-hidden />
      </span>
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="block text-sm font-medium text-slate-900">{title}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
