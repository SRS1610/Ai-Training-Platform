"use client";

import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  StatusPill,
  cn,
  toast,
} from "@praxis/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronRight, Eye, FileJson, ShieldCheck, Wand2 } from "lucide-react";
import * as React from "react";
import { ApiError, api, errorMessage } from "@/lib/api";
import { formatDateTime, formatRelative } from "@/lib/format";
import type { BuilderTab, MappedIssue } from "./graph-utils";
import { sk, type SimDefinition, type ValidationOut, type VersionOut } from "./types";

export const TAB_LABEL: Record<BuilderTab, string> = {
  flow: "Flow",
  scenario: "Scenario",
  environment: "Environment",
  characters: "Characters",
  variables: "Variables",
  scoring: "Scoring",
  feedback: "Feedback",
  json: "JSON",
};

/* ------------------------------------------------------------------ validation status + problems */

export function ValidationPill({ validation, stale, onClick }: { validation: ValidationOut | null; stale?: boolean; onClick: () => void }) {
  if (!validation) return null;
  const e = validation.errors.length;
  const w = validation.warnings.length;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset transition-colors focus-visible:focus-ring",
        e ? "bg-rose-50 text-rose-700 ring-rose-200 hover:bg-rose-100" : w ? "bg-amber-50 text-amber-800 ring-amber-200 hover:bg-amber-100" : "bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100",
      )}
      aria-label={`Validation: ${e} errors, ${w} warnings. Open problems panel.`}
    >
      {e ? <AlertCircle className="size-3.5" aria-hidden /> : w ? <AlertTriangle className="size-3.5" aria-hidden /> : <ShieldCheck className="size-3.5" aria-hidden />}
      {e ? `${e} error${e === 1 ? "" : "s"}` : "Valid"}
      {w > 0 && <span className="font-medium opacity-80">· {w} warning{w === 1 ? "" : "s"}</span>}
      {stale && <span className="font-medium opacity-70">· unsaved edits</span>}
    </button>
  );
}

