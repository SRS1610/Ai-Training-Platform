"use client";

import * as React from "react";
import type { SessionView, SimSession, StepOut } from "../types";
import type { ActionRequest, Pending } from "./use-sim-session";

/** Learner-visible note that was not persisted (rejected step), shown inline next to the tool/thread. */
export interface Ephemeral {
  id: string;
  afterSeq: number;
  scope: string; // "chat:<character>" | "tool:<tool id>"
  text: string;
  from?: string;
  name?: string | null;
  learnerText?: string;
}

export interface WorkspaceCtx {
  session: SimSession;
  view: SessionView;
  pending: Pending | null;
  ended: boolean;
  act: (req: ActionRequest, p?: Pending) => Promise<StepOut | void>;
  chat: (characterId: string, message: string) => Promise<StepOut | void>;
  ephemeral: Ephemeral[];
  /** Seq of the newest step, for "new" highlights. */
  lastSeq: number;
  openApp: (key: string) => void;
  openChat: (characterId?: string) => void;
}

const Ctx = React.createContext<WorkspaceCtx | null>(null);

export function WorkspaceProvider({ value, children }: { value: WorkspaceCtx; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace(): WorkspaceCtx {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return v;
}
