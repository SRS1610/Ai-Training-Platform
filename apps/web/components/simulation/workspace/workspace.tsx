"use client";

import {
  Button,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  Kbd,
  Sheet,
  SheetContent,
  SheetTitle,
  cn,
  colorClasses,
  toast,
  Tooltip,
} from "@praxis/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  Command as CommandIcon,
  Flag,
  Frown,
  Keyboard,
  LayoutGrid,
  ListChecks,
  Maximize2,
  MessagesSquare,
  Minimize2,
  MoreHorizontal,
  Sparkles,
  Target,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { TutorPanel } from "@/components/tutor/tutor-panel";
import { api, ApiError, errorMessage } from "@/lib/api";
import { fetchSimulation, simKeys } from "../queries";
import { industryMeta } from "../theme";
import type { SimSession, StepOut, ViewAction } from "../types";
import { ActionLauncher, INPUT_LABEL, kindMeta } from "./actions";
import { ChatPanel } from "./chat-panel";
import { PatienceMeter, PhaseStepper, SimClock, StatusChips } from "./chrome";
import { type Ephemeral, WorkspaceProvider } from "./context";
import { MissionColumn, type StepFeedback } from "./mission";
import { buildApps, buildChat, chatThread, isEditableTarget, orphanActions, type WorkspaceApp } from "./model";
import { PanelRenderer } from "./panels";
import type { ActionRequest, Pending } from "./use-sim-session";

const FOCUS_KEY = "praxis.sim.focus";
const CHAT_W_KEY = "praxis.sim.chatWidth";

interface LiveAlert {
  id: string;
  title: string;
  text: string;
  tone: "warning" | "danger" | "info";
}

export interface WorkspaceProps {
  session: SimSession;
  pending: Pending | null;
  act: (req: ActionRequest, p?: Pending) => Promise<StepOut>;
  chat: (characterId: string, message: string) => Promise<StepOut>;
  registerStepHandler: (fn: (step: StepOut, pending: Pending) => void) => void;
  fresh: boolean;
}

