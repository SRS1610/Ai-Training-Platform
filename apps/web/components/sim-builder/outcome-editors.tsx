"use client";

import { cn } from "@praxis/ui";
import { CheckCircle2, CircleDot, Eye, Flag, Flame, ListPlus, ListX, Minus, MoveRight, Plus, Variable, XCircle, Zap } from "lucide-react";
import * as React from "react";
import { ConditionEditor } from "./condition-editor";
import { FieldRow, ListEditor, MiniInput, MiniSelect, MiniTextarea, MultiPick, NumberInput, textToValue, useFieldId, valueToText } from "./fields";
import { DIM_COLORS } from "./theme";
import type { Classification, Condition, InputSpec, RefContext, SimEffect, SimMessage, SimOutput } from "./types";

/* ------------------------------------------------------------------ classification */

export const CLASSIFICATIONS: { value: Classification; label: string; on: string; dot: string }[] = [
  { value: "correct", label: "Correct", on: "bg-emerald-600 text-white ring-emerald-600", dot: "bg-emerald-500" },
  { value: "neutral", label: "Neutral", on: "bg-slate-600 text-white ring-slate-600", dot: "bg-slate-400" },
  { value: "incorrect", label: "Incorrect", on: "bg-amber-500 text-white ring-amber-500", dot: "bg-amber-500" },
  { value: "critical", label: "Critical", on: "bg-rose-600 text-white ring-rose-600", dot: "bg-rose-500" },
];

