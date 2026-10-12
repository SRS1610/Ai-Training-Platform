"use client";

import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  SimpleSelect,
  Textarea,
  cn,
  colorClasses,
  toast,
} from "@praxis/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Bot, Check, Clock, Cpu, FileCheck2, Layers, Sparkles, Wand2, Workflow, Wrench } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { ApiError, api, errorMessage } from "@/lib/api";
import { DIFFICULTIES, INDUSTRIES, INDUSTRY_COLOR } from "./theme";
import { sk, type AIBuildOut, type SimulationOut, type TemplateOut } from "./types";

const EXAMPLES = [
  "Create a Level 2 IT helpdesk simulation where the learner must diagnose a DNS problem after a VPN update",
  "A SOC analyst triages a suspicious invoice email, checks headers and contains a compromised mailbox",
  "A restaurant duty manager handles a guest reporting an allergic reaction during a busy dinner service",
  "A bank teller spots signs of elder financial abuse during a large cash withdrawal",
];

const STEPS = [
  { icon: Bot, label: "Drafting the scenario with AI" },
  { icon: Wrench, label: "Repairing and normalising the definition" },
  { icon: FileCheck2, label: "Validating phases, actions and scoring" },
  { icon: Layers, label: "Saving a draft for your review" },
];

export function AIBuildDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const reduce = useReducedMotion();
  const [description, setDescription] = React.useState("");
  const [industry, setIndustry] = React.useState<string>("auto");
  const [difficulty, setDifficulty] = React.useState<string>("auto");
  const [role, setRole] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [step, setStep] = React.useState(0);
  const [result, setResult] = React.useState<AIBuildOut | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setResult(null);
      setError(null);
      setStep(0);
    }
  }, [open]);

  const build = useMutation({
    mutationFn: () =>
      api.post<AIBuildOut>("/simulations/ai-build", {
        description: description.trim(),
        industry: industry === "auto" ? null : industry,
        difficulty: difficulty === "auto" ? null : difficulty,
        learner_role: role.trim() || null,
        title: title.trim() || null,
      }),
    onMutate: () => {
      setError(null);
      setStep(0);
    },
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: sk.all });
    },
    onError: (e) => setError(e instanceof ApiError && e.code === "plan_limit" ? `${e.message} Ask an admin to upgrade the plan.` : errorMessage(e)),
  });

  React.useEffect(() => {
    if (!build.isPending) return;
    const t = setInterval(() => setStep((s) => Math.min(STEPS.length - 1, s + 1)), 2200);
    return () => clearInterval(t);
  }, [build.isPending]);

  const valid = description.trim().length >= 10;

  return (
    <Dialog open={open} onOpenChange={(o) => !build.isPending && onOpenChange(o)}>
      <DialogContent size="lg" className="overflow-hidden p-0">
        <div className="relative bg-brand-gradient px-6 pb-6 pt-6 text-white">
          <div className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-white/10 blur-2xl" aria-hidden />
          <span className="grid size-11 place-items-center rounded-2xl bg-white/15 ring-1 ring-white/30">
            <Wand2 className="size-5" aria-hidden />
          </span>
          <DialogHeader className="mt-3">
            <DialogTitle className="text-xl text-white">AI Simulation Builder</DialogTitle>
            <DialogDescription className="text-white/85">
              Describe the work situation. The AI drafts phases, actions, consequences and scoring; the deterministic engine validates it. Nothing is published until you review it.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="space-y-5 px-6 pb-6">
          {result ? (
            <div className="space-y-4" aria-live="polite">
              <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-500 text-white">
                  <Check className="size-5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="font-display text-base font-semibold text-slate-900">{result.simulation.title}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {result.source === "ai" ? (
                      <Badge tone="gradient" size="sm">
                        <Sparkles aria-hidden /> Generated by AI
                      </Badge>
                    ) : (
                      <Badge tone="info" size="sm">
                        <Cpu aria-hidden /> Deterministic fallback
                      </Badge>
                    )}
                    <Badge tone={result.validation.valid ? "success" : "warning"} size="sm">
                      {result.validation.valid ? "Valid draft" : `${result.validation.errors.length} validation error(s)`}
                    </Badge>
                    <Badge tone="neutral" size="sm">
                      {String(result.validation.stats?.actions ?? "—")} actions · {String(result.validation.stats?.phases ?? "—")} phases
                    </Badge>
                  </div>
                </div>
              </div>
              {result.source === "fallback" && (
                <Alert tone="info" title="The AI was unavailable, so a template-based generator built this draft">
                  Look for <code className="font-mono text-xs">[Instructor: …]</code> placeholders and replace them with your scenario details.
                </Alert>
              )}
              {result.repairs.length > 0 && (
                <details className="rounded-2xl border border-slate-200 bg-slate-50 p-3" open={result.repairs.length <= 5}>
                  <summary className="cursor-pointer text-sm font-semibold text-slate-800">Automatic repairs ({result.repairs.length})</summary>
                  <ul className="mt-2 max-h-48 space-y-1 overflow-auto text-xs text-slate-700 scrollbar-thin">
                    {result.repairs.map((r, i) => (
                      <li key={i} className="flex gap-1.5">
                        <Wrench className="mt-0.5 size-3 shrink-0 text-slate-400" aria-hidden />
                        {r}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <DialogFooter>
                <Button variant="secondary" onClick={() => setResult(null)}>
                  Build another
                </Button>
                <Button variant="gradient" rightIcon={<ArrowRight />} onClick={() => router.push(`/app/instructor/simulations/${result.simulation.id}`)}>
                  Open the draft
                </Button>
              </DialogFooter>
            </div>
          ) : build.isPending ? (
            <div className="space-y-3 py-4" aria-live="polite" aria-busy>
              {STEPS.map((s, i) => {
                const done = i < step;
                const active = i === step;
                return (
                  <motion.div
                    key={s.label}
                    initial={reduce ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: reduce ? 0 : i * 0.12 }}
                    className={cn("flex items-center gap-3 rounded-2xl border px-4 py-3", active ? "border-brand-200 bg-brand-50" : done ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200 bg-white")}
                  >
                    <span className={cn("grid size-8 place-items-center rounded-xl", done ? "bg-emerald-500 text-white" : active ? "bg-brand-gradient text-white" : "bg-slate-100 text-slate-500")}>
                      {done ? <Check className="size-4" aria-hidden /> : <s.icon className={cn("size-4", active && "motion-safe:animate-pulse")} aria-hidden />}
                    </span>
                    <span className={cn("text-sm font-medium", active ? "text-brand-900" : "text-slate-700")}>{s.label}</span>
                  </motion.div>
                );
              })}
              <p className="text-center text-xs text-muted-foreground">This usually takes 10–40 seconds.</p>
            </div>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (valid) build.mutate();
              }}
            >
              <FormField label="Describe the simulation" required hint={`${description.trim().length}/4000 · at least 10 characters`}>
                <Textarea rows={4} maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the simulation…" />
              </FormField>
              <div className="flex flex-wrap gap-1.5" aria-label="Example prompts">
                {EXAMPLES.map((ex) => (
                  <button key={ex} type="button" onClick={() => setDescription(ex)} className="rounded-full bg-slate-100 px-3 py-1 text-left text-xs font-medium text-slate-700 transition-colors hover:bg-brand-50 hover:text-brand-800 focus-visible:focus-ring">
                    {ex.length > 64 ? `${ex.slice(0, 62)}…` : ex}
                  </button>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Industry">
                  {(aria) => <SimpleSelect {...aria} value={industry} onValueChange={setIndustry} options={[{ value: "auto", label: "Detect from description" }, ...INDUSTRIES]} />}
                </FormField>
                <FormField label="Difficulty">
                  {(aria) => <SimpleSelect {...aria} value={difficulty} onValueChange={setDifficulty} options={[{ value: "auto", label: "Detect (e.g. “Level 2”)" }, ...DIFFICULTIES]} />}
                </FormField>
                <FormField label="Learner role" hint="Optional">
                  <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Level 2 Service Desk Analyst" />
                </FormField>
                <FormField label="Title" hint="Optional — derived from the description">
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={255} />
                </FormField>
              </div>
              {error && <Alert tone="danger">{error}</Alert>}
              <DialogFooter>
                <Button variant="secondary" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="gradient" leftIcon={<Sparkles />} disabled={!valid}>
                  Generate draft
                </Button>
              </DialogFooter>
            </form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CreateBlankDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [title, setTitle] = React.useState("");
  const [industry, setIndustry] = React.useState("general");
  const [difficulty, setDifficulty] = React.useState("intermediate");
  const [description, setDescription] = React.useState("");
  const create = useMutation({
    mutationFn: () => api.post<SimulationOut>("/simulations", { title: title.trim(), industry, difficulty, description: description.trim() }),
    onSuccess: (s) => {
      toast.success("Blank simulation created");
      qc.invalidateQueries({ queryKey: sk.all });
      router.push(`/app/instructor/simulations/${s.id}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New blank simulation</DialogTitle>
          <DialogDescription>Starts with the default phases (Initial → Investigation → Diagnosis → Remediation → Validation → Resolution) and a starter scoring model.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) create.mutate();
          }}
        >
          <FormField label="Title" required>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Escalated billing dispute" autoFocus maxLength={255} />
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Industry">{(aria) => <SimpleSelect {...aria} value={industry} onValueChange={setIndustry} options={INDUSTRIES} />}</FormField>
            <FormField label="Difficulty">{(aria) => <SimpleSelect {...aria} value={difficulty} onValueChange={setDifficulty} options={DIFFICULTIES} />}</FormField>
          </div>
          <FormField label="Description" hint="Optional">
            <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </FormField>
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending} disabled={!title.trim()} leftIcon={<Workflow />}>
              Create & open builder
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TemplateDialog({ template, onOpenChange }: { template: TemplateOut | null; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [title, setTitle] = React.useState("");
  React.useEffect(() => setTitle(template?.title ?? ""), [template]);
  const create = useMutation({
    mutationFn: () => api.post<SimulationOut>("/simulations/from-template", { template_key: template!.key, title: title.trim() || null }),
    onSuccess: (s) => {
      toast.success("Simulation created from template");
      qc.invalidateQueries({ queryKey: sk.all });
      router.push(`/app/instructor/simulations/${s.id}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!template) return null;
  const c = colorClasses(INDUSTRY_COLOR(template.industry));
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <div className={cn("-mx-6 -mt-6 mb-1 rounded-t-3xl bg-gradient-to-br px-6 pb-5 pt-6 text-white", c.gradient)}>
          <p className="text-xs font-bold uppercase tracking-wider text-white/85">{template.industry} · {template.environment_type}</p>
          <DialogTitle className="mt-1 text-xl text-white">{template.title}</DialogTitle>
          <DialogDescription className="mt-1 text-white/90">{template.description}</DialogDescription>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            ["Actions", template.actions],
            ["Phases", template.phases.length],
            ["Minutes", template.estimated_minutes ?? "—"],
          ].map(([l, v]) => (
            <div key={String(l)} className={cn("rounded-2xl px-3 py-2", c.soft)}>
              <p className={cn("font-display text-xl font-bold tabular-nums", c.text)}>{v}</p>
              <p className="text-2xs font-semibold uppercase tracking-wider text-slate-600">{l}</p>
            </div>
          ))}
        </div>
        <div>
          <p className="mb-1.5 text-xs font-semibold text-slate-600">Flow</p>
          <div className="flex flex-wrap items-center gap-1 text-2xs font-semibold">
            {template.phases.map((p, i) => (
              <React.Fragment key={p}>
                {i > 0 && <ArrowRight className="size-3 text-slate-400" aria-hidden />}
                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-slate-700">{p}</span>
              </React.Fragment>
            ))}
          </div>
        </div>
        <p className="text-sm text-slate-700">
          Learner role: <span className="font-semibold">{template.learner_role}</span>
          <span className="ml-2 inline-flex items-center gap-1 text-xs text-slate-500">
            <Clock className="size-3" aria-hidden /> {template.difficulty}
          </span>
        </p>
        <FormField label="Title for your copy">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={255} />
        </FormField>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={create.isPending} onClick={() => create.mutate()} rightIcon={<ArrowRight />}>
            Use this template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
