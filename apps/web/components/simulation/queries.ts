/** Query keys + fetchers for the simulation player (local to this area). */
import { api } from "@/lib/api";
import type { Page, Replay, SessionSummary, SimBriefing, SimResult, SimSession, Simulation } from "./types";

export const simKeys = {
  all: ["simulations"] as const,
  list: (params: Record<string, unknown> = {}) => ["simulations", "list", params] as const,
  detail: (id: string) => ["simulations", "detail", id] as const,
  briefing: (id: string) => ["simulations", "briefing", id] as const,
  mySessions: (params: Record<string, unknown> = {}) => ["simulation-sessions", "mine", params] as const,
  session: (id: string) => ["simulation-sessions", "detail", id] as const,
  result: (id: string) => ["simulation-sessions", "result", id] as const,
  replay: (id: string) => ["simulation-sessions", "replay", id] as const,
};

export const fetchSimulations = (query: Record<string, string | number | undefined>, signal?: AbortSignal) =>
  api.get<Page<Simulation>>("/simulations", { query, signal });

export const fetchSimulation = (id: string, signal?: AbortSignal) => api.get<Simulation>(`/simulations/${id}`, { signal });

/** Learner-safe briefing of the published version (role, objectives, people, phases, scoring model). */
export const fetchBriefing = (id: string, signal?: AbortSignal) => api.get<SimBriefing>(`/simulations/${id}/briefing`, { signal });

export const fetchMySessions = (query: Record<string, string | number | undefined>, signal?: AbortSignal) =>
  api.get<Page<SessionSummary>>("/simulation-sessions", { query, signal });

export const fetchSession = (id: string, signal?: AbortSignal) => api.get<SimSession>(`/simulation-sessions/${id}`, { signal });

export const fetchResult = (id: string, signal?: AbortSignal) => api.get<SimResult>(`/simulation-sessions/${id}/result`, { signal });

export const fetchReplay = (id: string, signal?: AbortSignal) => api.get<Replay>(`/simulation-sessions/${id}/replay`, { signal });

export const startSession = (simulationId: string) => api.post<SimSession>(`/simulations/${simulationId}/sessions`, {});

/** Per-simulation aggregate of the learner's own attempts. */
export interface AttemptStats {
  attempts: number;
  best: SessionSummary | null;
  active: SessionSummary | null;
  latest: SessionSummary | null;
}

export function aggregateAttempts(sessions: SessionSummary[]): Map<string, AttemptStats> {
  const map = new Map<string, AttemptStats>();
  for (const s of sessions) {
    const cur = map.get(s.simulation_id) ?? { attempts: 0, best: null, active: null, latest: null };
    cur.attempts += 1;
    if (s.status === "active" && !cur.active) cur.active = s;
    if (!cur.latest || s.started_at > cur.latest.started_at) cur.latest = s;
    if (s.total_score !== null && s.status !== "active" && (!cur.best || (s.total_score ?? 0) > (cur.best.total_score ?? 0))) cur.best = s;
    map.set(s.simulation_id, cur);
  }
  return map;
}
