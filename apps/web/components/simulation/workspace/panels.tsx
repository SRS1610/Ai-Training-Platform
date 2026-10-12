"use client";

import { Badge, Button, cn, colorClasses, humanize, Input } from "@praxis/ui";
import {
  AlertOctagon,
  ArrowLeft,
  BookOpen,
  Clock,
  FileText,
  Globe,
  Mail,
  MailOpen,
  Search,
  ShieldAlert,
  ShieldCheck,
  SquareTerminal,
  UserRound,
} from "lucide-react";
import * as React from "react";
import { Markdown } from "@/components/common/markdown";
import type { TranscriptEntry, ViewAction, ViewPanel } from "../types";
import { ActionBar, ActionControl, TextActionForm } from "./actions";
import { useWorkspace } from "./context";
import { simClock, toolEntries, type WorkspaceApp } from "./model";
import { DataTable, DataView, Emphasis, PanelShell, Properties, ResultsFeed } from "./panel-kit";
import { TerminalPanel } from "./terminal-panel";

const str = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const isDoc = (a: ViewAction) => a.input.type === "free_text";

/* ------------------------------------------------------------------ registry */

export function PanelRenderer({ app, terminalRef }: { app: WorkspaceApp; terminalRef?: React.RefObject<HTMLInputElement | null> }) {
  if (!app.panel) return <ClosedApp app={app} />;
  switch (app.panel.type) {
    case "terminal":
      return <TerminalPanel app={app} focusRef={terminalRef} />;
    case "ticket":
      return <TicketPanel app={app} />;
    case "knowledge_base":
      return <KnowledgePanel app={app} />;
    case "email_inbox":
      return <EmailPanel app={app} />;
    case "email_viewer":
      return <HeadersPanel app={app} />;
    case "siem_alerts":
      return <SiemPanel app={app} />;
    case "url_sandbox":
      return <SandboxPanel app={app} />;
    case "log_viewer":
      return <LogPanel app={app} />;
    case "checklist":
      return <ChecklistPanel app={app} />;
    case "document":
    case "case_file":
      return <DocumentPanel app={app} />;
    case "crm_record":
    case "patient_chart":
      return <RecordPanel app={app} />;
    case "dashboard":
    case "admin_console":
      return <ConsolePanel app={app} />;
    case "system_info":
      return <SystemInfoPanel app={app} />;
    default:
      return <GenericPanel app={app} />;
  }
}

function Body({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("space-y-6 p-4 sm:p-5", className)}>{children}</div>;
}

/** Typed input for non-terminal tools that accept commands (search boxes, consoles). */
function CommandBar({ app }: { app: WorkspaceApp }) {
  const { act, pending, ended } = useWorkspace();
  const [text, setText] = React.useState("");
  const tool = app.commandTools[0];
  if (!tool) return null;
  const busy = pending?.kind === "command" && pending.tool === tool.id;
  return (
    <form
      className="flex gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const t = text.trim();
        if (!t) return;
        setText("");
        await act({ tool: tool.id, input: { text: t } }, { kind: "command", tool: tool.id, text: t }).catch(() => setText(t));
      }}
    >
      <Input
        inputSize="sm"
        value={text}
        onChange={(e) => setText(e.target.value)}
        leftIcon={<SquareTerminal />}
        placeholder={tool.prompt || `Type into ${tool.name}…`}
        aria-label={`${tool.name} input`}
        disabled={ended}
        className="font-mono"
      />
      <Button type="submit" size="sm" loading={busy} disabled={ended || !text.trim()}>
        Run
      </Button>
    </form>
  );
}

/* ------------------------------------------------------------------ closed app (tool without a visible panel) */

