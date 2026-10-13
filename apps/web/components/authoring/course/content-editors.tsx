"use client";

import {
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
} from "@praxis/ui";
import { ArrowDown, ArrowUp, ClipboardPaste, Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { CodeEditor } from "../code-editor";
import { uid } from "../hooks";
import { MarkdownEditor } from "../markdown-editor";
import { MediaField } from "../media-field";
import { CALLOUT_VARIANTS, CODE_LANGUAGES } from "../meta";
import { StringListEditor } from "../shared";
import { rovingRadio } from "../roving";

type C = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/* ------------------------------------------------------------------ client-side validation (mirrors content_rules.py) */

const URL_RE = /^(https?:\/\/\S+|\/\S*)$/i;

function badUrl(c: C, key: string): string | null {
  const v = str(c[key]).trim();
  return v && !URL_RE.test(v) ? `${key.replaceAll("_", " ")} must be an http(s) link or an absolute path` : null;
}

/** Problems that would make the API reject this content (empty = valid). */
export function contentProblems(type: string, c: C): string[] {
  const p: string[] = [];
  const need = (key: string, label: string) => {
    if (!str(c[key]).trim()) p.push(`${label} is required`);
  };
  const media = (key: string, label: string) => {
    if (!str(c[key]).trim() && !c.file_id) p.push(`Add a ${label} link or upload a file`);
    const b = badUrl(c, key);
    if (b) p.push(b);
  };
  switch (type) {
    case "text":
      need("body_markdown", "Lesson text");
      break;
    case "callout":
      need("body_markdown", "Callout text");
      break;
    case "video":
      media("video_url", "video");
      for (const k of ["captions_url", "poster_url"]) {
        const b = badUrl(c, k);
        if (b) p.push(b);
      }
      break;
    case "audio":
      media("audio_url", "audio");
      break;
    case "pdf":
    case "powerpoint":
    case "file":
      if (!str(c.url).trim() && !c.file_id) p.push("Upload a file or add a link");
      for (const k of ["url", "embed_url"]) {
        const b = badUrl(c, k);
        if (b) p.push(b);
      }
      break;
    case "image":
    case "infographic":
      media("image_url", "image");
      break;
    case "interactive_html":
      if (!str(c.html).trim() && !str(c.url).trim()) p.push("Add HTML or a link to an interactive page");
      if (badUrl(c, "url")) p.push(badUrl(c, "url")!);
      break;
    case "code":
      need("language", "Language");
      need("code", "Code");
      break;
    case "flashcards": {
      const cards = arr<{ front?: string; back?: string }>(c.cards);
      if (!cards.length) p.push("Add at least one card");
      cards.forEach((card, i) => {
        if (!str(card.front).trim() || !str(card.back).trim()) p.push(`Card ${i + 1} needs a front and a back`);
      });
      break;
    }
    case "scenario":
      if (!str(c.scenario).trim() && !str(c.body_markdown).trim()) p.push("Describe the scenario");
      arr<{ text?: string }>(c.choices).forEach((ch, i) => {
        if (!str(ch.text).trim()) p.push(`Choice ${i + 1} needs text`);
      });
      break;
    case "check": {
      need("question", "Question");
      const opts = arr<{ id?: string; text?: string }>(c.options);
      if (opts.length < 2) p.push("Add at least two options");
      if (opts.some((o) => !str(o.text).trim())) p.push("Every option needs text");
      const ids = new Set(opts.map((o) => String(o.id)));
      const ans = arr<string>(c.answer_ids);
      if (!ans.length || !ans.every((a) => ids.has(String(a)))) p.push("Mark at least one correct option");
      break;
    }
    case "embed":
      if (!str(c.url).trim()) p.push("URL is required");
      else if (badUrl(c, "url")) p.push(badUrl(c, "url")!);
      break;
  }
  return p;
}

/** Valid starter content for a new lesson / block of the given type (null = needs input first). */
export function defaultContent(type: string): C | null {
  switch (type) {
    case "text":
      return { body_markdown: "## Introduction\n\nStart writing your lesson here." };
    case "callout":
      return { variant: "tip", body_markdown: "A useful tip for learners." };
    case "code":
      return { language: "python", code: "# Your example\nprint(\"Hello, Praxis\")\n", instructions: "" };
    case "flashcards":
      return { cards: [{ front: "Term", back: "Definition" }] };
    case "scenario":
      return {
        scenario: "Describe the situation the learner faces…",
        prompt: "What do you do first?",
        choices: [
          { id: uid("c"), text: "Gather the facts", feedback: "Good — evidence first.", outcome: "best" },
          { id: uid("c"), text: "Act immediately", feedback: "Acting without facts can make things worse.", outcome: "poor" },
        ],
      };
    case "check":
      return {
        question: "Which statement is correct?",
        options: [
          { id: "a", text: "Option A" },
          { id: "b", text: "Option B" },
        ],
        answer_ids: ["a"],
        explanation: "",
      };
    case "interactive_html":
      return {
        html: '<div style="font-family:system-ui;padding:24px;text-align:center">\n  <h2>Interactive widget</h2>\n  <button onclick="this.textContent=\'Clicked!\'">Click me</button>\n</div>',
      };
    case "quiz":
    case "assignment":
    case "simulation":
    case "ai_tutor":
    case "mixed":
      return {};
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ editor building blocks */

function useField(content: C, onChange: (c: C) => void) {
  return React.useCallback((patch: C) => onChange({ ...content, ...patch }), [content, onChange]);
}

function FlashcardsEditor({ content, onChange }: { content: C; onChange: (c: C) => void }) {
  const set = useField(content, onChange);
  const cards = arr<{ front: string; back: string }>(content.cards);
  const [bulkOpen, setBulkOpen] = React.useState(false);
  const [bulk, setBulk] = React.useState("");
  const update = (i: number, patch: Partial<{ front: string; back: string }>) =>
    set({ cards: cards.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= cards.length) return;
    const next = [...cards];
    [next[i], next[j]] = [next[j]!, next[i]!];
    set({ cards: next });
  };
  const parsed = bulk
    .split("\n")
    .map((l) => l.split(/\t| \| |\|/))
    .filter((p) => p.length >= 2 && p[0]!.trim() && p[1]!.trim())
    .map((p) => ({ front: p[0]!.trim(), back: p.slice(1).join(" ").trim() }));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-800">
          {cards.length} card{cards.length === 1 ? "" : "s"}
        </p>
        <Button variant="secondary" size="sm" leftIcon={<ClipboardPaste />} onClick={() => setBulkOpen(true)}>
          Bulk add
        </Button>
      </div>
      <ol className="space-y-2.5">
        {cards.map((card, i) => (
          <li key={i} className="group rounded-2xl border border-amber-200/70 bg-gradient-to-r from-amber-50/60 to-white p-3 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-800">
                <span className="grid size-5 place-items-center rounded-md bg-amber-100">{i + 1}</span>
                Card
              </span>
              <div className="flex items-center">
                <Button variant="ghost" size="icon-sm" aria-label={`Move card ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label={`Move card ${i + 1} down`} disabled={i === cards.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label={`Delete card ${i + 1}`} onClick={() => set({ cards: cards.filter((_, j) => j !== i) })}>
                  <Trash2 />
                </Button>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Textarea rows={2} className="min-h-[64px]" placeholder="Front (question / term)" aria-label={`Card ${i + 1} front`} value={card.front} onChange={(e) => update(i, { front: e.target.value })} />
              <Textarea rows={2} className="min-h-[64px]" placeholder="Back (answer / definition)" aria-label={`Card ${i + 1} back`} value={card.back} onChange={(e) => update(i, { back: e.target.value })} />
            </div>
          </li>
        ))}
      </ol>
      <Button variant="soft" size="sm" leftIcon={<Plus />} onClick={() => set({ cards: [...cards, { front: "", back: "" }] })}>
        Add card
      </Button>
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk add flashcards</DialogTitle>
            <DialogDescription>One card per line: front and back separated by a tab or “ | ”. Paste straight from a spreadsheet.</DialogDescription>
          </DialogHeader>
          <Textarea rows={8} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={"Phishing | A fraudulent message designed to steal credentials\nMFA | Multi-factor authentication"} aria-label="Cards to add" />
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {parsed.length} card{parsed.length === 1 ? "" : "s"} detected
          </p>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setBulkOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!parsed.length}
              onClick={() => {
                set({ cards: [...cards.filter((c) => c.front || c.back), ...parsed] });
                setBulk("");
                setBulkOpen(false);
              }}
            >
              Add {parsed.length || ""} cards
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const OUTCOMES = [
  { value: "best", label: "Best choice", color: "emerald" },
  { value: "acceptable", label: "Acceptable", color: "amber" },
  { value: "poor", label: "Poor choice", color: "rose" },
] as const;

function ScenarioEditor({ content, onChange }: { content: C; onChange: (c: C) => void }) {
  const set = useField(content, onChange);
  const choices = arr<{ id?: string; text: string; feedback?: string; outcome?: string }>(content.choices);
  const update = (i: number, patch: Record<string, unknown>) => set({ choices: choices.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  return (
    <div className="space-y-5">
      <FormField label="The situation" hint="Set the scene: who, where, what just happened." required>
        {(aria) => <MarkdownEditor {...aria} label="Scenario" value={str(content.scenario) || str(content.body_markdown)} onChange={(v) => set({ scenario: v })} minRows={6} compact />}
      </FormField>
      <FormField label="Decision prompt" hint="The question the learner must answer.">
        <Input value={str(content.prompt)} onChange={(e) => set({ prompt: e.target.value })} placeholder="What do you do first?" />
      </FormField>
      <div className="space-y-2.5">
        <p className="text-sm font-semibold text-slate-800">Branches</p>
        {choices.map((ch, i) => {
          const o = OUTCOMES.find((x) => x.value === ch.outcome) ?? OUTCOMES[1];
          const cc = colorClasses(o.color);
          return (
            <div key={ch.id ?? i} className={cn("rounded-2xl border bg-white p-3 shadow-sm", cc.border)}>
              <div className="flex items-start gap-2">
                <span className={cn("mt-2 grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold text-white", cc.solid)} aria-hidden>
                  {String.fromCharCode(65 + i)}
                </span>
                <div className="grid min-w-0 flex-1 gap-2">
                  <Input inputSize="sm" value={ch.text} placeholder="Choice the learner can make" aria-label={`Branch ${i + 1} choice`} onChange={(e) => update(i, { text: e.target.value })} />
                  <Textarea rows={2} className="min-h-[60px]" value={str(ch.feedback)} placeholder="Feedback shown after choosing this branch" aria-label={`Branch ${i + 1} feedback`} onChange={(e) => update(i, { feedback: e.target.value })} />
                  <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" {...rovingRadio} aria-label={`Branch ${i + 1} outcome`}>
                    {OUTCOMES.map((x) => {
                      const on = (ch.outcome ?? "acceptable") === x.value;
                      const xc = colorClasses(x.color);
                      return (
                        <button
                          key={x.value}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => update(i, { outcome: x.value })}
                          className={cn("rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset focus-visible:focus-ring", on ? cn(xc.soft, xc.text, xc.ring) : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50")}
                        >
                          {x.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <Button variant="ghost" size="icon-sm" aria-label={`Delete branch ${i + 1}`} onClick={() => set({ choices: choices.filter((_, j) => j !== i) })}>
                  <Trash2 />
                </Button>
              </div>
            </div>
          );
        })}
        <Button variant="soft" size="sm" leftIcon={<Plus />} onClick={() => set({ choices: [...choices, { id: uid("c"), text: "", feedback: "", outcome: "acceptable" }] })}>
          Add branch
        </Button>
      </div>
      <FormField label="Debrief" hint="Shown after the learner commits to a choice.">
        {(aria) => <MarkdownEditor {...aria} label="Debrief" value={str(content.debrief)} onChange={(v) => set({ debrief: v })} minRows={4} compact />}
      </FormField>
    </div>
  );
}

function CheckEditor({ content, onChange }: { content: C; onChange: (c: C) => void }) {
  const set = useField(content, onChange);
  const options = arr<{ id: string; text: string }>(content.options);
  const answers = arr<string>(content.answer_ids).map(String);
  const toggle = (id: string) => set({ answer_ids: answers.includes(id) ? answers.filter((a) => a !== id) : [...answers, id] });
  return (
    <div className="space-y-3">
      <FormField label="Question" required>
        <Input value={str(content.question)} onChange={(e) => set({ question: e.target.value })} />
      </FormField>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-semibold text-slate-800">Options · tick the correct ones</legend>
        {options.map((o, i) => (
          <div key={o.id} className="flex items-center gap-2">
            <button
              type="button"
              role="checkbox"
              aria-checked={answers.includes(o.id)}
              aria-label={`Option ${i + 1} is correct`}
              onClick={() => toggle(o.id)}
              className={cn("grid size-7 shrink-0 place-items-center rounded-lg border-2 text-xs font-bold focus-visible:focus-ring", answers.includes(o.id) ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 text-slate-400")}
            >
              ✓
            </button>
            <Input inputSize="sm" value={o.text} aria-label={`Option ${i + 1}`} onChange={(e) => set({ options: options.map((x) => (x.id === o.id ? { ...x, text: e.target.value } : x)) })} />
            <Button variant="ghost" size="icon-sm" aria-label={`Remove option ${i + 1}`} disabled={options.length <= 2} onClick={() => set({ options: options.filter((x) => x.id !== o.id), answer_ids: answers.filter((a) => a !== o.id) })}>
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button variant="soft" size="xs" leftIcon={<Plus />} onClick={() => set({ options: [...options, { id: uid("o"), text: "" }] })}>
          Add option
        </Button>
      </fieldset>
      <FormField label="Explanation" hint="Shown after checking.">
        <Textarea rows={2} value={str(content.explanation)} onChange={(e) => set({ explanation: e.target.value })} />
      </FormField>
    </div>
  );
}

function HtmlEditor({ content, onChange }: { content: C; onChange: (c: C) => void }) {
  const set = useField(content, onChange);
  const html = str(content.html);
  const [preview, setPreview] = React.useState(html);
  React.useEffect(() => {
    const t = setTimeout(() => setPreview(html), 500);
    return () => clearTimeout(t);
  }, [html]);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <FormField label="HTML, CSS & JavaScript" hint="Runs in a locked-down sandbox (no access to Praxis, cookies or the network origin).">
          {(aria) => <CodeEditor {...aria} language="html" value={html} onChange={(v) => set({ html: v })} minLines={14} maxHeight={420} aria-label="Interactive HTML" />}
        </FormField>
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-slate-800">Live preview</p>
          <div className="overflow-hidden rounded-2xl border border-violet-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-violet-100 bg-violet-50/70 px-3 py-1.5 text-2xs font-semibold text-violet-700">
              <span className="size-2 rounded-full bg-violet-400 motion-safe:animate-pulse" aria-hidden /> sandbox=&quot;allow-scripts&quot;
            </div>
            <iframe title="Interactive HTML preview" sandbox="allow-scripts" srcDoc={preview} className="h-[392px] w-full bg-white" />
          </div>
        </div>
      </div>
      <FormField label="…or link to an external interactive page" hint="Used when no HTML is provided.">
        <Input value={str(content.url)} onChange={(e) => set({ url: e.target.value })} placeholder="https://…" />
      </FormField>
    </div>
  );
}

/* ------------------------------------------------------------------ main switch */

/**
 * Field editor for a lesson's / activity block's `content`. Linked lesson types (quiz, assignment,
 * simulation) only edit their intro text here; the link itself lives on the lesson.
 */
export function ContentEditor({ type, content, onChange, title }: { type: string; content: C; onChange: (c: C) => void; title?: string }) {
  const set = (patch: C) => onChange({ ...content, ...patch });
  const md = (key: string, label: string, opts: { required?: boolean; hint?: string; rows?: number; compact?: boolean } = {}) => (
    <FormField label={label} required={opts.required} hint={opts.hint}>
      {(aria) => <MarkdownEditor {...aria} label={label} value={str(content[key])} onChange={(v) => set({ [key]: v })} minRows={opts.rows ?? 12} compact={opts.compact} />}
    </FormField>
  );

  switch (type) {
    case "text":
      return md("body_markdown", "Lesson text", { required: true, rows: 16 });
    case "mixed":
      return md("body_markdown", "Introduction", { hint: "Optional intro shown above the blocks below.", rows: 5, compact: true });
    case "video":
      return (
        <div className="space-y-4">
          <MediaField
            label="Video"
            required
            url={str(content.video_url)}
            fileId={str(content.file_id) || null}
            accept=".mp4,.webm"
            hint="YouTube and Vimeo links are embedded privacy-friendly; uploads stream from Praxis."
            onChange={(v) => set({ video_url: v.url, file_id: v.file_id ?? undefined })}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Captions URL (WebVTT)" hint="Captions make video accessible — strongly recommended.">
              <Input value={str(content.captions_url)} onChange={(e) => set({ captions_url: e.target.value })} placeholder="https://…/captions.vtt" />
            </FormField>
            <FormField label="Poster image URL">
              <Input value={str(content.poster_url)} onChange={(e) => set({ poster_url: e.target.value })} placeholder="https://…/poster.jpg" />
            </FormField>
          </div>
          <FormField label="Transcript" hint="Searchable text version for accessibility and the AI tutor.">
            <Textarea rows={6} value={str(content.transcript)} onChange={(e) => set({ transcript: e.target.value })} />
          </FormField>
        </div>
      );
    case "audio":
      return (
        <div className="space-y-4">
          <MediaField label="Audio" required url={str(content.audio_url)} fileId={str(content.file_id) || null} accept=".mp3,.wav,.m4a,.webm" onChange={(v) => set({ audio_url: v.url, file_id: v.file_id ?? undefined })} />
          <FormField label="Transcript">
            <Textarea rows={6} value={str(content.transcript)} onChange={(e) => set({ transcript: e.target.value })} />
          </FormField>
        </div>
      );
    case "pdf":
    case "powerpoint":
    case "file":
      return (
        <div className="space-y-4">
          <MediaField
            label={type === "powerpoint" ? "Slide deck" : type === "pdf" ? "PDF document" : "File"}
            required
            url={str(content.url)}
            fileId={str(content.file_id) || null}
            accept={type === "powerpoint" ? ".pptx,.pdf" : type === "pdf" ? ".pdf" : ".pdf,.docx,.pptx,.xlsx,.csv,.txt,.md,.zip"}
            onChange={(v) => set({ url: v.url, file_id: v.file_id ?? undefined })}
          />
          {type !== "file" && (
            <FormField label="Embed URL" hint="Optional viewer link (e.g. a published slides URL).">
              <Input value={str(content.embed_url)} onChange={(e) => set({ embed_url: e.target.value })} placeholder="https://…" />
            </FormField>
          )}
          {type !== "file" && md("body_markdown", "Notes for learners", { rows: 5, compact: true })}
        </div>
      );
    case "image":
    case "infographic":
      return (
        <div className="space-y-4">
          <MediaField label={type === "infographic" ? "Infographic image" : "Image"} required url={str(content.image_url)} fileId={str(content.file_id) || null} accept=".png,.jpg,.jpeg,.gif,.webp" onChange={(v) => set({ image_url: v.url, file_id: v.file_id ?? undefined })} />
          {str(content.image_url) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={str(content.image_url)} alt={str(content.alt_text) || "Preview"} className="max-h-64 rounded-2xl border border-slate-200 object-contain" />
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Alt text" hint={str(content.alt_text) ? "Describes the image for screen readers." : "Missing — screen-reader users won't know what this shows."} error={null}>
              <Input value={str(content.alt_text)} onChange={(e) => set({ alt_text: e.target.value })} placeholder="What the image shows" />
            </FormField>
            <FormField label="Caption">
              <Input value={str(content.caption)} onChange={(e) => set({ caption: e.target.value })} />
            </FormField>
          </div>
          {type === "infographic" && md("body_markdown", "Key takeaways", { rows: 6, compact: true })}
        </div>
      );
    case "interactive_html":
      return <HtmlEditor content={content} onChange={onChange} />;
    case "code":
      return (
        <div className="space-y-4">
          <FormField label="Language" required>
            {(aria) => (
              <SimpleSelect {...aria} value={str(content.language) || "python"} onValueChange={(v) => set({ language: v })} options={CODE_LANGUAGES.map((l) => ({ value: l, label: l }))} className="sm:w-56" />
            )}
          </FormField>
          <FormField label="Code" required>
            {(aria) => <CodeEditor {...aria} language={str(content.language)} value={str(content.code)} onChange={(v) => set({ code: v })} minLines={12} aria-label="Code" />}
          </FormField>
          {md("instructions", "Walkthrough", { rows: 5, compact: true, hint: "Explain what the code does." })}
        </div>
      );
    case "flashcards":
      return <FlashcardsEditor content={content} onChange={onChange} />;
    case "scenario":
      return <ScenarioEditor content={content} onChange={onChange} />;
    case "callout":
      return (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" {...rovingRadio} aria-label="Callout style">
            {CALLOUT_VARIANTS.map((v) => {
              const on = (str(content.variant) || "tip") === v.value;
              const cc = colorClasses(v.color);
              return (
                <button key={v.value} type="button" role="radio" aria-checked={on} onClick={() => set({ variant: v.value })} className={cn("rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset focus-visible:focus-ring", on ? cn(cc.soft, cc.text, cc.ring) : "bg-white text-slate-600 ring-slate-200")}>
                  {v.label}
                </button>
              );
            })}
          </div>
          {md("body_markdown", "Callout text", { required: true, rows: 3, compact: true })}
        </div>
      );
    case "check":
      return <CheckEditor content={content} onChange={onChange} />;
    case "embed":
      return (
        <FormField label="URL" required hint="YouTube/Vimeo links play inline; other links open in a new tab.">
          <Input value={str(content.url)} onChange={(e) => set({ url: e.target.value })} placeholder="https://…" />
        </FormField>
      );
    case "ai_tutor":
      return (
        <div className="space-y-4">
          {md("body_markdown", "Introduction", { rows: 4, compact: true, hint: "What learners should get out of this conversation." })}
          <FormField label="Tutor focus" hint="Guidance for the AI tutor: what to explain, quiz or coach on.">
            <Textarea rows={3} value={str(content.instructions)} onChange={(e) => set({ instructions: e.target.value })} placeholder={`Coach the learner through ${title ?? "this topic"}; ask one question at a time.`} />
          </FormField>
          <FormField label="Starter prompts">
            <StringListEditor label="starter prompt" value={arr<string>(content.starter_prompts)} onChange={(v) => set({ starter_prompts: v })} placeholder="e.g. Explain this like I'm new to the team" color="fuchsia" />
          </FormField>
        </div>
      );
    case "quiz":
    case "assignment":
    case "simulation":
      return md("body_markdown", "Instructions shown before starting", { rows: 5, compact: true });
    default:
      return md("body_markdown", "Content", { rows: 8 });
  }
}
