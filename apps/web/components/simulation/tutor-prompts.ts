/**
 * Simulation-specific starter questions for the AI tutor drawer, built from what the learner is looking
 * at (the scenario's objectives and people while playing; missed steps and wrong decisions in the debrief).
 */
import type { SessionView, SimResult } from "./types";

/** IT network troubleshooting scenarios (the flagship) keep the signature DNS starter. */
const NETWORK = /network|connect|dns|wi-?fi|vpn|internet|intranet/i;

function clip(s: string, n = 64) {
  const t = s.trim().replace(/\s+/g, " ").replace(/[.!?]+$/, "");
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
}

const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s);

function isNetworkScenario(meta: SessionView["meta"]) {
  return (meta.industry ?? "").toLowerCase() === "it" && NETWORK.test(`${meta.title} ${meta.description} ${meta.briefing}`);
}

function unique(list: (string | null | undefined | false)[], max: number) {
  return [...new Set(list.filter((x): x is string => !!x))].slice(0, max);
}

/** Starters while playing: framed as approach/method questions (graded attempts get hints, not answers). */
export function workspaceTutorPrompts(view: SessionView): string[] {
  const person = view.characters.find((c) => c.id !== "system");
  const objective = view.meta.objectives[0];
  return unique(
    [
      isNetworkScenario(view.meta) && "Why would DNS cause this problem?",
      view.phase?.name && `How should I approach the ${view.phase.name.toLowerCase()} phase?`,
      objective && `What does good look like for: ${lowerFirst(clip(objective))}?`,
      person && `What should I ask ${person.name.split(" ")[0]} to narrow this down?`,
      "What mistakes do people usually make in a scenario like this?",
    ],
    4,
  );
}

/** Starters in the debrief: about this attempt's missed steps, wrong calls and weakest dimension. */
export function resultTutorPrompts(r: SimResult, meta: SessionView["meta"]): string[] {
  const f = r.feedback ?? {};
  const wrong = [...(f.critical_actions ?? []), ...(f.incorrect_actions ?? [])][0];
  const missed = (f.missed_steps ?? [])[0];
  const improve = (f.improvements ?? [])[0];
  const weakest = [...(r.dimensions ?? [])].sort((a, b) => a.percent - b.percent)[0];
  return unique(
    [
      wrong && `What should I have done instead of “${clip(wrong.label, 56)}”?`,
      missed && `Why does this step matter: ${lowerFirst(clip(missed.text))}?`,
      weakest && weakest.percent < 100 && `How can I improve my ${weakest.name.toLowerCase()} score?`,
      improve && `Help me practise this: ${lowerFirst(clip(improve.text))}`,
      isNetworkScenario(meta) && "Why would DNS cause this problem?",
      "What would an expert have done differently?",
      "Quiz me on the key steps of this scenario",
    ],
    4,
  );
}
