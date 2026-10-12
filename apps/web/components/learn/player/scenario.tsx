"use client";

import { Button, cn } from "@praxis/ui";
import { CornerDownRight, Flag, MessageSquareQuote, RotateCcw, Theater } from "lucide-react";
import * as React from "react";
import { Markdown } from "@/components/common/markdown";
import { str } from "./media";

interface Choice {
  id: string;
  text: string;
  feedback?: string;
  next?: string;
  outcome?: string;
}
interface SceneNode {
  id: string;
  body?: string;
  choices: Choice[];
  outcome?: string;
}

function readChoices(raw: unknown): Choice[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object" && typeof (c as Record<string, unknown>).text === "string")
    .map((c, i) => ({
      id: String(c.id ?? i),
      text: String(c.text),
      feedback: str(c.feedback) ?? str(c.explanation) ?? str(c.consequence),
      next: str(c.next) ?? str(c.next_node),
      outcome: str(c.outcome),
    }));
}

/** Normalise `{scenario, choices}` or `{start, nodes: {id: {text, choices}}}` into scene nodes. */
function readScenes(content: Record<string, unknown>): { start: string; nodes: Record<string, SceneNode> } {
  const nodes: Record<string, SceneNode> = {};
  const rawNodes = content.nodes && typeof content.nodes === "object" ? (content.nodes as Record<string, Record<string, unknown>>) : null;
  if (rawNodes) {
    for (const [id, n] of Object.entries(rawNodes)) {
      if (!n || typeof n !== "object") continue;
      nodes[id] = { id, body: str(n.body_markdown) ?? str(n.text) ?? str(n.prompt) ?? str(n.body), choices: readChoices(n.choices), outcome: str(n.outcome) };
    }
  }
  const rootChoices = readChoices(content.choices);
  if (rootChoices.length || !Object.keys(nodes).length) nodes.__root = { id: "__root", choices: rootChoices };
  const start = rootChoices.length || !rawNodes ? "__root" : (str(content.start) ?? Object.keys(nodes)[0] ?? "__root");
  return { start, nodes };
}

const LETTERS = "ABCDEFGHIJ";

/** Branching scenario: the situation, then choices that reveal consequences and (optionally) lead to further scenes. */
export function ScenarioBlock({ content }: { content: Record<string, unknown> }) {
  // `scenario` is the situation; `body_markdown` is then a debrief revealed once the learner has played through
  // (an interactive scenario shouldn't spoil its own answer). Without `scenario`, `body_markdown` is the situation.
  const situation = str(content.scenario) ?? str(content.body_markdown);
  const debrief = str(content.scenario) ? str(content.body_markdown) : undefined;
  const { start, nodes } = React.useMemo(() => readScenes(content), [content]);
  const [path, setPath] = React.useState<{ node: string; choice: Choice }[]>([]);
  const current = path.length ? path[path.length - 1]!.choice.next : start;
  const node = current ? nodes[current] : undefined;
  const interactive = Object.values(nodes).some((n) => n.choices.length > 0);
  const finished = path.length > 0 && (!node || node.choices.length === 0);
  const liveRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (path.length) liveRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [path.length]);

  return (
    <div className="space-y-5">
      {situation && (
        <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-50 via-fuchsia-50/60 to-white p-5 ring-1 ring-violet-100 sm:p-7">
          <div className="pointer-events-none absolute -right-8 -top-8 size-36 rounded-full bg-violet-200/40 blur-2xl" aria-hidden />
          <p className="relative flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-violet-700">
            <Theater className="size-4" aria-hidden /> The situation
          </p>
          <Markdown className="relative mt-3 text-base">{situation}</Markdown>
        </section>
      )}

      {path.map((step, i) => {
        const n = nodes[step.node];
        return (
          <div key={i} className="space-y-3">
            {n?.body && i > 0 && <Markdown className="rounded-2xl bg-slate-50 p-4">{n.body}</Markdown>}
            <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-brand-gradient px-4 py-3 text-sm font-medium text-white shadow-sm">
              <span className="sr-only">You chose: </span>
              {step.choice.text}
            </div>
            {(step.choice.feedback || step.choice.outcome) && (
              <div className="flex max-w-[92%] gap-3 rounded-2xl rounded-bl-md border border-slate-200 bg-white p-4 shadow-soft">
                <MessageSquareQuote className="mt-0.5 size-5 shrink-0 text-violet-600" aria-hidden />
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wider text-violet-700">What happens next</p>
                  {step.choice.feedback && <Markdown className="mt-1 text-sm">{step.choice.feedback}</Markdown>}
                  {step.choice.outcome && <p className="mt-2 text-sm font-semibold text-slate-800">{step.choice.outcome}</p>}
                </div>
              </div>
            )}
          </div>
        );
      })}

      <div ref={liveRef} aria-live="polite">
        {node && node.choices.length > 0 && (
          <section className="space-y-3">
            {node.body && (path.length > 0 || current !== "__root") && <Markdown className="rounded-2xl bg-slate-50 p-4">{node.body}</Markdown>}
            <h3 className="flex items-center gap-2 font-display text-base font-semibold text-slate-900">
              <CornerDownRight className="size-4 text-violet-600" aria-hidden /> What would you do?
            </h3>
            <ul className="grid gap-2.5">
              {node.choices.map((c, i) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setPath((p) => [...p, { node: node.id, choice: c }])}
                    className="group flex w-full items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left text-sm text-slate-800 shadow-sm transition hover:-translate-y-0.5 hover:border-violet-300 hover:shadow-lift focus-visible:focus-ring"
                  >
                    <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-violet-50 font-display text-xs font-bold text-violet-700 transition group-hover:bg-violet-600 group-hover:text-white">
                      {LETTERS[i] ?? i + 1}
                    </span>
                    <span className="pt-0.5">{c.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {finished && (
          <div className={cn("flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gradient-to-r from-emerald-50 to-teal-50 p-4 ring-1 ring-emerald-100")}>
            <p className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
              <Flag className="size-4" aria-hidden /> {node?.outcome ?? "End of scenario — reflect on how your choices played out."}
            </p>
            <Button variant="secondary" size="sm" leftIcon={<RotateCcw />} onClick={() => setPath([])}>
              Try a different path
            </Button>
          </div>
        )}
      </div>

      {debrief && (finished || !interactive) && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 motion-safe:animate-fade-up" aria-label="Debrief">
          <Markdown>{debrief}</Markdown>
        </section>
      )}
    </div>
  );
}
