"use client";

import { cn } from "@praxis/ui";
import { Highlight, themes } from "prism-react-renderer";
import * as React from "react";

const ALIASES: Record<string, string> = {
  html: "markup",
  xml: "markup",
  csharp: "clike",
  java: "clike",
  bash: "plain",
  shell: "plain",
  powershell: "plain",
  sh: "plain",
};

export function prismLanguage(lang: string | null | undefined): string {
  const l = (lang ?? "").toLowerCase();
  return ALIASES[l] ?? (l || "plain");
}

/**
 * Lightweight code editor: a transparent <textarea> layered over a Prism-highlighted <pre>.
 * Tab inserts two spaces (Shift+Tab / Esc then Tab moves focus on). Line numbers in a gutter.
 */
export function CodeEditor({
  value,
  onChange,
  language,
  minLines = 8,
  maxHeight = 520,
  id,
  "aria-label": ariaLabel = "Code",
  "aria-describedby": describedBy,
  readOnly,
  className,
  placeholder,
}: {
  value: string;
  onChange?: (v: string) => void;
  language?: string | null;
  minLines?: number;
  maxHeight?: number;
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  readOnly?: boolean;
  className?: string;
  placeholder?: string;
}) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const escaped = React.useRef(false);
  const lines = Math.max(minLines, value.split("\n").length);
  const code = value.endsWith("\n") ? `${value} ` : value || " ";

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      escaped.current = true;
      return;
    }
    if (e.key === "Tab" && !e.shiftKey && !escaped.current && onChange) {
      e.preventDefault();
      const el = e.currentTarget;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const next = `${value.slice(0, start)}  ${value.slice(end)}`;
      onChange(next);
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + 2;
      });
    }
    escaped.current = false;
  };

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-slate-800 bg-[#282c34] shadow-sm focus-within:ring-4 focus-within:ring-brand-500/25",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 border-b border-white/5 bg-black/20 px-3 py-2" aria-hidden>
        <span className="size-2.5 rounded-full bg-rose-400/80" />
        <span className="size-2.5 rounded-full bg-amber-400/80" />
        <span className="size-2.5 rounded-full bg-emerald-400/80" />
        <span className="ml-2 font-mono text-2xs uppercase tracking-wider text-slate-400">{language || "text"}</span>
      </div>
      <div className="overflow-auto scrollbar-thin" style={{ maxHeight }}>
        <div className="flex min-w-full">
          <div className="sticky left-0 z-10 select-none bg-[#282c34] py-3 pl-3 pr-2 text-right font-mono text-[13px] leading-[1.6] text-slate-500" aria-hidden>
            {Array.from({ length: lines }, (_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
          <div className="relative grid flex-1">
            <Highlight theme={themes.oneDark} code={code} language={prismLanguage(language)}>
              {({ tokens, getLineProps, getTokenProps }) => (
                <pre
                  aria-hidden
                  className="pointer-events-none m-0 whitespace-pre py-3 pl-2 pr-6 font-mono text-[13px] leading-[1.6] [grid-area:1/1]"
                  style={{ background: "transparent", minHeight: `${lines * 1.6 * 13 + 24}px` }}
                >
                  {tokens.map((line, i) => (
                    <div key={i} {...getLineProps({ line })}>
                      {line.map((token, key) => (
                        <span key={key} {...getTokenProps({ token })} />
                      ))}
                    </div>
                  ))}
                </pre>
              )}
            </Highlight>
            <textarea
              ref={ref}
              id={id}
              aria-label={ariaLabel}
              aria-describedby={describedBy}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              wrap="off"
              readOnly={readOnly}
              placeholder={placeholder}
              value={value}
              onChange={(e) => onChange?.(e.target.value)}
              onKeyDown={onKeyDown}
              className="m-0 resize-none overflow-hidden whitespace-pre bg-transparent py-3 pl-2 pr-6 font-mono text-[13px] leading-[1.6] text-transparent caret-white outline-none [grid-area:1/1] selection:bg-sky-400/30 placeholder:text-slate-500"
            />
          </div>
        </div>
      </div>
      {!readOnly && (
        <p className="sr-only">Tab inserts spaces. Press Escape then Tab to move focus out of the editor.</p>
      )}
    </div>
  );
}

/** Read-only highlighted code block. */
export function CodeBlock({ code, language, className }: { code: string; language?: string | null; className?: string }) {
  return (
    <Highlight theme={themes.oneDark} code={code || " "} language={prismLanguage(language)}>
      {({ tokens, getLineProps, getTokenProps }) => (
        <pre className={cn("overflow-x-auto rounded-2xl bg-[#282c34] p-4 font-mono text-[13px] leading-[1.6] scrollbar-thin", className)}>
          {tokens.map((line, i) => (
            <div key={i} {...getLineProps({ line })}>
              {line.map((token, key) => (
                <span key={key} {...getTokenProps({ token })} />
              ))}
            </div>
          ))}
        </pre>
      )}
    </Highlight>
  );
}
