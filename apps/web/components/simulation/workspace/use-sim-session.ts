"use client";

/**
 * Session driver: sends actions/chat with a strictly increasing `client_seq`, serialised through a queue
 * so rapid clicks never race. A 409 `sequence_conflict` (another tab, a lost response) refetches the
 * session and retries once with the server's `next_seq`; the server is idempotent per seq.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { api, ApiError } from "@/lib/api";
import { fetchSession, simKeys } from "../queries";
import type { SimSession, StepOut } from "../types";

export type Pending =
  | { kind: "chat"; character: string; text: string }
  | { kind: "command"; tool: string; text: string }
  | { kind: "action"; actionId: string; label?: string };

export interface ActionRequest {
  action_id?: string;
  tool?: string;
  character?: string;
  input?: Record<string, unknown> | null;
}

export function useSimSession(sessionId: string, onStep?: (step: StepOut, pending: Pending) => void) {
  const qc = useQueryClient();
  const key = simKeys.session(sessionId);
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => fetchSession(sessionId, signal),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: (n, err) => !(err instanceof ApiError && err.status < 500) && n < 2,
  });
  const [pending, setPending] = React.useState<Pending | null>(null);
  const queue = React.useRef<Promise<unknown>>(Promise.resolve());
  const onStepRef = React.useRef(onStep);
  onStepRef.current = onStep;

  const current = () => qc.getQueryData<SimSession>(key);

  const apply = React.useCallback(
    (step: StepOut) => {
      qc.setQueryData<SimSession>(key, (prev) =>
        prev
          ? {
              ...prev,
              status: step.status,
              phase: step.phase,
              sim_minutes: step.sim_minutes,
              action_count: step.next_seq - 1,
              next_seq: step.next_seq,
              view: step.view,
              result: step.result,
            }
          : prev,
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qc, sessionId],
  );

  const resync = React.useCallback(async () => {
    const fresh = await fetchSession(sessionId);
    qc.setQueryData(key, fresh);
    return fresh;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, sessionId]);

  const run = React.useCallback(
    (p: Pending, path: string, body: Record<string, unknown>): Promise<StepOut> => {
      const task = async () => {
        setPending(p);
        try {
          let seq = current()?.next_seq ?? 1;
          for (let attempt = 0; ; attempt++) {
            try {
              const step = await api.post<StepOut>(path, { ...body, client_seq: seq });
              apply(step);
              onStepRef.current?.(step, p);
              return step;
            } catch (err) {
              if (err instanceof ApiError && err.status === 409 && err.code === "sequence_conflict" && attempt === 0) {
                const fresh = await resync();
                seq = fresh.next_seq;
                continue;
              }
              if (err instanceof ApiError && err.status === 409 && err.code === "session_not_active") await resync();
              throw err;
            }
          }
        } finally {
          setPending(null);
        }
      };
      const next = queue.current.then(task, task);
      queue.current = next.catch(() => undefined);
      return next;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apply, resync, sessionId],
  );

  const act = React.useCallback(
    (req: ActionRequest, p?: Pending) =>
      run(p ?? { kind: "action", actionId: req.action_id ?? "" }, `/simulation-sessions/${sessionId}/actions`, { ...req }),
    [run, sessionId],
  );

  const chat = React.useCallback(
    (characterId: string, message: string) =>
      run({ kind: "chat", character: characterId, text: message }, `/simulation-sessions/${sessionId}/chat`, {
        character_id: characterId,
        message,
      }),
    [run, sessionId],
  );

  return { query, session: query.data, pending, act, chat, resync };
}
