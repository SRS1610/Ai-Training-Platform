"use client";

import { Button, cn, colorClasses, colorFor, Tooltip } from "@praxis/ui";
import { Lightbulb, MessagesSquare, Send, Video } from "lucide-react";
import * as React from "react";
import { useAuth } from "@/lib/auth";
import { firstName } from "@/lib/format";
import type { TranscriptEntry, ViewCharacter } from "../types";
import { useWorkspace } from "./context";
import { chatThread, patienceTone, simClock, type ChatModel } from "./model";

export function CharacterAvatar({ c, size = "md", className }: { c: Pick<ViewCharacter, "id" | "name" | "avatar">; size?: "sm" | "md" | "lg"; className?: string }) {
  const color = colorClasses(colorFor(c.id + c.name));
  const initials = (c.avatar && c.avatar.length <= 3 ? c.avatar : c.name.split(/\s+/).map((p) => p[0]).join("")).slice(0, 2).toUpperCase();
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-gradient-to-br font-semibold text-white shadow-sm",
        color.gradient,
        size === "sm" ? "size-7 text-2xs" : size === "lg" ? "size-11 text-sm" : "size-9 text-xs",
        className,
      )}
      aria-hidden
    >
      {initials}
    </span>
  );
}

/** Generic conversation moves (question types) — starters only, never answers. */
function moves(learner: string, other: string) {
  return [
    { label: "Introduce yourself", text: `Hi ${other}, I'm ${learner} and I'll be helping you with this today.` },
    { label: "Clarify the problem", text: "Can you describe exactly what you see when " },
    { label: "Timeline", text: "When did you first notice " },
    { label: "Scope & impact", text: "Is anyone else affected, and how is this affecting " },
    { label: "Recent changes", text: "Has anything changed recently, for example " },
    { label: "Ask them to check", text: "Could you try again now and tell me what happens?" },
    { label: "Explain & reassure", text: "Here's what I found and what I've done: " },
    { label: "Confirm & close", text: "Is there anything else I can help with before I close this?" },
  ];
}