export function ClassificationPicker({ value, onChange, inherit }: { value: Classification | null | undefined; onChange: (v: Classification | null) => void; inherit?: boolean }) {
  const opts = [...(inherit ? [{ value: null, label: "Inherit", on: "bg-white text-brand-700 ring-brand-300", dot: "bg-transparent" }] : []), ...CLASSIFICATIONS];
  return (
    <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Classification">
      {opts.map((o) => {
        const on = (value ?? null) === o.value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value as Classification | null)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold ring-1 ring-inset transition-colors focus-visible:focus-ring",
              on ? o.on : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50",
            )}
          >
            {o.value && <span className={cn("size-1.5 rounded-full", on ? "bg-white" : o.dot)} aria-hidden />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ score deltas */

export function ScoreEditor({
  value,
  onChange,
  ctx,
  nullable,
}: {
  value: Record<string, number> | null | undefined;
  onChange: (v: Record<string, number> | null) => void;
  ctx: RefContext;
  nullable?: boolean;
}) {
  const inherited = nullable && (value === null || value === undefined);
  const v = value ?? {};
  const extra = Object.keys(v).filter((k) => !ctx.dimensions.some((d) => d.id === k));
  return (
    <div className="space-y-2">
      {nullable && (
        <div className="flex gap-1 text-2xs font-semibold">
          <button type="button" aria-pressed={inherited} onClick={() => onChange(null)} className={cn("rounded-md px-2 py-1 ring-1 ring-inset focus-visible:focus-ring", inherited ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-600 ring-slate-200")}>
            Inherit from action
          </button>
          <button type="button" aria-pressed={!inherited} onClick={() => onChange(value ?? {})} className={cn("rounded-md px-2 py-1 ring-1 ring-inset focus-visible:focus-ring", !inherited ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-600 ring-slate-200")}>
            Override
          </button>
        </div>
      )}
      {!inherited && (
        <ul className="space-y-1.5">
          {[...ctx.dimensions.map((d) => ({ id: d.id, name: d.name })), ...extra.map((id) => ({ id, name: `${id} (unknown)` }))].map((d, i) => {
            const n = v[d.id];
            const c = DIM_COLORS[i % DIM_COLORS.length]!;
            return (
              <li key={d.id} className="flex items-center gap-2">
                <span className={cn("size-2.5 shrink-0 rounded-full", c.dot)} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-xs text-slate-700" title={d.id}>
                  {d.name}
                </span>
                <button type="button" aria-label={`Decrease ${d.name}`} className="grid size-6 place-items-center rounded-md text-slate-500 hover:bg-rose-50 hover:text-rose-600 focus-visible:focus-ring" onClick={() => onChange({ ...v, [d.id]: (n ?? 0) - 1 })}>
                  <Minus className="size-3" aria-hidden />
                </button>
                <NumberInput
                  aria-label={`${d.name} score delta`}
                  className={cn("w-16 text-right font-semibold", (n ?? 0) > 0 ? "text-emerald-700" : (n ?? 0) < 0 ? "text-rose-700" : "")}
                  step={0.5}
                  nullable
                  placeholder="0"
                  value={n ?? null}
                  onChange={(x) => {
                    const next = { ...v };
                    if (x === null || x === 0) delete next[d.id];
                    else next[d.id] = x;
                    onChange(next);
                  }}
                />
                <button type="button" aria-label={`Increase ${d.name}`} className="grid size-6 place-items-center rounded-md text-slate-500 hover:bg-emerald-50 hover:text-emerald-600 focus-visible:focus-ring" onClick={() => onChange({ ...v, [d.id]: (n ?? 0) + 1 })}>
                  <Plus className="size-3" aria-hidden />
                </button>
              </li>
            );
          })}
          {!ctx.dimensions.length && <li className="text-2xs italic text-slate-500">Add scoring dimensions in the Scoring tab first.</li>}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ effects */

type EffectKind = "set" | "inc" | "reveal" | "add_problem" | "remove_problem" | "transition" | "trigger_event" | "complete";
const EFFECT_KINDS: { value: EffectKind; label: string; icon: typeof Variable; color: string }[] = [
  { value: "set", label: "Set variables", icon: Variable, color: "text-indigo-600 bg-indigo-50" },
  { value: "inc", label: "Change number", icon: Plus, color: "text-sky-600 bg-sky-50" },
  { value: "reveal", label: "Reveal facts", icon: Eye, color: "text-teal-600 bg-teal-50" },
  { value: "add_problem", label: "Add problem", icon: ListPlus, color: "text-orange-600 bg-orange-50" },
  { value: "remove_problem", label: "Resolve problem", icon: ListX, color: "text-emerald-600 bg-emerald-50" },
  { value: "transition", label: "Force phase", icon: MoveRight, color: "text-fuchsia-600 bg-fuchsia-50" },
  { value: "trigger_event", label: "Trigger event", icon: Zap, color: "text-amber-600 bg-amber-50" },
  { value: "complete", label: "End the run", icon: Flag, color: "text-rose-600 bg-rose-50" },
];

const present = (v: unknown) => v !== null && v !== undefined && !(Array.isArray(v) && !v.length) && !(typeof v === "object" && !Array.isArray(v) && !Object.keys(v as object).length);

/** Split multi-key effects into single-kind entries (same order semantics) for editing. */
export function splitEffects(effects: SimEffect[] | null | undefined): SimEffect[] {
  const out: SimEffect[] = [];
  for (const e of effects ?? []) {
    if (!e) continue;
    for (const k of EFFECT_KINDS.map((x) => x.value)) if (present(e[k])) out.push({ [k]: e[k] } as SimEffect);
  }
  return out;
}

const kindOf = (e: SimEffect): EffectKind => (EFFECT_KINDS.find((k) => present(e[k.value]))?.value ?? "set") as EffectKind;

function defaultEffect(k: EffectKind, ctx: RefContext): SimEffect {
  switch (k) {
    case "set":
      return { set: { [ctx.variables[0]?.id ?? "flag"]: true } };
    case "inc":
      return { inc: { [ctx.variables.find((v) => v.type === "float" || v.type === "int")?.id ?? ctx.variables[0]?.id ?? "counter"]: 1 } };
    case "reveal":
      return { reveal: ctx.facts[0] ? [ctx.facts[0].id] : [] };
    case "add_problem":
      return { add_problem: { id: "new_problem", text: "Describe the problem the learner now faces", severity: "medium" } };
    case "remove_problem":
      return { remove_problem: ctx.problems[0] ?? "problem_id" };
    case "transition":
      return { transition: ctx.phases[0]?.id ?? "" };
    case "trigger_event":
      return { trigger_event: ctx.events[0]?.id ?? "" };
    case "complete":
      return { complete: "success" };
  }
}

function KeyValueRows({
  value,
  onChange,
  ctx,
  numeric,
}: {
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  ctx: RefContext;
  numeric?: boolean;
}) {
  const entries = Object.entries(value);
  const varOptions = ctx.variables.map((v) => ({ value: v.id, label: `${v.id}${v.visibility === "secret" ? " 🔒" : v.visibility === "public" ? " 👁" : ""}` }));
  return (
    <div className="space-y-1.5">
      {entries.map(([k, val], i) => (
        <div key={`${k}-${i}`} className="flex items-center gap-1.5">
          <MiniSelect
            aria-label="Variable"
            className="min-w-0 flex-1"
            value={k}
            options={varOptions}
            onChange={(nk) => {
              const next: Record<string, unknown> = {};
              entries.forEach(([ek, ev], j) => (next[j === i ? nk : ek] = ev));
              onChange(next);
            }}
          />
          <span className="text-xs font-semibold text-slate-400">{numeric ? "+=" : "="}</span>
          {numeric ? (
            <NumberInput aria-label={`Change for ${k}`} className="w-20" step={0.5} value={Number(val) || 0} onChange={(n) => onChange({ ...value, [k]: n ?? 0 })} />
          ) : (
            <MiniInput aria-label={`Value for ${k}`} mono className="min-w-0 flex-1" defaultValue={valueToText(val)} key={valueToText(val)} onBlur={(e) => onChange({ ...value, [k]: textToValue(e.target.value) })} placeholder="true / 42 / text" />
          )}
          <button
            type="button"
            className="grid size-6 shrink-0 place-items-center rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-600 focus-visible:focus-ring"
            aria-label={`Remove ${k}`}
            onClick={() => onChange(Object.fromEntries(entries.filter((_, j) => j !== i)))}
          >
            <XCircle className="size-3.5" aria-hidden />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="text-2xs font-semibold text-brand-700 hover:underline"
        onClick={() => {
          const free = ctx.variables.find((v) => !(v.id in value))?.id ?? `var_${entries.length + 1}`;
          onChange({ ...value, [free]: numeric ? 1 : true });
        }}
      >
        + Add variable
      </button>
    </div>
  );
}

function EffectBody({ e, onChange, ctx }: { e: SimEffect; onChange: (e: SimEffect) => void; ctx: RefContext }) {
  const k = kindOf(e);
  switch (k) {
    case "set":
      return <KeyValueRows value={e.set ?? {}} onChange={(v) => onChange({ set: v })} ctx={ctx} />;
    case "inc":
      return <KeyValueRows numeric value={(e.inc ?? {}) as Record<string, unknown>} onChange={(v) => onChange({ inc: v as Record<string, number> })} ctx={ctx} />;
    case "reveal":
      return (
        <MultiPick
          aria-label="Facts to reveal"
          value={e.reveal ?? []}
          onChange={(v) => onChange({ reveal: v })}
          options={ctx.facts.map((f) => ({ value: f.id, label: `${f.character}: ${f.text}` }))}
          placeholder="Choose facts…"
        />
      );
    case "add_problem": {
      const p = e.add_problem ?? { id: "", text: "" };
      return (
        <div className="space-y-1.5">
          <div className="flex gap-1.5">
            <MiniInput aria-label="Problem id" mono className="flex-1" defaultValue={p.id} onBlur={(ev) => onChange({ add_problem: { ...p, id: ev.target.value.trim() } })} placeholder="problem_id" />
            <MiniSelect
              aria-label="Severity"
              className="w-28"
              value={p.severity ?? "medium"}
              onChange={(s) => onChange({ add_problem: { ...p, severity: s as "low" } })}
              options={["low", "medium", "high", "critical"].map((s) => ({ value: s, label: s }))}
            />
          </div>
          <MiniTextarea aria-label="Problem text" rows={2} defaultValue={p.text} onBlur={(ev) => onChange({ add_problem: { ...p, text: ev.target.value } })} />
        </div>
      );
    }
    case "remove_problem":
      return ctx.problems.length ? (
        <MiniSelect aria-label="Problem to resolve" value={e.remove_problem ?? ""} onChange={(v) => onChange({ remove_problem: v })} options={ctx.problems.map((p) => ({ value: p, label: p }))} />
      ) : (
        <MiniInput aria-label="Problem id" mono defaultValue={e.remove_problem ?? ""} onBlur={(ev) => onChange({ remove_problem: ev.target.value.trim() })} />
      );
    case "transition":
      return <MiniSelect aria-label="Phase" value={e.transition ?? ""} onChange={(v) => onChange({ transition: v })} options={ctx.phases.map((p) => ({ value: p.id, label: p.name }))} />;
    case "trigger_event":
      return <MiniSelect aria-label="Event" value={e.trigger_event ?? ""} onChange={(v) => onChange({ trigger_event: v })} options={ctx.events.map((x) => ({ value: x.id, label: x.title }))} />;
    case "complete":
      return (
        <MiniSelect
          aria-label="End result"
          value={e.complete ?? "success"}
          onChange={(v) => onChange({ complete: v as "success" })}
          options={[
            { value: "success", label: "Success" },
            { value: "failure", label: "Failure" },
            { value: "escalated", label: "Escalated" },
          ]}
        />
      );
  }
}

export function EffectsEditor({ value, onChange, ctx }: { value: SimEffect[] | null | undefined; onChange: (v: SimEffect[]) => void; ctx: RefContext }) {
  const items = React.useMemo(() => splitEffects(value), [value]);
  return (
    <ListEditor
      items={items}
      onChange={onChange}
      make={() => defaultEffect("set", ctx)}
      addLabel="Add effect"
      itemLabel={(e, i) => `effect ${i + 1} (${EFFECT_KINDS.find((k) => k.value === kindOf(e))?.label})`}
      empty={<p className="text-2xs italic text-slate-500">No state changes.</p>}
      render={(e, update) => {
        const k = kindOf(e);
        const meta = EFFECT_KINDS.find((x) => x.value === k)!;
        return (
          <div className="space-y-2 pr-20">
            <div className="flex items-center gap-2">
              <span className={cn("grid size-6 place-items-center rounded-md", meta.color)}>
                <meta.icon className="size-3.5" aria-hidden />
              </span>
              <MiniSelect aria-label="Effect type" className="flex-1" value={k} onChange={(nk) => update(defaultEffect(nk as EffectKind, ctx))} options={EFFECT_KINDS.map((x) => ({ value: x.value, label: x.label }))} />
            </div>
            <div className="-mr-20">
              <EffectBody e={e} onChange={update} ctx={ctx} />
            </div>
          </div>
        );
      }}
    />
  );
}

/* ------------------------------------------------------------------ outputs & messages */

export function OutputsEditor({
  value,
  onChange,
  ctx,
  nullable,
}: {
  value: SimOutput[] | null | undefined;
  onChange: (v: SimOutput[] | null) => void;
  ctx: RefContext;
  nullable?: boolean;
}) {
  const inherited = nullable && (value === null || value === undefined);
  return (
    <div className="space-y-2">
      {nullable && (
        <div className="flex gap-1 text-2xs font-semibold">
          <button type="button" aria-pressed={inherited} onClick={() => onChange(null)} className={cn("rounded-md px-2 py-1 ring-1 ring-inset focus-visible:focus-ring", inherited ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-600 ring-slate-200")}>
            Inherit from action
          </button>
          <button type="button" aria-pressed={!inherited} onClick={() => onChange(value ?? [])} className={cn("rounded-md px-2 py-1 ring-1 ring-inset focus-visible:focus-ring", !inherited ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-600 ring-slate-200")}>
            Override
          </button>
        </div>
      )}
      {!inherited && (
        <>
          <p className="text-2xs text-slate-500">First matching output is shown. Put conditional outputs first and a fallback last. Use {"{{variable}}"} to interpolate.</p>
          <ListEditor
            items={value ?? []}
            onChange={onChange}
            make={(): SimOutput => ({ text: "", when: null, format: "text", panel: null })}
            addLabel="Add output"
            itemLabel={(_, i) => `output ${i + 1}`}
            render={(o, update, i) => (
              <div className="space-y-2">
                <div className="flex gap-1.5 pr-20">
                  <MiniSelect aria-label={`Output ${i + 1} format`} className="w-28" value={o.format ?? "text"} onChange={(f) => update({ ...o, format: f as SimOutput["format"] })} options={["text", "terminal", "markdown"].map((x) => ({ value: x, label: x }))} />
                  <MiniSelect aria-label={`Output ${i + 1} panel`} className="flex-1" value={o.panel ?? ""} placeholder="Default panel" onChange={(p) => update({ ...o, panel: p || null })} options={ctx.panels.map((p) => ({ value: p.id, label: p.title }))} />
                </div>
                <MiniTextarea aria-label={`Output ${i + 1} text`} mono={o.format === "terminal"} rows={o.format === "terminal" ? 5 : 3} value={o.text} onChange={(e) => update({ ...o, text: e.target.value })} />
                <ConditionEditor value={o.when} onChange={(w) => update({ ...o, when: w })} ctx={ctx} label={`Output ${i + 1} condition`} alwaysLabel="Always" />
              </div>
            )}
          />
        </>
      )}
    </div>
  );
}

export function MessagesEditor({ value, onChange, ctx }: { value: SimMessage[] | null | undefined; onChange: (v: SimMessage[]) => void; ctx: RefContext }) {
  return (
    <ListEditor
      items={value ?? []}
      onChange={onChange}
      make={() => ({ character: ctx.characters[0]?.id ?? null, text: "", when: null })}
      addLabel="Add message"
      itemLabel={(_, i) => `message ${i + 1}`}
      empty={<p className="text-2xs italic text-slate-500">No messages. Every matching message is sent.</p>}
      render={(m, update, i) => (
        <div className="space-y-2">
          <MiniSelect
            aria-label={`Message ${i + 1} sender`}
            className="mr-20"
            value={m.character ?? ""}
            placeholder="System notice"
            onChange={(c) => update({ ...m, character: c || null })}
            options={ctx.characters.map((c) => ({ value: c.id, label: c.name }))}
          />
          <MiniTextarea aria-label={`Message ${i + 1} text`} rows={2} value={m.text} onChange={(e) => update({ ...m, text: e.target.value })} />
          <ConditionEditor value={m.when} onChange={(w) => update({ ...m, when: w })} ctx={ctx} label={`Message ${i + 1} condition`} />
        </div>
      )}
    />
  );
}

/* ------------------------------------------------------------------ input spec */

export function InputSpecEditor({ value, onChange, ctx }: { value: InputSpec | undefined; onChange: (v: InputSpec) => void; ctx: RefContext }) {
  const v: InputSpec = { type: "none", intents: [], patterns: [], choices: [], placeholder: "", min_length: 0, ...(value ?? {}) };
  const typeId = useFieldId();
  return (
    <div className="space-y-3">
      <FieldRow label="Input type" htmlFor={typeId}>
        <MiniSelect
          id={typeId}
          value={v.type}
          onChange={(t) => onChange({ ...v, type: t as InputSpec["type"] })}
          options={[
            { value: "none", label: "None — a button" },
            { value: "free_text", label: "Free text — chat / document" },
            { value: "command", label: "Command — typed in a tool" },
            { value: "choice", label: "Choice — pick from options" },
          ]}
        />
      </FieldRow>
      {v.type === "free_text" && (
        <FieldRow label="Matched intents" hint="Chat messages matching any intent trigger this action. Documents use the minimum length instead.">
          <MultiPick aria-label="Intents" value={v.intents ?? []} onChange={(x) => onChange({ ...v, intents: x })} options={ctx.intents.map((i) => ({ value: i.id, label: i.id }))} placeholder="Choose intents…" />
        </FieldRow>
      )}
      {v.type === "command" && (
        <FieldRow label="Command patterns" hint="Case-insensitive full-match regexes, e.g. nslookup\s+(?P<host>\S+). Named groups become $input.named.*">
          <ListEditorStrings value={v.patterns ?? []} onChange={(x) => onChange({ ...v, patterns: x })} mono placeholder="ipconfig\s+/all" />
        </FieldRow>
      )}
      {v.type === "choice" && (
        <FieldRow label="Choices" hint="The learner's pick is available as $input.choice.">
          <ListEditor
            items={v.choices ?? []}
            onChange={(c) => onChange({ ...v, choices: c })}
            make={() => ({ id: `option_${(v.choices?.length ?? 0) + 1}`, label: "" })}
            addLabel="Add choice"
            itemLabel={(c) => c.label || c.id}
            render={(c, update, i) => (
              <div className="flex gap-1.5 pr-20">
                <MiniInput aria-label={`Choice ${i + 1} id`} mono className="w-28" value={c.id} onChange={(e) => update({ ...c, id: e.target.value })} />
                <MiniInput aria-label={`Choice ${i + 1} label`} className="flex-1" value={c.label} onChange={(e) => update({ ...c, label: e.target.value })} />
              </div>
            )}
          />
        </FieldRow>
      )}
      {v.type !== "none" && (
        <div className="grid grid-cols-[1fr_96px] gap-2">
          <FieldRow label="Placeholder">
            <MiniInput aria-label="Placeholder" value={v.placeholder ?? ""} onChange={(e) => onChange({ ...v, placeholder: e.target.value })} />
          </FieldRow>
          <FieldRow label="Min length">
            <NumberInput aria-label="Minimum length" min={0} value={v.min_length ?? 0} onChange={(n) => onChange({ ...v, min_length: Math.max(0, n ?? 0) })} />
          </FieldRow>
        </div>
      )}
    </div>
  );
}

/** Small string list editor using mini inputs. */
export function ListEditorStrings({ value, onChange, mono, placeholder }: { value: string[]; onChange: (v: string[]) => void; mono?: boolean; placeholder?: string }) {
  const [draft, setDraft] = React.useState("");
  return (
    <div className="space-y-1.5">
      {value.map((s, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <MiniInput aria-label={`Item ${i + 1}`} mono={mono} className="flex-1" value={s} onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))} />
          <button type="button" aria-label={`Remove item ${i + 1}`} className="grid size-6 place-items-center rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-600 focus-visible:focus-ring" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <XCircle className="size-3.5" aria-hidden />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <MiniInput
          aria-label="New item"
          mono={mono}
          className="flex-1"
          value={draft}
          placeholder={placeholder ?? "Add and press Enter"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              e.preventDefault();
              onChange([...value, draft.trim()]);
              setDraft("");
            }
          }}
        />
        <button
          type="button"
          aria-label="Add item"
          disabled={!draft.trim()}
          className="grid size-7 place-items-center rounded-md bg-slate-100 text-slate-600 hover:bg-brand-50 hover:text-brand-700 focus-visible:focus-ring disabled:opacity-40"
          onClick={() => {
            onChange([...value, draft.trim()]);
            setDraft("");
          }}
        >
          <Plus className="size-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}

export function ConditionField({ label, value, onChange, ctx, hint, alwaysLabel }: { label: string; value: Condition; onChange: (c: Condition) => void; ctx: RefContext; hint?: string; alwaysLabel?: string }) {
  return (
    <FieldRow label={label} hint={hint}>
      <ConditionEditor value={value} onChange={onChange} ctx={ctx} label={label} alwaysLabel={alwaysLabel} />
    </FieldRow>
  );
}

export const CLASS_ICON = { correct: CheckCircle2, neutral: CircleDot, incorrect: XCircle, critical: Flame } as const;
