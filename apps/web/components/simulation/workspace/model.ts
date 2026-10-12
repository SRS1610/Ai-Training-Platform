/**
 * Pure helpers that turn the engine's learner view into workspace "apps" (tabs), chat threads and feeds.
 * Everything is generic over panel/tool types so any template renders.
 */
import type { CategoryColor } from "@praxis/ui";
import type { LucideIcon } from "lucide-react";
import { panelColor, toolIcon } from "../theme";
import type { SessionView, TranscriptEntry, ViewAction, ViewCharacter, ViewPanel, ViewTool } from "../types";

export interface WorkspaceApp {
  /** Stable across "closed" (tool only) and "open" (panel visible) states. */
  key: string;
  title: string;
  type: string;
  panel: ViewPanel | null;
  tools: ViewTool[];
  actions: ViewAction[];
  icon: LucideIcon;
  color: CategoryColor;
  /** Tool ids that accept typed commands (terminal-like input). */
  commandTools: ViewTool[];
}

export interface ChatModel {
  panel: ViewPanel | null;
  title: string;
  channel: string | null;
  characters: ViewCharacter[];
  toolIds: string[];
}

export function isChatTool(t: ViewTool, view: SessionView): boolean {
  const panel = t.panel ? view.panels.find((p) => p.id === t.panel) : undefined;
  if (panel?.type === "chat") return true;
  if (panel) return false;
  return t.id === "chat" || t.icon === "message" || t.icon === "chat";
}

export function buildChat(view: SessionView): ChatModel | null {
  if (!view.characters.length) return null;
  const panel = view.panels.find((p) => p.type === "chat") ?? null;
  const participants = Array.isArray(panel?.data?.participants) ? (panel!.data.participants as string[]) : null;
  const talkedTo = new Set(
    view.transcript.filter((e) => e.kind === "message").map((e) => (e.from === "learner" ? (e.to ?? "") : e.from)),
  );
  const characters = view.characters.filter((c) => !participants || participants.includes(c.id) || talkedTo.has(c.id));
  return {
    panel,
    title: panel?.title ?? "Conversations",
    channel: typeof panel?.data?.channel === "string" ? (panel.data.channel as string) : null,
    characters: characters.length ? characters : view.characters,
    toolIds: view.tools.filter((t) => isChatTool(t, view)).map((t) => t.id),
  };
}

export function buildApps(view: SessionView): WorkspaceApp[] {
  const apps: WorkspaceApp[] = [];
  const byKey = new Map<string, WorkspaceApp>();
  const chatTools = new Set(view.tools.filter((t) => isChatTool(t, view)).map((t) => t.id));
  const panelById = new Map(view.panels.map((p) => [p.id, p]));
  const add = (app: WorkspaceApp) => {
    apps.push(app);
    byKey.set(app.key, app);
  };

  // Stable order: tools first (always listed, "closed" until their panel becomes visible), then
  // tool-less panels in definition order as they appear — so tab positions never shift.
  for (const t of view.tools) {
    if (chatTools.has(t.id)) continue;
    const key = t.panel ?? `tool:${t.id}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.tools.push(t);
      if (t.accepts.includes("command")) existing.commandTools.push(t);
      continue;
    }
    const p = t.panel ? panelById.get(t.panel) ?? null : null;
    if (p?.type === "chat") continue;
    add({
      key,
      title: p?.title || t.name,
      type: p?.type ?? "closed",
      panel: p,
      tools: [t],
      actions: [],
      icon: toolIcon(t.icon, p?.type ?? t.id),
      color: p ? panelColor(p.type, p.id) : panelColor(t.icon === "monitor" ? "system_info" : t.icon, t.id),
      commandTools: t.accepts.includes("command") ? [t] : [],
    });
  }
  for (const p of view.panels) {
    if (p.type === "chat" || byKey.has(p.id)) continue;
    add({ key: p.id, title: p.title || p.id, type: p.type, panel: p, tools: [], actions: [], icon: toolIcon(p.type), color: panelColor(p.type, p.id), commandTools: [] });
  }
  // Actions belong to the app of their tool.
  const toolToApp = new Map<string, WorkspaceApp>();
  for (const a of apps) for (const t of a.tools) toolToApp.set(t.id, a);
  for (const action of view.available_actions) {
    if (!action.tool) continue;
    toolToApp.get(action.tool)?.actions.push(action);
  }
  return apps;
}

/** Actions that don't belong to any app (no tool, or a chat tool) — shown in the global toolbox only. */
export function orphanActions(view: SessionView, apps: WorkspaceApp[]): ViewAction[] {
  const owned = new Set(apps.flatMap((a) => a.actions.map((x) => x.id)));
  return view.available_actions.filter((a) => !owned.has(a.id));
}

export function chatThread(view: SessionView, characterId: string): TranscriptEntry[] {
  return view.transcript.filter(
    (e) =>
      (e.kind === "message" && e.from === characterId) ||
      (e.from === "learner" && (e.kind === "message" || e.kind === "action") && e.to === characterId),
  );
}

export function toolEntries(view: SessionView, app: WorkspaceApp): TranscriptEntry[] {
  const ids = new Set(app.tools.map((t) => t.id));
  return view.transcript.filter((e) => (e.tool && ids.has(e.tool)) || (app.panel && e.panel === app.panel.id));
}

/** Simulated clock: 12.5 → "12:30". */
export function simClock(minutes: number): string {
  const total = Math.max(0, Math.round(minutes * 60));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function patienceTone(p: number): { color: CategoryColor; label: string } {
  if (p >= 70) return { color: "emerald", label: "Calm" };
  if (p >= 45) return { color: "amber", label: "Uneasy" };
  if (p >= 20) return { color: "orange", label: "Frustrated" };
  return { color: "rose", label: "Furious" };
}

const PATIENCE_KEYS = /patience|mood/i;

/** Public status variables worth showing as chips (patience meters are rendered separately). */
export function statusVariables(view: SessionView): { key: string; label: string; value: string }[] {
  return Object.entries(view.variables)
    .filter(([k, v]) => !PATIENCE_KEYS.test(k) && (typeof v === "string" || typeof v === "number" || typeof v === "boolean"))
    .map(([k, v]) => ({
      key: k,
      label: k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
      value: typeof v === "boolean" ? (v ? "Yes" : "No") : String(v),
    }));
}

export function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
}

export const KIND_ORDER: Record<string, number> = { inspect: 0, select: 1, command: 2, document: 3, submit: 4, escalate: 5 };
