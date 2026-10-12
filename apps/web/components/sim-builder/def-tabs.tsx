"use client";

/**
 * Editors for the non-graph sections of a simulation definition: scenario/meta + completion + settings,
 * environment (panels, tools), characters/facts/intents, variables, scoring and feedback rules.
 */
import { Alert, Badge, Button, Card, Switch, bandMeta, cn, colorClasses } from "@praxis/ui";
import { AlertCircle, AlertTriangle, BookOpen, Braces, Eye, EyeOff, Lock, MessageSquare, PanelsTopLeft, Scale, Sparkles, Target, Users, Wrench } from "lucide-react";
import * as React from "react";
import { ConditionEditor } from "./condition-editor";
import { ChipPicker, FieldRow, JsonField, ListEditor, MiniInput, MiniSelect, MiniTextarea, MultiPick, NumberInput, ToggleRow, useFieldId } from "./fields";
import type { MappedIssue } from "./graph-utils";
import { ListEditorStrings, MessagesEditor, ScoreEditor } from "./outcome-editors";
import { DIFFICULTIES, INDUSTRIES, dimColor } from "./theme";
import type { BandSpec, Character, Dimension, FeedbackRule, Intent, Panel, RefContext, Scoring, SimDefinition, Tool, VariableSpec } from "./types";

export interface SimSettingsForm {
  title: string;
  description: string;
  industry: string;
  environment_type: string;
  difficulty: string;
  estimated_minutes: number;
  is_graded: boolean;
  max_attempts: number | null;
}

interface TabProps {
  def: SimDefinition;
  onChange: (d: SimDefinition) => void;
  ctx: RefContext;
  issues: MappedIssue[];
}

const PANEL_TYPES = [
  "ticket",
  "chat",
  "terminal",
  "system_info",
  "knowledge_base",
  "email_inbox",
  "email_viewer",
  "siem_alerts",
  "url_sandbox",
  "crm_record",
  "patient_chart",
  "dashboard",
  "document",
  "log_viewer",
  "checklist",
  "admin_console",
  "case_file",
  "custom",
];

export function TabCard({ title, description, icon: Icon, color, children, action }: { title: string; description?: string; icon: typeof Users; color: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", color)}>
          <Icon className="size-[18px]" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-base font-semibold text-slate-900">{title}</h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      <div className="space-y-4 p-5">{children}</div>
    </Card>
  );
}

