"use client";

/**
 * Tutor answer rendering: Markdown (GFM, sanitised, no raw HTML — same rules as components/common/markdown)
 * where inline "[n]" citation markers become numbered chips with a hover/focus card showing the source.
 */
import { cn, Popover, PopoverContent, PopoverTrigger } from "@praxis/ui";
import { FileText } from "lucide-react";
import * as React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import type { Citation } from "./use-tutor";

function useHoverOpen() {
  const [open, setOpen] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), 120);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), 150);
  };
  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return { open, setOpen, show, hide };
}

/** Hover/focus card for one document: its title, then each cited passage (heading + snippet). */
function SourceCard({ cs }: { cs: Citation[] }) {
  const first = cs[0]!;
  return (
    <>
      <div className="flex items-start gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-sky-50 text-sky-600">
          <FileText className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">{first.title}</p>
          {cs.length === 1 && first.heading && <p className="text-xs text-slate-500">{first.heading}</p>}
        </div>
      </div>
      <div className={cn("mt-3 space-y-3", cs.length > 1 && "max-h-72 overflow-y-auto pr-1 scrollbar-thin")}>
        {cs.map((c) => (
          <div key={c.chunk_id}>
            {cs.length > 1 && (
              <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-700">
                <span className="grid size-4 shrink-0 place-items-center rounded-full bg-gradient-to-br from-sky-500 to-indigo-600 text-[9px] font-bold text-white">{c.index}</span>
                <span className="truncate">{c.heading || `Passage ${c.index}`}</span>
              </p>
            )}
            {c.snippet && <p className={cn("border-l-2 border-sky-300 pl-3 text-xs leading-relaxed text-slate-600", cs.length > 1 ? "line-clamp-3" : "line-clamp-6")}>{c.snippet}</p>}
          </div>
        ))}
      </div>
      <p className="mt-3 text-2xs font-medium uppercase tracking-wider text-slate-500">
        Source {cs.map((c) => `[${c.index}]`).join(" ")} · course knowledge base
      </p>
    </>
  );
}

export function CitationChip({ c, inline }: { c: Citation; inline?: boolean }) {
  return <SourceChip cs={[c]} inline={inline} />;
}

/**
 * One chip per cited document. Several passages from the same document collapse into a single chip with
 * all of their numbers, and its card lists each passage by heading.
 */
