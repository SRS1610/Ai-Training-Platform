"use client";

import {
  Button,
  FormField,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SimpleSelect,
  Switch,
  Textarea,
  cn,
  colorClasses,
} from "@praxis/ui";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Check, CheckCircle2, FlaskConical, GitBranch, Plus, Trash2, X, XCircle } from "lucide-react";
import * as React from "react";
import { api } from "@/lib/api";
import { CodeEditor } from "../code-editor";
import { uid } from "../hooks";
import { MarkdownEditor } from "../markdown-editor";
import { CODE_LANGUAGES } from "../meta";
import { NumberInput, StringListEditor, TagInput } from "../shared";
import type { Page, QuestionType, SimulationLite } from "../types";

type O = Record<string, unknown>;
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const str = (v: unknown) => (typeof v === "string" ? v : "");

export interface QState {
  options: O;
  answer_key: O;
}

/* ------------------------------------------------------------------ defaults */

export function defaultsFor(type: QuestionType): QState {
  const choices = () => ["a", "b", "c", "d"].map((id) => ({ id, text: "" }));
  switch (type) {
    case "multiple_choice":
      return { options: { choices: choices() }, answer_key: { choice_id: "a" } };
    case "multiple_select":
      return { options: { choices: choices() }, answer_key: { choice_ids: ["a"], partial_credit: true } };
    case "true_false":
      return { options: {}, answer_key: { value: true } };
    case "short_answer":
      return { options: {}, answer_key: { accepted: [], regex: "", case_sensitive: false } };
    case "long_answer":
      return { options: { min_words: 80, max_words: 400 }, answer_key: { model_answer: "" } };
    case "matching":
      return {
        options: { left: [{ id: "l1", text: "" }, { id: "l2", text: "" }], right: [{ id: "r1", text: "" }, { id: "r2", text: "" }] },
        answer_key: { pairs: { l1: "r1", l2: "r2" }, partial_credit: true },
      };
    case "ordering":
      return { options: { items: [1, 2, 3].map((n) => ({ id: `i${n}`, text: "" })) }, answer_key: { order: ["i1", "i2", "i3"], scoring: "positions" } };
    case "fill_blank":
      return { options: { text: "The capital of France is {{b1}}.", blanks: [{ id: "b1" }] }, answer_key: { blanks: { b1: { accepted: ["Paris"], case_sensitive: false } }, partial_credit: true } };
    case "code":
      return { options: { language: "python", starter_code: "def solve():\n    pass\n" }, answer_key: { test_cases: [], auto_grade: false } };
    case "file_upload":
      return { options: { allowed_types: [".pdf", ".docx", ".png"], max_files: 3, instructions: "" }, answer_key: {} };
    case "scenario":
      return { options: { scenario: "" }, answer_key: { model_answer: "" } };
    case "decision_tree":
      return {
        options: {
          start: "n1",
          nodes: {
            n1: { prompt: "A user reports their account is locked. What do you do first?", choices: [{ id: "c1", text: "Verify the user's identity", next: "n2" }, { id: "c2", text: "Unlock it immediately", next: null }] },
            n2: { prompt: "Identity verified. Next step?", choices: [{ id: "c1", text: "Check the lockout source in the logs", next: null }, { id: "c2", text: "Reset the password without checking", next: null }] },
          },
        },
        answer_key: { points: { n1: { c1: 1, c2: 0 }, n2: { c1: 2, c2: 0 } } },
      };
    case "practical_task":
      return { options: { task: "", checklist: [] }, answer_key: { model_answer: "" } };
    case "simulation":
      return { options: { simulation_id: "" }, answer_key: {} };
  }
}

/* ------------------------------------------------------------------ validation (mirrors assessments/validation.py) */

function textSpecOk(spec: O | undefined): boolean {
  if (!spec) return false;
  const acc = arr<string>(spec.accepted).filter((a) => String(a).trim());
  return acc.length > 0 || !!str(spec.regex).trim();
}