export function ChatPanel({
  chat,
  active,
  onActiveChange,
  inputRef,
  className,
}: {
  chat: ChatModel;
  active: string;
  onActiveChange: (id: string) => void;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
  className?: string;
}) {
  const { view, chat: send, pending, ended, ephemeral, lastSeq } = useWorkspace();
  const { user } = useAuth();
  const character = chat.characters.find((c) => c.id === active) ?? chat.characters[0]!;
  const thread = chatThread(view, character.id);
  const eph = ephemeral.filter((e) => e.scope === `chat:${character.id}`);
  const [text, setText] = React.useState("");
  const [showMoves, setShowMoves] = React.useState(false);
  const scroller = React.useRef<HTMLDivElement>(null);
  const ownRef = React.useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? ownRef;
  const sending = pending?.kind === "chat" && pending.character === character.id ? pending.text : null;
  const [seen, setSeen] = React.useState<Record<string, number>>({});

  React.useEffect(() => {
    setSeen((s) => ({ ...s, [character.id]: view.action_count }));
  }, [character.id, view.action_count]);

  React.useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [thread.length, sending, eph.length, character.id]);

  const unread = (c: ViewCharacter) =>
    c.id === character.id ? 0 : chatThread(view, c.id).filter((e) => e.from === c.id && e.seq > (seen[c.id] ?? -1)).length;

  const submit = async () => {
    const msg = text.trim();
    if (!msg || ended) return;
    setText("");
    setShowMoves(false);
    try {
      await send(character.id, msg);
    } catch {
      setText(msg);
    }
  };

  // Merge persisted thread with ephemeral (rejected) exchanges in seq order.
  type Item = { key: string; mine: boolean; text: string; minutes?: number; seq: number; ghost?: boolean; fresh?: boolean };
  const items: Item[] = thread.map((e: TranscriptEntry, i) => ({
    key: `t${i}`,
    mine: e.from === "learner",
    text: e.text,
    minutes: e.minutes,
    seq: e.seq,
    fresh: e.seq === lastSeq && e.from !== "learner",
  }));
  for (const x of eph) {
    if (x.learnerText) items.push({ key: `${x.id}l`, mine: true, text: x.learnerText, seq: x.afterSeq + 0.1 });
    items.push({ key: x.id, mine: false, text: x.text, seq: x.afterSeq + 0.2, fresh: true });
  }
  items.sort((a, b) => a.seq - b.seq);

  const mood = character.patience !== null && character.patience !== undefined ? patienceTone(character.patience) : null;
  const moodC = mood ? colorClasses(mood.color) : null;

  return (
    <section className={cn("flex h-full min-h-0 flex-col bg-white", className)} aria-label={chat.title}>
      <header className="border-b border-slate-200/80">
        <div className="flex items-center gap-3 px-4 pb-2 pt-3">
          <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-sm">
            <MessagesSquare className="size-[18px]" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-display text-[15px] font-semibold text-slate-900">{chat.title}</h2>
            {chat.channel && <p className="truncate text-xs text-muted-foreground">{chat.channel}</p>}
          </div>
          <Tooltip content="Calls aren't part of this simulation">
            <span className="grid size-8 place-items-center rounded-lg text-slate-400" aria-hidden>
              <Video className="size-4" />
            </span>
          </Tooltip>
        </div>
        {chat.characters.length > 1 && (
          <div className="no-scrollbar flex gap-1 overflow-x-auto px-3 pb-2 pt-1" role="tablist" aria-label="Conversations">
            {chat.characters.map((c, i) => {
              const n = unread(c);
              const on = c.id === character.id;
              return (
                <button
                  key={c.id}
                  id={`sim-chat-tab-${c.id}`}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  aria-controls="sim-chat-panel"
                  tabIndex={on ? 0 : -1}
                  onClick={() => onActiveChange(c.id)}
                  onKeyDown={(e) => {
                    // Roving tabindex (WAI-ARIA tabs): arrows/Home/End move and select.
                    const len = chat.characters.length;
                    const j =
                      e.key === "ArrowRight" ? (i + 1) % len : e.key === "ArrowLeft" ? (i - 1 + len) % len : e.key === "Home" ? 0 : e.key === "End" ? len - 1 : -1;
                    if (j < 0) return;
                    e.preventDefault();
                    const next = chat.characters[j]!;
                    onActiveChange(next.id);
                    requestAnimationFrame(() => document.getElementById(`sim-chat-tab-${next.id}`)?.focus());
                  }}
                  className={cn(
                    "relative flex shrink-0 items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-xs transition-colors focus-visible:focus-ring",
                    on ? "bg-violet-50 text-violet-900 ring-1 ring-violet-200" : "text-slate-600 hover:bg-slate-50",
                  )}
                >
                  <CharacterAvatar c={c} size="sm" />
                  <span>
                    <span className="block font-semibold">{c.name}</span>
                    <span className="block text-2xs text-slate-500">{c.role}</span>
                  </span>
                  {n > 0 && (
                    <span className="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-2xs font-bold text-white" aria-label={`${n} unread`}>
                      {n}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
        <div className="flex items-center gap-3 border-t border-slate-100 bg-slate-50/60 px-4 py-2">
          <span className="relative">
            <CharacterAvatar c={character} size="sm" />
            <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-emerald-500 ring-2 ring-white" aria-hidden />
          </span>
          <div className="min-w-0 flex-1 text-xs">
            <p className="truncate font-semibold text-slate-900">{character.name}</p>
            <p className="truncate text-slate-500">{character.role} · Available</p>
          </div>
          {mood && moodC && (
            <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-2xs font-semibold ring-1 ring-inset", moodC.soft, moodC.text, moodC.ring)}>
              {mood.label}
            </span>
          )}
        </div>
      </header>

      <div
        className="flex min-h-0 flex-1 flex-col"
        {...(chat.characters.length > 1 ? { role: "tabpanel", id: "sim-chat-panel", "aria-labelledby": `sim-chat-tab-${character.id}` } : {})}
      >
      <div ref={scroller} className="relative min-h-0 flex-1 space-y-3 overflow-y-auto bg-gradient-to-b from-slate-50/80 to-white px-4 py-4 scrollbar-thin" role="log" aria-live="polite" aria-label={`Conversation with ${character.name}`}>
        {items.length === 0 && !sending && (
          <p className="mx-auto max-w-xs py-8 text-center text-sm text-muted-foreground">No messages with {firstName(character.name)} yet. Say hello to get started.</p>
        )}
        {items.map((m) =>
          m.mine ? (
            <div key={m.key} className="flex justify-end">
              <div className="max-w-[85%]">
                <div className="rounded-2xl rounded-br-md bg-gradient-to-br from-indigo-600 to-violet-600 px-3.5 py-2 text-sm text-white shadow-sm">{m.text}</div>
                {m.minutes !== undefined && <p className="mt-0.5 text-right font-mono text-2xs text-slate-500">T+{simClock(m.minutes)}</p>}
              </div>
            </div>
          ) : (
            <div key={m.key} className={cn("flex items-end gap-2", m.fresh && "motion-safe:animate-fade-up")}>
              <CharacterAvatar c={character} size="sm" />
              <div className="max-w-[85%]">
                <div className="rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-800 shadow-sm">{m.text}</div>
                {m.minutes !== undefined && <p className="mt-0.5 font-mono text-2xs text-slate-500">T+{simClock(m.minutes)}</p>}
              </div>
            </div>
          ),
        )}
        {sending && (
          <>
            <div className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-gradient-to-br from-indigo-600 to-violet-600 px-3.5 py-2 text-sm text-white opacity-70 shadow-sm">{sending}</div>
            </div>
            <div className="flex items-end gap-2" aria-label={`${character.name} is typing`}>
              <CharacterAvatar c={character} size="sm" />
              <div className="flex items-center gap-1 rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3.5 py-3 shadow-sm">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="size-1.5 rounded-full bg-slate-400 motion-safe:animate-bounce" style={{ animationDelay: `${i * 140}ms` }} />
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="border-t border-slate-200/80 p-3">
        {showMoves && (
          <div className="mb-2 flex flex-wrap gap-1.5" aria-label="Conversation starters">
            {moves(firstName(user?.full_name), firstName(character.name)).map((m) => (
              <button
                key={m.label}
                type="button"
                onClick={() => {
                  setText(m.text);
                  requestAnimationFrame(() => {
                    ref.current?.focus();
                    const len = m.text.length;
                    ref.current?.setSelectionRange(len, len);
                  });
                }}
                className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-800 ring-1 ring-inset ring-violet-200 transition-colors hover:bg-violet-100 focus-visible:focus-ring"
              >
                {m.label}
              </button>
            ))}
          </div>
        )}
        <form
          className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm focus-within:border-brand-300 focus-within:ring-2 focus-within:ring-brand-100"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Tooltip content="Conversation starters">
            <button
              type="button"
              onClick={() => setShowMoves((v) => !v)}
              aria-pressed={showMoves}
              aria-label="Show conversation starters"
              className={cn("grid size-9 shrink-0 place-items-center rounded-xl transition-colors focus-visible:focus-ring", showMoves ? "bg-amber-100 text-amber-700" : "text-slate-500 hover:bg-slate-100")}
            >
              <Lightbulb className="size-4" aria-hidden />
            </button>
          </Tooltip>
          <label htmlFor="sim-chat-input" className="sr-only">
            Message {character.name}
          </label>
          <textarea
            id="sim-chat-input"
            ref={ref}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            disabled={ended}
            maxLength={2000}
            placeholder={ended ? "This session has ended" : `Message ${firstName(character.name)}…`}
            className="max-h-32 min-h-9 flex-1 resize-none bg-transparent px-1 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400"
          />
          <Button type="submit" size="icon-sm" className="size-9 rounded-xl" disabled={!text.trim() || ended || !!sending} aria-label="Send message">
            <Send className="size-4" aria-hidden />
          </Button>
        </form>
      </div>
      </div>
    </section>
  );
}