function ClosedApp({ app }: { app: WorkspaceApp }) {
  const c = colorClasses(app.color);
  const Icon = app.icon;
  const tool = app.tools[0];
  return (
    <PanelShell icon={app.icon} color={app.color} title={app.title} subtitle={tool?.description || "Not opened yet"}>
      <div className="grid min-h-full place-items-center p-6">
        <div className="w-full max-w-md text-center">
          <span className={cn("mx-auto grid size-16 place-items-center rounded-3xl bg-gradient-to-br text-white shadow-lift", c.gradient)}>
            <Icon className="size-8" aria-hidden />
          </span>
          <h3 className="mt-4 font-display text-lg font-semibold text-slate-900">{app.title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{tool?.description || "Open this tool to see what it shows."}</p>
          {app.actions.length > 0 ? (
            <div className="mt-5 grid gap-2">
              {app.actions.map((a) => (
                <ActionControl key={a.id} action={a} size="md" className="w-full justify-center" />
              ))}
            </div>
          ) : app.commandTools.length ? (
            <div className="mt-5 text-left">
              <CommandBar app={app} />
            </div>
          ) : (
            <p className="mt-5 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">Nothing to do here right now.</p>
          )}
        </div>
      </div>
    </PanelShell>
  );
}

/* ------------------------------------------------------------------ ticket (ServiceNow-style) */

const PRIORITY_TONE: Record<string, "danger" | "warning" | "info" | "neutral"> = { "1": "danger", "2": "warning", "3": "warning", "4": "info", "5": "neutral" };

function TicketPanel({ app }: { app: WorkspaceApp }) {
  const { view } = useWorkspace();
  const d = app.panel!.data;
  const [tab, setTab] = React.useState<"details" | "notes">("details");
  const priority = str(d.priority);
  const pTone = PRIORITY_TONE[priority.match(/P?(\d)/)?.[1] ?? ""] ?? "neutral";
  const status = str(d.status);
  const docs = app.actions.filter(isDoc);
  const entries = toolEntries(view, app);
  const known = ["number", "title", "priority", "status", "caller", "contact", "asset", "opened", "assignment_group", "sla", "description"];
  const extra = Object.fromEntries(Object.entries(d).filter(([k]) => !known.includes(k)));
  const field = (label: string, value: unknown, mono?: boolean) =>
    value ? (
      <div>
        <p className="text-2xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
        <p className={cn("mt-1 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-sm text-slate-900", mono && "font-mono text-[13px]")}>{str(value)}</p>
      </div>
    ) : null;

  return (
    <PanelShell
      icon={app.icon}
      color={app.color}
      title={
        <span className="flex items-center gap-2">
          <span className="font-mono text-sm text-indigo-700">{str(d.number) || app.title}</span>
          <span className="hidden truncate sm:inline">{str(d.title)}</span>
        </span>
      }
      subtitle={<span className="sm:hidden">{str(d.title)}</span>}
      right={
        <div className="flex flex-wrap items-center gap-1.5">
          {priority && (
            <Badge tone={pTone} size="sm" dot>
              {priority}
            </Badge>
          )}
          {status && (
            <Badge tone={/resolv|clos/i.test(status) ? "success" : /progress/i.test(status) ? "info" : "neutral"} size="sm" dot>
              {status}
            </Badge>
          )}
        </div>
      }
      toolbar={<ActionBar actions={app.actions} exclude={isDoc} />}
    >
      <div className="flex gap-1 border-b border-slate-100 px-4 pt-2 sm:px-5" role="tablist" aria-label="Ticket sections">
        {(["details", "notes"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              "-mb-px border-b-2 px-3 pb-2 pt-1 text-sm font-medium transition-colors focus-visible:focus-ring",
              tab === t ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800",
            )}
          >
            {t === "details" ? "Details" : `Work notes${docs.length ? "" : ""}`}
            {t === "notes" && entries.length > 0 && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-2xs text-slate-600">{entries.filter((e) => e.kind !== "message").length}</span>}
          </button>
        ))}
      </div>
      {tab === "details" ? (
        <Body>
          {d.description ? (
            <blockquote className="rounded-2xl border-l-4 border-indigo-400 bg-indigo-50/60 px-4 py-3 text-sm text-slate-800">
              <p className="mb-1 text-2xs font-semibold uppercase tracking-wider text-indigo-700">Caller description</p>
              {str(d.description)}
            </blockquote>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            {field("Caller", d.caller)}
            {field("Contact", d.contact)}
            {field("Configuration item", d.asset, true)}
            {field("Opened", d.opened)}
            {field("Assignment group", d.assignment_group)}
            {field("SLA", d.sla)}
          </div>
          {Object.keys(extra).length > 0 && <DataView data={extra} />}
          {docs.length > 0 && (
            <Button variant="soft" size="sm" leftIcon={<FileText />} onClick={() => setTab("notes")}>
              Open work notes
            </Button>
          )}
        </Body>
      ) : (
        <Body>
          {docs.map((a) => (
            <div key={a.id} className="rounded-2xl border border-slate-200 p-4">
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900">
                <FileText className="size-4 text-indigo-600" aria-hidden />
                {a.label}
              </p>
              <TextActionForm action={a} rows={5} submitLabel="Save to ticket" />
            </div>
          ))}
          <ResultsFeed entries={entries} title="Activity stream" empty="No work notes yet." />
        </Body>
      )}
    </PanelShell>
  );
}

/* ------------------------------------------------------------------ knowledge base */

function articleOutputs(entries: TranscriptEntry[]): Map<string, string> {
  // learner "action" entry (label) and its output share a seq.
  const out = new Map<string, string>();
  const bySeq = new Map<number, TranscriptEntry[]>();
  for (const e of entries) bySeq.set(e.seq, [...(bySeq.get(e.seq) ?? []), e]);
  for (const list of bySeq.values()) {
    const label = list.find((e) => e.kind === "action")?.text;
    const body = list.find((e) => e.kind === "output")?.text;
    if (label && body) out.set(label, body);
  }
  return out;
}

function KnowledgePanel({ app }: { app: WorkspaceApp }) {
  const { view, act, pending, ended } = useWorkspace();
  const articles = (Array.isArray(app.panel!.data.articles) ? app.panel!.data.articles : []) as Record<string, unknown>[];
  const entries = toolEntries(view, app);
  const read = articleOutputs(entries);
  const [q, setQ] = React.useState("");
  const [openId, setOpenId] = React.useState<string | null>(null);
  const match = (a: Record<string, unknown>) => {
    const id = str(a.id);
    const title = str(a.title);
    const action = app.actions.find((x) => (id && x.label.includes(id)) || (title && x.label.toLowerCase().includes(title.toLowerCase())));
    const content = [...read.entries()].find(([label]) => (id && label.includes(id)) || (title && label.toLowerCase().includes(title.toLowerCase())))?.[1];
    return { id, title, action, content };
  };
  const list = articles.filter((a) => !q || `${str(a.id)} ${str(a.title)}`.toLowerCase().includes(q.toLowerCase()));
  const open = openId ? articles.find((a) => str(a.id) === openId) : null;
  const m = open ? match(open) : null;
  const matchedIds = new Set(articles.map((a) => match(a).action?.id).filter(Boolean));
  const others = app.actions.filter((a) => !matchedIds.has(a.id));

  const openArticle = async (a: Record<string, unknown>) => {
    const info = match(a);
    setOpenId(info.id);
    if (!info.content && info.action) {
      await act({ action_id: info.action.id, tool: info.action.tool ?? undefined, input: null }, { kind: "action", actionId: info.action.id }).catch(() => undefined);
    }
  };

  return (
    <PanelShell icon={BookOpen} color={app.color} title={app.title} subtitle={`${articles.length} articles`} toolbar={others.length ? <ActionBar actions={others} /> : undefined}>
      <div className="grid min-h-full md:grid-cols-[18rem_1fr]">
        <div className={cn("border-slate-100 p-3 md:border-r", open && "hidden md:block")}>
          <Input inputSize="sm" leftIcon={<Search />} placeholder="Search knowledge base…" aria-label="Search knowledge base" value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="mt-3 space-y-1">
            {list.map((a) => {
              const info = match(a);
              const on = info.id === openId;
              return (
                <li key={info.id}>
                  <button
                    type="button"
                    onClick={() => openArticle(a)}
                    disabled={ended && !info.content}
                    className={cn(
                      "w-full rounded-xl px-3 py-2.5 text-left transition-colors focus-visible:focus-ring",
                      on ? "bg-amber-50 ring-1 ring-amber-200" : "hover:bg-slate-50",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span className="rounded-md bg-amber-100 px-1.5 py-0.5 font-mono text-2xs font-semibold text-amber-900">{info.id}</span>
                      {info.content && <span className="text-2xs font-medium text-emerald-700">Read</span>}
                    </span>
                    <span className="mt-1 block text-sm font-medium text-slate-900">{info.title}</span>
                    {a.updated ? <span className="mt-0.5 block text-2xs text-slate-500">Updated {str(a.updated)}</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        <div className={cn("p-4 sm:p-6", !open && "hidden md:block")}>
          {open && m ? (
            <article className="mx-auto max-w-2xl">
              <button type="button" onClick={() => setOpenId(null)} className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900 md:hidden">
                <ArrowLeft className="size-4" aria-hidden /> All articles
              </button>
              <p className="font-mono text-xs font-semibold text-amber-800">{m.id}</p>
              <h3 className="mt-1 font-display text-xl font-semibold text-slate-900">{m.title}</h3>
              <div className="mt-4">
                {m.content ? (
                  <Markdown>{m.content}</Markdown>
                ) : pending?.kind === "action" && pending.actionId === m.action?.id ? (
                  <div className="space-y-2" aria-busy>
                    {[90, 100, 75, 85].map((w, i) => (
                      <div key={i} className="h-3 animate-pulse rounded bg-slate-100" style={{ width: `${w}%` }} />
                    ))}
                  </div>
                ) : m.action ? (
                  <ActionControl action={m.action}>Open article</ActionControl>
                ) : (
                  <p className="text-sm text-muted-foreground">This article isn’t available right now.</p>
                )}
              </div>
            </article>
          ) : (
            <div className="grid h-full place-items-center py-10 text-center">
              <div>
                <BookOpen className="mx-auto size-10 text-amber-400" aria-hidden />
                <p className="mt-3 text-sm font-medium text-slate-700">Select an article to read it</p>
                <p className="text-xs text-muted-foreground">Reading takes a little simulated time — pick what’s relevant.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </PanelShell>
  );
}

/* ------------------------------------------------------------------ email */

function EmailPanel({ app }: { app: WorkspaceApp }) {
  const { view } = useWorkspace();
  const messages = (Array.isArray(app.panel!.data.messages) ? app.panel!.data.messages : []) as Record<string, unknown>[];
  const [sel, setSel] = React.useState<string | null>(str(messages[0]?.id) || null);
  const [showHeaders, setShowHeaders] = React.useState(false);
  const msg = messages.find((m) => str(m.id) === sel) ?? null;
  const headersPanel = view.panels.find((p) => p.type === "email_viewer");
  const headerAction = app.actions.find((a) => /header/i.test(a.label));
  const entries = toolEntries(view, app);

  return (
    <PanelShell icon={Mail} color={app.color} title={app.title} subtitle={`${messages.length} message${messages.length === 1 ? "" : "s"}`} toolbar={<ActionBar actions={app.actions} />}>
      <div className="grid min-h-full lg:grid-cols-[17rem_1fr]">
        <ul className={cn("border-slate-100 lg:border-r", msg && "hidden lg:block")} aria-label="Messages">
          {messages.map((m) => {
            const on = str(m.id) === sel;
            const reporters = Array.isArray(m.reported_by) ? m.reported_by.length : 0;
            return (
              <li key={str(m.id)}>
                <button
                  type="button"
                  onClick={() => setSel(str(m.id))}
                  className={cn("w-full border-b border-slate-100 px-4 py-3 text-left transition-colors focus-visible:focus-ring", on ? "bg-sky-50" : "hover:bg-slate-50")}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-slate-900">{str(m.from).replace(/<.*>/, "").trim() || str(m.from)}</span>
                    <span className="shrink-0 text-2xs text-slate-500">{str(m.received)}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-sm text-slate-700">{str(m.subject)}</span>
                  {reporters > 0 && (
                    <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-2xs font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">
                      <AlertOctagon className="size-3" aria-hidden /> Reported by {reporters}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        <div className={cn("min-w-0 p-4 sm:p-6", !msg && "hidden lg:block")}>
          {msg ? (
            <article className="mx-auto max-w-2xl space-y-4">
              <button type="button" onClick={() => setSel(null)} className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900 lg:hidden">
                <ArrowLeft className="size-4" aria-hidden /> Inbox
              </button>
              <h3 className="font-display text-xl font-semibold text-slate-900">{str(msg.subject)}</h3>
              <div className="flex flex-wrap items-center gap-3">
                <span className="grid size-10 place-items-center rounded-full bg-gradient-to-br from-sky-400 to-blue-500 text-white">
                  <MailOpen className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="break-all font-medium text-slate-900">{str(msg.from)}</p>
                  <p className="text-xs text-slate-500">Received {str(msg.received)}</p>
                </div>
                {(headersPanel || headerAction) && (
                  <Button
                    size="xs"
                    variant={showHeaders ? "soft" : "secondary"}
                    aria-pressed={showHeaders}
                    onClick={() => setShowHeaders((v) => !v)}
                  >
                    {showHeaders ? "Hide headers" : "Show headers"}
                  </Button>
                )}
              </div>
              {showHeaders && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  {headersPanel ? (
                    <HeaderTable panel={headersPanel} />
                  ) : headerAction ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
                      Full headers haven’t been retrieved yet.
                      <ActionControl action={headerAction} size="xs" />
                    </div>
                  ) : null}
                </div>
              )}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <Markdown className="text-sm">{str(msg.body)}</Markdown>
              </div>
              {Array.isArray(msg.reported_by) && (
                <p className="text-xs text-slate-500">
                  Reported by: <span className="font-medium text-slate-700">{(msg.reported_by as unknown[]).map(str).join(", ")}</span>
                </p>
              )}
            </article>
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">Select a message.</p>
          )}
          <ResultsFeed entries={entries} className="mx-auto mt-6 max-w-2xl" title="Analysis notes" empty="Your findings from this mailbox appear here." />
        </div>
      </div>
    </PanelShell>
  );
}

function HeaderTable({ panel }: { panel: ViewPanel }) {
  const headers = (panel.data.headers && typeof panel.data.headers === "object" ? panel.data.headers : panel.data) as Record<string, unknown>;
  return (
    <dl className="space-y-1.5 font-mono text-[12.5px]">
      {Object.entries(headers).map(([k, v]) => (
        <div key={k} className="grid gap-1 sm:grid-cols-[11rem_1fr]">
          <dt className="font-semibold text-slate-500">{k}:</dt>
          <dd className="break-all text-slate-900">
            {str(v)
              .split(/(\b(?:spf|dkim|dmarc)=\w+)/i)
              .map((part, i) =>
                /^(spf|dkim|dmarc)=/i.test(part) ? (
                  <span key={i} className={cn("rounded px-1 font-semibold", /=(pass)$/i.test(part) ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800")}>
                    {part}
                  </span>
                ) : (
                  <React.Fragment key={i}>{part}</React.Fragment>
                ),
              )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function HeadersPanel({ app }: { app: WorkspaceApp }) {
  return (
    <PanelShell icon={app.icon} color={app.color} title={app.title} subtitle="Raw message headers" toolbar={<ActionBar actions={app.actions} />}>
      <Body>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <HeaderTable panel={app.panel!} />
        </div>
      </Body>
    </PanelShell>
  );
}

/* ------------------------------------------------------------------ SIEM */

const SEV: Record<string, string> = {
  critical: "bg-rose-600 text-white",
  high: "bg-rose-100 text-rose-800 ring-1 ring-inset ring-rose-200",
  medium: "bg-amber-100 text-amber-900 ring-1 ring-inset ring-amber-200",
  low: "bg-sky-100 text-sky-800 ring-1 ring-inset ring-sky-200",
  info: "bg-slate-100 text-slate-700",
};

function SiemPanel({ app }: { app: WorkspaceApp }) {
  const { view } = useWorkspace();
  const alerts = (Array.isArray(app.panel!.data.alerts) ? app.panel!.data.alerts : []) as Record<string, unknown>[];
  const rest = Object.fromEntries(Object.entries(app.panel!.data).filter(([k]) => k !== "alerts"));
  const counts = alerts.reduce<Record<string, number>>((acc, a) => ({ ...acc, [str(a.severity).toLowerCase()]: (acc[str(a.severity).toLowerCase()] ?? 0) + 1 }), {});
  return (
    <PanelShell
      icon={app.icon}
      color={app.color}
      title={app.title}
      subtitle={`${alerts.length} correlated events`}
      right={
        <div className="hidden gap-1.5 sm:flex">
          {Object.entries(counts).map(([s, n]) => (
            <span key={s} className={cn("rounded-full px-2 py-0.5 text-2xs font-semibold", SEV[s] ?? SEV.info)}>
              {n} {s}
            </span>
          ))}
        </div>
      }
      toolbar={<ActionBar actions={app.actions} />}
    >
      <Body>
        <DataTable
          cols={["time", "severity", "source", "text"]}
          rows={alerts}
          render={(col, v) =>
            col === "severity" ? (
              <span className={cn("rounded-full px-2 py-0.5 text-2xs font-semibold capitalize", SEV[str(v).toLowerCase()] ?? SEV.info)}>{str(v)}</span>
            ) : col === "time" ? (
              <span className="whitespace-nowrap font-mono text-xs text-slate-600">{str(v)}</span>
            ) : col === "source" ? (
              <span className="whitespace-nowrap font-medium text-slate-900">{str(v)}</span>
            ) : (
              str(v)
            )
          }
        />
        {Object.keys(rest).length > 0 && <DataView data={rest} />}
        <ResultsFeed entries={toolEntries(view, app)} title="Query results" />
      </Body>
    </PanelShell>
  );
}

/* ------------------------------------------------------------------ URL sandbox */

function SandboxPanel({ app }: { app: WorkspaceApp }) {
  const d = app.panel!.data;
  const verdict = str(d.verdict);
  const bad = /malicious|phish|harmful|danger/i.test(verdict);
  const rest = Object.fromEntries(Object.entries(d).filter(([k]) => !["verdict", "url"].includes(k)));
  return (
    <PanelShell icon={app.icon} color={app.color} title={app.title} subtitle="Detonation report" toolbar={<ActionBar actions={app.actions} />}>
      <Body>
        <div className={cn("flex items-center gap-4 rounded-2xl p-4 ring-1 ring-inset", bad ? "bg-rose-50 ring-rose-200" : "bg-emerald-50 ring-emerald-200")}>
          <span className={cn("grid size-12 shrink-0 place-items-center rounded-2xl text-white", bad ? "bg-rose-600" : "bg-emerald-600")}>
            {bad ? <ShieldAlert className="size-6" aria-hidden /> : <ShieldCheck className="size-6" aria-hidden />}
          </span>
          <div className="min-w-0">
            <p className={cn("text-2xs font-semibold uppercase tracking-wider", bad ? "text-rose-700" : "text-emerald-700")}>Verdict</p>
            <p className="font-display text-xl font-bold text-slate-900">{verdict || "Pending"}</p>
          </div>
        </div>
        {d.url ? (
          <p className="flex items-start gap-2 break-all rounded-xl bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100">
            <Globe className="mt-0.5 size-3.5 shrink-0 text-slate-400" aria-hidden />
            {str(d.url)}
          </p>
        ) : null}
        <DataView data={rest} />
      </Body>
    </PanelShell>
  );
}

/* ------------------------------------------------------------------ log viewer */

function LogPanel({ app }: { app: WorkspaceApp }) {
  const { view } = useWorkspace();
  const entries = (Array.isArray(app.panel!.data.entries) ? app.panel!.data.entries : []) as Record<string, unknown>[];
  return (
    <PanelShell icon={app.icon} color={app.color} title={app.title} subtitle={`${entries.length} entries`} toolbar={<ActionBar actions={app.actions} />}>
      <Body>
        <ol className="relative space-y-0 border-l-2 border-amber-200 pl-5">
          {entries.map((e, i) => (
            <li key={i} className="relative pb-4 last:pb-0">
              <span className="absolute -left-[27px] top-1 size-3 rounded-full bg-amber-400 ring-4 ring-white" aria-hidden />
              <p className="flex items-center gap-1.5 font-mono text-xs font-semibold text-amber-800">
                <Clock className="size-3" aria-hidden />
                {str(e.time)}
              </p>
              <p className="mt-0.5 text-sm text-slate-800">
                <Emphasis text={str(e.text ?? e.message ?? "")} />
              </p>
            </li>
          ))}
        </ol>
        <ResultsFeed entries={toolEntries(view, app)} title="Findings" />
      </Body>
    </PanelShell>
  );
}

/* ------------------------------------------------------------------ checklist / matrix */

function ChecklistPanel({ app }: { app: WorkspaceApp }) {
  const items = (Array.isArray(app.panel!.data.items) ? app.panel!.data.items : []) as Record<string, unknown>[];
  const cols = [...new Set(items.flatMap((r) => Object.keys(r)))];
  const rest = Object.fromEntries(Object.entries(app.panel!.data).filter(([k]) => k !== "items"));
  return (
    <PanelShell icon={app.icon} color={app.color} title={app.title} subtitle="Reference" toolbar={<ActionBar actions={app.actions} />}>
      <Body>
        {items.length > 0 && <DataTable cols={cols} rows={items} />}
        {Object.keys(rest).length > 0 && <DataView data={rest} />}
      </Body>
    </PanelShell>
  );
}

/* ------------------------------------------------------------------ document / form */

function DocumentPanel({ app }: { app: WorkspaceApp }) {
  const { view } = useWorkspace();
  const docs = app.actions.filter(isDoc);
  const d = app.panel!.data;
  return (
    <PanelShell icon={FileText} color={app.color} title={app.title} subtitle={d.form ? `Form ${str(d.form)}` : undefined} toolbar={<ActionBar actions={app.actions} exclude={isDoc} />}>
      <Body>
        {Object.keys(d).filter((k) => k !== "form").length > 0 && <DataView data={Object.fromEntries(Object.entries(d).filter(([k]) => k !== "form"))} />}
        {docs.map((a) => (
          <div key={a.id} className="rounded-2xl border border-slate-200 bg-gradient-to-b from-indigo-50/50 to-white p-4">
            <p className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-900">
              <FileText className="size-4 text-indigo-600" aria-hidden />
              {a.label}
            </p>
            {a.description && <p className="mb-2 text-xs text-muted-foreground">{a.description}</p>}
            <TextActionForm action={a} rows={6} />
          </div>
        ))}
        {docs.length === 0 && app.actions.length === 0 && <p className="text-sm text-muted-foreground">Nothing to complete here right now.</p>}
        <ResultsFeed entries={toolEntries(view, app)} title="Submitted" empty="Nothing submitted yet." />
      </Body>
    </PanelShell>
  );
}

/* ------------------------------------------------------------------ record (CRM / patient chart) */

function RecordPanel({ app }: { app: WorkspaceApp }) {
  const { view } = useWorkspace();
  const d = app.panel!.data;
  const nameKey = ["guest", "patient", "name", "customer", "client", "user"].find((k) => typeof d[k] === "string");
  const name = nameKey ? str(d[nameKey]) : app.title;
  const status = str(d.status);
  const rest = Object.fromEntries(Object.entries(d).filter(([k]) => k !== nameKey && k !== "status"));
  const c = colorClasses(app.color);
  return (
    <PanelShell icon={app.icon} color={app.color} title={app.title} subtitle={nameKey ? humanize(nameKey) + " record" : "Record"} toolbar={<ActionBar actions={app.actions} />}>
      <Body>
        <div className={cn("flex items-center gap-4 rounded-2xl bg-gradient-to-r p-4 ring-1 ring-inset", c.tint, c.ring)}>
          <span className={cn("grid size-12 place-items-center rounded-2xl bg-gradient-to-br text-white", c.gradient)}>
            <UserRound className="size-6" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-lg font-semibold text-slate-900">{name}</p>
            {nameKey && <p className="text-xs text-muted-foreground">{humanize(nameKey)}</p>}
          </div>
          {status && (
            <Badge tone={/clos|resolv|done/i.test(status) ? "success" : /open|new/i.test(status) ? "warning" : "info"} dot>
              {status}
            </Badge>
          )}
        </div>
        <DataView data={rest} />
        <ResultsFeed entries={toolEntries(view, app)} />
      </Body>
    </PanelShell>
  );
}

/* ------------------------------------------------------------------ console / dashboard */

function ConsolePanel({ app }: { app: WorkspaceApp }) {
  const { view } = useWorkspace();
  const d = app.panel!.data;
  const prims = Object.entries(d).filter(([, v]) => typeof v !== "object" || v === null);
  const nested = Object.fromEntries(Object.entries(d).filter(([, v]) => typeof v === "object" && v !== null));
  const docs = app.actions.filter(isDoc);
  const buttons = app.actions.filter((a) => !isDoc(a));
  const palette = ["indigo", "sky", "emerald", "amber", "fuchsia", "teal"] as const;
  return (
    <PanelShell icon={app.icon} color={app.color} title={app.title} subtitle={prims.length ? prims.map(([k, v]) => `${humanize(k)}: ${str(v)}`).join(" · ") : undefined}>
      <Body>
        {prims.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {prims.map(([k, v], i) => {
              const cc = colorClasses(palette[i % palette.length]!);
              return (
                <div key={k} className={cn("rounded-2xl bg-gradient-to-br p-3 ring-1 ring-inset", cc.tint, cc.ring)}>
                  <p className="text-2xs font-semibold uppercase tracking-wider text-slate-500">{humanize(k)}</p>
                  <p className="mt-1 truncate font-display text-base font-semibold text-slate-900">{str(v)}</p>
                </div>
              );
            })}
          </div>
        )}
        {Object.keys(nested).length > 0 && <DataView data={nested} />}
        {buttons.length > 0 && (
          <div>
            <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-slate-500">Response actions</h3>
            <div className="grid gap-1 rounded-2xl border border-slate-200 p-1.5 sm:grid-cols-2">
              {buttons.map((a) => (
                <ActionControl key={a.id} action={a} variant="row" />
              ))}
            </div>
          </div>
        )}
        {docs.map((a) => (
          <div key={a.id} className="rounded-2xl border border-slate-200 p-4">
            <p className="mb-2 text-sm font-semibold text-slate-900">{a.label}</p>
            <TextActionForm action={a} rows={4} />
          </div>
        ))}
        <ResultsFeed entries={toolEntries(view, app)} />
      </Body>
    </PanelShell>
  );
}

/* ------------------------------------------------------------------ system info (Windows-style properties) */

function SystemInfoPanel({ app }: { app: WorkspaceApp }) {
  const { view } = useWorkspace();
  const d = app.panel!.data;
  const prims = Object.entries(d).filter(([, v]) => typeof v !== "object" || v === null);
  const nested = Object.fromEntries(Object.entries(d).filter(([, v]) => typeof v === "object" && v !== null));
  const device = prims.filter(([k]) => /host|os|domain|model|serial|user/i.test(k));
  const network = prims.filter(([k]) => !/host|os|domain|model|serial|user/i.test(k));
  return (
    <PanelShell icon={app.icon} color={app.color} title={app.title} subtitle={typeof d.hostname === "string" ? d.hostname : undefined} toolbar={<ActionBar actions={app.actions} />}>
      <Body>
        <div className="grid gap-5 xl:grid-cols-2">
          {device.length > 0 && (
            <div>
              <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-slate-500">Device</h3>
              <Properties rows={device.map(([k, v]) => [humanize(k).replace(/^Os$/, "OS"), str(v)])} mono />
            </div>
          )}
          {network.length > 0 && (
            <div>
              <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-slate-500">Network connection details</h3>
              <Properties rows={network.map(([k, v]) => [humanize(k).replace(/Ipv4/, "IPv4").replace(/Dns/, "DNS"), str(v)])} mono />
            </div>
          )}
        </div>
        {Object.keys(nested).length > 0 && <DataView data={nested} mono />}
        <ResultsFeed entries={toolEntries(view, app)} />
      </Body>
    </PanelShell>
  );
}

/* ------------------------------------------------------------------ generic fallback */

function GenericPanel({ app }: { app: WorkspaceApp }) {
  const { view } = useWorkspace();
  const docs = app.actions.filter(isDoc);
  return (
    <PanelShell icon={app.icon} color={app.color} title={app.title} subtitle={humanize(app.panel?.type)} toolbar={<ActionBar actions={app.actions} exclude={isDoc} />}>
      <Body>
        {app.commandTools.length > 0 && <CommandBar app={app} />}
        {app.panel && Object.keys(app.panel.data).length > 0 ? <DataView data={app.panel.data} /> : <p className="text-sm text-muted-foreground">No details to show.</p>}
        {docs.map((a) => (
          <div key={a.id} className="rounded-2xl border border-slate-200 p-4">
            <p className="mb-2 text-sm font-semibold text-slate-900">{a.label}</p>
            <TextActionForm action={a} rows={4} />
          </div>
        ))}
        <ResultsFeed entries={toolEntries(view, app)} />
      </Body>
    </PanelShell>
  );
}

export { simClock };
