"use client";

import { Button, Textarea, cn } from "@praxis/ui";
import { ArrowDown, ArrowUp, GitBranch, MonitorPlay, Play, RotateCcw, UploadCloud } from "lucide-react";
import * as React from "react";
import { Markdown } from "@/components/common/markdown";
import { CodeEditor } from "../code-editor";
import { questionMeta } from "../meta";
import { TypeChip } from "../shared";

type O = Record<string, unknown>;
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const str = (v: unknown) => (typeof v === "string" ? v : "");

function seededShuffle<T>(list: T[], seed: number): T[] {
  const out = [...list];
  let s = seed || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function Choices({ options, multi }: { options: O; multi: boolean }) {
  const choices = arr<{ id: string; text: string }>(options.choices);
  const [sel, setSel] = React.useState<string[]>([]);
  return (
    <div className="grid gap-2" role={multi ? "group" : "radiogroup"} aria-label="Answer choices">
      {choices.map((c, i) => {
        const on = sel.includes(c.id);
        return (
          <button
            key={c.id}
            type="button"
            role={multi ? "checkbox" : "radio"}
            aria-checked={on}
            onClick={() => setSel(multi ? (on ? sel.filter((x) => x !== c.id) : [...sel, c.id]) : [c.id])}
            className={cn(
              "flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left text-sm transition-colors focus-visible:focus-ring",
              on ? "border-brand-400 bg-brand-50 text-brand-900" : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50",
            )}
          >
            <span className={cn("grid size-5 shrink-0 place-items-center border-2", multi ? "rounded-md" : "rounded-full", on ? "border-brand-600 bg-brand-600" : "border-slate-300")} aria-hidden>
              {on && <span className={cn("bg-white", multi ? "size-2 rounded-sm" : "size-2 rounded-full")} />}
            </span>
            <span className="mr-1 font-semibold text-slate-400">{String.fromCharCode(65 + i)}.</span>
            {c.text || <span className="italic text-slate-400">Empty choice</span>}
          </button>
        );
      })}
    </div>
  );
}

function Ordering({ options }: { options: O }) {
  const items = arr<{ id: string; text: string }>(options.items);
  const [order, setOrder] = React.useState(() => seededShuffle(items, items.length * 7 + 3));
  React.useEffect(() => setOrder(seededShuffle(items, items.length * 7 + 3)), [items.map((i) => i.id + i.text).join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  const mv = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    const n = [...order];
    [n[i], n[j]] = [n[j]!, n[i]!];
    setOrder(n);
  };
  return (
    <ol className="space-y-2">
      {order.map((it, i) => (
        <li key={it.id} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm">
          <span className="grid size-6 shrink-0 place-items-center rounded-md bg-teal-100 text-xs font-bold text-teal-800">{i + 1}</span>
          <span className="min-w-0 flex-1">{it.text || <span className="italic text-slate-400">Empty step</span>}</span>
          <Button variant="ghost" size="icon-sm" aria-label={`Move ${it.text} up`} onClick={() => mv(i, -1)} disabled={i === 0}>
            <ArrowUp />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={`Move ${it.text} down`} onClick={() => mv(i, 1)} disabled={i === order.length - 1}>
            <ArrowDown />
          </Button>
        </li>
      ))}
    </ol>
  );
}

function Matching({ options }: { options: O }) {
  const left = arr<{ id: string; text: string }>(options.left);
  const right = seededShuffle(arr<{ id: string; text: string }>(options.right), 11);
  return (
    <div className="space-y-2">
      {left.map((l, i) => (
        <div key={l.id} className="grid items-center gap-2 rounded-xl border border-slate-200 bg-white p-2.5 sm:grid-cols-2">
          <span className="text-sm font-medium text-slate-800">{l.text || <span className="italic text-slate-400">Item {i + 1}</span>}</span>
          <select aria-label={`Match for ${l.text || `item ${i + 1}`}`} className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm focus-visible:focus-ring" defaultValue="">
            <option value="" disabled>
              Choose a match…
            </option>
            {right.map((r) => (
              <option key={r.id} value={r.id}>
                {r.text || "—"}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}

function FillBlank({ options }: { options: O }) {
  const text = str(options.text);
  const parts = text.split(/(\{\{\w+\}\})/g);
  let n = 0;
  return (
    <p className="text-[15px] leading-9 text-slate-800">
      {parts.map((p, i) => {
        if (/^\{\{\w+\}\}$/.test(p)) {
          n += 1;
          return <input key={i} aria-label={`Blank ${n}`} className="mx-1 inline-block h-8 w-28 rounded-lg border-b-2 border-orange-400 bg-orange-50 px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-orange-300" />;
        }
        return <span key={i}>{p}</span>;
      })}
    </p>
  );
}

function DecisionTree({ options }: { options: O }) {
  const nodes = (options.nodes ?? {}) as Record<string, { prompt: string; choices: { id: string; text: string; next: string | null }[] }>;
  const start = String(options.start ?? Object.keys(nodes)[0] ?? "");
  const [path, setPath] = React.useState<{ node: string; choice: string }[]>([]);
  const current = path.length ? (nodes[path.at(-1)!.node]?.choices.find((c) => c.id === path.at(-1)!.choice)?.next ?? null) : start;
  const node = current ? nodes[current] : null;
  return (
    <div className="space-y-3">
      {path.map((p, i) => {
        const nd = nodes[p.node];
        return (
          <div key={i} className="rounded-xl bg-violet-50/60 px-3 py-2 text-sm">
            <p className="text-slate-600">{nd?.prompt}</p>
            <p className="font-semibold text-violet-800">→ {nd?.choices.find((c) => c.id === p.choice)?.text}</p>
          </div>
        );
      })}
      {node ? (
        <div className="rounded-2xl border border-violet-200 bg-white p-4 shadow-sm">
          <p className="mb-3 flex items-start gap-2 font-medium text-slate-900">
            <GitBranch className="mt-0.5 size-4 shrink-0 text-violet-600" aria-hidden />
            {node.prompt || <span className="italic text-slate-400">No prompt</span>}
          </p>
          <div className="grid gap-2">
            {node.choices.map((c) => (
              <button key={c.id} type="button" onClick={() => setPath([...path, { node: current!, choice: c.id }])} className="rounded-xl border border-slate-200 px-3.5 py-2.5 text-left text-sm hover:border-violet-300 hover:bg-violet-50 focus-visible:focus-ring">
                {c.text || <span className="italic text-slate-400">Empty option</span>}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
          End of the path
          <Button size="xs" variant="secondary" leftIcon={<RotateCcw />} onClick={() => setPath([])}>
            Restart
          </Button>
        </div>
      )}
    </div>
  );
}

/** Interactive learner-view preview of a question (answers are not checked). */
export function QuestionPreview({ type, prompt, options, points }: { type: string; prompt: string; options: O; points?: number }) {
  const meta = questionMeta(type);
  const [text, setText] = React.useState("");
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const [code, setCode] = React.useState(str(options.starter_code));
  React.useEffect(() => setCode(str(options.starter_code)), [options.starter_code]);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <TypeChip meta={meta} size="xs" />
        <span className="text-xs font-semibold text-slate-600">{meta.label}</span>
        {points !== undefined && <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-2xs font-semibold text-slate-600">{points} pt{points === 1 ? "" : "s"}</span>}
      </div>
      {prompt.trim() ? <Markdown className="font-medium text-slate-900">{prompt}</Markdown> : <p className="italic text-slate-400">Your question prompt appears here.</p>}
      {(type === "multiple_choice" || type === "multiple_select") && <Choices options={options} multi={type === "multiple_select"} />}
      {type === "multiple_select" && <p className="text-xs text-muted-foreground">Select all that apply.</p>}
      {type === "true_false" && (
        <div className="grid grid-cols-2 gap-2">
          {["True", "False"].map((v) => (
            <button key={v} type="button" className="rounded-xl border border-slate-200 bg-white py-3 font-semibold text-slate-700 hover:bg-slate-50 focus-visible:focus-ring">
              {v}
            </button>
          ))}
        </div>
      )}
      {type === "short_answer" && <input aria-label="Your answer" className="h-11 w-full rounded-xl border border-slate-300 px-3.5 text-sm focus-visible:focus-ring" placeholder="Type your answer" />}
      {(type === "long_answer" || type === "scenario" || type === "practical_task") && (
        <div className="space-y-2">
          {type === "scenario" && str(options.scenario) && (
            <div className="rounded-2xl border border-teal-200 bg-teal-50/50 p-4">
              <Markdown>{str(options.scenario)}</Markdown>
            </div>
          )}
          {type === "practical_task" && (
            <div className="space-y-2">
              {str(options.task) && <Markdown>{str(options.task)}</Markdown>}
              {arr<string>(options.checklist).length > 0 && (
                <ul className="space-y-1">
                  {arr<string>(options.checklist).map((c) => (
                    <li key={c} className="flex items-center gap-2 text-sm text-slate-700">
                      <span className="size-4 rounded border-2 border-amber-400" aria-hidden /> {c}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} aria-label="Your response" placeholder="Write your response…" />
          {type === "long_answer" && (
            <p className="text-right text-xs tabular-nums text-muted-foreground">
              {words} words
              {options.min_words ? ` · min ${options.min_words}` : ""}
              {options.max_words ? ` · max ${options.max_words}` : ""}
            </p>
          )}
        </div>
      )}
      {type === "matching" && <Matching options={options} />}
      {type === "ordering" && <Ordering options={options} />}
      {type === "fill_blank" && <FillBlank options={options} />}
      {type === "decision_tree" && <DecisionTree options={options} />}
      {type === "code" && <CodeEditor value={code} onChange={setCode} language={str(options.language)} minLines={6} maxHeight={260} aria-label="Your code" />}
      {type === "file_upload" && (
        <div className="space-y-2">
          {str(options.instructions) && <p className="text-sm text-slate-700">{str(options.instructions)}</p>}
          <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-6 text-center">
            <UploadCloud className="size-7 text-brand-600" aria-hidden />
            <p className="text-sm font-semibold text-slate-700">Drop files to upload</p>
            <p className="text-xs text-muted-foreground">
              {arr<string>(options.allowed_types).join(", ") || "Any type"} · up to {String(options.max_files ?? 1)} file(s)
            </p>
          </div>
        </div>
      )}
      {type === "simulation" && (
        <div className="flex items-center gap-3 rounded-2xl border border-fuchsia-200 bg-gradient-to-r from-fuchsia-50 to-violet-50 p-4">
          <MonitorPlay className="size-6 text-fuchsia-600" aria-hidden />
          <span className="min-w-0 flex-1 text-sm font-semibold text-slate-900">{str(options.title) || "Simulation task"}</span>
          <Button size="sm" variant="gradient" leftIcon={<Play />} disabled>
            Launch
          </Button>
        </div>
      )}
    </div>
  );
}