export function ProblemsSheet({
  open,
  onOpenChange,
  issues,
  stats,
  onGo,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  issues: MappedIssue[];
  stats?: Record<string, unknown>;
  onGo: (issue: MappedIssue) => void;
}) {
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const Row = ({ i }: { i: MappedIssue }) => (
    <li>
      <button
        type="button"
        onClick={() => onGo(i)}
        className={cn(
          "group flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left ring-1 ring-inset transition-colors focus-visible:focus-ring",
          i.severity === "error" ? "bg-rose-50/70 ring-rose-200 hover:bg-rose-50" : "bg-amber-50/70 ring-amber-200 hover:bg-amber-50",
        )}
      >
        {i.severity === "error" ? <AlertCircle className="mt-0.5 size-4 shrink-0 text-rose-600" aria-hidden /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />}
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-slate-900">{i.message}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-2xs text-slate-500">
            <span className="font-mono">{i.path || "definition"}</span>
            <span className="rounded bg-white px-1 font-mono">{i.code}</span>
            <span>· {TAB_LABEL[i.tab]}</span>
          </span>
        </span>
        <ChevronRight className="mt-0.5 size-4 shrink-0 text-slate-400 group-hover:text-slate-700" aria-hidden />
      </button>
    </li>
  );
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[94%] max-w-lg">
        <SheetHeader>
          <SheetTitle>Validation</SheetTitle>
          <SheetDescription>Publishing needs zero errors. Click an issue to jump to it.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-5 overflow-y-auto px-6 pb-6 scrollbar-thin">
          {stats && (
            <dl className="grid grid-cols-4 gap-2">
              {Object.entries(stats).slice(0, 8).map(([k, v]) => (
                <div key={k} className="rounded-xl bg-slate-50 px-2.5 py-2 text-center">
                  <dt className="truncate text-2xs font-semibold uppercase tracking-wider text-slate-500">{k}</dt>
                  <dd className="font-display text-lg font-bold tabular-nums text-slate-900">{String(v)}</dd>
                </div>
              ))}
            </dl>
          )}
          {!issues.length ? (
            <EmptyState size="sm" illustration="shield" title="No problems found" description="The definition is valid and ready to publish." />
          ) : (
            <>
              {errors.length > 0 && (
                <section>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-rose-700">Errors ({errors.length})</h3>
                  <ul className="space-y-1.5">{errors.map((i, k) => <Row key={k} i={i} />)}</ul>
                </section>
              )}
              {warnings.length > 0 && (
                <section>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-amber-800">Warnings ({warnings.length})</h3>
                  <ul className="space-y-1.5">{warnings.map((i, k) => <Row key={k} i={i} />)}</ul>
                </section>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ versions */

export function VersionsSheet({ open, onOpenChange, simId }: { open: boolean; onOpenChange: (o: boolean) => void; simId: string }) {
  const [viewing, setViewing] = React.useState<number | null>(null);
  const q = useQuery({
    queryKey: sk.versions(simId),
    queryFn: ({ signal }) => api.get<VersionOut[]>(`/simulations/${simId}/versions`, { signal }),
    enabled: open,
  });
  const detail = useQuery({
    queryKey: sk.version(simId, viewing ?? 0),
    queryFn: ({ signal }) => api.get<VersionOut & { definition: SimDefinition }>(`/simulations/${simId}/versions/${viewing}`, { signal }),
    enabled: viewing !== null,
  });
  const tone = (s: string) => (s === "published" ? "success" : s === "draft" ? "info" : "neutral");
  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-[94%] max-w-md">
          <SheetHeader>
            <SheetTitle>Versions</SheetTitle>
            <SheetDescription>Publishing freezes an immutable version. Running sessions stay on the version they started.</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-6 pb-6 scrollbar-thin">
            {q.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 rounded-xl" />
                ))}
              </div>
            ) : q.isError ? (
              <Alert tone="danger">{errorMessage(q.error)}</Alert>
            ) : (
              <ol className="relative space-y-3 before:absolute before:bottom-3 before:left-[15px] before:top-3 before:w-px before:bg-slate-200">
                {(q.data ?? []).map((v) => (
                  <li key={v.id} className="relative flex gap-3">
                    <span className={cn("relative z-10 grid size-8 shrink-0 place-items-center rounded-full text-xs font-bold ring-4 ring-white", v.status === "published" ? "bg-emerald-500 text-white" : v.status === "draft" ? "bg-sky-500 text-white" : "bg-slate-200 text-slate-600")}>
                      v{v.version}
                    </span>
                    <div className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white p-3">
                      <div className="flex items-center justify-between gap-2">
                        <StatusPill status={v.status} tone={tone(v.status)} size="sm" />
                        <Button size="xs" variant="ghost" leftIcon={<Eye />} onClick={() => setViewing(v.version)}>
                          View
                        </Button>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {v.published_at ? `Published ${formatDateTime(v.published_at)}` : `Updated ${formatRelative(v.updated_at)}`}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </SheetContent>
      </Sheet>
      <Dialog open={viewing !== null} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent size="xl">
          <DialogHeader>
            <DialogTitle>Version {viewing}</DialogTitle>
            <DialogDescription>Read-only definition snapshot.</DialogDescription>
          </DialogHeader>
          {detail.isLoading ? (
            <Skeleton className="h-96 rounded-xl" />
          ) : detail.data ? (
            <pre className="max-h-[60vh] overflow-auto rounded-xl bg-slate-950 p-4 font-mono text-xs leading-relaxed text-emerald-200 scrollbar-thin">{JSON.stringify(detail.data.definition, null, 2)}</pre>
          ) : (
            <Alert tone="danger">{errorMessage(detail.error)}</Alert>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ------------------------------------------------------------------ raw JSON editor */

export function JsonTab({
  simId,
  definition,
  blocked,
  onSaved,
  onValidation,
}: {
  simId: string;
  definition: SimDefinition | null;
  blocked: string | null;
  onSaved: () => void;
  onValidation: (v: ValidationOut) => void;
}) {
  const initial = React.useMemo(() => JSON.stringify(definition ?? {}, null, 2), [definition]);
  const [text, setText] = React.useState(initial);
  const [parseError, setParseError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<ValidationOut | null>(null);
  const gutter = React.useRef<HTMLPreElement>(null);
  React.useEffect(() => {
    setText(initial);
    setParseError(null);
  }, [initial]);
  const dirty = text !== initial;
  const lines = text.split("\n").length;

  const parse = (): SimDefinition | null => {
    try {
      const v = JSON.parse(text) as SimDefinition;
      setParseError(null);
      return v;
    } catch (e) {
      setParseError((e as Error).message);
      return null;
    }
  };
  const validate = useMutation({
    mutationFn: (d: SimDefinition) => api.post<ValidationOut>(`/simulations/${simId}/validate`, { definition: d }),
    onSuccess: (v) => {
      setResult(v);
      toast[v.valid ? "success" : "warning"](v.valid ? "Definition is valid" : `${v.errors.length} error(s) found`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const save = useMutation({
    mutationFn: (d: SimDefinition) => api.put<{ validation: ValidationOut }>(`/simulations/${simId}/draft`, { definition: d }),
    onSuccess: (r) => {
      setResult(r.validation);
      onValidation(r.validation);
      toast.success("Draft saved from JSON");
      onSaved();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "invalid_definition") {
        const d = e.details as ValidationOut | undefined;
        if (d?.errors) setResult({ valid: false, errors: d.errors, warnings: d.warnings ?? [], stats: {} });
        toast.error("The definition isn't structurally valid — see the errors below");
      } else toast.error(errorMessage(e));
    },
  });

  return (
    <div className="space-y-4">
      {blocked && (
        <Alert tone="warning" title="Save your other changes first">
          {blocked}
        </Alert>
      )}
      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-lift">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-900 px-4 py-2.5">
          <FileJson className="size-4 text-emerald-400" aria-hidden />
          <span className="text-sm font-semibold text-slate-100">definition.json</span>
          <span className="text-xs text-slate-400">{lines} lines</span>
          {dirty && <Badge tone="warning" size="sm">Edited</Badge>}
          <div className="ml-auto flex flex-wrap gap-1.5">
            <Button
              size="xs"
              variant="ghost"
              className="text-slate-200 hover:bg-slate-800 hover:text-white"
              leftIcon={<Wand2 />}
              onClick={() => {
                const v = parse();
                if (v) setText(JSON.stringify(v, null, 2));
              }}
            >
              Format
            </Button>
            <Button size="xs" variant="ghost" className="text-slate-200 hover:bg-slate-800 hover:text-white" disabled={!!blocked} onClick={() => setText(initial)}>
              Revert
            </Button>
            <Button size="xs" variant="secondary" leftIcon={<ShieldCheck />} loading={validate.isPending} onClick={() => { const v = parse(); if (v) validate.mutate(v); }}>
              Validate
            </Button>
            <Button size="xs" variant="success" leftIcon={<CheckCircle2 />} loading={save.isPending} disabled={!!blocked || !dirty} onClick={() => { const v = parse(); if (v) save.mutate(v); }}>
              Save JSON
            </Button>
          </div>
        </div>
        <div className="flex max-h-[68vh] overflow-auto scrollbar-thin" onScroll={(e) => gutter.current && (gutter.current.scrollTop = (e.target as HTMLDivElement).scrollTop)}>
          <pre ref={gutter} aria-hidden className="sticky left-0 select-none bg-slate-950 py-3 pl-3 pr-3 text-right font-mono text-xs leading-5 text-slate-600">
            {Array.from({ length: lines }, (_, i) => i + 1).join("\n")}
          </pre>
          <textarea
            aria-label="Simulation definition JSON"
            spellCheck={false}
            value={text}
            readOnly={!!blocked}
            onChange={(e) => {
              setText(e.target.value);
              setParseError(null);
            }}
            rows={lines}
            className="min-h-[60vh] flex-1 resize-none whitespace-pre bg-transparent py-3 pr-4 font-mono text-xs leading-5 text-emerald-100 caret-emerald-300 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500/40"
          />
        </div>
      </div>
      {parseError && <Alert tone="danger" title="Invalid JSON">{parseError}</Alert>}
      {result && (
        <div className={cn("rounded-2xl border p-4", result.valid ? "border-emerald-200 bg-emerald-50/60" : "border-rose-200 bg-rose-50/60")} aria-live="polite">
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            {result.valid ? <CheckCircle2 className="size-4 text-emerald-600" aria-hidden /> : <AlertCircle className="size-4 text-rose-600" aria-hidden />}
            {result.valid ? "Valid" : `${result.errors.length} error(s)`} · {result.warnings.length} warning(s)
          </p>
          <ul className="mt-2 space-y-1 text-xs">
            {[...result.errors.map((x) => ({ ...x, s: "e" })), ...result.warnings.map((x) => ({ ...x, s: "w" }))].map((x, i) => (
              <li key={i} className={x.s === "e" ? "text-rose-800" : "text-amber-900"}>
                <span className="font-mono font-semibold">{x.path}</span> — {x.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