export function questionProblems(type: string, o: O, k: O): string[] {
  const p: string[] = [];
  const choiceIds = (key: string, min: number) => {
    const list = arr<{ id?: string; text?: string }>(o[key]);
    if (list.length < min) p.push(`Add at least ${min} ${key === "choices" ? "choices" : "items"}`);
    if (list.some((c) => !str(c.text).trim())) p.push(`Every ${key === "choices" ? "choice" : "item"} needs text`);
    return list.map((c) => String(c.id));
  };
  switch (type) {
    case "multiple_choice": {
      const ids = choiceIds("choices", 2);
      if (!ids.includes(String(k.choice_id))) p.push("Mark the correct choice");
      break;
    }
    case "multiple_select": {
      const ids = choiceIds("choices", 2);
      const sel = arr<string>(k.choice_ids);
      if (!sel.length || !sel.every((s) => ids.includes(String(s)))) p.push("Mark at least one correct choice");
      break;
    }
    case "true_false":
      if (typeof k.value !== "boolean") p.push("Choose true or false");
      break;
    case "short_answer":
      if (!textSpecOk(k)) p.push("Add at least one accepted answer or a pattern");
      if (str(k.regex)) {
        try {
          new RegExp(str(k.regex));
        } catch {
          p.push("The answer pattern is not a valid regular expression");
        }
      }
      break;
    case "matching": {
      const left = choiceIds("left", 1);
      choiceIds("right", 1);
      const pairs = (k.pairs ?? {}) as Record<string, string>;
      if (left.some((l) => !pairs[l])) p.push("Every left item needs a match");
      break;
    }
    case "ordering":
      choiceIds("items", 2);
      break;
    case "fill_blank": {
      const blanks = arr<{ id: string }>(o.blanks).map((b) => b.id);
      if (!blanks.length) p.push("Add at least one blank with “Insert blank”");
      const specs = (k.blanks ?? {}) as Record<string, O>;
      blanks.forEach((b, i) => {
        if (!textSpecOk(specs[b])) p.push(`Blank ${i + 1} needs an accepted answer`);
      });
      break;
    }
    case "decision_tree": {
      const nodes = (o.nodes ?? {}) as Record<string, { prompt?: string; choices?: { id: string; text?: string; next?: string | null }[] }>;
      const ids = Object.keys(nodes);
      if (!ids.length) p.push("Add at least one decision");
      if (!ids.includes(String(o.start))) p.push("Choose the starting decision");
      for (const [nid, n] of Object.entries(nodes)) {
        if (!arr(n.choices).length) p.push(`Decision ${ids.indexOf(nid) + 1} needs choices`);
        for (const c of arr<{ next?: string | null }>(n.choices)) if (c.next && !ids.includes(c.next)) p.push("A choice points to a missing decision");
      }
      const pts = (k.points ?? {}) as Record<string, Record<string, number>>;
      const anyPts = Object.values(pts).some((m) => Object.values(m ?? {}).some((v) => Number(v) > 0));
      if (!anyPts && !k.max_points) p.push("Give at least one choice points");
      break;
    }
    case "code": {
      const cases = arr<{ pattern?: string; match?: string }>(k.test_cases);
      cases.forEach((c, i) => {
        if (!str(c.pattern)) p.push(`Check ${i + 1} needs a pattern`);
        if (c.match === "regex") {
          try {
            new RegExp(str(c.pattern));
          } catch {
            p.push(`Check ${i + 1} is not a valid regular expression`);
          }
        }
      });
      if (k.auto_grade && !cases.length) p.push("Auto-grading needs at least one check");
      break;
    }
    case "simulation":
      if (!str(o.simulation_id)) p.push("Choose a simulation");
      break;
  }
  return [...new Set(p)];
}

/* ------------------------------------------------------------------ small helpers */

function CorrectToggle({ on, onClick, multi, label }: { on: boolean; onClick: () => void; multi?: boolean; label: string }) {
  return (
    <button
      type="button"
      role={multi ? "checkbox" : "radio"}
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "grid size-8 shrink-0 place-items-center border-2 transition-all focus-visible:focus-ring",
        multi ? "rounded-lg" : "rounded-full",
        on ? "border-emerald-500 bg-emerald-500 text-white shadow-sm" : "border-slate-300 bg-white text-transparent hover:border-emerald-400",
      )}
    >
      <Check className="size-4" strokeWidth={3} aria-hidden />
    </button>
  );
}

function RowButtons({ i, n, onMove, onRemove, label, minRows = 1 }: { i: number; n: number; onMove: (d: -1 | 1) => void; onRemove: () => void; label: string; minRows?: number }) {
  return (
    <div className="flex shrink-0 items-center">
      <Button variant="ghost" size="icon-sm" aria-label={`Move ${label} up`} disabled={i === 0} onClick={() => onMove(-1)}>
        <ArrowUp />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label={`Move ${label} down`} disabled={i === n - 1} onClick={() => onMove(1)}>
        <ArrowDown />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label={`Remove ${label}`} disabled={n <= minRows} onClick={onRemove}>
        <Trash2 />
      </Button>
    </div>
  );
}