export function Workspace({ session, pending, act, chat, registerStepHandler, fresh }: WorkspaceProps) {
  const qc = useQueryClient();
  const view = session.view;
  const ended = session.status !== "active";
  const apps = React.useMemo(() => buildApps(view), [view]);
  const chatModel = React.useMemo(() => buildChat(view), [view]);
  const sim = useQuery({ queryKey: simKeys.detail(session.simulation_id), queryFn: ({ signal }) => fetchSimulation(session.simulation_id, signal), staleTime: 300_000 });
  const ind = industryMeta(view.meta.industry);

  const [activeKey, setActiveKey] = React.useState<string>(() => apps[0]?.key ?? "");
  const [activeChar, setActiveChar] = React.useState<string>(() => chatModel?.characters[0]?.id ?? "");
  const [mobileTab, setMobileTab] = React.useState<"work" | "chat" | "mission">("work");
  const [focus, setFocus] = React.useState(false);
  const [chatW, setChatW] = React.useState(380);
  const [ephemeral, setEphemeral] = React.useState<Ephemeral[]>([]);
  const [feedback, setFeedback] = React.useState<Record<number, StepFeedback>>({});
  const [alerts, setAlerts] = React.useState<LiveAlert[]>([]);
  const [lastSeq, setLastSeq] = React.useState(0);
  // Messages up to this seq count as read (mobile "Chat" tab badge); everything on entry is read.
  const [chatSeenSeq, setChatSeenSeq] = React.useState(view.action_count);
  React.useEffect(() => {
    if (mobileTab === "chat") setChatSeenSeq(view.action_count);
  }, [mobileTab, view.action_count]);
  const [palette, setPalette] = React.useState(false);
  const [launch, setLaunch] = React.useState<ViewAction | null>(null);
  const [shortcuts, setShortcuts] = React.useState(false);
  const [missionSheet, setMissionSheet] = React.useState(false);
  const [tutor, setTutor] = React.useState(false);
  const [confirm, setConfirm] = React.useState<"finish" | "abandon" | null>(null);
  const [briefing, setBriefing] = React.useState(fresh && view.action_count === 0);
  const [height, setHeight] = React.useState<number | null>(null);
  const [rootW, setRootW] = React.useState(1200);
  const wide = rootW >= 1240; // room for the mission column
  const wideish = rootW >= 1080;
  const rootRef = React.useRef<HTMLDivElement>(null);
  const chatInput = React.useRef<HTMLTextAreaElement>(null);
  const termInput = React.useRef<HTMLInputElement>(null);
  const prevOpen = React.useRef(new Set(apps.filter((a) => a.panel).map((a) => a.key)));
  // The view as rendered before a step is applied (step handlers run before the re-render).
  const viewRef = React.useRef(view);
  viewRef.current = view;

  // Persisted preferences.
  React.useEffect(() => {
    try {
      setFocus(localStorage.getItem(FOCUS_KEY) === "1");
      const w = Number(localStorage.getItem(CHAT_W_KEY));
      if (w >= 300 && w <= 600) setChatW(w);
    } catch {
      /* ignore */
    }
  }, []);
  const toggleFocus = React.useCallback(() => {
    setFocus((f) => {
      try {
        localStorage.setItem(FOCUS_KEY, f ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !f;
    });
  }, []);

  React.useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => e && setRootW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fill the viewport below the app top bar when not in focus mode.
  React.useLayoutEffect(() => {
    if (focus) return setHeight(null);
    const measure = () => {
      const el = rootRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      setHeight(Math.max(480, window.innerHeight - top));
    };
    measure();
    window.addEventListener("resize", measure);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => measure()) : null;
    ro?.observe(document.body);
    return () => {
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [focus]);

  // Keep the active app valid; auto-open panels that just became visible.
  React.useEffect(() => {
    const open = new Set(apps.filter((a) => a.panel).map((a) => a.key));
    const appeared = [...open].filter((k) => !prevOpen.current.has(k));
    prevOpen.current = open;
    if (appeared.length === 1) setActiveKey(appeared[0]!);
    else if (!apps.some((a) => a.key === activeKey) && apps[0]) setActiveKey(apps[0].key);
  }, [apps, activeKey]);

  const openApp = React.useCallback((key: string) => {
    setActiveKey(key);
    setMobileTab("work");
  }, []);
  const openChat = React.useCallback((id?: string) => {
    if (id) setActiveChar(id);
    setMobileTab("chat");
    requestAnimationFrame(() => chatInput.current?.focus());
  }, []);

  /* ---------------------------------------------------------------- step outcomes → UI */
  const onStep = React.useCallback(
    (step: StepOut, p: Pending) => {
      const o = step.outcome;
      setLastSeq(step.view.action_count);
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      if (!step.accepted) {
        const msg = o.message || "That isn't possible right now.";
        if (o.reason === "session_expired") toast.error(msg);
        else if (p.kind === "chat")
          setEphemeral((e) => [...e, { id, afterSeq: step.view.action_count, scope: `chat:${p.character}`, learnerText: p.text, text: step.reply?.text ?? msg }]);
        else if (p.kind === "command") setEphemeral((e) => [...e, { id, afterSeq: step.view.action_count, scope: `tool:${p.tool}`, learnerText: p.text, text: msg }]);
        else toast.warning(msg);
        return;
      }
      if (session.show_feedback && o.classification) {
        setFeedback((f) => ({ ...f, [o.seq]: { classification: o.classification, feedback: o.feedback, score_deltas: o.score_deltas } }));
        if (o.classification !== "neutral") {
          const fn = o.classification === "correct" ? toast.success : o.classification === "critical" ? toast.error : toast.warning;
          fn(o.classification === "correct" ? "Good call" : o.classification === "critical" ? "Critical mistake" : "Not ideal", {
            description: o.feedback || o.label || undefined,
          });
        }
      }
      if (o.phase_changed) {
        const ph = step.view.phases.find((x) => x.id === o.phase_after);
        toast.success(`Phase: ${ph?.name ?? o.phase_after}`, { description: step.view.phase.description || undefined, icon: <Target className="size-4" /> });
      }
      for (const ev of o.events ?? []) {
        const alert: LiveAlert = { id: `${id}-${ev.id}`, title: ev.title || "Something happened", text: ev.notify, tone: /escalat|complain|fail/i.test(`${ev.title} ${ev.notify}`) ? "danger" : "warning" };
        setAlerts((a) => [...a.slice(-2), alert]);
        setTimeout(() => setAlerts((a) => a.filter((x) => x.id !== alert.id)), 9000);
      }
      for (const pr of o.problems_added ?? []) toast.error("New problem", { description: pr.text, icon: <AlertTriangle className="size-4" /> });
      // Customer mood: call out sharp drops in patience.
      for (const c of step.view.characters) {
        const before = viewRef.current.characters.find((x) => x.id === c.id)?.patience;
        if (typeof before === "number" && typeof c.patience === "number" && before - c.patience >= 10)
          toast.warning(`${c.name} is losing patience`, {
            description: `Patience ${Math.round(before)}% → ${Math.round(c.patience)}%. Keep them informed and avoid disruptive steps.`,
            icon: <Frown className="size-4" />,
          });
      }
      if (o.problems_removed?.length) toast.success("Problem resolved");
      // Unsolicited messages from people you're not currently talking to.
      const replyTo = p.kind === "chat" ? p.character : null;
      for (const m of o.messages ?? []) {
        const chatVisible = mobileTab === "chat" || window.matchMedia?.("(min-width: 1024px)").matches;
        if (m.from !== "system" && m.from !== replyTo && !(chatVisible && m.from === activeChar)) {
          toast(`${m.name ?? m.from}`, {
            description: m.text,
            icon: <MessagesSquare className="size-4 text-violet-600" />,
            action: { label: "Reply", onClick: () => openChat(m.from) },
          });
        }
      }
      // Actions launched from the palette: show the app that owns the tool.
      if (p.kind === "action") {
        const owner = buildApps(step.view).find((a) => a.tools.some((t) => t.id === o.tool));
        if (owner && owner.key !== activeKey) setActiveKey(owner.key);
      }
      if (step.ended) qc.invalidateQueries({ queryKey: ["simulation-sessions"] });
    },
    [session.show_feedback, activeChar, mobileTab, openChat, activeKey, qc],
  );
  React.useEffect(() => registerStepHandler(onStep), [registerStepHandler, onStep]);

  /* ---------------------------------------------------------------- shortcuts */
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setPalette((v) => !v);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isEditableTarget(e.target) || document.querySelector("[role=dialog]")) return;
      const k = e.key;
      if (/^[1-9]$/.test(k) && apps[Number(k) - 1]) {
        e.preventDefault();
        openApp(apps[Number(k) - 1]!.key);
      } else if (k === "a") {
        e.preventDefault();
        setPalette(true);
      } else if (k === "c" && chatModel) {
        e.preventDefault();
        openChat();
      } else if (k === "t") {
        const term = apps.find((a) => a.panel?.type === "terminal");
        if (term) {
          e.preventDefault();
          openApp(term.key);
          requestAnimationFrame(() => termInput.current?.focus());
        }
      } else if (k === "f") {
        e.preventDefault();
        toggleFocus();
      } else if (k === "?") {
        e.preventDefault();
        setShortcuts(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [apps, chatModel, openApp, openChat, toggleFocus]);

  /* ---------------------------------------------------------------- finish / abandon */
  const finish = async () => {
    try {
      await api.post(`/simulation-sessions/${session.id}/finish`);
      await qc.invalidateQueries({ queryKey: simKeys.session(session.id) });
      qc.invalidateQueries({ queryKey: ["simulation-sessions"] });
      setConfirm(null);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const abandon = async () => {
    try {
      const s = await api.post<SimSession>(`/simulation-sessions/${session.id}/abandon`);
      qc.setQueryData(simKeys.session(session.id), s);
      qc.invalidateQueries({ queryKey: ["simulation-sessions"] });
      setConfirm(null);
      toast.success("Attempt abandoned");
    } catch (err) {
      if (err instanceof ApiError && err.code === "session_not_active") qc.invalidateQueries({ queryKey: simKeys.session(session.id) });
      toast.error(errorMessage(err));
    }
  };

  /* ---------------------------------------------------------------- splitter */
  const dragging = React.useRef(false);
  const onSplitDown = (e: React.PointerEvent) => {
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onSplitMove = (e: React.PointerEvent) => {
    if (!dragging.current || !rootRef.current) return;
    const right = rootRef.current.getBoundingClientRect().right;
    setChatW(Math.min(600, Math.max(300, right - e.clientX)));
  };
  const onSplitUp = () => {
    dragging.current = false;
    try {
      localStorage.setItem(CHAT_W_KEY, String(chatW));
    } catch {
      /* ignore */
    }
  };

  const active = apps.find((a) => a.key === activeKey) ?? apps[0];
  const patienceChars = view.characters.filter((c) => c.patience !== null && c.patience !== undefined);
  const unreadChat = chatModel
    ? chatModel.characters.reduce((n, c) => n + chatThread(view, c.id).filter((e) => e.from === c.id && e.seq > chatSeenSeq).length, 0)
    : 0;
  const orphans = orphanActions(view, apps);

  const ctx = React.useMemo(
    () => ({ session, view, pending, ended, act, chat, ephemeral, lastSeq, openApp, openChat }),
    [session, view, pending, ended, act, chat, ephemeral, lastSeq, openApp, openChat],
  );

  return (
    <WorkspaceProvider value={ctx}>
      <div
        ref={rootRef}
        style={!focus && height ? { height } : undefined}
        className={cn(
          "relative flex flex-col overflow-hidden bg-slate-100",
          focus
            ? "fixed inset-0 z-[45]"
            : "max-lg:fixed max-lg:inset-0 max-lg:z-[45] lg:-mx-8 lg:-mb-12 lg:-mt-8 lg:border-l lg:border-slate-200/70",
        )}
      >
        {/* ------------------------------------------------ top bar */}
        <header className="relative z-10 border-b border-slate-200/80 bg-white/95 backdrop-blur">
          <div className={cn("pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r", ind.classes.gradient)} aria-hidden />
          <div className="flex items-center gap-2 px-2 py-2 sm:gap-3 sm:px-4">
            <Tooltip content="Leave — your progress is saved">
              <Button variant="ghost" size="icon-sm" asChild aria-label="Leave simulation">
                <Link href={`/app/simulations/${session.simulation_id}`}>
                  <ArrowLeft className="size-4" />
                </Link>
              </Button>
            </Tooltip>
            <span className={cn("hidden size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow-sm sm:grid", ind.classes.gradient)}>
              <ind.icon className="size-[18px]" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-display text-sm font-semibold text-slate-900 sm:text-[15px]">{view.meta.title}</h1>
              <p className="truncate text-2xs text-slate-500 sm:text-xs">
                {view.meta.learner_role} · Attempt {session.attempt_number} · {session.is_graded ? "Graded" : "Practice"}
              </p>
            </div>
            <StatusChips view={view} className={cn("hidden", wide ? "lg:flex" : "2xl:flex")} />
            {patienceChars.map((c) => (
              <PatienceMeter key={c.id} character={c} compact={patienceChars.length > 1 || !wideish} />
            ))}
            <SimClock minutes={view.sim_minutes} target={view.target_minutes} />
            {!wide && (
              <Tooltip content="Mission, facts & log">
                <Button variant="ghost" size="icon-sm" onClick={() => setMissionSheet(true)} aria-label="Open mission, facts and log" className="relative hidden lg:inline-flex">
                  <ListChecks className="size-4" />
                  {view.problems.length > 0 && <span className="absolute right-1 top-1 size-2 rounded-full bg-rose-500 ring-2 ring-white" aria-hidden />}
                </Button>
              </Tooltip>
            )}
            <Tooltip content="All available actions (Ctrl/⌘ J)">
              <Button variant="secondary" size="sm" onClick={() => setPalette(true)} leftIcon={<Zap className="text-amber-500" />} className="hidden md:inline-flex" disabled={ended}>
                Actions
              </Button>
            </Tooltip>
            <Tooltip content="Finish and get your debrief">
              <Button size="sm" onClick={() => setConfirm("finish")} leftIcon={<Flag />} className="hidden sm:inline-flex" disabled={ended}>
                Finish
              </Button>
            </Tooltip>
            <Tooltip content={focus ? "Exit focus mode (F)" : "Focus mode (F)"}>
              <Button variant="ghost" size="icon-sm" onClick={toggleFocus} aria-label={focus ? "Exit focus mode" : "Enter focus mode"} aria-pressed={focus} className="hidden lg:inline-flex">
                {focus ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
              </Button>
            </Tooltip>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Simulation menu">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel>Simulation</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => setPalette(true)} disabled={ended}>
                  <Zap /> All actions <DropdownMenuShortcut>⌘J</DropdownMenuShortcut>
                </DropdownMenuItem>
                {!wide && (
                  <DropdownMenuItem onSelect={() => setMissionSheet(true)}>
                    <ListChecks /> Mission, facts & log
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => setBriefing(true)}>
                  <Target /> Re-read briefing
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setTutor(true)}>
                  <Sparkles /> Ask the AI tutor
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setShortcuts(true)}>
                  <Keyboard /> Keyboard shortcuts <DropdownMenuShortcut>?</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={toggleFocus} className="lg:hidden">
                  {focus ? <Minimize2 /> : <Maximize2 />} {focus ? "Exit focus mode" : "Focus mode"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setConfirm("finish")} disabled={ended}>
                  <Flag /> Finish & get scored
                </DropdownMenuItem>
                <DropdownMenuItem destructive onSelect={() => setConfirm("abandon")} disabled={ended}>
                  <Trash2 /> Abandon attempt
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="flex items-center gap-3 border-t border-slate-100 bg-gradient-to-r from-slate-50/80 via-white to-slate-50/80 px-2 py-1.5 sm:px-4">
            <PhaseStepper phases={view.phases} className="min-w-0 flex-1" />
            {view.phase.description && <p className={cn("hidden max-w-sm truncate text-xs text-slate-500", wideish && "lg:block")}>{view.phase.description}</p>}
          </div>
        </header>

        {/* ------------------------------------------------ live alerts (events) */}
        <div className="pointer-events-none absolute inset-x-0 top-[6.75rem] z-20 flex flex-col items-center gap-2 px-4" aria-live="assertive">
          {alerts.map((a) => (
            <div
              key={a.id}
              role="alert"
              className={cn(
                "pointer-events-auto flex w-full max-w-xl items-start gap-3 rounded-2xl border px-4 py-3 shadow-lift backdrop-blur motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-4",
                a.tone === "danger" ? "border-rose-200 bg-rose-50/95 text-rose-950" : "border-amber-200 bg-amber-50/95 text-amber-950",
              )}
            >
              <span className={cn("grid size-8 shrink-0 place-items-center rounded-xl text-white", a.tone === "danger" ? "bg-rose-600" : "bg-amber-500")}>
                <Bell className="size-4 motion-safe:animate-flicker" aria-hidden />
              </span>
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-semibold">{a.title}</p>
                {a.text && <p className="mt-0.5 opacity-90">{a.text}</p>}
              </div>
              <button type="button" onClick={() => setAlerts((x) => x.filter((y) => y.id !== a.id))} className="grid size-7 place-items-center rounded-lg hover:bg-black/5 focus-visible:focus-ring" aria-label="Dismiss alert">
                <X className="size-4" aria-hidden />
              </button>
            </div>
          ))}
        </div>

        {/* ------------------------------------------------ columns */}
        <div className="flex min-h-0 flex-1 gap-0 lg:gap-2 lg:p-2">
          <aside
            className={cn(
              "min-h-0 w-full flex-col overflow-hidden lg:w-[300px] lg:shrink-0 lg:rounded-2xl lg:border lg:border-slate-200/80 lg:shadow-soft",
              mobileTab === "mission" ? "flex" : "hidden",
              wide ? "lg:flex" : "lg:hidden",
            )}
          >
            <MissionColumn feedback={feedback} />
          </aside>

          <main className={cn("min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white lg:flex lg:rounded-2xl lg:border lg:border-slate-200/80 lg:shadow-soft", mobileTab === "work" ? "flex" : "hidden")}>
            <AppDock apps={apps} active={active?.key} onChange={openApp} />
            <div className="min-h-0 flex-1" role="tabpanel" aria-label={active?.title}>
              {active ? <PanelRenderer app={active} terminalRef={termInput} /> : <div className="grid h-full place-items-center text-sm text-muted-foreground">No tools available.</div>}
            </div>
            {orphans.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/70 px-4 py-2">
                <span className="text-2xs font-semibold uppercase tracking-wider text-slate-500">Other actions</span>
                {orphans.map((a) => (
                  <Button key={a.id} size="xs" variant="secondary" onClick={() => setLaunch(a)} disabled={ended || !!pending}>
                    {a.label}
                  </Button>
                ))}
              </div>
            )}
          </main>

          {chatModel && (
            <>
              {/* Focusable window splitter (WAI-ARIA separator pattern): arrow keys resize. */}
              {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize conversation panel"
                aria-valuenow={chatW}
                aria-valuemin={300}
                aria-valuemax={600}
                // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
                tabIndex={0}
                onPointerDown={onSplitDown}
                onPointerMove={onSplitMove}
                onPointerUp={onSplitUp}
                onKeyDown={(e) => {
                  if (e.key === "ArrowLeft") setChatW((w) => Math.min(600, w + 24));
                  if (e.key === "ArrowRight") setChatW((w) => Math.max(300, w - 24));
                }}
                className="group -mx-1.5 hidden w-2 shrink-0 cursor-col-resize items-center justify-center rounded focus-visible:focus-ring lg:flex"
              >
                <span className="h-10 w-1 rounded-full bg-slate-300 transition-colors group-hover:bg-brand-400" aria-hidden />
              </div>
              <aside
                className={cn("min-h-0 w-full flex-col overflow-hidden lg:flex lg:w-[var(--chat-w)] lg:shrink-0 lg:rounded-2xl lg:border lg:border-slate-200/80 lg:shadow-soft", mobileTab === "chat" ? "flex" : "hidden")}
                style={{ ["--chat-w" as string]: `${chatW}px` }}
              >
                <ChatPanel chat={chatModel} active={activeChar} onActiveChange={setActiveChar} inputRef={chatInput} />
              </aside>
            </>
          )}
        </div>

        {/* ------------------------------------------------ mobile tabs */}
        <nav className="grid grid-cols-3 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Workspace sections">
          {(
            [
              { id: "work", label: "Tools", icon: LayoutGrid },
              { id: "chat", label: "Chat", icon: MessagesSquare, badge: unreadChat },
              { id: "mission", label: "Mission", icon: ListChecks, badge: view.problems.length },
            ] as const
          ).map((t) => {
            const Icon = t.icon;
            const on = mobileTab === t.id;
            if (t.id === "chat" && !chatModel) return <span key={t.id} />;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setMobileTab(t.id)}
                aria-pressed={on}
                className={cn("relative flex flex-col items-center gap-0.5 py-2 text-2xs font-semibold focus-visible:focus-ring", on ? "text-brand-700" : "text-slate-500")}
              >
                <Icon className="size-5" aria-hidden />
                {t.label}
                {"badge" in t && !!t.badge && (
                  <span className="absolute right-[calc(50%-1.4rem)] top-1 grid min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">{t.badge}</span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* ------------------------------------------------ overlays */}
      <ActionPalette
        open={palette}
        onOpenChange={setPalette}
        apps={apps}
        orphans={orphans}
        onPick={(a) => {
          setPalette(false);
          setLaunch(a);
        }}
      />
      {launch && <ActionLauncher key={launch.id} action={launch} onDone={() => setLaunch(null)} />}

      <Sheet open={missionSheet} onOpenChange={setMissionSheet}>
        <SheetContent side="left" className="w-full max-w-sm gap-0 p-0">
          <SheetTitle className="sr-only">Mission</SheetTitle>
          <MissionColumn feedback={feedback} />
        </SheetContent>
      </Sheet>

      <ShortcutsDialog open={shortcuts} onOpenChange={setShortcuts} apps={apps} />
      <BriefingDialog open={briefing} onOpenChange={setBriefing} session={session} onStart={() => setBriefing(false)} />
      <TutorPanel open={tutor} onOpenChange={setTutor} courseId={sim.data?.course_id ?? undefined} />

      <ConfirmDialog
        open={confirm === "finish"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Finish and get scored?"
        description="Your attempt will be scored as it stands. Unfinished work scores lower — make sure you've done everything you intended."
        confirmLabel="Finish & score"
        onConfirm={finish}
      />
      <ConfirmDialog
        open={confirm === "abandon"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Abandon this attempt?"
        description="It still counts as an attempt and won't pass. You can start a new attempt afterwards if you have attempts left."
        confirmLabel="Abandon attempt"
        destructive
        onConfirm={abandon}
      />
    </WorkspaceProvider>
  );
}

/* ------------------------------------------------------------------ app dock (tabs) */

function AppDock({ apps, active, onChange }: { apps: WorkspaceApp[]; active?: string; onChange: (k: string) => void }) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const n = apps.length;
    let j = -1;
    if (e.key === "ArrowRight") j = (i + 1) % n;
    if (e.key === "ArrowLeft") j = (i - 1 + n) % n;
    if (e.key === "Home") j = 0;
    if (e.key === "End") j = n - 1;
    if (j >= 0) {
      e.preventDefault();
      refs.current[j]?.focus();
      onChange(apps[j]!.key);
    }
  };
  return (
    <div className="no-scrollbar flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200/80 bg-slate-50/80 px-2 pt-2" role="tablist" aria-label="Workspace tools">
      {apps.map((a, i) => {
        const on = a.key === active;
        const c = colorClasses(a.color);
        const Icon = a.icon;
        return (
          <button
            key={a.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onKeyDown={(e) => onKey(e, i)}
            onClick={() => onChange(a.key)}
            className={cn(
              "group relative flex shrink-0 items-center gap-2 rounded-t-xl border border-b-0 px-3 py-2 text-sm font-medium transition-colors focus-visible:focus-ring",
              on ? "border-slate-200/80 bg-white text-slate-900 shadow-[0_-1px_0_0_white_inset]" : "border-transparent text-slate-600 hover:bg-white/70 hover:text-slate-900",
            )}
          >
            <span className={cn("grid size-6 place-items-center rounded-md transition-colors", on ? cn("bg-gradient-to-br text-white", c.gradient) : cn(c.soft, c.icon))}>
              <Icon className="size-3.5" aria-hidden />
            </span>
            <span className="max-w-[11rem] truncate" title={a.title !== a.label ? a.title : undefined}>
              {a.label}
            </span>
            {!a.panel && <span className="rounded bg-slate-200/70 px-1 text-[10px] font-semibold uppercase text-slate-500">closed</span>}
            {i < 9 && <span className="hidden rounded border border-slate-200 bg-white px-1 font-mono text-[10px] leading-4 text-slate-500 xl:inline">{i + 1}</span>}
            {on && <span className={cn("absolute inset-x-3 -bottom-px h-0.5 rounded-full", c.solid)} aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ actions palette */

function ActionPalette({
  open,
  onOpenChange,
  apps,
  orphans,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  apps: WorkspaceApp[];
  orphans: ViewAction[];
  onPick: (a: ViewAction) => void;
}) {
  const groups = [...apps.filter((a) => a.actions.length).map((a) => ({ key: a.key, title: a.title, color: a.color, actions: a.actions })), ...(orphans.length ? [{ key: "_other", title: "Other", color: "indigo" as const, actions: orphans }] : [])];
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      label="Actions"
      footer={
        <span className="flex flex-wrap items-center gap-3">
          <span>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> to move · <Kbd>Enter</Kbd> to run
          </span>
          <span>Typed commands and conversations happen in the terminal and chat.</span>
        </span>
      }
    >
      <CommandInput placeholder="Search available actions…" />
      <CommandList>
        <CommandEmpty>No matching actions available right now.</CommandEmpty>
        {groups.map((g) => (
          <CommandGroup key={g.key} heading={g.title}>
            {g.actions.map((a) => {
              const k = kindMeta(a.kind);
              const Icon = k.icon;
              const inp = INPUT_LABEL[a.input.type];
              return (
                <CommandItem key={a.id} value={`${g.title} ${a.label} ${a.description}`} onSelect={() => onPick(a)}>
                  <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg ring-1 ring-inset", k.tone)}>
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-900">{a.label}</span>
                    {a.description && <span className="block truncate text-xs text-slate-500">{a.description}</span>}
                  </span>
                  {inp && (
                    <span className="hidden shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-2xs font-medium text-slate-600 sm:inline-flex">
                      <inp.icon className="size-3" aria-hidden />
                      {inp.label}
                    </span>
                  )}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}

/* ------------------------------------------------------------------ shortcuts + briefing dialogs */

function ShortcutsDialog({ open, onOpenChange, apps }: { open: boolean; onOpenChange: (o: boolean) => void; apps: WorkspaceApp[] }) {
  const rows: [React.ReactNode, string][] = [
    [
      <>
        <Kbd>Ctrl</Kbd>/<Kbd>⌘</Kbd> <Kbd>J</Kbd>
      </>,
      "Open the actions palette",
    ],
    [<Kbd key="a">A</Kbd>, "Actions palette (when not typing)"],
    [
      <>
        <Kbd>1</Kbd>–<Kbd>{Math.min(9, apps.length)}</Kbd>
      </>,
      "Switch between tools",
    ],
    [<Kbd key="c">C</Kbd>, "Jump to the chat composer"],
    [<Kbd key="t">T</Kbd>, "Jump to the terminal"],
    [<Kbd key="f">F</Kbd>, "Toggle focus mode"],
    [
      <>
        <Kbd>↑</Kbd> <Kbd>↓</Kbd>
      </>,
      "Terminal command history",
    ],
    [<Kbd key="cls">cls</Kbd>, "Clear the terminal screen"],
    [
      <>
        <Kbd>Enter</Kbd> / <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd>
      </>,
      "Send chat message / new line",
    ],
    [<Kbd key="q">?</Kbd>, "Show this help"],
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CommandIcon className="size-5 text-brand-600" aria-hidden /> Keyboard shortcuts
          </DialogTitle>
          <DialogDescription>Single-key shortcuts only work when you’re not typing in a field.</DialogDescription>
        </DialogHeader>
        <dl className="divide-y divide-slate-100 rounded-2xl border border-slate-200">
          {rows.map(([k, d], i) => (
            <div key={i} className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
              <dt className="text-slate-700">{d}</dt>
              <dd className="flex shrink-0 items-center gap-1 text-slate-500">{k}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}

function BriefingDialog({ open, onOpenChange, session, onStart }: { open: boolean; onOpenChange: (o: boolean) => void; session: SimSession; onStart: () => void }) {
  const m = session.view.meta;
  const ind = industryMeta(m.industry);
  const first = session.view.action_count === 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="overflow-hidden p-0">
        <div className={cn("relative bg-gradient-to-br p-6 pb-5", ind.classes.tint)}>
          <div className={cn("absolute inset-x-0 top-0 h-1 bg-gradient-to-r", ind.classes.gradient)} aria-hidden />
          <DialogHeader>
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">{first ? "Your mission" : "Briefing"}</p>
            <DialogTitle className="text-xl">{m.title}</DialogTitle>
            {m.learner_role && <DialogDescription>You are playing: <span className="font-semibold text-slate-800">{m.learner_role}</span></DialogDescription>}
          </DialogHeader>
        </div>
        <div className="space-y-5 px-6 pb-6">
          {m.briefing && <p className="text-[15px] leading-relaxed text-slate-700">{m.briefing}</p>}
          {!!m.objectives?.length && (
            <ol className="grid gap-2 sm:grid-cols-2">
              {m.objectives.map((o, i) => (
                <li key={i} className="flex items-start gap-2.5 rounded-xl bg-slate-50 p-2.5 text-sm text-slate-700 ring-1 ring-inset ring-slate-100">
                  <span className="grid size-5 shrink-0 place-items-center rounded-md bg-emerald-500 text-2xs font-bold text-white">{i + 1}</span>
                  {o}
                </li>
              ))}
            </ol>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
            <span>The clock is paused until your first action. Press <Kbd>?</Kbd> any time for shortcuts.</span>
          </div>
          <div className="flex justify-end">
            <Button variant="gradient" onClick={onStart}>
              {first ? "Enter the workspace" : "Back to work"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
