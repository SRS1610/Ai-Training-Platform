"use client";

/**
 * JSON-logic condition editor: a rule builder for the common shapes (variable comparisons, action taken,
 * phase, facts, events, problems; combined with all/any and per-rule NOT) plus a raw JSON mode for
 * anything more advanced. Values round-trip exactly to the engine's condition DSL.
 */
import { cn } from "@praxis/ui";
import { Braces, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import * as React from "react";
import { JsonField, MiniInput, MiniSelect, NumberInput, textToValue, valueToText } from "./fields";
import { summarizeCondition, truncate } from "./graph-utils";
import type { Condition, RefContext } from "./types";

type CompareOp = "==" | "!=" | "<" | "<=" | ">" | ">=" | "contains" | "in" | "truthy" | "falsy";

type Rule =
  | { kind: "var"; var: string; op: CompareOp; value: unknown; negate?: boolean }
  | { kind: "action_taken"; id: string; count: number; negate?: boolean }
  | { kind: "phase_is"; ids: string[]; negate?: boolean }
  | { kind: "visited_phase"; id: string; negate?: boolean }
  | { kind: "has_fact"; id: string; negate?: boolean }
  | { kind: "event_fired"; id: string; negate?: boolean }
  | { kind: "has_problem"; id: string; negate?: boolean };

type Mode = "always" | "never" | "all" | "any";
interface Model {
  mode: Mode;
  rules: Rule[];
}

const SPECIAL_VARS = ["$input.text", "$input.choice", "$minutes", "$phase", "$actions_count", "$problems_count", "$unknown_inputs"];
const CMP = ["==", "!=", "<", "<=", ">", ">="];

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const varName = (v: unknown): string | null => {
  if (!isObj(v) || Object.keys(v).length !== 1 || !("var" in v)) return null;
  const x = v.var;
  return typeof x === "string" ? x : null;
};
const isPrimitive = (v: unknown) => v === null || ["string", "number", "boolean"].includes(typeof v);

function parseRule(c: unknown, negate = false): Rule | null {
  if (!isObj(c) || Object.keys(c).length !== 1) return null;
  const [op, args] = Object.entries(c)[0]!;
  if (op === "!" || op === "not") {
    if (negate) return null;
    const inner = Array.isArray(args) && args.length === 1 ? args[0] : args;
    const v = varName(inner);
    if (v) return { kind: "var", var: v, op: "falsy", value: null };
    return parseRule(inner, true);
  }
  if (op === "var") {
    const v = varName(c);
    return v ? { kind: "var", var: v, op: "truthy", value: null, negate } : null;
  }
  if ([...CMP, "contains", "in"].includes(op) && Array.isArray(args) && args.length === 2) {
    const v = varName(args[0]);
    if (!v) return null;
    if (op === "in" ? !Array.isArray(args[1]) && !isPrimitive(args[1]) : !isPrimitive(args[1])) return null;
    return { kind: "var", var: v, op: op as CompareOp, value: args[1], negate };
  }
  if (op === "action_taken") {
    if (typeof args === "string") return { kind: "action_taken", id: args, count: 1, negate };
    if (Array.isArray(args) && typeof args[0] === "string" && typeof args[1] === "number") return { kind: "action_taken", id: args[0], count: args[1], negate };
    return null;
  }
  if (op === "phase_is") {
    if (typeof args === "string") return { kind: "phase_is", ids: [args], negate };
    if (Array.isArray(args) && args.every((x) => typeof x === "string")) return { kind: "phase_is", ids: args as string[], negate };
    return null;
  }
  if (["visited_phase", "has_fact", "event_fired", "has_problem"].includes(op) && typeof args === "string")
    return { kind: op as "visited_phase", id: args, negate };
  return null;
}

export function parseCondition(c: Condition): Model | null {
  if (c === null || c === undefined || c === true) return { mode: "always", rules: [] };
  if (c === false) return { mode: "never", rules: [] };
  if (isObj(c) && Object.keys(c).length === 1 && ("and" in c || "or" in c)) {
    const list = (c.and ?? c.or) as unknown;
    if (!Array.isArray(list)) return null;
    const rules = list.map((x) => parseRule(x));
    if (rules.some((r) => !r)) return null;
    return { mode: "and" in c ? "all" : "any", rules: rules as Rule[] };
  }
  const r = parseRule(c);
  return r ? { mode: "all", rules: [r] } : null;
}

function ruleToJson(r: Rule): unknown {
  let out: unknown;
  switch (r.kind) {
    case "var":
      if (r.op === "truthy") out = { var: r.var };
      else if (r.op === "falsy") return r.negate ? { var: r.var } : { "!": { var: r.var } };
      else out = { [r.op]: [{ var: r.var }, r.value] };
      break;
    case "action_taken":
      out = { action_taken: r.count > 1 ? [r.id, r.count] : r.id };
      break;
    case "phase_is":
      out = { phase_is: r.ids.length === 1 ? r.ids[0] : r.ids };
      break;
    default:
      out = { [r.kind]: r.id };
  }
  return r.negate ? { "!": out } : out;
}

export function serializeCondition(m: Model, allowNull: boolean): Condition {
  if (m.mode === "always" || (m.rules.length === 0 && m.mode !== "never")) return allowNull ? null : true;
  if (m.mode === "never") return false;
  const rules = m.rules.map(ruleToJson);
  if (rules.length === 1) return rules[0];
  return m.mode === "all" ? { and: rules } : { or: rules };
}

const RULE_KINDS: { value: Rule["kind"]; label: string }[] = [
  { value: "var", label: "Variable" },
  { value: "action_taken", label: "Action taken" },
  { value: "phase_is", label: "Current phase" },
  { value: "visited_phase", label: "Visited phase" },
  { value: "has_fact", label: "Fact revealed" },
  { value: "event_fired", label: "Event fired" },
  { value: "has_problem", label: "Problem open" },
];

function defaultRule(kind: Rule["kind"], ctx: RefContext): Rule {
  switch (kind) {
    case "var":
      return { kind, var: ctx.variables[0]?.id ?? "$minutes", op: "==", value: true };
    case "action_taken":
      return { kind, id: ctx.actions[0]?.id ?? "", count: 1 };
    case "phase_is":
      return { kind, ids: ctx.phases[0] ? [ctx.phases[0].id] : [] };
    case "visited_phase":
      return { kind, id: ctx.phases[0]?.id ?? "" };
    case "has_fact":
      return { kind, id: ctx.facts[0]?.id ?? "" };
    case "event_fired":
      return { kind, id: ctx.events[0]?.id ?? "" };
    case "has_problem":
      return { kind, id: ctx.problems[0] ?? "" };
  }
}

function RuleRow({ rule, onChange, onRemove, ctx, index }: { rule: Rule; onChange: (r: Rule) => void; onRemove: () => void; ctx: RefContext; index: number }) {
  const varOptions = [
    ...ctx.variables.map((v) => ({ value: v.id, label: `${v.id}${v.visibility === "secret" ? " 🔒" : ""}` })),
    ...SPECIAL_VARS.map((v) => ({ value: v, label: v })),
  ];
  const idOptions =
    rule.kind === "action_taken"
      ? ctx.actions.map((a) => ({ value: a.id, label: truncate(`${a.label} (${a.id})`, 48) }))
      : rule.kind === "visited_phase"
        ? ctx.phases.map((p) => ({ value: p.id, label: p.name }))
        : rule.kind === "has_fact"
          ? ctx.facts.map((f) => ({ value: f.id, label: truncate(`${f.character}: ${f.text}`, 48) }))
          : rule.kind === "event_fired"
            ? ctx.events.map((e) => ({ value: e.id, label: e.title }))
            : ctx.problems.map((p) => ({ value: p, label: p }));
  return (
    <li className="rounded-lg border border-slate-200 bg-white p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          aria-pressed={!!rule.negate}
          onClick={() => onChange({ ...rule, negate: !rule.negate } as Rule)}
          className={cn(
            "h-7 rounded-md px-2 text-2xs font-bold uppercase tracking-wide ring-1 ring-inset focus-visible:focus-ring",
            rule.negate ? "bg-rose-600 text-white ring-rose-600" : "bg-white text-slate-500 ring-slate-200 hover:bg-slate-50",
          )}
          title="Negate this rule"
        >
          not
        </button>
        <MiniSelect
          aria-label={`Rule ${index + 1} type`}
          className="w-36"
          value={rule.kind}
          onChange={(k) => onChange({ ...defaultRule(k as Rule["kind"], ctx), negate: rule.negate } as Rule)}
          options={RULE_KINDS}
        />
        <button type="button" onClick={onRemove} aria-label={`Remove rule ${index + 1}`} className="ml-auto grid size-7 place-items-center rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-600 focus-visible:focus-ring">
          <Trash2 className="size-3.5" aria-hidden />
        </button>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {rule.kind === "var" && (
          <>
            <MiniSelect aria-label="Variable" className="min-w-0 flex-1 basis-32" value={rule.var} onChange={(v) => onChange({ ...rule, var: v })} options={varOptions} />
            <MiniSelect
              aria-label="Operator"
              className="w-24"
              value={rule.op}
              onChange={(op) => onChange({ ...rule, op: op as CompareOp, value: op === "in" ? (Array.isArray(rule.value) ? rule.value : []) : rule.value })}
              options={[
                { value: "truthy", label: "is true" },
                { value: "falsy", label: "is false" },
                { value: "==", label: "=" },
                { value: "!=", label: "≠" },
                { value: "<", label: "<" },
                { value: "<=", label: "≤" },
                { value: ">", label: ">" },
                { value: ">=", label: "≥" },
                { value: "contains", label: "contains" },
                { value: "in", label: "in list" },
              ]}
            />
            {!["truthy", "falsy"].includes(rule.op) && (
              <MiniInput
                aria-label="Value"
                className="min-w-0 flex-1 basis-24"
                mono
                placeholder={rule.op === "in" ? '["a","b"]' : "value"}
                defaultValue={valueToText(rule.value)}
                key={`${rule.op}-${valueToText(rule.value)}`}
                onBlur={(e) => onChange({ ...rule, value: textToValue(e.target.value) })}
              />
            )}
          </>
        )}
        {rule.kind === "action_taken" && (
          <>
            <MiniSelect aria-label="Action" className="min-w-0 flex-1 basis-40" value={rule.id} onChange={(id) => onChange({ ...rule, id })} options={idOptions} placeholder="Choose action" />
            <span className="text-2xs text-slate-500">at least</span>
            <NumberInput aria-label="Minimum count" className="w-14" min={1} value={rule.count} onChange={(n) => onChange({ ...rule, count: Math.max(1, n ?? 1) })} />
            <span className="text-2xs text-slate-500">×</span>
          </>
        )}
        {rule.kind === "phase_is" && (
          <div className="flex flex-wrap gap-1" role="group" aria-label="Phases">
            {ctx.phases.map((p) => {
              const on = rule.ids.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onChange({ ...rule, ids: on ? rule.ids.filter((x) => x !== p.id) : [...rule.ids, p.id] })}
                  className={cn("rounded-md px-2 py-1 text-2xs font-semibold ring-1 ring-inset focus-visible:focus-ring", on ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-slate-600 ring-slate-200")}
                >
                  {p.name}
                </button>
              );
            })}
          </div>
        )}
        {["visited_phase", "has_fact", "event_fired", "has_problem"].includes(rule.kind) && "id" in rule && (
          rule.kind === "has_problem" && !idOptions.length ? (
            <MiniInput aria-label="Problem id" mono className="flex-1" defaultValue={rule.id} onBlur={(e) => onChange({ ...rule, id: e.target.value.trim() })} placeholder="problem_id" />
          ) : (
            <MiniSelect aria-label="Reference" className="min-w-0 flex-1" value={rule.id} onChange={(id) => onChange({ ...rule, id } as Rule)} options={idOptions} placeholder="Choose…" />
          )
        )}
      </div>
    </li>
  );
}

export function ConditionEditor({
  value,
  onChange,
  ctx,
  allowNull = true,
  alwaysLabel = "Always",
  label,
}: {
  value: Condition;
  onChange: (c: Condition) => void;
  ctx: RefContext;
  allowNull?: boolean;
  alwaysLabel?: string;
  label?: string;
}) {
  const parsed = React.useMemo(() => parseCondition(value), [value]);
  const [raw, setRaw] = React.useState(parsed === null);
  React.useEffect(() => {
    if (parsed === null) setRaw(true);
  }, [parsed]);
  const model = parsed ?? { mode: "all" as Mode, rules: [] };
  const commit = (m: Model) => onChange(serializeCondition(m, allowNull));
  const modes: { value: Mode; label: string }[] = [
    { value: "always", label: alwaysLabel },
    { value: "all", label: "All of" },
    { value: "any", label: "Any of" },
    { value: "never", label: "Never" },
  ];
  const mode = model.mode;

  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-2.5" role="group" aria-label={label ?? "Condition"}>
      <div className="flex items-center gap-2">
        {!raw && (
          <div className="flex rounded-lg bg-white p-0.5 ring-1 ring-slate-200" role="radiogroup" aria-label="Condition mode">
            {modes.map((m) => (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={mode === m.value}
                onClick={() => {
                  if (m.value === "all" || m.value === "any") commit({ mode: m.value, rules: model.rules.length ? model.rules : [defaultRule("var", ctx)] });
                  else commit({ mode: m.value, rules: [] });
                }}
                className={cn(
                  "rounded-md px-2 py-1 text-2xs font-semibold transition-colors focus-visible:focus-ring",
                  mode === m.value ? (m.value === "never" ? "bg-rose-600 text-white" : "bg-brand-600 text-white") : "text-slate-600 hover:bg-slate-100",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => setRaw((r) => (parsed === null ? true : !r))}
          className={cn("ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-2xs font-semibold text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-white focus-visible:focus-ring", raw && "bg-white text-brand-700")}
          aria-pressed={raw}
          title={parsed === null ? "This condition uses advanced logic — edit it as JSON" : "Switch between the rule builder and raw JSON"}
        >
          {raw ? <SlidersHorizontal className="size-3" aria-hidden /> : <Braces className="size-3" aria-hidden />}
          {raw ? "Builder" : "JSON"}
        </button>
      </div>

      {raw ? (
        <>
          {parsed === null && <p className="text-2xs text-amber-800">Advanced condition — the rule builder can&apos;t represent it, so edit it as JSON.</p>}
          <JsonField value={value ?? null} onChange={onChange} rows={4} aria-label={`${label ?? "Condition"} JSON`} />
        </>
      ) : (
        (mode === "all" || mode === "any") && (
          <>
            <ul className="space-y-1.5">
              {model.rules.map((r, i) => (
                <RuleRow
                  key={i}
                  index={i}
                  rule={r}
                  ctx={ctx}
                  onChange={(nr) => commit({ ...model, rules: model.rules.map((x, j) => (j === i ? nr : x)) })}
                  onRemove={() => commit({ ...model, rules: model.rules.filter((_, j) => j !== i) })}
                />
              ))}
            </ul>
            <button
              type="button"
              onClick={() => commit({ ...model, rules: [...model.rules, defaultRule("var", ctx)] })}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-2xs font-semibold text-brand-700 hover:bg-brand-50 focus-visible:focus-ring"
            >
              <Plus className="size-3" aria-hidden /> Add rule
            </button>
          </>
        )
      )}
      <p className="truncate text-2xs text-slate-500" title={summarizeCondition(value)}>
        <span className="font-semibold text-slate-600">Reads as:</span> {summarizeCondition(value)}
      </p>
    </div>
  );
}
