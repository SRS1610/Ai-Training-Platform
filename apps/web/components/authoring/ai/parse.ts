/** Light, client-side understanding of a natural-language course request → structured generation fields. */

export interface ParsedRequest {
  subject?: string;
  audience?: string;
  difficulty?: string;
  weeks?: number;
  industry?: string;
  format?: string;
  duration?: string;
}

const INDUSTRIES: [RegExp, string][] = [
  [/\b(health ?care|hospital|clinical|nhs|nurs\w*|patient)/i, "healthcare"],
  [/\b(bank\w*|financ\w*|fintech|insurance)/i, "finance"],
  [/\b(retail|e-?commerce|store)/i, "retail"],
  [/\b(manufactur\w*|factory|plant)/i, "manufacturing"],
  [/\b(call ?cent(er|re)|customer (service|support)|contact cent(er|re))/i, "customer service"],
  [/\b(soc|cyber\w*|security|infosec)/i, "cybersecurity"],
  [/\b(help ?desk|it support|service desk|sysadmin|devops|cloud)/i, "IT"],
  [/\b(hospitality|hotel|restaurant)/i, "hospitality"],
  [/\b(logistics|warehouse|supply chain)/i, "logistics"],
];

function titleCase(s: string): string {
  const small = new Set(["a", "an", "and", "for", "of", "the", "to", "in", "on", "with", "or"]);
  return s
    .split(/\s+/)
    .map((w, i) => (i > 0 && small.has(w.toLowerCase()) ? w.toLowerCase() : /^[A-Z0-9]{2,}$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

export function parseRequest(text: string): ParsedRequest {
  const t = text.trim();
  if (!t) return {};
  const out: ParsedRequest = {};

  const weeks = t.match(/(\d{1,2})\s*-?\s*weeks?\b/i);
  if (weeks) {
    const n = Number(weeks[1]);
    if (n >= 1 && n <= 26) {
      out.weeks = n;
      out.duration = `${n} week${n === 1 ? "" : "s"}`;
    }
  }
  const hours = t.match(/(\d{1,3})\s*-?\s*(hours?|hrs?)\b/i);
  if (hours && !out.duration) out.duration = `${hours[1]} hours`;

  if (/\b(beginner|junior|entry[- ]level|intro(ductory)?|foundation(al)?|new (starters?|hires?)|novice)\b/i.test(t)) out.difficulty = "beginner";
  else if (/\b(intermediate|mid[- ]level|practitioner)\b/i.test(t)) out.difficulty = "intermediate";
  else if (/\b(advanced|senior|experienced)\b/i.test(t)) out.difficulty = "advanced";
  else if (/\b(expert|master(class)?|principal)\b/i.test(t)) out.difficulty = "expert";

  const aud = t.match(/\bfor\s+((?:new|junior|senior|experienced|our|all|first[- ]line|frontline)?\s*[\w\s/&-]{3,60}?)(?=[.,;:!?]|\s+(?:who|that|with|covering|in|on|using|focus)\b|$)/i);
  if (aud) out.audience = aud[1]!.trim().replace(/\s+/g, " ");

  for (const [re, name] of INDUSTRIES) {
    if (re.test(t)) {
      out.industry = name;
      break;
    }
  }

  if (/\b(self[- ]paced)\b/i.test(t)) out.format = "self-paced";
  else if (/\b(instructor[- ]led|classroom|workshop)\b/i.test(t)) out.format = "instructor-led";
  else if (/\b(blended)\b/i.test(t)) out.format = "blended";
  else if (/\b(micro[- ]?learning|bite[- ]sized)\b/i.test(t)) out.format = "microlearning";

  // Topic: drop the verb, size and audience clauses, keep the subject phrase.
  let topic = t
    .replace(/^(please\s+)?(create|build|make|design|generate|write|draft|develop|put together)\s+(me\s+)?(an?|the|some)?\s*/i, "")
    .replace(/\b\d{1,2}\s*-?\s*(weeks?|hours?|hrs?|days?|modules?)\b\s*(long)?/gi, "")
    .replace(/\bfor\s+.*$/i, "")
    .replace(/\b(beginner|junior|intermediate|advanced|expert|introductory|self[- ]paced|instructor[- ]led|blended)\b/gi, "")
    .replace(/\b(online\s+)?(training\s+)?(course|program(me)?|curriculum|module|training|bootcamp|workshop)s?\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, "")
    .trim();
  if (topic.length < 3) topic = t;
  out.subject = titleCase(topic).slice(0, 300);
  return out;
}

export const EXAMPLE_PROMPTS = [
  "Create a 4-week cybersecurity incident response course for junior SOC analysts",
  "Build a 2-week customer service de-escalation course for new call centre agents",
  "Design an advanced Kubernetes troubleshooting course for experienced DevOps engineers",
  "Make a 3-week hand hygiene and infection control course for new healthcare assistants",
];
