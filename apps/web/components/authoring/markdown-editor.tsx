"use client";

import { Kbd, Tooltip, cn } from "@praxis/ui";
import {
  Bold,
  Code,
  Columns2,
  Eye,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  type LucideIcon,
  Minus,
  Pencil,
  Quote,
  Table,
} from "lucide-react";
import * as React from "react";
import { Markdown } from "@/components/common/markdown";
import { rovingRadio } from "./roving";

type Mode = "write" | "preview" | "split";

interface Action {
  label: string;
  icon: LucideIcon;
  shortcut?: string;
  run: (sel: string) => { text: string; select?: [number, number] };
  block?: boolean;
}

const wrap = (pre: string, post = pre, placeholder = "text") => (sel: string) => {
  const inner = sel || placeholder;
  return { text: `${pre}${inner}${post}`, select: [pre.length, pre.length + inner.length] as [number, number] };
};
const prefixLines = (prefix: (i: number) => string, placeholder = "item") => (sel: string) => {
  const lines = (sel || placeholder).split("\n");
  return { text: lines.map((l, i) => `${prefix(i)}${l}`).join("\n") };
};

const ACTIONS: Action[] = [
  { label: "Bold", icon: Bold, shortcut: "B", run: wrap("**", "**", "bold text") },
  { label: "Italic", icon: Italic, shortcut: "I", run: wrap("_", "_", "italic text") },
  { label: "Heading", icon: Heading2, run: prefixLines(() => "## ", "Heading"), block: true },
  { label: "Subheading", icon: Heading3, run: prefixLines(() => "### ", "Subheading"), block: true },
  { label: "Bulleted list", icon: List, run: prefixLines(() => "- "), block: true },
  { label: "Numbered list", icon: ListOrdered, run: prefixLines((i) => `${i + 1}. `), block: true },
  { label: "Quote", icon: Quote, run: prefixLines(() => "> ", "Quote"), block: true },
  { label: "Inline code", icon: Code, shortcut: "E", run: wrap("`", "`", "code") },
  {
    label: "Link",
    icon: LinkIcon,
    shortcut: "K",
    run: (sel) => {
      const t = sel || "link text";
      return { text: `[${t}](https://)`, select: [t.length + 3, t.length + 11] };
    },
  },
  {
    label: "Table",
    icon: Table,
    run: () => ({ text: "| Column | Column |\n| --- | --- |\n| Cell | Cell |" }),
    block: true,
  },
  { label: "Divider", icon: Minus, run: () => ({ text: "---" }), block: true },
];

/**
 * Markdown editor with formatting toolbar, keyboard shortcuts (⌘/Ctrl B, I, E, K) and a
 * sanitised live preview (Write / Split / Preview).
 */
export function MarkdownEditor({
  value,
  onChange,
  id,
  minRows = 12,
  placeholder = "Write in Markdown…",
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
  label = "Content",
  defaultMode,
  compact,
}: {
  value: string;
  onChange: (v: string) => void;
  id?: string;
  minRows?: number;
  placeholder?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  label?: string;
  defaultMode?: Mode;
  compact?: boolean;
}) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = React.useState<Mode>(defaultMode ?? (compact ? "write" : "split"));
  const autoId = React.useId();
  const taId = id ?? `md${autoId.replace(/:/g, "")}`;

  // Auto-grow the textarea.
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, minRows * 24)}px`;
  }, [value, mode, minRows]);

  const apply = (a: Action) => {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const sel = value.slice(start, end);
    const res = a.run(sel);
    let before = value.slice(0, start);
    let text = res.text;
    if (a.block && before && !before.endsWith("\n")) text = `\n${text}`;
    if (a.block && before && !before.endsWith("\n\n") && (res.text.startsWith("|") || res.text === "---")) text = `\n${text}`;
    const next = before + text + value.slice(end);
    before = value.slice(0, start);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const offset = start + (text.length - res.text.length);
      if (res.select) {
        el.selectionStart = offset + res.select[0];
        el.selectionEnd = offset + res.select[1];
      } else {
        el.selectionStart = el.selectionEnd = start + text.length;
      }
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const a = ACTIONS.find((x) => x.shortcut && x.shortcut.toLowerCase() === e.key.toLowerCase());
    if (a) {
      e.preventDefault();
      apply(a);
    }
  };

  const words = value.trim() ? value.trim().split(/\s+/).length : 0;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm focus-within:border-brand-400 focus-within:ring-4 focus-within:ring-brand-500/10">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/80 px-2 py-1.5">
        <div className="flex flex-wrap items-center gap-0.5" role="toolbar" aria-label={`${label} formatting`}>
          {ACTIONS.map((a) => {
            const Icon = a.icon;
            return (
              <Tooltip key={a.label} content={a.shortcut ? <span>{a.label} <Kbd className="ml-1 border-slate-700 bg-slate-800 text-slate-200">⌘{a.shortcut}</Kbd></span> : a.label}>
                <button
                  type="button"
                  onClick={() => apply(a)}
                  disabled={mode === "preview"}
                  aria-label={a.label}
                  className="grid size-8 place-items-center rounded-lg text-slate-600 transition-colors hover:bg-white hover:text-brand-700 hover:shadow-sm focus-visible:focus-ring disabled:opacity-40"
                >
                  <Icon className="size-4" aria-hidden />
                </button>
              </Tooltip>
            );
          })}
        </div>
        <div className="flex items-center gap-0.5 rounded-lg bg-slate-200/60 p-0.5" role="radiogroup" {...rovingRadio} aria-label="Editor view">
          {(
            [
              ["write", Pencil, "Write"],
              ["split", Columns2, "Split"],
              ["preview", Eye, "Preview"],
            ] as const
          ).map(([m, Icon, l]) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold transition-colors focus-visible:focus-ring",
                mode === m ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900",
                m === "split" && "hidden lg:inline-flex",
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className={cn("grid grid-cols-1", mode === "split" && "lg:grid-cols-2")}>
        <div className={cn("min-w-0", mode === "preview" && "hidden", mode === "split" && "lg:border-r lg:border-slate-100")}>
          {!id && (
            <label htmlFor={taId} className="sr-only">
              {label}
            </label>
          )}
          <textarea
            ref={ref}
            id={taId}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            spellCheck
            className="block w-full resize-none bg-transparent px-4 py-3.5 font-mono text-[13.5px] leading-6 text-slate-800 outline-none placeholder:text-slate-400"
          />
        </div>
        <div
          className={cn(
            "min-h-[12rem] min-w-0 bg-gradient-to-b from-white to-slate-50/40 px-5 py-4",
            mode === "write" && "hidden",
            mode === "split" && "hidden lg:block",
          )}
          aria-label={`${label} preview`}
          role="region"
        >
          {value.trim() ? (
            <Markdown>{value}</Markdown>
          ) : (
            <p className="text-sm italic text-slate-400">Nothing to preview yet.</p>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/60 px-3 py-1.5 text-2xs text-slate-500">
        <span className="hidden sm:inline">Markdown supported · GFM tables & task lists</span>
        <span className="tabular-nums" aria-live="off">
          {words.toLocaleString()} words · ~{Math.max(1, Math.round(words / 200))} min read
        </span>
      </div>
    </div>
  );
}
