"use client";

import { Badge, Button, cn, colorClasses } from "@praxis/ui";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  CheckCircle2,
  ExternalLink,
  FileText,
  Lightbulb,
  Play,
  RotateCw,
  Send,
  XCircle,
} from "lucide-react";
import * as React from "react";
import { Markdown } from "@/components/common/markdown";
import { CodeBlock } from "../code-editor";
import { activityMeta, CALLOUT_VARIANTS, lessonMeta } from "../meta";
import { TypeChip } from "../shared";
import type { LinkedItem } from "../types";

type C = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

export interface RenderableLesson {
  title: string;
  summary?: string | null;
  lesson_type: string;
  content: C;
  duration_minutes?: number;
  linked?: LinkedItem | null;
  activities?: { id: string; activity_type: string; title: string | null; content: C }[];
}

/* ------------------------------------------------------------------ media helpers */

function embedFor(url: string): string | null {
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`;
  const vimeo = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  return null;
}

function Video({ c }: { c: C }) {
  const url = str(c.video_url);
  if (!url) return <EmptyMedia label="No video yet" />;
  const embed = embedFor(url);
  return (
    <div className="overflow-hidden rounded-2xl bg-slate-900 shadow-lift">
      {embed ? (
        <iframe
          src={embed}
          title="Lesson video"
          className="aspect-video w-full"
          allow="accelerometer; encrypted-media; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video controls preload="metadata" className="aspect-video w-full" poster={str(c.poster_url) || undefined} src={url}>
          {str(c.captions_url) && <track kind="captions" src={str(c.captions_url)} label="Captions" default />}
        </video>
      )}
    </div>
  );
}

function Transcript({ text }: { text: string }) {
  if (!text.trim()) return null;
  return (
    <details className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <summary className="cursor-pointer list-none text-sm font-semibold text-slate-800 focus-visible:focus-ring">
        <span className="inline-flex items-center gap-2">
          <FileText className="size-4 text-brand-600" aria-hidden /> Transcript
          <span className="text-xs font-normal text-muted-foreground group-open:hidden">(show)</span>
        </span>
      </summary>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{text}</p>
    </details>
  );
}

function EmptyMedia({ label }: { label: string }) {
  return (
    <div className="grid aspect-video place-items-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 text-sm text-muted-foreground">
      {label}
    </div>
  );
}

function DocCard({ url, title, kind }: { url: string; title: string; kind: string }) {
  if (!url) return <EmptyMedia label={`No ${kind} attached yet`} />;
  return (
    <div className="flex flex-col items-start gap-4 rounded-2xl border border-slate-200 bg-gradient-to-br from-emerald-50 via-white to-white p-5 shadow-sm sm:flex-row sm:items-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-sm">
        <FileText className="size-7" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-display text-base font-semibold text-slate-900">{title}</p>
        <p className="text-sm text-muted-foreground">Opens in a new tab · {kind}</p>
      </div>
      <Button asChild variant="secondary" leftIcon={<ExternalLink />}>
        <a href={url} target="_blank" rel="noopener noreferrer">
          Open {kind}
        </a>
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ interactive pieces */

export function FlashcardDeck({ cards }: { cards: { front: string; back: string }[] }) {
  const [i, setI] = React.useState(0);
  const [flipped, setFlipped] = React.useState(false);
  if (!cards.length) return <EmptyMedia label="No cards yet" />;
  const card = cards[Math.min(i, cards.length - 1)]!;
  const go = (d: number) => {
    setFlipped(false);
    setI((x) => (x + d + cards.length) % cards.length);
  };
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setFlipped((f) => !f)}
        aria-label={flipped ? "Show front of card" : "Flip card to see the answer"}
        className={cn(
          "relative grid min-h-[200px] w-full place-items-center rounded-3xl p-8 text-center shadow-lift transition-all duration-300 focus-visible:focus-ring",
          flipped ? "bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white" : "bg-gradient-to-br from-amber-50 via-white to-orange-50 ring-1 ring-amber-200",
        )}
      >
        <span className={cn("absolute left-4 top-3 text-2xs font-bold uppercase tracking-wider", flipped ? "text-violet-100" : "text-amber-700")}>
          {flipped ? "Answer" : "Question"}
        </span>
        <span className={cn("font-display text-lg font-semibold sm:text-xl", !flipped && "text-slate-900")} aria-live="polite">
          {flipped ? card.back : card.front}
        </span>
        <span className={cn("absolute bottom-3 right-4 inline-flex items-center gap-1 text-2xs font-medium", flipped ? "text-violet-100" : "text-slate-500")}>
          <RotateCw className="size-3" aria-hidden /> Tap to flip
        </span>
      </button>
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" leftIcon={<ArrowLeft />} onClick={() => go(-1)}>
          Previous
        </Button>
        <span className="text-xs font-semibold tabular-nums text-slate-600">
          {Math.min(i, cards.length - 1) + 1} / {cards.length}
        </span>
        <Button variant="ghost" size="sm" rightIcon={<ArrowRight />} onClick={() => go(1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

export function ScenarioPlayer({ c }: { c: C }) {
  const choices = (Array.isArray(c.choices) ? c.choices : []) as { id?: string; text: string; feedback?: string; outcome?: string }[];
  const [picked, setPicked] = React.useState<number | null>(null);
  const body = str(c.scenario) || str(c.body_markdown);
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-teal-200 bg-gradient-to-br from-teal-50 via-white to-white p-5">
        <p className="mb-2 text-2xs font-bold uppercase tracking-wider text-teal-700">The situation</p>
        {body ? <Markdown>{body}</Markdown> : <p className="text-sm text-muted-foreground">No scenario text yet.</p>}
      </div>
      {str(c.prompt) && <p className="font-semibold text-slate-900">{str(c.prompt)}</p>}
      {choices.length > 0 && (
        <div className="grid gap-2">
          {choices.map((ch, i) => {
            const on = picked === i;
            const tone = ch.outcome === "best" ? "emerald" : ch.outcome === "poor" ? "rose" : "amber";
            const cc = colorClasses(tone);
            return (
              <div key={ch.id ?? i}>
                <button
                  type="button"
                  onClick={() => setPicked(i)}
                  aria-pressed={on}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-xl border p-3.5 text-left text-sm transition-all focus-visible:focus-ring",
                    on ? cn(cc.border, cc.soft, "shadow-sm") : "border-slate-200 bg-white hover:border-brand-300 hover:bg-brand-50/40",
                  )}
                >
                  <span className={cn("grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold", on ? cn(cc.solid, "text-white") : "bg-slate-100 text-slate-600")}>
                    {String.fromCharCode(65 + i)}
                  </span>
                  <span className="pt-0.5 text-slate-800">{ch.text}</span>
                </button>
                {on && (ch.feedback || ch.outcome) && (
                  <div className={cn("mt-1.5 rounded-xl px-4 py-3 text-sm", cc.soft, cc.text)} role="status">
                    {ch.outcome && <strong className="mr-1 capitalize">{ch.outcome === "best" ? "Great choice." : ch.outcome === "poor" ? "Risky choice." : "Acceptable."}</strong>}
                    {ch.feedback}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {str(c.debrief) && picked !== null && (
        <div className="rounded-2xl border border-violet-200 bg-violet-50/60 p-4">
          <p className="mb-1 text-2xs font-bold uppercase tracking-wider text-violet-700">Debrief</p>
          <Markdown>{str(c.debrief)}</Markdown>
        </div>
      )}
    </div>
  );
}

function KnowledgeCheck({ c }: { c: C }) {
  const options = (Array.isArray(c.options) ? c.options : []) as { id: string; text: string }[];
  const answers = new Set(((Array.isArray(c.answer_ids) ? c.answer_ids : []) as string[]).map(String));
  const [sel, setSel] = React.useState<Set<string>>(new Set());
  const [checked, setChecked] = React.useState(false);
  const multi = answers.size > 1;
  const correct = checked && sel.size === answers.size && [...sel].every((s) => answers.has(s));
  return (
    <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50/70 via-white to-white p-5">
      <p className="mb-1 text-2xs font-bold uppercase tracking-wider text-emerald-700">Knowledge check</p>
      <p className="font-semibold text-slate-900">{str(c.question) || "Question"}</p>
      <div className="mt-3 grid gap-2">
        {options.map((o) => {
          const on = sel.has(o.id);
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={on}
              onClick={() => {
                setChecked(false);
                setSel((s) => {
                  const n = new Set(multi ? s : []);
                  if (on) n.delete(o.id);
                  else n.add(o.id);
                  return n;
                });
              }}
              className={cn(
                "rounded-xl border px-3.5 py-2.5 text-left text-sm transition-colors focus-visible:focus-ring",
                on ? "border-brand-400 bg-brand-50 text-brand-900" : "border-slate-200 bg-white hover:bg-slate-50",
                checked && answers.has(o.id) && "border-emerald-400 bg-emerald-50 text-emerald-900",
              )}
            >
              {o.text}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button size="sm" variant="success" onClick={() => setChecked(true)} disabled={!sel.size}>
          Check answer
        </Button>
        {checked && (
          <span className={cn("inline-flex items-center gap-1.5 text-sm font-semibold", correct ? "text-emerald-700" : "text-rose-700")} role="status">
            {correct ? <CheckCircle2 className="size-4" aria-hidden /> : <XCircle className="size-4" aria-hidden />}
            {correct ? "Correct!" : "Not quite."}
          </span>
        )}
      </div>
      {checked && str(c.explanation) && <p className="mt-2 text-sm text-slate-700">{str(c.explanation)}</p>}
    </div>
  );
}

function Callout({ c }: { c: C }) {
  const v = CALLOUT_VARIANTS.find((x) => x.value === c.variant) ?? CALLOUT_VARIANTS[1];
  const cc = colorClasses(v.color);
  return (
    <div className={cn("flex gap-3 rounded-2xl border p-4", cc.border, cc.soft)}>
      <Lightbulb className={cn("mt-0.5 size-5 shrink-0", cc.icon)} aria-hidden />
      <div className={cn("min-w-0 text-sm", cc.text)}>
        <p className="mb-0.5 text-2xs font-bold uppercase tracking-wider">{v.label}</p>
        <Markdown className="text-[14px] text-slate-800">{str(c.body_markdown)}</Markdown>
      </div>
    </div>
  );
}

function Sandboxed({ html, title }: { html: string; title: string }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-violet-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-violet-100 bg-violet-50/60 px-3 py-1.5 text-2xs font-semibold text-violet-700">
        <span className="size-2 rounded-full bg-violet-400" aria-hidden /> Sandboxed preview · scripts run isolated from Praxis
      </div>
      <iframe title={title} sandbox="allow-scripts" srcDoc={html} className="h-[360px] w-full bg-white" />
    </div>
  );
}

function LinkedCard({ lessonType, linked }: { lessonType: string; linked?: LinkedItem | null }) {
  const meta = lessonMeta(lessonType);
  const c = colorClasses(meta.color);
  return (
    <div className={cn("relative overflow-hidden rounded-3xl border bg-gradient-to-br p-6", c.border, c.tint)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <TypeChip meta={meta} size="lg" />
        <div className="min-w-0 flex-1">
          <p className={cn("text-2xs font-bold uppercase tracking-wider", c.text)}>{meta.label}</p>
          <p className="font-display text-lg font-semibold text-slate-900">{linked?.title ?? `No ${meta.label.toLowerCase()} linked yet`}</p>
          {linked?.status && (
            <Badge size="sm" tone={linked.status === "published" ? "success" : "neutral"} className="mt-1">
              {linked.status}
            </Badge>
          )}
        </div>
        <Button variant="gradient" leftIcon={<Play />} disabled>
          Start
        </Button>
      </div>
    </div>
  );
}

function TutorCard({ c }: { c: C }) {
  const starters = (Array.isArray(c.starter_prompts) ? c.starter_prompts : []) as string[];
  return (
    <div className="overflow-hidden rounded-3xl border border-fuchsia-200 bg-white shadow-sm">
      <div className="flex items-center gap-3 bg-gradient-to-r from-fuchsia-500 to-violet-500 px-5 py-3 text-white">
        <Bot className="size-5" aria-hidden />
        <p className="font-semibold">AI tutor session</p>
      </div>
      <div className="space-y-3 p-5">
        <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-fuchsia-50 px-4 py-3 text-sm text-slate-800">
          {str(c.instructions) || "Hi! Ask me anything about this lesson — I'll explain, give hints and quiz you."}
        </div>
        {starters.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {starters.map((s) => (
              <span key={s} className="rounded-full border border-fuchsia-200 bg-white px-3 py-1 text-xs font-medium text-fuchsia-800">
                {s}
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-400">
          Ask the tutor… <Send className="ml-auto size-4" aria-hidden />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ block renderer */

function Block({ type, c, title }: { type: string; c: C; title: string }) {
  switch (type) {
    case "text":
      return str(c.body_markdown) ? <Markdown>{str(c.body_markdown)}</Markdown> : <p className="text-sm italic text-slate-400">Empty text.</p>;
    case "video":
      return (
        <div className="space-y-3">
          <Video c={c} />
          <Transcript text={str(c.transcript)} />
        </div>
      );
    case "audio":
      return (
        <div className="space-y-3">
          {str(c.audio_url) ? (
            <div className="rounded-2xl border border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50 p-4">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <audio controls src={str(c.audio_url)} className="w-full" />
            </div>
          ) : (
            <EmptyMedia label="No audio yet" />
          )}
          <Transcript text={str(c.transcript)} />
        </div>
      );
    case "pdf":
    case "powerpoint":
    case "file":
      return (
        <div className="space-y-3">
          <DocCard url={str(c.url) || str(c.embed_url)} title={title} kind={type === "powerpoint" ? "slides" : type === "file" ? "file" : "PDF"} />
          {str(c.body_markdown) && <Markdown>{str(c.body_markdown)}</Markdown>}
        </div>
      );
    case "image":
    case "infographic":
      return (
        <figure className="space-y-3">
          {str(c.image_url) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={str(c.image_url)} alt={str(c.alt_text)} className="w-full rounded-2xl border border-slate-200 shadow-sm" />
          ) : (
            <EmptyMedia label="No image yet" />
          )}
          {str(c.caption) && <figcaption className="text-center text-sm text-muted-foreground">{str(c.caption)}</figcaption>}
          {str(c.body_markdown) && <Markdown>{str(c.body_markdown)}</Markdown>}
        </figure>
      );
    case "interactive_html":
      return str(c.html) ? (
        <Sandboxed html={str(c.html)} title={title} />
      ) : (
        <DocCard url={str(c.url)} title={title} kind="interactive page" />
      );
    case "code":
      return (
        <div className="space-y-3">
          {str(c.instructions) && <Markdown>{str(c.instructions)}</Markdown>}
          <CodeBlock code={str(c.code)} language={str(c.language)} />
        </div>
      );
    case "flashcards":
      return <FlashcardDeck cards={(Array.isArray(c.cards) ? c.cards : []) as { front: string; back: string }[]} />;
    case "scenario":
      return <ScenarioPlayer c={c} />;
    case "callout":
      return <Callout c={c} />;
    case "check":
      return <KnowledgeCheck c={c} />;
    case "embed": {
      const e = embedFor(str(c.url));
      return e ? <Video c={{ video_url: str(c.url) }} /> : <DocCard url={str(c.url)} title={title || "Embedded resource"} kind="link" />;
    }
    default:
      return str(c.body_markdown) ? <Markdown>{str(c.body_markdown)}</Markdown> : null;
  }
}

/** Learner-style rendering of a lesson (used for in-builder preview and the course preview). */
export function LessonRender({ lesson, className }: { lesson: RenderableLesson; className?: string }) {
  const meta = lessonMeta(lesson.lesson_type);
  const c = lesson.content ?? {};
  const linked = ["quiz", "assignment", "simulation"].includes(lesson.lesson_type);
  return (
    <article className={cn("space-y-6", className)}>
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <TypeChip meta={meta} size="sm" />
          <span className={cn("text-xs font-semibold uppercase tracking-wider", colorClasses(meta.color).text)}>{meta.label}</span>
          {!!lesson.duration_minutes && <span className="text-xs text-muted-foreground">· {lesson.duration_minutes} min</span>}
        </div>
        <h2 className="font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{lesson.title}</h2>
        {lesson.summary && <p className="text-base text-muted-foreground">{lesson.summary}</p>}
      </header>
      {linked ? (
        <div className="space-y-4">
          {str(c.body_markdown) && <Markdown>{str(c.body_markdown)}</Markdown>}
          {str(c.instructions) && <Markdown>{str(c.instructions)}</Markdown>}
          <LinkedCard lessonType={lesson.lesson_type} linked={lesson.linked} />
        </div>
      ) : lesson.lesson_type === "ai_tutor" ? (
        <div className="space-y-4">
          {str(c.body_markdown) && <Markdown>{str(c.body_markdown)}</Markdown>}
          <TutorCard c={c} />
        </div>
      ) : lesson.lesson_type === "mixed" ? (
        str(c.body_markdown) ? <Markdown>{str(c.body_markdown)}</Markdown> : null
      ) : (
        <Block type={lesson.lesson_type} c={c} title={lesson.title} />
      )}
      {(lesson.activities ?? []).map((a) => {
        const am = activityMeta(a.activity_type);
        return (
          <section key={a.id} aria-label={a.title ?? am.label} className="space-y-2">
            {a.title && <h3 className="font-display text-lg font-semibold text-slate-900">{a.title}</h3>}
            <Block type={a.activity_type} c={a.content} title={a.title ?? am.label} />
          </section>
        );
      })}
    </article>
  );
}