export function IssueList({ issues }: { issues: MappedIssue[] }) {
  if (!issues.length) return null;
  return (
    <ul className="space-y-1.5" aria-label="Validation issues in this section">
      {issues.map((i, k) => (
        <li key={k} className={cn("flex items-start gap-2 rounded-xl px-3 py-2 text-xs", i.severity === "error" ? "bg-rose-50 text-rose-900 ring-1 ring-rose-200" : "bg-amber-50 text-amber-900 ring-1 ring-amber-200")}>
          {i.severity === "error" ? <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />}
          <span>
            <span className="font-mono font-semibold">{i.path}</span> — {i.message}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Text({ label, value, onChange, multiline, rows, mono, hint, placeholder }: { label: string; value: string | null | undefined; onChange: (v: string) => void; multiline?: boolean; rows?: number; mono?: boolean; hint?: React.ReactNode; placeholder?: string }) {
  const id = useFieldId();
  return (
    <FieldRow label={label} htmlFor={id} hint={hint}>
      {multiline ? (
        <MiniTextarea id={id} rows={rows ?? 3} mono={mono} value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <MiniInput id={id} mono={mono} value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
    </FieldRow>
  );
}

/* ------------------------------------------------------------------ scenario */

export function ScenarioTab({ def, onChange, ctx, issues, sim, onSim }: TabProps & { sim: SimSettingsForm; onSim: (s: SimSettingsForm) => void }) {
  const meta = def.meta;
  const setMeta = (p: Partial<SimDefinition["meta"]>) => onChange({ ...def, meta: { ...meta, ...p } });
  const setBoth = (p: Partial<SimSettingsForm>) => {
    onSim({ ...sim, ...p });
    const m: Partial<SimDefinition["meta"]> = {};
    for (const k of ["title", "description", "industry", "environment_type", "difficulty", "estimated_minutes"] as const) if (k in p) (m as Record<string, unknown>)[k] = p[k];
    if (Object.keys(m).length) setMeta(m);
  };
  const completion = def.completion ?? {};
  const settings = def.settings ?? {};
  const setSettings = (p: Partial<NonNullable<SimDefinition["settings"]>>) => onChange({ ...def, settings: { ...settings, ...p } });
  const unknown = (settings.unknown_input ?? {}) as { penalty?: Record<string, number>; reply?: string; max_penalised?: number; time_cost?: number };
  const indId = useFieldId();
  const diffId = useFieldId();
  const minId = useFieldId();
  const attId = useFieldId();
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <div className="space-y-6">
        <IssueList issues={issues} />
        <TabCard title="Simulation" description="Catalogue details shown to learners (kept in sync with the definition's meta)." icon={Sparkles} color="bg-indigo-50 text-indigo-600">
          <Text label="Title" value={sim.title} onChange={(v) => setBoth({ title: v })} />
          <Text label="Description" value={sim.description} onChange={(v) => setBoth({ description: v })} multiline rows={3} />
          <div className="grid gap-3 sm:grid-cols-2">
            <FieldRow label="Industry" htmlFor={indId}>
              <MiniSelect id={indId} value={sim.industry} onChange={(v) => setBoth({ industry: v })} options={INDUSTRIES} />
            </FieldRow>
            <Text label="Environment type" value={sim.environment_type} onChange={(v) => setBoth({ environment_type: v })} mono placeholder="helpdesk" />
            <FieldRow label="Difficulty" htmlFor={diffId}>
              <MiniSelect id={diffId} value={sim.difficulty} onChange={(v) => setBoth({ difficulty: v })} options={DIFFICULTIES} />
            </FieldRow>
            <FieldRow label="Estimated minutes" htmlFor={minId}>
              <NumberInput id={minId} min={1} max={600} value={sim.estimated_minutes} onChange={(n) => setBoth({ estimated_minutes: Math.max(1, Math.min(600, n ?? 20)) })} />
            </FieldRow>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
              <div>
                <p className="text-sm font-semibold text-slate-800">Graded</p>
                <p className="text-2xs text-slate-500">Practice mode shows per-action feedback.</p>
              </div>
              <Switch aria-label="Graded simulation" checked={sim.is_graded} onCheckedChange={(v) => onSim({ ...sim, is_graded: v })} />
            </div>
            <FieldRow label="Max attempts" htmlFor={attId} hint="Empty = unlimited">
              <NumberInput id={attId} nullable min={1} max={100} placeholder="Unlimited" value={sim.max_attempts} onChange={(n) => onSim({ ...sim, max_attempts: n === null ? null : Math.max(1, Math.min(100, n)) })} />
            </FieldRow>
          </div>
        </TabCard>

        <TabCard title="Learner briefing" description="What the learner reads before starting." icon={BookOpen} color="bg-sky-50 text-sky-600">
          <Text label="Learner role" value={meta.learner_role} onChange={(v) => setMeta({ learner_role: v })} placeholder="Level 2 Service Desk Analyst" />
          <Text label="Briefing (Markdown)" value={meta.briefing} onChange={(v) => setMeta({ briefing: v })} multiline rows={6} />
          <FieldRow label="Objectives">
            <ListEditorStrings value={meta.objectives ?? []} onChange={(v) => setMeta({ objectives: v })} placeholder="Diagnose the root cause before changing settings" />
          </FieldRow>
          <FieldRow label="Tags">
            <ListEditorStrings value={meta.tags ?? []} onChange={(v) => setMeta({ tags: v })} placeholder="dns" />
          </FieldRow>
        </TabCard>
      </div>

      <div className="space-y-6">
        <TabCard title="Completion" description="When the run ends. Effects with “End the run” take precedence." icon={Target} color="bg-emerald-50 text-emerald-600">
          <FieldRow label="Success when">
            <ConditionEditor value={completion.success} onChange={(v) => onChange({ ...def, completion: { ...completion, success: v } })} ctx={ctx} label="Success condition" alwaysLabel="Not set" />
          </FieldRow>
          <FieldRow label="Failure when">
            <ConditionEditor value={completion.failure} onChange={(v) => onChange({ ...def, completion: { ...completion, failure: v } })} ctx={ctx} label="Failure condition" alwaysLabel="Not set" />
          </FieldRow>
          <div className="grid grid-cols-2 gap-3">
            <FieldRow label="Max simulated minutes">
              <NumberInput aria-label="Max simulated minutes" nullable placeholder="No limit" min={1} value={completion.max_sim_minutes ?? null} onChange={(n) => onChange({ ...def, completion: { ...completion, max_sim_minutes: n } })} />
            </FieldRow>
            <FieldRow label="Max actions">
              <NumberInput aria-label="Max actions" nullable placeholder="No limit" min={1} value={completion.max_actions ?? null} onChange={(n) => onChange({ ...def, completion: { ...completion, max_actions: n } })} />
            </FieldRow>
          </div>
        </TabCard>

        <TabCard title="Behaviour settings" icon={Wrench} color="bg-violet-50 text-violet-600">
          <ToggleRow label="Show per-action feedback in practice runs" checked={settings.show_feedback !== false} onChange={(v) => setSettings({ show_feedback: v })} />
          <ToggleRow label="Show feedback even when graded" checked={!!settings.show_feedback_when_graded} onChange={(v) => setSettings({ show_feedback_when_graded: v })} />
          <ToggleRow label="AI character voice" hint="AI may rephrase canonical replies; never adds information or affects scoring." checked={settings.ai_character_voice !== false} onChange={(v) => setSettings({ ai_character_voice: v })} />
          <div className="grid grid-cols-2 gap-3">
            <FieldRow label="Idle timeout (minutes)">
              <NumberInput aria-label="Idle timeout in minutes" min={5} value={settings.session_timeout_minutes ?? 240} onChange={(n) => setSettings({ session_timeout_minutes: n ?? 240 })} />
            </FieldRow>
            <FieldRow label="Default repeat policy">
              <MiniSelect
                aria-label="Default repeat policy"
                value={settings.repeat?.mode ?? "diminish"}
                onChange={(v) => setSettings({ repeat: { ...(settings.repeat ?? {}), mode: v as "diminish" } })}
                options={["diminish", "allow", "penalize", "block"].map((m) => ({ value: m, label: m }))}
              />
            </FieldRow>
          </div>
          <Text label="Reply to unrecognised chat" value={unknown.reply ?? "I'm not sure what you mean."} onChange={(v) => setSettings({ unknown_input: { ...unknown, reply: v } })} />
          <FieldRow label="Penalty for unrecognised chat (first few only)">
            <ScoreEditor value={unknown.penalty ?? { communication: -1 }} onChange={(v) => setSettings({ unknown_input: { ...unknown, penalty: v ?? {} } })} ctx={ctx} />
          </FieldRow>
        </TabCard>

        <TabCard title="Opening messages" description="The transcript when the session starts." icon={MessageSquare} color="bg-teal-50 text-teal-600">
          <MessagesEditor value={def.opening_messages} onChange={(v) => onChange({ ...def, opening_messages: v })} ctx={ctx} />
        </TabCard>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ environment */

function DataEditor({ value, onChange, label }: { value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void; label: string }) {
  const [json, setJson] = React.useState(false);
  const entries = Object.entries(value ?? {});
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-700">{label}</span>
        <button type="button" onClick={() => setJson((j) => !j)} aria-pressed={json} className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-2xs font-semibold text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50 focus-visible:focus-ring">
          <Braces className="size-3" aria-hidden /> {json ? "Fields" : "JSON"}
        </button>
      </div>
      {json ? (
        <JsonField value={value ?? {}} onChange={(v) => onChange((v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Record<string, unknown>)} rows={10} aria-label={`${label} JSON`} />
      ) : (
        <div className="space-y-2">
          {entries.length === 0 && <p className="text-2xs italic text-slate-500">No data yet. Strings support {"{{variable}}"} interpolation.</p>}
          {entries.map(([k, v], i) => (
            <div key={i} className="grid gap-1.5 rounded-lg border border-slate-200 bg-slate-50/50 p-2 sm:grid-cols-[160px_1fr_auto]">
              <MiniInput
                aria-label={`Key ${i + 1}`}
                mono
                defaultValue={k}
                onBlur={(e) => {
                  const nk = e.target.value.trim();
                  if (!nk || nk === k) return;
                  onChange(Object.fromEntries(entries.map(([ek, ev]) => [ek === k ? nk : ek, ev])));
                }}
              />
              {typeof v === "string" ? (
                <MiniTextarea aria-label={`Value for ${k}`} rows={Math.min(8, Math.max(1, v.split("\n").length))} value={v} onChange={(e) => onChange({ ...value, [k]: e.target.value })} mono={v.includes("\n")} />
              ) : typeof v === "number" ? (
                <NumberInput aria-label={`Value for ${k}`} value={v} onChange={(n) => onChange({ ...value, [k]: n ?? 0 })} />
              ) : typeof v === "boolean" ? (
                <div className="flex h-8 items-center">
                  <Switch aria-label={`Value for ${k}`} checked={v} onCheckedChange={(b) => onChange({ ...value, [k]: b })} />
                </div>
              ) : (
                <JsonField value={v} onChange={(nv) => onChange({ ...value, [k]: nv })} rows={4} aria-label={`Value for ${k}`} />
              )}
              <Button variant="ghost" size="icon-sm" aria-label={`Remove ${k}`} onClick={() => onChange(Object.fromEntries(entries.filter((_, j) => j !== i)))}>
                <span aria-hidden>×</span>
              </Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Button size="xs" variant="secondary" onClick={() => onChange({ ...value, [`field_${entries.length + 1}`]: "" })}>
              + Text field
            </Button>
            <Button size="xs" variant="ghost" onClick={() => onChange({ ...value, [`items_${entries.length + 1}`]: [] })}>
              + List / object
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function EnvironmentTab({ def, onChange, ctx, issues }: TabProps) {
  const panels = def.environment?.panels ?? [];
  const tools = def.tools ?? [];
  const setPanels = (p: Panel[]) => onChange({ ...def, environment: { ...(def.environment ?? {}), panels: p } });
  return (
    <div className="space-y-6">
      <IssueList issues={issues} />
      <div className="grid gap-6 2xl:grid-cols-2">
        <TabCard title={`Panels (${panels.length})`} description="Screens in the learner's workspace. The type is a rendering hint for the player." icon={PanelsTopLeft} color="bg-sky-50 text-sky-600">
          <ListEditor<Panel>
            items={panels}
            onChange={setPanels}
            make={() => ({ id: `panel_${panels.length + 1}`, type: "document", title: "New panel", data: {}, visible_when: null, variants: [] })}
            addLabel="Add panel"
            itemLabel={(p) => p.title || p.id}
            render={(p, update, i) => (
              <div className="space-y-3">
                <div className="grid gap-2 pr-20 sm:grid-cols-3">
                  <Text label="Id" value={p.id} onChange={(v) => update({ ...p, id: v })} mono />
                  <FieldRow label="Type">
                    <MiniSelect aria-label={`Panel ${i + 1} type`} value={p.type} onChange={(v) => update({ ...p, type: v })} options={PANEL_TYPES.map((t) => ({ value: t, label: t.replace(/_/g, " ") }))} />
                  </FieldRow>
                  <Text label="Title" value={p.title} onChange={(v) => update({ ...p, title: v })} />
                </div>
                <DataEditor label="Panel data" value={p.data ?? {}} onChange={(v) => update({ ...p, data: v })} />
                <details className="rounded-lg bg-slate-50 p-2">
                  <summary className="cursor-pointer text-xs font-semibold text-slate-700">Visibility & variants ({(p.variants ?? []).length})</summary>
                  <div className="mt-2 space-y-3">
                    <FieldRow label="Visible when">
                      <ConditionEditor value={p.visible_when} onChange={(v) => update({ ...p, visible_when: v })} ctx={ctx} label="Panel visibility" alwaysLabel="Always visible" />
                    </FieldRow>
                    <FieldRow label="Variants (data merged over the base while their condition holds)">
                      <ListEditor
                        items={p.variants ?? []}
                        onChange={(v) => update({ ...p, variants: v })}
                        make={() => ({ when: true, data: {} })}
                        addLabel="Add variant"
                        itemLabel={(_, j) => `variant ${j + 1}`}
                        render={(vr, upd, j) => (
                          <div className="space-y-2">
                            <ConditionEditor value={vr.when} onChange={(w) => upd({ ...vr, when: w })} ctx={ctx} label={`Variant ${j + 1} condition`} />
                            <JsonField value={vr.data ?? {}} onChange={(d) => upd({ ...vr, data: (d ?? {}) as Record<string, unknown> })} rows={4} aria-label={`Variant ${j + 1} data`} />
                          </div>
                        )}
                      />
                    </FieldRow>
                  </div>
                </details>
              </div>
            )}
          />
        </TabCard>

        <TabCard title={`Tools (${tools.length})`} description="What the learner can use. Each tool is bound to a panel; actions belong to tools." icon={Wrench} color="bg-indigo-50 text-indigo-600">
          <ListEditor<Tool>
            items={tools}
            onChange={(t) => onChange({ ...def, tools: t })}
            make={() => ({ id: `tool_${tools.length + 1}`, name: "New tool", panel: panels[0]?.id ?? null, description: "", icon: null, prompt: "", unknown_input_output: "", visible_when: null })}
            addLabel="Add tool"
            itemLabel={(t) => t.name || t.id}
            render={(t, update, i) => (
              <div className="space-y-3">
                <div className="grid gap-2 pr-20 sm:grid-cols-3">
                  <Text label="Id" value={t.id} onChange={(v) => update({ ...t, id: v })} mono />
                  <Text label="Name" value={t.name} onChange={(v) => update({ ...t, name: v })} />
                  <FieldRow label="Panel">
                    <MiniSelect aria-label={`Tool ${i + 1} panel`} value={t.panel ?? ""} placeholder="No panel" onChange={(v) => update({ ...t, panel: v || null })} options={ctx.panels.map((p) => ({ value: p.id, label: p.title }))} />
                  </FieldRow>
                </div>
                <Text label="Description" value={t.description} onChange={(v) => update({ ...t, description: v })} />
                <div className="grid gap-2 sm:grid-cols-2">
                  <Text label="Prompt (terminals)" value={t.prompt} onChange={(v) => update({ ...t, prompt: v })} mono placeholder="PS C:\>" />
                  <Text label="Icon (lucide name)" value={t.icon ?? ""} onChange={(v) => update({ ...t, icon: v || null })} mono placeholder="terminal" />
                </div>
                <Text label="Output for unrecognised commands" value={t.unknown_input_output} onChange={(v) => update({ ...t, unknown_input_output: v })} multiline rows={2} mono hint="Use {{$input.text}} to echo the command." />
                <FieldRow label="Visible when">
                  <ConditionEditor value={t.visible_when} onChange={(v) => update({ ...t, visible_when: v })} ctx={ctx} label="Tool visibility" alwaysLabel="Always visible" />
                </FieldRow>
              </div>
            )}
          />
        </TabCard>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ characters */

export function CharactersTab({ def, onChange, ctx, issues }: TabProps) {
  const chars = def.characters ?? [];
  const intents = def.intents ?? [];
  const numericVars = Object.entries(def.variables ?? {})
    .filter(([, v]) => v.type === "float" || v.type === "int")
    .map(([k]) => ({ value: k, label: k }));
  return (
    <div className="space-y-6">
      <IssueList issues={issues} />
      <div className="grid gap-6 2xl:grid-cols-[3fr_2fr]">
        <TabCard title={`Characters (${chars.length})`} description="People the learner talks to, what they know and how patient they are." icon={Users} color="bg-fuchsia-50 text-fuchsia-600">
          <ListEditor<Character>
            items={chars}
            onChange={(c) => onChange({ ...def, characters: c })}
            make={() => ({ id: `person_${chars.length + 1}`, name: "New character", role: "", persona: "", tone: "", facts: [], fallback_reply: "Sorry, I'm not sure what you mean. Could you rephrase that?", patience_var: null, patience_decay_per_minute: 0 })}
            addLabel="Add character"
            itemLabel={(c) => c.name || c.id}
            render={(c, update, i) => {
              const cc = colorClasses((["fuchsia", "sky", "emerald", "amber", "violet"] as const)[i % 5] ?? "fuchsia");
              return (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 pr-20">
                    <span className={cn("grid size-10 shrink-0 place-items-center rounded-full bg-gradient-to-br text-sm font-bold text-white", cc.gradient)} aria-hidden>
                      {(c.name || "?").slice(0, 1)}
                    </span>
                    <div className="grid flex-1 gap-2 sm:grid-cols-3">
                      <Text label="Id" value={c.id} onChange={(v) => update({ ...c, id: v })} mono />
                      <Text label="Name" value={c.name} onChange={(v) => update({ ...c, name: v })} />
                      <Text label="Role" value={c.role} onChange={(v) => update({ ...c, role: v })} />
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Text label="Persona" value={c.persona} onChange={(v) => update({ ...c, persona: v })} multiline rows={3} />
                    <Text label="Tone" value={c.tone} onChange={(v) => update({ ...c, tone: v })} multiline rows={3} />
                  </div>
                  <Text label="Fallback reply" value={c.fallback_reply} onChange={(v) => update({ ...c, fallback_reply: v })} />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <FieldRow label="Patience variable" hint="A public number variable works best (shown as a meter).">
                      <MiniSelect aria-label={`${c.name} patience variable`} value={c.patience_var ?? ""} placeholder="None" onChange={(v) => update({ ...c, patience_var: v || null })} options={numericVars} />
                    </FieldRow>
                    <FieldRow label="Patience lost per simulated minute">
                      <NumberInput aria-label={`${c.name} patience decay`} step={0.1} min={0} value={c.patience_decay_per_minute ?? 0} onChange={(n) => update({ ...c, patience_decay_per_minute: n ?? 0 })} />
                    </FieldRow>
                  </div>
                  <FieldRow label={`Facts (${(c.facts ?? []).length})`} hint="Revealed by action effects, by matching chat intents, or automatically.">
                    <ListEditor
                      items={c.facts ?? []}
                      onChange={(f) => update({ ...c, facts: f })}
                      make={() => ({ id: `f_${(c.facts ?? []).length + 1}`, text: "", intents: [], when: null, auto_reveal: false })}
                      addLabel="Add fact"
                      itemLabel={(f) => f.id}
                      render={(f, upd, j) => (
                        <div className="space-y-2">
                          <div className="grid gap-2 pr-20 sm:grid-cols-[140px_1fr]">
                            <Text label="Id" value={f.id} onChange={(v) => upd({ ...f, id: v })} mono />
                            <FieldRow label="Matched by intents">
                              <MultiPick aria-label={`Fact ${j + 1} intents`} value={f.intents ?? []} onChange={(v) => upd({ ...f, intents: v })} options={intents.map((x) => ({ value: x.id, label: x.description || x.id }))} placeholder="None" />
                            </FieldRow>
                          </div>
                          <Text label="What they say" value={f.text} onChange={(v) => upd({ ...f, text: v })} multiline rows={2} />
                          <ToggleRow label="Reveal automatically when the condition holds" checked={!!f.auto_reveal} onChange={(v) => upd({ ...f, auto_reveal: v })} />
                          <ConditionEditor value={f.when} onChange={(v) => upd({ ...f, when: v })} ctx={ctx} label={`Fact ${j + 1} condition`} alwaysLabel="Any time" />
                        </div>
                      )}
                    />
                  </FieldRow>
                </div>
              );
            }}
          />
        </TabCard>

        <div className="space-y-6">
          <TabCard title={`Chat intents (${intents.length})`} description="Recognised in chat and search boxes. Patterns are keyword phrases; examples are whole sentences." icon={MessageSquare} color="bg-sky-50 text-sky-600">
            <ListEditor<Intent>
              items={intents}
              onChange={(v) => onChange({ ...def, intents: v })}
              make={() => ({ id: `intent_${intents.length + 1}`, description: "", patterns: [], examples: [] })}
              addLabel="Add intent"
              itemLabel={(x) => x.id}
              render={(x, update) => (
                <div className="space-y-2">
                  <div className="grid gap-2 pr-20 sm:grid-cols-2">
                    <Text label="Id" value={x.id} onChange={(v) => update({ ...x, id: v })} mono />
                    <Text label="Description" value={x.description} onChange={(v) => update({ ...x, description: v })} />
                  </div>
                  <FieldRow label="Patterns">
                    <ListEditorStrings value={x.patterns ?? []} onChange={(v) => update({ ...x, patterns: v })} placeholder="when start" />
                  </FieldRow>
                  <FieldRow label="Example sentences">
                    <ListEditorStrings value={x.examples ?? []} onChange={(v) => update({ ...x, examples: v })} placeholder="When did this start happening?" />
                  </FieldRow>
                </div>
              )}
            />
          </TabCard>
          <TabCard title="Synonyms" description="Extra vocabulary for intent matching: {canonical: [variants]}." icon={Braces} color="bg-slate-100 text-slate-600">
            <JsonField value={def.synonyms ?? {}} onChange={(v) => onChange({ ...def, synonyms: (v ?? {}) as Record<string, string[]> })} rows={6} aria-label="Synonyms JSON" />
          </TabCard>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ variables */

const VIS = {
  public: { label: "Public", icon: Eye, cls: "bg-emerald-50 text-emerald-700 ring-emerald-200", hint: "Sent to the learner (meters, statuses)" },
  internal: { label: "Internal", icon: EyeOff, cls: "bg-slate-100 text-slate-700 ring-slate-200", hint: "Hidden, but may be interpolated into outputs" },
  secret: { label: "Secret", icon: Lock, cls: "bg-rose-50 text-rose-700 ring-rose-200", hint: "Ground truth — never shown or interpolated" },
} as const;

function InitialValue({ spec, onChange, name }: { spec: VariableSpec; onChange: (v: unknown) => void; name: string }) {
  const t = spec.type ?? "any";
  if (t === "bool")
    return (
      <div className="flex h-8 items-center">
        <Switch aria-label={`${name} initial value`} checked={!!spec.initial} onCheckedChange={(b) => onChange(b)} />
      </div>
    );
  if (t === "int" || t === "float") return <NumberInput aria-label={`${name} initial value`} step={t === "int" ? 1 : 0.5} value={typeof spec.initial === "number" ? spec.initial : 0} onChange={(n) => onChange(n ?? 0)} />;
  if (t === "str") return <MiniInput aria-label={`${name} initial value`} value={String(spec.initial ?? "")} onChange={(e) => onChange(e.target.value)} />;
  return <JsonField value={spec.initial ?? null} onChange={onChange} rows={2} aria-label={`${name} initial value`} />;
}

export function VariablesTab({ def, onChange, issues }: TabProps) {
  const vars = Object.entries(def.variables ?? {});
  const setVars = (entries: [string, VariableSpec][]) => onChange({ ...def, variables: Object.fromEntries(entries) });
  const variations = def.variations ?? [];
  return (
    <div className="space-y-6">
      <IssueList issues={issues} />
      <TabCard
        title={`Variables (${vars.length})`}
        description="Scenario state. Conditions read them, effects change them. Renaming doesn't update references — use the JSON tab to rename everywhere."
        icon={Braces}
        color="bg-indigo-50 text-indigo-600"
        action={
          <div className="hidden gap-1.5 lg:flex">
            {Object.entries(VIS).map(([k, v]) => (
              <span key={k} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-semibold ring-1 ring-inset", v.cls)} title={v.hint}>
                <v.icon className="size-3" aria-hidden /> {v.label}
              </span>
            ))}
          </div>
        }
      >
        <ListEditor<[string, VariableSpec]>
          items={vars}
          onChange={setVars}
          make={() => [`var_${vars.length + 1}`, { type: "bool", initial: false, visibility: "internal", label: "" }]}
          addLabel="Add variable"
          itemLabel={([k]) => k}
          render={([name, spec], update) => {
            const vis = VIS[spec.visibility ?? "internal"];
            return (
              <div className="grid gap-2 pr-20 md:grid-cols-[1.2fr_0.8fr_1fr_1.2fr_1.2fr]">
                <FieldRow label="Name">
                  <MiniInput aria-label="Variable name" mono defaultValue={name} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== name && update([e.target.value.trim(), spec])} />
                </FieldRow>
                <FieldRow label="Type">
                  <MiniSelect
                    aria-label={`${name} type`}
                    value={spec.type ?? "any"}
                    onChange={(t) => update([name, { ...spec, type: t as VariableSpec["type"], initial: t === "bool" ? false : t === "int" || t === "float" ? 0 : t === "str" ? "" : t === "list" ? [] : t === "dict" ? {} : null }])}
                    options={["bool", "int", "float", "str", "list", "dict", "any"].map((t) => ({ value: t, label: t }))}
                  />
                </FieldRow>
                <FieldRow label="Visibility">
                  <div className="flex items-center gap-1.5">
                    <vis.icon className={cn("size-4 shrink-0", spec.visibility === "secret" ? "text-rose-600" : spec.visibility === "public" ? "text-emerald-600" : "text-slate-500")} aria-hidden />
                    <MiniSelect aria-label={`${name} visibility`} value={spec.visibility ?? "internal"} onChange={(v) => update([name, { ...spec, visibility: v as VariableSpec["visibility"] }])} options={Object.entries(VIS).map(([k, v]) => ({ value: k, label: v.label }))} />
                  </div>
                </FieldRow>
                <FieldRow label="Initial value">
                  <InitialValue spec={spec} name={name} onChange={(v) => update([name, { ...spec, initial: v }])} />
                </FieldRow>
                <FieldRow label="Label (public meters)">
                  <MiniInput aria-label={`${name} label`} value={spec.label ?? ""} onChange={(e) => update([name, { ...spec, label: e.target.value }])} />
                </FieldRow>
                {(spec.type === "int" || spec.type === "float") && (
                  <div className="grid grid-cols-2 gap-2 md:col-span-2">
                    <FieldRow label="Min">
                      <NumberInput aria-label={`${name} minimum`} nullable placeholder="none" value={spec.min ?? null} onChange={(n) => update([name, { ...spec, min: n }])} />
                    </FieldRow>
                    <FieldRow label="Max">
                      <NumberInput aria-label={`${name} maximum`} nullable placeholder="none" value={spec.max ?? null} onChange={(n) => update([name, { ...spec, max: n }])} />
                    </FieldRow>
                  </div>
                )}
                <div className="md:col-span-3">
                  <FieldRow label="Seeded pool (one value picked per session)">
                    <JsonField value={spec.pool ?? null} onChange={(v) => update([name, { ...spec, pool: Array.isArray(v) ? v : null }])} rows={1} aria-label={`${name} pool`} />
                  </FieldRow>
                </div>
              </div>
            );
          }}
        />
      </TabCard>
      <TabCard title={`Variations (${variations.length})`} description="Weighted scenario variants picked from the session seed (after pools)." icon={Sparkles} color="bg-violet-50 text-violet-600">
        <ListEditor
          items={variations}
          onChange={(v) => onChange({ ...def, variations: v })}
          make={() => ({ id: `variant_${variations.length + 1}`, label: "", weight: 1, set: {} })}
          addLabel="Add variation"
          itemLabel={(v) => v.label || v.id}
          render={(v, update, i) => (
            <div className="space-y-2">
              <div className="grid gap-2 pr-20 sm:grid-cols-[1fr_1.5fr_90px]">
                <Text label="Id" value={v.id} onChange={(x) => update({ ...v, id: x })} mono />
                <Text label="Label" value={v.label} onChange={(x) => update({ ...v, label: x })} />
                <FieldRow label="Weight">
                  <NumberInput aria-label={`Variation ${i + 1} weight`} step={0.5} min={0} value={v.weight ?? 1} onChange={(n) => update({ ...v, weight: n ?? 1 })} />
                </FieldRow>
              </div>
              <FieldRow label="Sets variables">
                <JsonField value={v.set ?? {}} onChange={(s) => update({ ...v, set: (s ?? {}) as Record<string, unknown> })} rows={3} aria-label={`Variation ${i + 1} values`} />
              </FieldRow>
            </div>
          )}
        />
      </TabCard>
    </div>
  );
}

/* ------------------------------------------------------------------ scoring */

const BAND_ORDER = ["expert", "advanced", "competent", "needs_improvement", "fail"];
const bandKey = (name: string) => name.toLowerCase().replace(/[\s-]+/g, "_");

export function BandPreview({ bands, passMark }: { bands: BandSpec[]; passMark?: number }) {
  const sorted = [...bands].sort((a, b) => a.min - b.min);
  return (
    <figure>
      <div className="relative flex h-9 overflow-hidden rounded-xl ring-1 ring-slate-200" role="img" aria-label={`Bands: ${sorted.map((b) => `${b.name} from ${b.min}`).join(", ")}`}>
        {sorted.map((b, i) => {
          const end = sorted[i + 1]?.min ?? 100;
          const width = Math.max(0, Math.min(100, end) - Math.max(0, b.min));
          const meta = bandMeta(bandKey(b.name));
          const c = colorClasses(meta.color);
          return (
            <div key={`${b.name}-${i}`} className={cn("flex items-center justify-center overflow-hidden bg-gradient-to-r text-2xs font-bold text-white", c.gradient)} style={{ width: `${width}%` }} title={`${b.name}: ${b.min}–${end}`}>
              <span className="truncate px-1 drop-shadow-sm">{width > 8 ? b.name : ""}</span>
            </div>
          );
        })}
        {passMark !== undefined && (
          <div className="absolute inset-y-0 w-0.5 bg-slate-900" style={{ left: `${passMark}%` }} aria-hidden>
            <span className="absolute -top-0.5 left-1 rounded bg-slate-900 px-1 text-2xs font-bold text-white">pass {passMark}</span>
          </div>
        )}
      </div>
      <figcaption className="mt-1 flex justify-between text-2xs tabular-nums text-slate-500">
        <span>0</span>
        <span>50</span>
        <span>100</span>
      </figcaption>
    </figure>
  );
}

export function ScoringTab({ def, onChange, ctx, issues }: TabProps) {
  const sc: Scoring = def.scoring ?? { dimensions: [] };
  const set = (p: Partial<Scoring>) => onChange({ ...def, scoring: { ...sc, ...p } });
  const dims = sc.dimensions ?? [];
  const total = Math.round(dims.reduce((a, d) => a + (Number(d.weight) || 0), 0) * 100) / 100;
  const ok = Math.abs(total - 100) < 0.001;
  const bands = sc.bands ?? [];
  const normalise = () => {
    if (!total) return;
    const scaled = dims.map((d) => ({ ...d, weight: Math.round(((Number(d.weight) || 0) / total) * 1000) / 10 }));
    const diff = Math.round((100 - scaled.reduce((a, d) => a + d.weight, 0)) * 10) / 10;
    if (scaled.length) scaled[0] = { ...scaled[0]!, weight: Math.round((scaled[0]!.weight + diff) * 10) / 10 };
    set({ dimensions: scaled });
  };
  return (
    <div className="space-y-6">
      <IssueList issues={issues} />
      <div className="grid gap-6 xl:grid-cols-2">
        <TabCard
          title="Dimensions"
          description="Weights must total 100. Calibrate max points to ~80–90% of what the optimal path earns."
          icon={Scale}
          color="bg-emerald-50 text-emerald-600"
          action={
            <span aria-live="polite" className={cn("rounded-full px-2.5 py-1 text-xs font-bold tabular-nums ring-1 ring-inset", ok ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-rose-50 text-rose-700 ring-rose-200")}>
              {total} / 100
            </span>
          }
        >
          <div className="flex h-3 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`Weights: ${dims.map((d) => `${d.name} ${d.weight}`).join(", ")}`}>
            {dims.map((d, i) => (
              <div key={d.id} className={cn("h-full", dimColor(i).dot)} style={{ width: `${Math.max(0, Number(d.weight) || 0)}%` }} title={`${d.name}: ${d.weight}%`} />
            ))}
          </div>
          {!ok && (
            <Alert tone="danger" title={`Weights total ${total}, not 100`} action={total > 0 ? <Button size="xs" variant="secondary" onClick={normalise}>Normalise</Button> : undefined}>
              Publishing is blocked until the weights add up to exactly 100.
            </Alert>
          )}
          <ListEditor<Dimension>
            items={dims}
            onChange={(v) => set({ dimensions: v })}
            make={() => ({ id: `dimension_${dims.length + 1}`, name: "New dimension", weight: 0, max_points: 10, baseline: "zero", description: "" })}
            addLabel="Add dimension"
            itemLabel={(d) => d.name}
            render={(d, update, i) => (
              <div className="space-y-2">
                <div className="flex items-center gap-2 pr-20">
                  <span className={cn("size-3 shrink-0 rounded-full", dimColor(i).dot)} aria-hidden />
                  <MiniInput aria-label={`Dimension ${i + 1} name`} className="flex-1 font-semibold" value={d.name} onChange={(e) => update({ ...d, name: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Text label="Id" value={d.id} onChange={(v) => update({ ...d, id: v })} mono />
                  <FieldRow label="Weight %">
                    <NumberInput aria-label={`${d.name} weight`} min={0} max={100} step={1} value={d.weight} onChange={(n) => update({ ...d, weight: n ?? 0 })} />
                  </FieldRow>
                  <FieldRow label="Max points">
                    <NumberInput aria-label={`${d.name} max points`} min={0.5} step={0.5} value={d.max_points ?? 10} onChange={(n) => update({ ...d, max_points: n ?? 10 })} />
                  </FieldRow>
                  <FieldRow label="Baseline">
                    <MiniSelect aria-label={`${d.name} baseline`} value={d.baseline ?? "zero"} onChange={(v) => update({ ...d, baseline: v as "zero" | "full" })} options={[{ value: "zero", label: "Start at 0" }, { value: "full", label: "Start full" }]} />
                  </FieldRow>
                </div>
              </div>
            )}
          />
        </TabCard>

        <div className="space-y-6">
          <TabCard title="Bands & pass mark" description="The band is the highest one whose minimum the total reaches." icon={Target} color="bg-violet-50 text-violet-600">
            <BandPreview bands={bands} passMark={sc.pass_mark ?? 70} />
            <ul className="space-y-1.5">
              {[...bands]
                .map((b, i) => ({ b, i }))
                .sort((x, y) => y.b.min - x.b.min)
                .map(({ b, i }) => {
                  const meta = bandMeta(bandKey(b.name));
                  const c = colorClasses(meta.color);
                  return (
                    <li key={i} className="flex items-center gap-2">
                      <span className={cn("size-3 shrink-0 rounded-full", c.solid)} aria-hidden />
                      <MiniInput aria-label={`Band ${i + 1} name`} className="flex-1" value={b.name} onChange={(e) => set({ bands: bands.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                      <span className="text-2xs text-slate-500">from</span>
                      <NumberInput aria-label={`${b.name} minimum score`} className="w-20" min={0} max={100} value={b.min} onChange={(n) => set({ bands: bands.map((x, j) => (j === i ? { ...x, min: n ?? 0 } : x)) })} />
                      <button type="button" aria-label={`Remove ${b.name}`} className="grid size-7 place-items-center rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-600 focus-visible:focus-ring" onClick={() => set({ bands: bands.filter((_, j) => j !== i) })}>
                        ×
                      </button>
                    </li>
                  );
                })}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button size="xs" variant="secondary" onClick={() => set({ bands: [...bands, { name: "New band", min: 0 }] })}>
                + Add band
              </Button>
              {bands.length === 0 && (
                <Button size="xs" variant="soft" onClick={() => set({ bands: BAND_ORDER.map((k, i) => ({ name: bandMeta(k).label, min: [95, 85, 70, 50, 0][i]! })) })}>
                  Use standard bands
                </Button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FieldRow label="Pass mark">
                <NumberInput aria-label="Pass mark" min={0} max={100} value={sc.pass_mark ?? 70} onChange={(n) => set({ pass_mark: n ?? 70 })} />
              </FieldRow>
              <FieldRow label="Critical cap" hint="Total is capped here after any critical outcome.">
                <NumberInput aria-label="Critical cap" nullable placeholder="No cap" min={0} max={100} value={sc.critical_cap ?? null} onChange={(n) => set({ critical_cap: n })} />
              </FieldRow>
            </div>
            <ToggleRow label="Unfinished runs cannot pass" checked={sc.require_completion !== false} onChange={(v) => set({ require_completion: v })} />
          </TabCard>

          <TabCard
            title="Efficiency"
            description="Full points up to the target time, falling to zero at the maximum."
            icon={Sparkles}
            color="bg-sky-50 text-sky-600"
            action={<Switch aria-label="Score efficiency" checked={!!sc.efficiency} onCheckedChange={(v) => set({ efficiency: v ? { dimension: dims.find((d) => d.id.includes("effic"))?.id ?? dims[0]?.id ?? "efficiency", target_minutes: 20, max_minutes: 60, require_success: true } : null })} />}
          >
            {sc.efficiency ? (
              <div className="grid grid-cols-2 gap-3">
                <FieldRow label="Dimension">
                  <MiniSelect aria-label="Efficiency dimension" value={sc.efficiency.dimension ?? ""} onChange={(v) => set({ efficiency: { ...sc.efficiency!, dimension: v } })} options={ctx.dimensions.map((d) => ({ value: d.id, label: d.name }))} />
                </FieldRow>
                <div />
                <FieldRow label="Target minutes">
                  <NumberInput aria-label="Target minutes" min={1} value={sc.efficiency.target_minutes} onChange={(n) => set({ efficiency: { ...sc.efficiency!, target_minutes: n ?? 1 } })} />
                </FieldRow>
                <FieldRow label="Max minutes">
                  <NumberInput aria-label="Max minutes" min={1} value={sc.efficiency.max_minutes} onChange={(n) => set({ efficiency: { ...sc.efficiency!, max_minutes: n ?? 1 } })} />
                </FieldRow>
                <div className="col-span-2">
                  <ToggleRow label="Only counts for successful runs" checked={sc.efficiency.require_success !== false} onChange={(v) => set({ efficiency: { ...sc.efficiency!, require_success: v } })} />
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500">Efficiency isn&apos;t scored.</p>
            )}
          </TabCard>

          <TabCard
            title="Process adherence"
            description="Loses points for each required phase skipped."
            icon={Target}
            color="bg-amber-50 text-amber-600"
            action={<Switch aria-label="Score process adherence" checked={!!sc.process} onCheckedChange={(v) => set({ process: v ? { dimension: dims.find((d) => d.id.includes("process"))?.id ?? dims[0]?.id, required_order: ctx.phases.map((p) => p.id), skip_penalty: 4 } : null })} />}
          >
            {sc.process ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <FieldRow label="Dimension">
                    <MiniSelect aria-label="Process dimension" value={sc.process.dimension ?? ""} onChange={(v) => set({ process: { ...sc.process!, dimension: v } })} options={ctx.dimensions.map((d) => ({ value: d.id, label: d.name }))} />
                  </FieldRow>
                  <FieldRow label="Penalty per skipped phase">
                    <NumberInput aria-label="Skip penalty" min={0} step={0.5} value={sc.process.skip_penalty ?? 4} onChange={(n) => set({ process: { ...sc.process!, skip_penalty: n ?? 0 } })} />
                  </FieldRow>
                </div>
                <FieldRow label="Required order" hint="Phases are required in the order you select them.">
                  <ChipPicker aria-label="Required phase order" options={ctx.phases.map((p) => ({ value: p.id, label: p.name }))} value={sc.process.required_order ?? []} onChange={(v) => set({ process: { ...sc.process!, required_order: v } })} />
                </FieldRow>
                <p className="flex flex-wrap items-center gap-1 text-2xs text-slate-600">
                  {(sc.process.required_order ?? []).map((p, i) => (
                    <React.Fragment key={p}>
                      {i > 0 && <span aria-hidden>→</span>}
                      <Badge tone="brand" size="sm">
                        {i + 1}. {p}
                      </Badge>
                    </React.Fragment>
                  ))}
                </p>
              </div>
            ) : (
              <p className="text-xs text-slate-500">Process adherence isn&apos;t scored.</p>
            )}
          </TabCard>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ feedback rules */

const FB = {
  strength: { label: "Strength", cls: "border-l-emerald-500", chip: "bg-emerald-50 text-emerald-700" },
  improvement: { label: "Improvement", cls: "border-l-amber-500", chip: "bg-amber-50 text-amber-800" },
  missed_step: { label: "Missed step", cls: "border-l-rose-500", chip: "bg-rose-50 text-rose-700" },
  tip: { label: "Tip", cls: "border-l-sky-500", chip: "bg-sky-50 text-sky-700" },
} as const;

export function FeedbackTab({ def, onChange, ctx, issues }: TabProps) {
  const rules = def.feedback_rules ?? [];
  const counts = Object.fromEntries(Object.keys(FB).map((k) => [k, rules.filter((r) => r.type === k).length]));
  return (
    <div className="space-y-6">
      <IssueList issues={issues} />
      <TabCard
        title={`Feedback rules (${rules.length})`}
        description="Evaluated when the run is scored. The engine also adds critical/incorrect actions, process skips and a focus-area tip automatically."
        icon={MessageSquare}
        color="bg-emerald-50 text-emerald-600"
        action={
          <div className="hidden flex-wrap gap-1 sm:flex">
            {Object.entries(FB).map(([k, v]) => (
              <span key={k} className={cn("rounded-full px-2 py-0.5 text-2xs font-semibold", v.chip)}>
                {v.label} · {counts[k]}
              </span>
            ))}
          </div>
        }
      >
        <ListEditor<FeedbackRule>
          items={rules}
          onChange={(v) => onChange({ ...def, feedback_rules: v })}
          make={() => ({ id: `fb_${rules.length + 1}`, when: true, type: "improvement", text: "", priority: 0 })}
          addLabel="Add rule"
          itemLabel={(r) => r.id}
          render={(r, update, i) => (
            <div className={cn("-m-3 space-y-2 rounded-xl border-l-4 p-3", FB[r.type]?.cls)}>
              <div className="grid gap-2 pr-20 sm:grid-cols-[1fr_160px_90px]">
                <Text label="Id" value={r.id} onChange={(v) => update({ ...r, id: v })} mono />
                <FieldRow label="Type">
                  <MiniSelect aria-label={`Rule ${i + 1} type`} value={r.type} onChange={(v) => update({ ...r, type: v as FeedbackRule["type"] })} options={Object.entries(FB).map(([k, v]) => ({ value: k, label: v.label }))} />
                </FieldRow>
                <FieldRow label="Priority">
                  <NumberInput aria-label={`Rule ${i + 1} priority`} value={r.priority ?? 0} onChange={(n) => update({ ...r, priority: n ?? 0 })} />
                </FieldRow>
              </div>
              <Text label="Feedback text" value={r.text} onChange={(v) => update({ ...r, text: v })} multiline rows={2} />
              <FieldRow label="Given when">
                <ConditionEditor value={r.when} onChange={(v) => update({ ...r, when: v })} ctx={ctx} allowNull={false} label={`Rule ${i + 1} condition`} />
              </FieldRow>
            </div>
          )}
        />
      </TabCard>
    </div>
  );
}