function move<T>(list: T[], i: number, d: number): T[] {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

/** Accepted answers + pattern + case sensitivity, with a live tester. */
function TextSpecEditor({ spec, onChange, label = "answer" }: { spec: O; onChange: (s: O) => void; label?: string }) {
  const [probe, setProbe] = React.useState("");
  const accepted = arr<string>(spec.accepted).map(String);
  const cs = !!spec.case_sensitive;
  const norm = (v: string) => {
    const t = v.normalize("NFKC").split(/\s+/).join(" ").trim().replace(/^[ .,;:!?"'`]+|[ .,;:!?"'`]+$/g, "");
    return cs ? t : t.toLowerCase();
  };
  let match: boolean | null = null;
  if (probe.trim()) {
    match = accepted.some((a) => norm(a) === norm(probe));
    if (!match && str(spec.regex)) {
      try {
        match = new RegExp(`^(?:${str(spec.regex)})$`, cs ? "" : "i").test(probe.trim());
      } catch {
        match = false;
      }
    }
  }
  return (
    <div className="space-y-3">
      <FormField label="Accepted answers" hint="Press Enter after each. Matching ignores extra spaces and surrounding punctuation.">
        {(aria) => <TagInput id={aria.id} aria-describedby={aria["aria-describedby"]} value={accepted} onChange={(v) => onChange({ ...spec, accepted: v })} placeholder={`Add an accepted ${label}…`} />}
      </FormField>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <FormField label="Pattern (regular expression)" hint="Optional — the whole answer must match, e.g. ^(TLS|SSL)\s?1\.[23]$">
          <Input className="font-mono" value={str(spec.regex)} onChange={(e) => onChange({ ...spec, regex: e.target.value })} placeholder="optional" />
        </FormField>
        <div className="flex h-11 items-center gap-2">
          <Switch id={`cs-${label}`} checked={cs} onCheckedChange={(v) => onChange({ ...spec, case_sensitive: v })} />
          <label htmlFor={`cs-${label}`} className="text-sm text-slate-700">
            Case sensitive
          </label>
        </div>
      </div>
      <div className="flex items-center gap-2 rounded-xl bg-slate-50 p-2">
        <FlaskConical className="ml-1 size-4 shrink-0 text-violet-600" aria-hidden />
        <Input inputSize="sm" value={probe} onChange={(e) => setProbe(e.target.value)} placeholder="Try a learner answer…" aria-label={`Test a learner ${label}`} />
        {match !== null && (
          <span className={cn("inline-flex shrink-0 items-center gap-1 text-xs font-semibold", match ? "text-emerald-700" : "text-rose-700")} role="status">
            {match ? <CheckCircle2 className="size-4" aria-hidden /> : <XCircle className="size-4" aria-hidden />}
            {match ? "Accepted" : "Rejected"}
          </span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ per-type editors */

function ChoicesEditor({ s, onChange, multi }: { s: QState; onChange: (s: QState) => void; multi: boolean }) {
  const choices = arr<{ id: string; text: string }>(s.options.choices);
  const correct = multi ? arr<string>(s.answer_key.choice_ids).map(String) : [String(s.answer_key.choice_id ?? "")];
  const setChoices = (c: { id: string; text: string }[]) => onChange({ ...s, options: { ...s.options, choices: c } });
  const toggle = (id: string) => {
    if (!multi) return onChange({ ...s, answer_key: { ...s.answer_key, choice_id: id } });
    const next = correct.includes(id) ? correct.filter((x) => x !== id) : [...correct, id];
    onChange({ ...s, answer_key: { ...s.answer_key, choice_ids: next } });
  };
  return (
    <div className="space-y-3">
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium text-slate-800">Choices · {multi ? "tick every correct answer" : "select the correct answer"}</legend>
        {choices.map((c, i) => {
          const on = correct.includes(c.id);
          return (
            <div key={c.id} className={cn("flex items-center gap-2 rounded-2xl border p-1.5 pl-2 transition-colors", on ? "border-emerald-300 bg-emerald-50/60" : "border-slate-200 bg-white")}>
              <CorrectToggle on={on} multi={multi} onClick={() => toggle(c.id)} label={`Choice ${String.fromCharCode(65 + i)} is correct`} />
              <span className="grid size-6 shrink-0 place-items-center rounded-md bg-slate-100 text-2xs font-bold text-slate-600" aria-hidden>
                {String.fromCharCode(65 + i)}
              </span>
              <Input inputSize="sm" className="border-transparent bg-transparent shadow-none" value={c.text} placeholder={`Choice ${String.fromCharCode(65 + i)}`} aria-label={`Choice ${String.fromCharCode(65 + i)} text`} onChange={(e) => setChoices(choices.map((x) => (x.id === c.id ? { ...x, text: e.target.value } : x)))} />
              <RowButtons
                i={i}
                n={choices.length}
                label={`choice ${String.fromCharCode(65 + i)}`}
                minRows={2}
                onMove={(d) => setChoices(move(choices, i, d))}
                onRemove={() => {
                  const next = choices.filter((x) => x.id !== c.id);
                  const key = multi ? { ...s.answer_key, choice_ids: correct.filter((x) => x !== c.id) } : { ...s.answer_key, choice_id: correct[0] === c.id ? next[0]?.id : correct[0] };
                  onChange({ options: { ...s.options, choices: next }, answer_key: key });
                }}
              />
            </div>
          );
        })}
      </fieldset>
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="soft" size="sm" leftIcon={<Plus />} disabled={choices.length >= 10} onClick={() => setChoices([...choices, { id: uid("c"), text: "" }])}>
          Add choice
        </Button>
        {multi && (
          <div className="flex items-center gap-2">
            <Switch id="ms-partial" checked={s.answer_key.partial_credit !== false} onCheckedChange={(v) => onChange({ ...s, answer_key: { ...s.answer_key, partial_credit: v } })} />
            <label htmlFor="ms-partial" className="text-sm text-slate-700">
              Partial credit <span className="text-muted-foreground">(right picks minus wrong picks)</span>
            </label>
          </div>
        )}
      </div>
    </div>
  );
}

function MatchingEditor({ s, onChange }: { s: QState; onChange: (s: QState) => void }) {
  const left = arr<{ id: string; text: string }>(s.options.left);
  const right = arr<{ id: string; text: string }>(s.options.right);
  const pairs = (s.answer_key.pairs ?? {}) as Record<string, string>;
  const paired = new Set(Object.values(pairs));
  const distractors = right.filter((r) => !paired.has(r.id));
  const rows = left.map((l) => ({ l, r: right.find((x) => x.id === pairs[l.id]) ?? { id: pairs[l.id] ?? uid("r"), text: "" } }));
  const emit = (nextRows: { l: { id: string; text: string }; r: { id: string; text: string } }[], nextDistractors = distractors) =>
    onChange({
      options: { ...s.options, left: nextRows.map((x) => x.l), right: [...nextRows.map((x) => x.r), ...nextDistractors] },
      answer_key: { ...s.answer_key, pairs: Object.fromEntries(nextRows.map((x) => [x.l.id, x.r.id])) },
    });
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-slate-800">Pairs · learners match each item on the left with one on the right (right side is shuffled)</p>
      {rows.map((row, i) => (
        <div key={row.l.id} className="grid items-center gap-2 rounded-2xl border border-fuchsia-200/70 bg-gradient-to-r from-fuchsia-50/60 to-white p-2 sm:grid-cols-[1fr_auto_1fr_auto]">
          <Input inputSize="sm" value={row.l.text} placeholder={`Item ${i + 1}`} aria-label={`Left item ${i + 1}`} onChange={(e) => emit(rows.map((x, j) => (j === i ? { ...x, l: { ...x.l, text: e.target.value } } : x)))} />
          <span className="hidden text-fuchsia-500 sm:block" aria-hidden>
            ⟷
          </span>
          <Input inputSize="sm" value={row.r.text} placeholder={`Match ${i + 1}`} aria-label={`Match for item ${i + 1}`} onChange={(e) => emit(rows.map((x, j) => (j === i ? { ...x, r: { ...x.r, text: e.target.value } } : x)))} />
          <RowButtons i={i} n={rows.length} label={`pair ${i + 1}`} onMove={(d) => emit(move(rows, i, d))} onRemove={() => emit(rows.filter((_, j) => j !== i))} />
        </div>
      ))}
      <Button variant="soft" size="sm" leftIcon={<Plus />} onClick={() => emit([...rows, { l: { id: uid("l"), text: "" }, r: { id: uid("r"), text: "" } }])}>
        Add pair
      </Button>
      <FormField label="Distractors" hint="Extra right-hand options that match nothing (optional).">
        {() => (
          <StringListEditor
            label="distractor"
            value={distractors.map((d) => d.text)}
            onChange={(v) => emit(rows, v.map((text, i) => ({ id: distractors[i]?.id ?? uid("d"), text })))}
            placeholder="A plausible wrong match"
            color="rose"
          />
        )}
      </FormField>
      <div className="flex items-center gap-2">
        <Switch id="match-partial" checked={s.answer_key.partial_credit !== false} onCheckedChange={(v) => onChange({ ...s, answer_key: { ...s.answer_key, partial_credit: v } })} />
        <label htmlFor="match-partial" className="text-sm text-slate-700">
          Partial credit per correct pair
        </label>
      </div>
    </div>
  );
}

function OrderingEditor({ s, onChange }: { s: QState; onChange: (s: QState) => void }) {
  const items = arr<{ id: string; text: string }>(s.options.items);
  const emit = (next: { id: string; text: string }[], scoring = String(s.answer_key.scoring ?? "positions")) =>
    onChange({ options: { ...s.options, items: next }, answer_key: { ...s.answer_key, order: next.map((x) => x.id), scoring } });
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-slate-800">Items in the correct order · learners see them shuffled</p>
      <ol className="space-y-2">
        {items.map((it, i) => (
          <li key={it.id} className="flex items-center gap-2 rounded-2xl border border-teal-200/80 bg-gradient-to-r from-teal-50/70 to-white p-1.5 pl-2">
            <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-teal-500 text-xs font-bold text-white" aria-hidden>
              {i + 1}
            </span>
            <Input inputSize="sm" className="border-transparent bg-transparent shadow-none" value={it.text} placeholder={`Step ${i + 1}`} aria-label={`Step ${i + 1}`} onChange={(e) => emit(items.map((x) => (x.id === it.id ? { ...x, text: e.target.value } : x)))} />
            <RowButtons i={i} n={items.length} minRows={2} label={`step ${i + 1}`} onMove={(d) => emit(move(items, i, d))} onRemove={() => emit(items.filter((x) => x.id !== it.id))} />
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="soft" size="sm" leftIcon={<Plus />} onClick={() => emit([...items, { id: uid("i"), text: "" }])}>
          Add step
        </Button>
        <FormField label="Scoring" className="min-w-56">
          {(aria) => (
            <SimpleSelect
              {...aria}
              value={String(s.answer_key.scoring ?? "positions")}
              onValueChange={(v) => emit(items, v)}
              options={[
                { value: "positions", label: "Credit per correct position" },
                { value: "kendall", label: "Credit for relative order (Kendall)" },
                { value: "all_or_nothing", label: "All or nothing" },
              ]}
            />
          )}
        </FormField>
      </div>
    </div>
  );
}

function FillBlankEditor({ s, onChange }: { s: QState; onChange: (s: QState) => void }) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const text = str(s.options.text);
  const specs = (s.answer_key.blanks ?? {}) as Record<string, O>;
  const sync = (nextText: string, nextSpecs = specs) => {
    // Convert [blank] / [answer] markers into {{bN}} placeholders.
    let n = 1;
    const used = new Set((nextText.match(/\{\{(\w+)\}\}/g) ?? []).map((m) => m.slice(2, -2)));
    const newSpecs: Record<string, O> = { ...nextSpecs };
    const converted = nextText.replace(/\[([^\]\n]{0,80})\]/g, (_m, inner: string) => {
      while (used.has(`b${n}`)) n++;
      const id = `b${n}`;
      used.add(id);
      const ans = inner.trim();
      newSpecs[id] = { accepted: ans && ans.toLowerCase() !== "blank" ? [ans] : [], case_sensitive: false };
      return `{{${id}}}`;
    });
    const ids = [...new Set((converted.match(/\{\{(\w+)\}\}/g) ?? []).map((m) => m.slice(2, -2)))];
    const finalSpecs = Object.fromEntries(ids.map((id) => [id, newSpecs[id] ?? { accepted: [], case_sensitive: false }]));
    onChange({ options: { ...s.options, text: converted, blanks: ids.map((id) => ({ id })) }, answer_key: { ...s.answer_key, blanks: finalSpecs } });
  };
  const insert = () => {
    const el = ref.current;
    const pos = el ? el.selectionStart : text.length;
    const end = el ? el.selectionEnd : text.length;
    const selected = text.slice(pos, end);
    sync(`${text.slice(0, pos)}[${selected || "blank"}]${text.slice(end)}`);
  };
  const ids = arr<{ id: string }>(s.options.blanks).map((b) => b.id);
  return (
    <div className="space-y-4">
      <FormField label="Sentence" hint="Type [answer] (or [blank]) where a gap goes, or select a word and click Insert blank. Gaps become {{b1}}, {{b2}}…">
        {(aria) => (
          <div className="space-y-2">
            <Textarea {...aria} ref={ref} rows={3} className="font-mono text-[13px]" value={text} onChange={(e) => sync(e.target.value)} />
            <Button variant="soft" size="xs" leftIcon={<Plus />} onClick={insert}>
              Insert blank
            </Button>
          </div>
        )}
      </FormField>
      {ids.length > 0 && (
        <div className="space-y-3">
          {ids.map((id, i) => (
            <div key={id} className="rounded-2xl border border-orange-200 bg-orange-50/40 p-3">
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-orange-800">
                Blank {i + 1} <code className="ml-1 rounded bg-white px-1 font-mono text-2xs normal-case">{`{{${id}}}`}</code>
              </p>
              <TextSpecEditor label={`answer for blank ${i + 1}`} spec={specs[id] ?? {}} onChange={(sp) => onChange({ ...s, answer_key: { ...s.answer_key, blanks: { ...specs, [id]: sp } } })} />
            </div>
          ))}
          <div className="flex items-center gap-2">
            <Switch id="fb-partial" checked={s.answer_key.partial_credit !== false} onCheckedChange={(v) => onChange({ ...s, answer_key: { ...s.answer_key, partial_credit: v } })} />
            <label htmlFor="fb-partial" className="text-sm text-slate-700">
              Partial credit per blank
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

type DNode = { prompt: string; choices: { id: string; text: string; next: string | null }[] };

function DecisionTreeEditor({ s, onChange }: { s: QState; onChange: (s: QState) => void }) {
  const nodes = (s.options.nodes ?? {}) as Record<string, DNode>;
  const order = Object.keys(nodes);
  const points = (s.answer_key.points ?? {}) as Record<string, Record<string, number>>;
  const start = String(s.options.start ?? order[0] ?? "");
  const emit = (nextNodes: Record<string, DNode>, nextPoints = points, nextStart = start) =>
    onChange({ options: { ...s.options, nodes: nextNodes, start: nextStart }, answer_key: { ...s.answer_key, points: nextPoints } });
  const setNode = (id: string, n: DNode) => emit({ ...nodes, [id]: n });
  const label = (id: string) => `Decision ${order.indexOf(id) + 1}`;
  const maxPath = (() => {
    const memo = new Map<string, number>();
    const best = (id: string, depth: number): number => {
      if (depth > 30 || !nodes[id]) return 0;
      if (memo.has(id)) return memo.get(id)!;
      const v = Math.max(0, ...nodes[id]!.choices.map((c) => Number(points[id]?.[c.id] ?? 0) + (c.next ? best(c.next, depth + 1) : 0)));
      memo.set(id, v);
      return v;
    };
    return best(start, 0);
  })();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <FormField label="Starting decision" className="min-w-48">
          {(aria) => <SimpleSelect {...aria} value={start} onValueChange={(v) => emit(nodes, points, v)} options={order.map((id) => ({ value: id, label: label(id) }))} />}
        </FormField>
        <span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-800 ring-1 ring-violet-200">Best path scores {maxPath} pts</span>
      </div>
      {order.map((id) => {
        const n = nodes[id]!;
        return (
          <div key={id} className={cn("rounded-2xl border bg-white p-3 shadow-sm", id === start ? "border-violet-300 ring-1 ring-violet-200" : "border-slate-200")}>
            <div className="mb-2 flex items-center gap-2">
              <span className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white" aria-hidden>
                <GitBranch className="size-3.5" />
              </span>
              <span className="text-sm font-semibold text-slate-900">{label(id)}</span>
              {id === start && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-2xs font-bold text-violet-700">START</span>}
              <Button
                variant="ghost"
                size="icon-sm"
                className="ml-auto"
                aria-label={`Delete ${label(id)}`}
                disabled={order.length <= 1}
                onClick={() => {
                  const next = Object.fromEntries(
                    Object.entries(nodes)
                      .filter(([k]) => k !== id)
                      .map(([k, v]) => [k, { ...v, choices: v.choices.map((c) => (c.next === id ? { ...c, next: null } : c)) }]),
                  );
                  const np = { ...points };
                  delete np[id];
                  emit(next, np, start === id ? Object.keys(next)[0]! : start);
                }}
              >
                <Trash2 />
              </Button>
            </div>
            <Textarea rows={2} className="min-h-[60px]" value={n.prompt} placeholder="What situation does the learner face here?" aria-label={`${label(id)} prompt`} onChange={(e) => setNode(id, { ...n, prompt: e.target.value })} />
            <div className="mt-2 space-y-2">
              {n.choices.map((c, ci) => (
                <div key={c.id} className="grid items-center gap-2 rounded-xl bg-slate-50 p-2 sm:grid-cols-[1fr_170px_90px_auto]">
                  <Input inputSize="sm" value={c.text} placeholder={`Option ${ci + 1}`} aria-label={`${label(id)} option ${ci + 1}`} onChange={(e) => setNode(id, { ...n, choices: n.choices.map((x) => (x.id === c.id ? { ...x, text: e.target.value } : x)) })} />
                  <SimpleSelect
                    aria-label={`${label(id)} option ${ci + 1} leads to`}
                    value={c.next ?? "__end"}
                    onValueChange={(v) => setNode(id, { ...n, choices: n.choices.map((x) => (x.id === c.id ? { ...x, next: v === "__end" ? null : v } : x)) })}
                    options={[{ value: "__end", label: "→ End" }, ...order.filter((o) => o !== id).map((o) => ({ value: o, label: `→ ${label(o)}` }))]}
                    className="h-9"
                  />
                  <NumberInput
                    inputSize="sm"
                    aria-label={`${label(id)} option ${ci + 1} points`}
                    value={points[id]?.[c.id] ?? 0}
                    min={0}
                    suffix="pts"
                    onChange={(v) => emit(nodes, { ...points, [id]: { ...(points[id] ?? {}), [c.id]: v ?? 0 } })}
                  />
                  <Button variant="ghost" size="icon-sm" aria-label={`Remove option ${ci + 1}`} disabled={n.choices.length <= 1} onClick={() => setNode(id, { ...n, choices: n.choices.filter((x) => x.id !== c.id) })}>
                    <X />
                  </Button>
                </div>
              ))}
              <Button variant="ghost" size="xs" leftIcon={<Plus />} onClick={() => setNode(id, { ...n, choices: [...n.choices, { id: uid("c"), text: "", next: null }] })}>
                Add option
              </Button>
            </div>
          </div>
        );
      })}
      <Button
        variant="soft"
        size="sm"
        leftIcon={<Plus />}
        onClick={() => {
          const nid = uid("n");
          emit({ ...nodes, [nid]: { prompt: "", choices: [{ id: uid("c"), text: "", next: null }] } });
        }}
      >
        Add decision
      </Button>
    </div>
  );
}

function CodeQuestionEditor({ s, onChange }: { s: QState; onChange: (s: QState) => void }) {
  const cases = arr<{ id: string; pattern: string; match: string; weight?: number; description?: string }>(s.answer_key.test_cases);
  const setCases = (c: typeof cases) => onChange({ ...s, answer_key: { ...s.answer_key, test_cases: c } });
  return (
    <div className="space-y-4">
      <FormField label="Language">
        {(aria) => <SimpleSelect {...aria} value={str(s.options.language) || "python"} onValueChange={(v) => onChange({ ...s, options: { ...s.options, language: v } })} options={CODE_LANGUAGES.map((l) => ({ value: l, label: l }))} className="sm:w-56" />}
      </FormField>
      <FormField label="Starter code" hint="Pre-filled in the learner's editor.">
        {(aria) => <CodeEditor {...aria} language={str(s.options.language)} value={str(s.options.starter_code)} onChange={(v) => onChange({ ...s, options: { ...s.options, starter_code: v } })} minLines={6} maxHeight={280} aria-label="Starter code" />}
      </FormField>
      <div className="space-y-2">
        <p className="text-sm font-medium text-slate-800">Static checks · code is never executed, only pattern-checked</p>
        {cases.map((c, i) => (
          <div key={c.id} className="grid items-center gap-2 rounded-xl border border-violet-200/70 bg-violet-50/40 p-2 sm:grid-cols-[150px_1fr_90px_auto]">
            <SimpleSelect
              aria-label={`Check ${i + 1} type`}
              value={c.match || "contains"}
              onValueChange={(v) => setCases(cases.map((x) => (x.id === c.id ? { ...x, match: v } : x)))}
              options={[
                { value: "contains", label: "Contains" },
                { value: "not_contains", label: "Must not contain" },
                { value: "regex", label: "Matches regex" },
                { value: "exact", label: "Exactly equals" },
              ]}
              className="h-9"
            />
            <Input inputSize="sm" className="font-mono" value={c.pattern} placeholder="e.g. def solve(" aria-label={`Check ${i + 1} pattern`} onChange={(e) => setCases(cases.map((x) => (x.id === c.id ? { ...x, pattern: e.target.value } : x)))} />
            <NumberInput inputSize="sm" aria-label={`Check ${i + 1} weight`} value={c.weight ?? 1} min={0} suffix="×" onChange={(v) => setCases(cases.map((x) => (x.id === c.id ? { ...x, weight: v ?? 1 } : x)))} />
            <Button variant="ghost" size="icon-sm" aria-label={`Remove check ${i + 1}`} onClick={() => setCases(cases.filter((x) => x.id !== c.id))}>
              <Trash2 />
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-4">
          <Button variant="soft" size="sm" leftIcon={<Plus />} onClick={() => setCases([...cases, { id: uid("t"), pattern: "", match: "contains", weight: 1 }])}>
            Add check
          </Button>
          <div className="flex items-center gap-2">
            <Switch id="code-auto" checked={!!s.answer_key.auto_grade} onCheckedChange={(v) => onChange({ ...s, answer_key: { ...s.answer_key, auto_grade: v } })} />
            <label htmlFor="code-auto" className="text-sm text-slate-700">
              Auto-grade from checks <span className="text-muted-foreground">(otherwise manual review)</span>
            </label>
          </div>
        </div>
      </div>
      <FormField label="Reference solution (assessors only)">
        {(aria) => <CodeEditor {...aria} language={str(s.options.language)} value={str(s.answer_key.solution)} onChange={(v) => onChange({ ...s, answer_key: { ...s.answer_key, solution: v } })} minLines={5} maxHeight={240} aria-label="Reference solution" />}
      </FormField>
    </div>
  );
}

function SimulationPicker({ value, onChange }: { value: string; onChange: (id: string, title: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const sims = useQuery({
    queryKey: ["simulations", "picker", ""],
    queryFn: ({ signal }) => api.get<Page<SimulationLite>>("/simulations", { signal, query: { page_size: 50 } }),
  });
  const cur = sims.data?.items.find((x) => x.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant={value ? "secondary" : "primary"} size="sm">
          {cur ? cur.title : value ? "Linked simulation" : "Choose simulation"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <div className="max-h-64 overflow-y-auto" role="listbox" aria-label="Simulations">
          {sims.isLoading ? (
            <p className="p-3 text-sm text-muted-foreground">Loading…</p>
          ) : !sims.data?.items.length ? (
            <p className="p-3 text-sm text-muted-foreground">No simulations yet — build one in the simulation builder.</p>
          ) : (
            sims.data.items.map((x) => (
              <button
                key={x.id}
                type="button"
                role="option"
                aria-selected={x.id === value}
                onClick={() => {
                  onChange(x.id, x.title);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-brand-50 focus-visible:focus-ring"
              >
                <span className="min-w-0 flex-1 truncate">{x.title}</span>
                <span className="text-2xs capitalize text-muted-foreground">{x.status}</span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Type-specific editor for a question's `options` + `answer_key`. */
export function QuestionTypeEditor({ type, s, onChange }: { type: QuestionType; s: QState; onChange: (s: QState) => void }) {
  const setO = (patch: O) => onChange({ ...s, options: { ...s.options, ...patch } });
  const setK = (patch: O) => onChange({ ...s, answer_key: { ...s.answer_key, ...patch } });
  const modelAnswer = (
    <FormField label="Model answer (assessors & AI grading only)" hint="Never shown to learners.">
      <Textarea rows={4} value={str(s.answer_key.model_answer)} onChange={(e) => setK({ model_answer: e.target.value })} />
    </FormField>
  );
  switch (type) {
    case "multiple_choice":
      return <ChoicesEditor s={s} onChange={onChange} multi={false} />;
    case "multiple_select":
      return <ChoicesEditor s={s} onChange={onChange} multi />;
    case "true_false":
      return (
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-slate-800">The statement is…</legend>
          <div className="grid max-w-md grid-cols-2 gap-3" role="radiogroup" aria-label="Correct answer">
            {[true, false].map((v) => {
              const on = s.answer_key.value === v;
              const c = colorClasses(v ? "emerald" : "rose");
              return (
                <button key={String(v)} type="button" role="radio" aria-checked={on} onClick={() => setK({ value: v })} className={cn("flex items-center justify-center gap-2 rounded-2xl border-2 p-4 font-display text-lg font-bold transition-all focus-visible:focus-ring", on ? cn(c.border, c.soft, c.text, "shadow-sm") : "border-slate-200 bg-white text-slate-500 hover:border-slate-300")}>
                  {v ? <CheckCircle2 className="size-5" aria-hidden /> : <XCircle className="size-5" aria-hidden />}
                  {v ? "True" : "False"}
                </button>
              );
            })}
          </div>
        </fieldset>
      );
    case "short_answer":
      return <TextSpecEditor spec={s.answer_key} onChange={(k) => onChange({ ...s, answer_key: k })} />;
    case "long_answer":
      return (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Minimum words">
              {(aria) => <NumberInput {...aria} value={(s.options.min_words as number) ?? null} min={0} onChange={(v) => setO({ min_words: v })} />}
            </FormField>
            <FormField label="Maximum words">
              {(aria) => <NumberInput {...aria} value={(s.options.max_words as number) ?? null} min={0} onChange={(v) => setO({ max_words: v })} />}
            </FormField>
          </div>
          {modelAnswer}
        </div>
      );
    case "matching":
      return <MatchingEditor s={s} onChange={onChange} />;
    case "ordering":
      return <OrderingEditor s={s} onChange={onChange} />;
    case "fill_blank":
      return <FillBlankEditor s={s} onChange={onChange} />;
    case "decision_tree":
      return <DecisionTreeEditor s={s} onChange={onChange} />;
    case "code":
      return <CodeQuestionEditor s={s} onChange={onChange} />;
    case "file_upload":
      return (
        <div className="space-y-4">
          <FormField label="Allowed file types" hint="Extensions, e.g. .pdf, .png, .docx">
            {(aria) => <TagInput id={aria.id} lowercase value={arr<string>(s.options.allowed_types)} onChange={(v) => setO({ allowed_types: v.map((x) => (x.startsWith(".") ? x : `.${x}`)) })} />}
          </FormField>
          <FormField label="Maximum files">
            {(aria) => <NumberInput {...aria} value={(s.options.max_files as number) ?? 1} min={1} max={20} onChange={(v) => setO({ max_files: v ?? 1 })} className="sm:w-40" />}
          </FormField>
          <FormField label="Submission instructions">
            <Textarea rows={3} value={str(s.options.instructions)} onChange={(e) => setO({ instructions: e.target.value })} placeholder="e.g. Upload your completed incident report as a PDF." />
          </FormField>
          {modelAnswer}
        </div>
      );
    case "scenario":
      return (
        <div className="space-y-4">
          <FormField label="Scenario" hint="The situation the learner responds to (Markdown).">
            {(aria) => <MarkdownEditor {...aria} label="Scenario" value={str(s.options.scenario)} onChange={(v) => setO({ scenario: v })} minRows={6} compact />}
          </FormField>
          {modelAnswer}
        </div>
      );
    case "practical_task":
      return (
        <div className="space-y-4">
          <FormField label="Task" hint="What the learner must do (Markdown).">
            {(aria) => <MarkdownEditor {...aria} label="Task" value={str(s.options.task)} onChange={(v) => setO({ task: v })} minRows={5} compact />}
          </FormField>
          <FormField label="Evidence checklist">
            {() => <StringListEditor label="checklist item" value={arr<string>(s.options.checklist)} onChange={(v) => setO({ checklist: v })} placeholder="e.g. Screenshot of the firewall rule" color="amber" />}
          </FormField>
          {modelAnswer}
        </div>
      );
    case "simulation":
      return (
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-800">Simulation</p>
          <SimulationPicker value={str(s.options.simulation_id)} onChange={(id, title) => setO({ simulation_id: id, title })} />
          <p className="text-xs text-muted-foreground">The learner&apos;s score is taken from their simulation session&apos;s total score.</p>
        </div>
      );
  }
}
