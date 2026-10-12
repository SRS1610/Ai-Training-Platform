"use client";

import { cn } from "@praxis/ui";
import { Maximize2, Minus, SquareTerminal, X } from "lucide-react";
import * as React from "react";
import type { TranscriptEntry, ViewTool } from "../types";
import { useWorkspace } from "./context";
import { toolEntries, type WorkspaceApp } from "./model";
import { useReveal } from "./panel-kit";

interface Line {
  key: string;
  type: "command" | "output" | "warn" | "banner";
  text: string;
  seq: number;
}

/**
 * Realistic terminal emulator. Commands are sent as engine actions (`{tool, input: {text}}`); only outputs
 * returned by the engine are printed. `cls`/`clear` (and Ctrl+L) clear the screen locally, ↑/↓ walk history.
 */
export function TerminalPanel({ app, focusRef }: { app: WorkspaceApp; focusRef?: React.RefObject<HTMLInputElement | null> }) {
  const { view, act, pending, ended, ephemeral } = useWorkspace();
  const tool: ViewTool | undefined = app.commandTools[0] ?? app.tools[0];
  const data = (app.panel?.data ?? {}) as Record<string, unknown>;
  const prompt = tool?.prompt || "C:\\>";
  const [clearedAt, setClearedAt] = React.useState<number>(-1);
  const [input, setInput] = React.useState("");
  const [histIdx, setHistIdx] = React.useState<number | null>(null);
  const localHistory = React.useRef<string[]>([]);
  const mountSeq = React.useRef(view.action_count);
  const scroller = React.useRef<HTMLDivElement>(null);
  const ownRef = React.useRef<HTMLInputElement>(null);
  const inputRef = focusRef ?? ownRef;

  const entries = toolEntries(view, app);
  const history = React.useMemo(
    () => [...entries.filter((e) => e.kind === "command" && e.from === "learner").map((e) => e.text), ...localHistory.current],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries.length],
  );

  const lines: Line[] = [];
  if (clearedAt < 0) {
    if (typeof data.shell === "string") lines.push({ key: "b1", type: "banner", text: data.shell, seq: -1 });
    if (typeof data.banner === "string") lines.push({ key: "b2", type: "banner", text: data.banner, seq: -1 });
  }
  entries.forEach((e: TranscriptEntry, i) => {
    if (e.seq <= clearedAt) return;
    if (e.kind === "command") lines.push({ key: `c${i}`, type: "command", text: e.text, seq: e.seq });
    else if (e.kind === "output") lines.push({ key: `o${i}`, type: "output", text: e.text, seq: e.seq });
    else if (e.kind === "action") lines.push({ key: `a${i}`, type: "banner", text: `# ${e.text}`, seq: e.seq });
  });
  for (const x of ephemeral.filter((x) => tool && x.scope === `tool:${tool.id}` && x.afterSeq > clearedAt)) {
    if (x.learnerText) lines.push({ key: `${x.id}c`, type: "command", text: x.learnerText, seq: x.afterSeq });
    lines.push({ key: x.id, type: "warn", text: x.text, seq: x.afterSeq });
  }
  const running = pending?.kind === "command" && pending.tool === tool?.id ? pending.text : null;
  const newestOutputKey = [...lines].reverse().find((l) => l.type === "output" && l.seq > mountSeq.current)?.key;

  React.useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  });

  const submit = async () => {
    const text = input.trim();
    setHistIdx(null);
    if (!text) return;
    if (/^(cls|clear)$/i.test(text)) {
      setClearedAt(view.action_count);
      localHistory.current.push(text);
      setInput("");
      return;
    }
    if (!tool) return;
    setInput("");
    try {
      await act({ tool: tool.id, input: { text } }, { kind: "command", tool: tool.id, text });
    } catch {
      setInput(text);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void submit();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!history.length) return;
      const i = histIdx === null ? history.length - 1 : Math.max(0, histIdx - 1);
      setHistIdx(i);
      setInput(history[i] ?? "");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (histIdx === null) return;
      const i = histIdx + 1;
      if (i >= history.length) {
        setHistIdx(null);
        setInput("");
      } else {
        setHistIdx(i);
        setInput(history[i] ?? "");
      }
    } else if (e.key.toLowerCase() === "l" && e.ctrlKey) {
      e.preventDefault();
      setClearedAt(view.action_count);
    }
  };

  const host = typeof data.host === "string" ? data.host : null;

  return (
    <section className="flex h-full min-h-0 flex-col bg-[#0c1222]" aria-label={app.title}>
      {/* window title bar */}
      <header className="flex items-center gap-3 border-b border-white/10 bg-[#111a2e] px-3 py-2 text-slate-300">
        <span className="grid size-6 place-items-center rounded-md bg-gradient-to-br from-sky-400 to-indigo-500 text-white">
          <SquareTerminal className="size-3.5" aria-hidden />
        </span>
        <h2 className="min-w-0 flex-1 truncate text-xs font-medium text-slate-200">{app.title}</h2>
        {host && <span className="hidden rounded bg-white/5 px-2 py-0.5 font-mono text-2xs text-teal-300 sm:inline">{host}</span>}
        <span className="flex items-center gap-3 text-slate-500" aria-hidden>
          <Minus className="size-3.5" />
          <Maximize2 className="size-3" />
          <X className="size-3.5" />
        </span>
      </header>
      {/* Clicking the screen focuses the prompt (mouse convenience; keyboard users tab to the input). */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
      <div
        ref={scroller}
        role="log"
        aria-live="polite"
        aria-label="Terminal output"
        className="min-h-0 flex-1 cursor-text overflow-y-auto px-4 py-3 font-mono text-[12.5px] leading-[1.55] text-slate-200 scrollbar-thin [scrollbar-color:#334155_transparent]"
        onClick={() => window.getSelection()?.toString() || inputRef.current?.focus()}
      >
        {lines.map((l) =>
          l.type === "output" ? (
            <OutputBlock key={l.key} text={l.text} animate={l.key === newestOutputKey} />
          ) : l.type === "command" ? (
            <div key={l.key} className="mt-2 whitespace-pre-wrap break-words first:mt-0">
              <span className="text-teal-300">{prompt}</span> <span className="text-white">{l.text}</span>
            </div>
          ) : l.type === "warn" ? (
            <div key={l.key} className="whitespace-pre-wrap text-amber-300">
              {l.text}
            </div>
          ) : (
            <div key={l.key} className="whitespace-pre-wrap text-slate-400">
              {l.text}
            </div>
          ),
        )}
        {running !== null && (
          <div className="mt-2 whitespace-pre-wrap">
            <span className="text-teal-300">{prompt}</span> <span className="text-white">{running}</span>
            <span className="ml-1 inline-block h-3.5 w-2 translate-y-0.5 bg-slate-300 motion-safe:animate-pulse" aria-hidden />
          </div>
        )}
        {running === null && (
          <form
            className="mt-2 flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <label htmlFor={`term-${app.key}`} className="shrink-0 text-teal-300">
              {prompt}
            </label>
            <input
              id={`term-${app.key}`}
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={ended || !tool}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              aria-label={`${tool?.name ?? "Terminal"} command`}
              className={cn(
                "min-w-0 flex-1 bg-transparent font-mono text-[12.5px] text-white caret-teal-300 outline-none placeholder:text-slate-600",
                ended && "opacity-50",
              )}
              placeholder={ended ? "Session ended" : lines.length <= 2 ? "Type a command and press Enter (try: help)" : ""}
            />
          </form>
        )}
      </div>
      <footer className="flex items-center justify-between gap-3 border-t border-white/10 bg-[#111a2e] px-4 py-1.5 font-mono text-2xs text-slate-500">
        <span>↑/↓ history · cls to clear · Ctrl+L</span>
        <span className="hidden sm:inline">{entries.filter((e) => e.kind === "command").length} commands run</span>
      </footer>
    </section>
  );
}

function OutputBlock({ text, animate }: { text: string; animate: boolean }) {
  const shown = useReveal(text, animate);
  return <pre className="whitespace-pre-wrap break-words font-mono text-slate-300">{shown}</pre>;
}
