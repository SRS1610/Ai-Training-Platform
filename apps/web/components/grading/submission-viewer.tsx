"use client";

import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, SimpleSelect, cn } from "@praxis/ui";
import { Code2, FileStack, GitCompareArrows, ListTree, Paperclip, Type } from "lucide-react";
import { Highlight, themes } from "prism-react-renderer";
import * as React from "react";
import { formatDateTime } from "@/lib/format";
import { EvidenceFiles } from "./evidence-files";
import { SwitchChip } from "./list-input";
import { TextDiff } from "./text-diff";
import type { StructuredField, SubmissionVersion } from "./types";

function guessLanguage(code: string): string {
  if (/^\s*(def |class .*:|import \w+$|from \w+ import)/m.test(code)) return "python";
  if (/^\s*(SELECT|INSERT|UPDATE|CREATE TABLE)\b/im.test(code)) return "sql";
  if (/^\s*[{[]/.test(code) && /":\s/.test(code)) return "json";
  if (/<\/?[a-z][\s\S]*>/i.test(code) && !/=>/.test(code)) return "markup";
  if (/^\s*(\$|PS |Get-|Set-|ipconfig|ping |nslookup)/m.test(code)) return "bash";
  return "tsx";
}

export function CodeBlock({ code }: { code: string }) {
  const lang = React.useMemo(() => guessLanguage(code), [code]);
  return (
    <Highlight theme={themes.github} code={code.replace(/\n$/, "")} language={lang}>
      {({ className, style, tokens, getLineProps, getTokenProps }) => (
        <pre className={cn(className, "max-h-[560px] overflow-auto rounded-xl border border-slate-200 p-4 text-[13px] leading-6 scrollbar-thin")} style={style}>
          {tokens.map((line, i) => {
            const { key: _k, ...lineProps } = getLineProps({ line, key: i }) as ReturnType<typeof getLineProps> & { key?: React.Key };
            return (
              <div key={i} {...lineProps}>
                <span className="mr-4 inline-block w-8 select-none text-right text-2xs text-slate-400" aria-hidden>
                  {i + 1}
                </span>
                {line.map((token, j) => {
                  const { key: _tk, ...tp } = getTokenProps({ token, key: j }) as ReturnType<typeof getTokenProps> & { key?: React.Key };
                  return <span key={j} {...tp} />;
                })}
              </div>
            );
          })}
        </pre>
      )}
    </Highlight>
  );
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v, null, 2);
}

function Section({ icon: Icon, title, children, color }: { icon: typeof Type; title: string; children: React.ReactNode; color: string }) {
  return (
    <section className="space-y-2.5">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <span className={cn("grid size-7 place-items-center rounded-lg", color)}>
          <Icon className="size-4" aria-hidden />
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}

export function SubmissionViewer({ versions, fields, currentVersion }: { versions: SubmissionVersion[]; fields: StructuredField[]; currentVersion: number }) {
  const sorted = React.useMemo(() => [...versions].sort((a, b) => a.version_number - b.version_number), [versions]);
  const [selected, setSelected] = React.useState<number>(currentVersion || sorted[sorted.length - 1]?.version_number || 1);
  const [compare, setCompare] = React.useState(false);
  const [base, setBase] = React.useState<number | null>(null);
  React.useEffect(() => setSelected(currentVersion || sorted[sorted.length - 1]?.version_number || 1), [currentVersion, sorted]);

  const v = sorted.find((x) => x.version_number === selected) ?? sorted[sorted.length - 1];
  const baseNum = base ?? sorted.filter((x) => x.version_number < selected).pop()?.version_number ?? null;
  const b = compare && baseNum !== null ? sorted.find((x) => x.version_number === baseNum) : undefined;

  if (!v)
    return (
      <Card>
        <EmptyState illustration="inbox" title="No submitted versions" description="This submission has no saved content yet." />
      </Card>
    );

  const answers = (v.structured_answers ?? {}) as Record<string, unknown>;
  const baseAnswers = (b?.structured_answers ?? {}) as Record<string, unknown>;
  const fieldIds = Array.from(new Set([...fields.map((f) => f.id), ...Object.keys(answers)]));
  const labelFor = (id: string) => fields.find((f) => f.id === id)?.label ?? id;

  return (
    <Card>
      <CardHeader className="flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-indigo-50 text-indigo-600">
            <FileStack className="size-[18px]" aria-hidden />
          </span>
          <div>
            <CardTitle as="h2">Learner submission</CardTitle>
            <p className="text-xs text-muted-foreground">
              Version {v.version_number} · saved {formatDateTime(v.created_at)}
              {v.content_sha256 && <span className="ml-1 font-mono text-2xs text-slate-400">#{v.content_sha256.slice(0, 8)}</span>}
            </p>
          </div>
        </div>
        {sorted.length > 1 && (
          <SwitchChip checked={compare} onCheckedChange={setCompare} icon={<GitCompareArrows aria-hidden />} label="Compare versions" />
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Submission versions">
          {sorted.map((x) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              aria-selected={x.version_number === v.version_number}
              onClick={() => {
                setSelected(x.version_number);
                setBase(null);
              }}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset transition-colors focus-visible:focus-ring",
                x.version_number === v.version_number ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50",
              )}
            >
              v{x.version_number}
              {x.is_final && <span className={cn("rounded-full px-1.5 text-2xs", x.version_number === v.version_number ? "bg-white/20" : "bg-emerald-50 text-emerald-700")}>final</span>}
            </button>
          ))}
          {compare && (
            <div className="ml-auto flex items-center gap-2 text-xs text-slate-600">
              <span>against</span>
              <SimpleSelect
                aria-label="Compare against version"
                className="h-8 w-28"
                value={baseNum !== null ? String(baseNum) : undefined}
                placeholder="Version"
                onValueChange={(val) => setBase(Number(val))}
                options={sorted.filter((x) => x.version_number !== v.version_number).map((x) => ({ value: String(x.version_number), label: `v${x.version_number}` }))}
              />
            </div>
          )}
        </div>

        {compare && b && (
          <Badge tone="info" size="md">
            Showing changes from v{b.version_number} → v{v.version_number}
          </Badge>
        )}

        {(v.text_content || b?.text_content) && (
          <Section icon={Type} title="Written answer" color="bg-sky-50 text-sky-600">
            {compare && b ? (
              <TextDiff before={b.text_content ?? ""} after={v.text_content ?? ""} />
            ) : (
              <div className="whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-gradient-to-b from-white to-slate-50/60 p-4 text-[15px] leading-7 text-slate-800">
                {v.text_content}
              </div>
            )}
          </Section>
        )}

        {(v.code_content || b?.code_content) && (
          <Section icon={Code2} title="Code" color="bg-violet-50 text-violet-600">
            {compare && b ? <TextDiff before={b.code_content ?? ""} after={v.code_content ?? ""} mono /> : <CodeBlock code={v.code_content ?? ""} />}
          </Section>
        )}

        {fieldIds.length > 0 && Object.keys(answers).length > 0 && (
          <Section icon={ListTree} title="Structured answers" color="bg-teal-50 text-teal-600">
            <dl className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
              {fieldIds.map((id) => {
                const val = stringify(answers[id]);
                const changed = compare && b && stringify(baseAnswers[id]) !== val;
                return (
                  <div key={id} className={cn("grid gap-1 px-4 py-3 sm:grid-cols-[200px_1fr] sm:gap-4", changed && "bg-amber-50/70")}>
                    <dt className="text-sm font-medium text-slate-600">
                      {labelFor(id)}
                      {changed && <span className="ml-2 rounded-full bg-amber-100 px-1.5 text-2xs font-semibold text-amber-800">changed</span>}
                    </dt>
                    <dd className="whitespace-pre-wrap break-words text-sm text-slate-900">
                      {val || <span className="italic text-slate-400">No answer</span>}
                      {changed && (
                        <span className="mt-1 block text-xs text-slate-500 line-through decoration-rose-400">{stringify(baseAnswers[id]) || "(empty)"}</span>
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </Section>
        )}

        <Section icon={Paperclip} title={`Evidence files (${v.files?.length ?? 0})`} color="bg-amber-50 text-amber-600">
          <EvidenceFiles files={v.files ?? []} />
        </Section>

        {!v.text_content && !v.code_content && !Object.keys(answers).length && !(v.files ?? []).length && (
          <p className="text-sm italic text-muted-foreground">This version is empty.</p>
        )}
      </CardContent>
    </Card>
  );
}
