"use client";

import { Badge, Button, cn, toast } from "@praxis/ui";
import { Check, Copy, ExternalLink, MousePointerClick, RotateCcw, ShieldCheck, WrapText } from "lucide-react";
import { Highlight, type PrismTheme, themes } from "prism-react-renderer";
import * as React from "react";
import { Markdown } from "@/components/common/markdown";
import { isPlaceholderUrl, str, videoEmbedUrl } from "./media";

type Content = Record<string, unknown>;

/* ------------------------------------------------------------------ interactive HTML */

/**
 * Author-provided HTML runs in a sandboxed `srcdoc` iframe: scripts only — no same-origin access (so no
 * cookies, storage or API calls as the learner), no forms, popups, top navigation or downloads.
 */
export function InteractiveHtmlBlock({ content, title }: { content: Content; title?: string }) {
  const html = str(content.html);
  const url = str(content.url);
  const embed = videoEmbedUrl(url);
  const [key, setKey] = React.useState(0);
  const height = Math.min(1200, Math.max(280, Number(content.height) || 560));
  const doc = React.useMemo(
    () =>
      html
        ? `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0;font-family:Inter,system-ui,sans-serif;color:#0f172a}</style></head><body>${html}</body></html>`
        : "",
    [html],
  );
  return (
    <div className="space-y-4">
      {str(content.instructions) && <Markdown>{str(content.instructions)!}</Markdown>}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-soft">
        <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
          <span className="flex gap-1.5" aria-hidden>
            <span className="size-2.5 rounded-full bg-rose-400" />
            <span className="size-2.5 rounded-full bg-amber-400" />
            <span className="size-2.5 rounded-full bg-emerald-400" />
          </span>
          <span className="ml-2 inline-flex min-w-0 items-center gap-1.5 truncate text-xs font-medium text-slate-600">
            <MousePointerClick className="size-3.5 text-fuchsia-600" aria-hidden />
            {title ?? "Interactive activity"}
          </span>
          <Badge tone="success" size="sm" className="ml-auto hidden sm:inline-flex" title="Runs isolated from your account">
            <ShieldCheck aria-hidden /> Sandboxed
          </Badge>
          {html && (
            <Button variant="ghost" size="icon-sm" aria-label="Restart activity" onClick={() => setKey((k) => k + 1)}>
              <RotateCcw />
            </Button>
          )}
        </div>
        {html ? (
          <iframe
            key={key}
            title={title ?? "Interactive activity"}
            srcDoc={doc}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            className="block w-full bg-white"
            style={{ height }}
          />
        ) : embed ? (
          <iframe key={key} title={title ?? "Interactive activity"} src={embed} className="block aspect-video w-full" allowFullScreen />
        ) : url && !isPlaceholderUrl(url, content) ? (
          <div className="grid place-items-center gap-3 px-6 py-12 text-center">
            <p className="max-w-md text-sm text-slate-600">This activity is hosted externally and opens in a new tab.</p>
            <Button asChild variant="gradient" rightIcon={<ExternalLink />}>
              <a href={url} target="_blank" rel="noopener noreferrer nofollow">
                Launch activity
              </a>
            </Button>
          </div>
        ) : (
          <p className="px-6 py-12 text-center text-sm text-slate-600">This interactive activity hasn&apos;t been set up yet.</p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ code */

const LANG_ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  py: "python",
  sh: "bash",
  shell: "bash",
  yml: "yaml",
  html: "markup",
  xml: "markup",
  "c#": "csharp",
  "c++": "cpp",
};

/** Light, AA-contrast syntax theme (VS light palette, tuned for a slate-50 surface). */
const LIGHT_CODE_THEME: PrismTheme = {
  plain: { color: "#1e293b", backgroundColor: "transparent" },
  styles: [
    ...themes.vsLight.styles.filter((s) => !s.types.includes("attr-name")),
    { types: ["attr-name"], style: { color: "rgb(190, 18, 60)" } },
    { types: ["comment"], style: { color: "rgb(21, 128, 61)", fontStyle: "italic" } },
  ],
};

export function CodeBlock({ code, language, title, className }: { code: string; language?: string; title?: string; className?: string }) {
  const lang = LANG_ALIASES[(language ?? "").toLowerCase()] ?? (language ?? "text").toLowerCase();
  const [copied, setCopied] = React.useState(false);
  const [wrap, setWrap] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Couldn't copy — select the code and copy manually.");
    }
  };
  return (
    <div className={cn("overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/80 shadow-soft", className)}>
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <span className="flex gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-rose-400" />
          <span className="size-2.5 rounded-full bg-amber-400" />
          <span className="size-2.5 rounded-full bg-emerald-400" />
        </span>
        <span className="ml-2 truncate font-mono text-xs text-slate-600">{title ?? "Code example"}</span>
        <span className="ml-auto rounded-md bg-indigo-50 px-1.5 py-0.5 font-mono text-2xs font-semibold uppercase text-indigo-700 ring-1 ring-inset ring-indigo-100">{lang}</span>
        <button
          type="button"
          onClick={() => setWrap((w) => !w)}
          aria-pressed={wrap}
          aria-label="Toggle line wrap"
          className={cn("grid size-7 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:focus-ring", wrap && "bg-slate-100 text-slate-900")}
        >
          <WrapText className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={copy}
          className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 hover:text-slate-900 focus-visible:focus-ring"
        >
          {copied ? <Check className="size-3.5 text-emerald-600" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </button>
        <span className="sr-only" aria-live="polite">
          {copied ? "Code copied to clipboard" : ""}
        </span>
      </div>
      <Highlight theme={LIGHT_CODE_THEME} code={code.replace(/\n$/, "")} language={lang}>
        {({ tokens, getLineProps, getTokenProps }) => (
          // Scrollable code must be keyboard-reachable (WCAG 2.1.1); a focusable <pre> is the standard pattern.
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          <pre className={cn("overflow-x-auto p-4 font-mono text-[13px] leading-6 scrollbar-thin", wrap && "whitespace-pre-wrap break-words")} tabIndex={0} aria-label={`${lang} code`}>
            {tokens.map((line, i) => {
              const lineProps = getLineProps({ line });
              return (
                <div key={i} style={lineProps.style} className="table-row">
                  <span className="table-cell select-none pr-4 text-right text-slate-400" aria-hidden>
                    {i + 1}
                  </span>
                  <span className="table-cell">
                    {line.map((token, k) => {
                      const tp = getTokenProps({ token });
                      return <span key={k} className={tp.className} style={tp.style}>{tp.children}</span>;
                    })}
                  </span>
                </div>
              );
            })}
          </pre>
        )}
      </Highlight>
    </div>
  );
}

export function CodeLessonBlock({ content }: { content: Content }) {
  return (
    <div className="space-y-4">
      {str(content.instructions) && <Markdown>{str(content.instructions)!}</Markdown>}
      <CodeBlock code={str(content.code) ?? ""} language={str(content.language)} title={str(content.filename)} />
      {str(content.body_markdown) && <Markdown>{str(content.body_markdown)!}</Markdown>}
    </div>
  );
}

/* ------------------------------------------------------------------ embeds */

export function EmbedBlock({ content, title }: { content: Content; title?: string }) {
  const url = str(content.url);
  const embed = videoEmbedUrl(url);
  if (embed)
    return (
      <div className="aspect-video overflow-hidden rounded-2xl bg-slate-900 shadow-lift">
        <iframe src={embed} title={title ?? "Embedded content"} className="size-full" allowFullScreen />
      </div>
    );
  if (!url) return null;
  let host = url;
  try {
    host = new URL(url).hostname;
  } catch {
    /* relative */
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="group flex items-center gap-4 rounded-2xl border border-slate-200 bg-gradient-to-br from-sky-50 via-white to-white p-4 transition hover:-translate-y-0.5 hover:shadow-lift focus-visible:focus-ring"
    >
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-sky-400 to-blue-500 text-white">
        <ExternalLink className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-slate-900">{title ?? str(content.title) ?? "External resource"}</span>
        <span className="block truncate text-xs text-slate-500">{host} · opens in a new tab</span>
      </span>
    </a>
  );
}