function SourceChip({ cs, inline }: { cs: Citation[]; inline?: boolean }) {
  const { open, setOpen, show, hide } = useHoverOpen();
  const first = cs[0]!;
  const label = `Source${cs.length > 1 ? "s" : ""} ${cs.map((c) => c.index).join(", ")}: ${first.title}`;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {inline ? (
          <button
            type="button"
            onMouseEnter={show}
            onMouseLeave={hide}
            onFocus={show}
            onBlur={hide}
            className="mx-0.5 inline-flex h-[18px] min-w-[18px] -translate-y-px items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-indigo-600 px-1 align-middle text-[10px] font-bold leading-none text-white shadow-sm transition-transform hover:scale-110 focus-visible:focus-ring"
            aria-label={label}
          >
            {first.index}
          </button>
        ) : (
          <button
            type="button"
            onMouseEnter={show}
            onMouseLeave={hide}
            onFocus={show}
            onBlur={hide}
            className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-full bg-white py-0.5 pl-0.5 pr-2.5 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-200 transition-colors hover:bg-sky-50 hover:ring-sky-200 focus-visible:focus-ring"
            aria-label={label}
          >
            <span className="flex shrink-0 -space-x-1">
              {cs.map((c) => (
                <span key={c.chunk_id} className="grid size-5 place-items-center rounded-full bg-gradient-to-br from-sky-500 to-indigo-600 text-[10px] font-bold text-white ring-2 ring-white">
                  {c.index}
                </span>
              ))}
            </span>
            <span className="truncate">{first.title}</span>
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-80" onMouseEnter={show} onMouseLeave={hide} onOpenAutoFocus={(e) => e.preventDefault()}>
        <SourceCard cs={cs} />
      </PopoverContent>
    </Popover>
  );
}

/** The "Sources" row under an answer: citations grouped by document, in first-cited order. */
export function SourceChips({ citations }: { citations: Citation[] }) {
  const groups = React.useMemo(() => {
    const byDoc = new Map<string, Citation[]>();
    for (const c of [...citations].sort((a, b) => a.index - b.index)) {
      const list = byDoc.get(c.document_id);
      if (list) list.push(c);
      else byDoc.set(c.document_id, [c]);
    }
    return [...byDoc.values()];
  }, [citations]);
  return (
    <>
      {groups.map((cs) => (
        <SourceChip key={cs[0]!.document_id} cs={cs} />
      ))}
    </>
  );
}

const base: Components = {
  h1: ({ node: _n, children, ...p }) => (
    <h3 className="mt-5 font-display text-lg font-bold text-slate-900 first:mt-0" {...p}>
      {children}
    </h3>
  ),
  h2: ({ node: _n, children, ...p }) => (
    <h4 className="mt-5 font-display text-base font-semibold text-slate-900 first:mt-0" {...p}>
      {children}
    </h4>
  ),
  h3: ({ node: _n, children, ...p }) => (
    <h5 className="mt-4 font-semibold text-slate-900 first:mt-0" {...p}>
      {children}
    </h5>
  ),
  p: ({ node: _n, ...p }) => <p className="my-3 leading-relaxed first:mt-0 last:mb-0" {...p} />,
  ul: ({ node: _n, ...p }) => <ul className="my-3 list-disc space-y-1.5 pl-5 marker:text-violet-400" {...p} />,
  ol: ({ node: _n, ...p }) => <ol className="my-3 list-decimal space-y-1.5 pl-5 marker:font-semibold marker:text-violet-600" {...p} />,
  li: ({ node: _n, ...p }) => <li className="pl-1" {...p} />,
  blockquote: ({ node: _n, ...p }) => <blockquote className="my-4 rounded-r-xl border-l-4 border-violet-400 bg-violet-50/60 py-2 pl-4 pr-3 text-slate-700" {...p} />,
  code: ({ node: _n, className, children, ...p }) =>
    /language-/.test(className ?? "") ? (
      <code className={cn("font-mono text-[13px]", className)} {...p}>
        {children}
      </code>
    ) : (
      <code className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[0.85em] text-fuchsia-700" {...p}>
        {children}
      </code>
    ),
  pre: ({ node: _n, ...p }) => <pre className="my-4 overflow-x-auto rounded-2xl bg-slate-900 p-4 text-slate-100 scrollbar-thin" {...p} />,
  table: ({ node: _n, ...p }) => (
    <div className="my-4 overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full border-collapse text-sm" {...p} />
    </div>
  ),
  thead: ({ node: _n, ...p }) => <thead className="bg-slate-50" {...p} />,
  th: ({ node: _n, ...p }) => <th className="border-b border-slate-200 px-3 py-2 text-left font-semibold text-slate-700" {...p} />,
  td: ({ node: _n, ...p }) => <td className="border-b border-slate-100 px-3 py-2 text-slate-700" {...p} />,
  hr: () => <hr className="my-5 border-slate-200" />,
};

const CITE = /\[(\d{1,2})\](?!\()/g;

export function TutorMarkdown({ children, citations, className }: { children: string; citations: Citation[]; className?: string }) {
  const byIndex = React.useMemo(() => new Map(citations.map((c) => [c.index, c])), [citations]);
  const text = React.useMemo(
    () => (byIndex.size ? children.replace(CITE, (m, n: string) => (byIndex.has(Number(n)) ? `[${n}](#cite-${n})` : m)) : children),
    [children, byIndex],
  );
  const components = React.useMemo<Components>(
    () => ({
      ...base,
      a: ({ node: _n, href, children: kids, ...p }) => {
        const cite = href?.match(/^#cite-(\d+)$/);
        const c = cite ? byIndex.get(Number(cite[1])) : undefined;
        if (c) return <CitationChip c={c} inline />;
        const external = !!href && /^https?:\/\//.test(href);
        return (
          <a
            href={href}
            className="font-medium text-brand-700 underline decoration-brand-300 underline-offset-2 hover:decoration-brand-600"
            {...(external ? { target: "_blank", rel: "noopener noreferrer nofollow" } : {})}
            {...p}
          >
            {kids}
          </a>
        );
      },
    }),
    [byIndex],
  );
  return (
    <div className={cn("text-[15px] text-slate-700", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={components} skipHtml>
        {text}
      </ReactMarkdown>
    </div>
  );
}
