"use client";

/**
 * Safe Markdown renderer (GFM: tables, task lists, strikethrough, autolinks).
 * Raw HTML is never rendered and output is sanitised with rehype-sanitize (GitHub schema).
 * Use for AI tutor answers, lesson text, feedback and descriptions.
 */

import { cn } from "@praxis/ui";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

const components: Components = {
  h1: ({ node: _n, children, ...p }) => (
    <h2 className="mt-6 font-display text-2xl font-bold tracking-tight text-slate-900 first:mt-0" {...p}>
      {children}
    </h2>
  ),
  h2: ({ node: _n, children, ...p }) => (
    <h3 className="mt-6 font-display text-xl font-semibold text-slate-900 first:mt-0" {...p}>
      {children}
    </h3>
  ),
  h3: ({ node: _n, children, ...p }) => (
    <h4 className="mt-5 font-display text-lg font-semibold text-slate-900 first:mt-0" {...p}>
      {children}
    </h4>
  ),
  h4: ({ node: _n, children, ...p }) => (
    <h5 className="mt-4 font-semibold text-slate-900 first:mt-0" {...p}>
      {children}
    </h5>
  ),
  p: ({ node: _n, ...p }) => <p className="my-3 leading-relaxed first:mt-0 last:mb-0" {...p} />,
  a: ({ node: _n, href, children, ...p }) => {
    const external = !!href && /^https?:\/\//.test(href);
    return (
      <a
        href={href}
        className="font-medium text-brand-700 underline decoration-brand-300 underline-offset-2 hover:decoration-brand-600"
        {...(external ? { target: "_blank", rel: "noopener noreferrer nofollow" } : {})}
        {...p}
      >
        {children}
      </a>
    );
  },
  ul: ({ node: _n, className, ...p }) => (
    <ul className={cn("my-3 space-y-1.5 pl-5", className?.includes("contains-task-list") ? "list-none pl-0" : "list-disc marker:text-brand-400")} {...p} />
  ),
  ol: ({ node: _n, ...p }) => <ol className="my-3 list-decimal space-y-1.5 pl-5 marker:font-semibold marker:text-brand-600" {...p} />,
  li: ({ node: _n, ...p }) => <li className="pl-1 [&>input]:mr-2" {...p} />,
  blockquote: ({ node: _n, ...p }) => (
    <blockquote className="my-4 rounded-r-xl border-l-4 border-violet-400 bg-violet-50/60 py-2 pl-4 pr-3 text-slate-700" {...p} />
  ),
  code: ({ node: _n, className, children, ...p }) => {
    const block = /language-/.test(className ?? "");
    return block ? (
      <code className={cn("font-mono text-[13px]", className)} {...p}>
        {children}
      </code>
    ) : (
      <code className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[0.85em] text-fuchsia-700" {...p}>
        {children}
      </code>
    );
  },
  pre: ({ node: _n, ...p }) => <pre className="my-4 overflow-x-auto rounded-2xl bg-slate-900 p-4 text-slate-100 scrollbar-thin" {...p} />,
  table: ({ node: _n, ...p }) => (
    <div className="my-4 overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full border-collapse text-sm" {...p} />
    </div>
  ),
  thead: ({ node: _n, ...p }) => <thead className="bg-slate-50" {...p} />,
  th: ({ node: _n, ...p }) => <th className="border-b border-slate-200 px-3 py-2 text-left font-semibold text-slate-700" {...p} />,
  td: ({ node: _n, ...p }) => <td className="border-b border-slate-100 px-3 py-2 text-slate-700" {...p} />,
  hr: () => <hr className="my-6 border-slate-200" />,
  img: ({ node: _n, alt, ...p }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt ?? ""} loading="lazy" className="my-4 max-w-full rounded-xl border border-slate-200" {...p} />
  ),
};

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("text-[15px] text-slate-700", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={components} skipHtml>
        {children}
      </ReactMarkdown>
    </div>
  );
}
