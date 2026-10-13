"use client";

import { Button, Kbd, Progress, cn } from "@praxis/ui";
import { ArrowLeft, ArrowRight, Check, Repeat2, RotateCcw, Shuffle, Sparkles, X } from "lucide-react";
import * as React from "react";
import { Markdown } from "@/components/common/markdown";

interface Card {
  front: string;
  back: string;
  hint?: string;
}

function readCards(content: Record<string, unknown>): Card[] {
  const raw = Array.isArray(content.cards) ? content.cards : [];
  return raw
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
    .map((c) => ({ front: String(c.front ?? ""), back: String(c.back ?? ""), hint: typeof c.hint === "string" ? c.hint : undefined }))
    .filter((c) => c.front.trim() && c.back.trim());
}

const FACE_COLORS = [
  "from-indigo-500 via-violet-500 to-fuchsia-500",
  "from-sky-500 via-cyan-500 to-teal-500",
  "from-amber-400 via-orange-500 to-rose-500",
  "from-emerald-500 via-teal-500 to-sky-500",
  "from-fuchsia-500 via-pink-500 to-rose-500",
];

/** Flip-card deck: click / Space / Enter flips, ← → navigate, mark cards as known or still learning. */
export function Flashcards({ content }: { content: Record<string, unknown> }) {
  const base = React.useMemo(() => readCards(content), [content]);
  const [order, setOrder] = React.useState<number[]>(() => base.map((_, i) => i));
  const [pos, setPos] = React.useState(0);
  const [flipped, setFlipped] = React.useState(false);
  const [marks, setMarks] = React.useState<Record<number, "known" | "learning">>({});
  const [announce, setAnnounce] = React.useState("");
  const hintId = React.useId();

  React.useEffect(() => {
    setOrder(base.map((_, i) => i));
    setPos(0);
    setMarks({});
  }, [base]);

  if (base.length === 0) return <p className="text-sm text-slate-600">This deck has no cards yet.</p>;

  const total = order.length;
  const done = pos >= total;
  const idx = order[Math.min(pos, total - 1)]!;
  const card = base[idx]!;
  const known = Object.values(marks).filter((m) => m === "known").length;
  const reviewed = Object.keys(marks).length;

  const go = (d: number) => {
    setFlipped(false);
    setPos((p) => {
      const n = Math.max(0, Math.min(total, p + d));
      setAnnounce(n >= total ? "Deck complete" : `Card ${n + 1} of ${total}`);
      return n;
    });
  };
  const mark = (m: "known" | "learning") => {
    setMarks((s) => ({ ...s, [idx]: m }));
    go(1);
  };
  const shuffle = () => {
    const a = [...order];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    setOrder(a);
    setPos(0);
    setFlipped(false);
    setAnnounce("Deck shuffled");
  };
  const restart = (onlyLearning = false) => {
    const next = onlyLearning ? base.map((_, i) => i).filter((i) => marks[i] !== "known") : base.map((_, i) => i);
    setOrder(next.length ? next : base.map((_, i) => i));
    setPos(0);
    setFlipped(false);
    if (!onlyLearning) setMarks({});
    setAnnounce(onlyLearning ? "Reviewing cards you're still learning" : "Deck restarted");
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (done) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      go(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(-1);
    }
  };
  const grad = FACE_COLORS[idx % FACE_COLORS.length];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Progress value={(Math.min(pos, total) / total) * 100} color="amber" size="sm" className="flex-1" aria-label="Deck progress" />
        <span className="text-xs font-semibold tabular-nums text-slate-600">
          {Math.min(pos + 1, total)} / {total}
        </span>
      </div>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      {done ? (
        <div className="rounded-3xl bg-gradient-to-br from-amber-50 via-white to-emerald-50 p-8 text-center ring-1 ring-amber-100">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-glow">
            <Sparkles className="size-7" aria-hidden />
          </span>
          <h3 className="mt-4 font-display text-xl font-bold text-slate-900">Deck complete!</h3>
          <p className="mt-1 text-sm text-slate-600">
            You marked <strong className="text-emerald-700">{known}</strong> of {base.length} cards as known
            {reviewed - known > 0 && (
              <>
                {" "}
                and <strong className="text-amber-800">{reviewed - known}</strong> to keep practising
              </>
            )}
            .
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {reviewed - known > 0 && (
              <Button variant="primary" leftIcon={<Repeat2 />} onClick={() => restart(true)}>
                Review {reviewed - known} again
              </Button>
            )}
            <Button variant="secondary" leftIcon={<RotateCcw />} onClick={() => restart()}>
              Start over
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="[perspective:1600px]">
            <button
              type="button"
              onClick={() => setFlipped((f) => !f)}
              onKeyDown={onKey}
              aria-roledescription="flashcard"
              aria-describedby={hintId}
              className="relative block h-72 w-full cursor-pointer rounded-3xl motion-safe:transition-transform motion-safe:duration-500 motion-safe:ease-spring [transform-style:preserve-3d] focus-visible:focus-ring sm:h-80"
              style={{ transform: flipped ? "rotateY(180deg)" : "none" }}
            >
              <span
                aria-hidden={flipped}
                className={cn("absolute inset-0 flex flex-col overflow-hidden rounded-3xl bg-gradient-to-br p-6 text-left text-white shadow-lift [backface-visibility:hidden] sm:p-8", grad)}
              >
                <span className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-white/15" aria-hidden />
                <span className="text-xs font-semibold uppercase tracking-wider text-white/80">Question</span>
                <span className="my-auto block font-display text-xl font-bold leading-snug sm:text-2xl">{card.front}</span>
                <span className="text-xs font-medium text-white/85" aria-hidden>
                  Click or press Space to reveal
                </span>
              </span>
              <span
                aria-hidden={!flipped}
                className="absolute inset-0 flex flex-col overflow-auto rounded-3xl border-2 border-slate-200 bg-white p-6 text-left shadow-lift [backface-visibility:hidden] [transform:rotateY(180deg)] sm:p-8"
              >
                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Answer</span>
                <span className="my-auto block text-slate-800">
                  <Markdown className="text-lg">{card.back}</Markdown>
                </span>
              </span>
            </button>
            <span id={hintId} className="sr-only">
              Card {pos + 1} of {total}. Press Space or Enter to flip, left and right arrows to move between cards.
            </span>
          </div>
          <div aria-live="polite" className="sr-only">
            {flipped ? `Answer: ${card.back}` : `Question: ${card.front}`}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <Button variant="secondary" size="icon" aria-label="Previous card" onClick={() => go(-1)} disabled={pos === 0}>
                <ArrowLeft />
              </Button>
              <Button variant="secondary" onClick={() => setFlipped((f) => !f)}>
                {flipped ? "Show question" : "Reveal answer"}
              </Button>
              <Button variant="secondary" size="icon" aria-label="Next card" onClick={() => go(1)}>
                <ArrowRight />
              </Button>
            </div>
            <div className="flex items-center gap-1.5">
              <Button variant="destructive-soft" leftIcon={<X />} onClick={() => mark("learning")}>
                Still learning
              </Button>
              <Button variant="success" leftIcon={<Check />} onClick={() => mark("known")}>
                Got it
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span className="hidden items-center gap-1.5 sm:flex">
              <Kbd>Space</Kbd> flip <Kbd>←</Kbd>
              <Kbd>→</Kbd> navigate (when the card is focused)
            </span>
            <span className="flex items-center gap-3">
              <span>
                <strong className="text-emerald-700">{known}</strong> known · <strong className="text-amber-800">{reviewed - known}</strong> learning
              </span>
              <Button variant="ghost" size="xs" leftIcon={<Shuffle />} onClick={shuffle}>
                Shuffle
              </Button>
            </span>
          </div>
        </>
      )}
    </div>
  );
}
