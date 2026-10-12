"use client";

/**
 * AI tutor data layer: sessions, messages, SSE streaming (fetch + ReadableStream) and ratings.
 * The stream request reuses lib/api.ts conventions: same-origin /api/v1, cookies, X-CSRF-Token and
 * X-Organisation-Id, one refresh-and-retry on 401.
 */
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, buildUrl, CSRF_COOKIE, CSRF_HEADER, ORG_HEADER, readCookie, redirectToLogin, refreshSession } from "@/lib/api";
import { getActiveOrgId } from "@/lib/org";

export interface Citation {
  index: number;
  document_id: string;
  title: string;
  chunk_id: string;
  snippet: string;
  heading?: string | null;
}

export interface TutorMessage {
  id: string;
  role: "user" | "assistant" | string;
  content: string;
  mode: "explain" | "hint" | "refuse" | string | null;
  citations: Citation[];
  safety?: Record<string, unknown>;
  model: string | null;
  feedback_rating: number | null;
  created_at: string;
  /** Client-only flags. */
  streaming?: boolean;
  pending?: boolean;
}

export interface TutorSession {
  id: string;
  title: string | null;
  course_id: string | null;
  lesson_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface MyEnrolment {
  id: string;
  course_id: string;
  title: string;
  category: string | null;
  status: string;
  progress_pct: number;
}

export const tutorKeys = {
  sessions: (courseId?: string) => ["tutor", "sessions", courseId ?? "all"] as const,
  messages: (id: string) => ["tutor", "messages", id] as const,
  enrolments: ["enrolments", "me", "tutor"] as const,
  outline: (courseId: string) => ["learn", "outline", courseId] as const,
};

export function useTutorSessions(courseId?: string) {
  return useQuery({
    queryKey: tutorKeys.sessions(courseId),
    queryFn: ({ signal }) =>
      api.get<{ items: TutorSession[]; total: number }>("/ai/tutor/sessions", { query: { page_size: 100, course_id: courseId }, signal }),
  });
}

export function useMyEnrolments() {
  return useQuery({
    queryKey: tutorKeys.enrolments,
    queryFn: ({ signal }) => api.get<MyEnrolment[]>("/enrolments/me", { signal }),
    staleTime: 60_000,
  });
}

export interface OutlineLesson {
  id: string;
  title: string;
  lesson_type: string;
}

export function useCourseLessons(courseId: string | null | undefined) {
  return useQuery({
    queryKey: tutorKeys.outline(courseId ?? "none"),
    enabled: !!courseId,
    queryFn: async ({ signal }) => {
      const out = await api.get<{ modules: { id: string; title: string; lessons: OutlineLesson[] }[] }>(`/learn/${courseId}`, { signal });
      return out.modules;
    },
    staleTime: 60_000,
    retry: false,
  });
}

export const createTutorSession = (body: { course_id?: string | null; lesson_id?: string | null; title?: string }) =>
  api.post<TutorSession>("/ai/tutor/sessions", { course_id: body.course_id ?? null, lesson_id: body.lesson_id ?? null, title: body.title });

export const fetchTutorMessages = (id: string, signal?: AbortSignal) => api.get<TutorMessage[]>(`/ai/tutor/sessions/${id}/messages`, { signal });

export const rateTutorMessage = (id: string, rating: 1 | -1) => api.post<TutorMessage>(`/ai/tutor/messages/${id}/rating`, { rating });

export interface StreamMeta {
  session_id: string;
  user_message_id: string;
  assistant_message_id: string;
  mode: string;
  citations: Citation[];
  offline: boolean;
}

export interface StreamHandlers {
  onMeta?: (m: StreamMeta) => void;
  onDelta?: (text: string) => void;
  onDone?: (m: TutorMessage) => void;
}

async function errorFrom(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string; details?: unknown; request_id?: string } };
    const e = body.error;
    return new ApiError(res.status, e?.code ?? `http_${res.status}`, e?.message ?? res.statusText, e?.details, e?.request_id);
  } catch {
    return new ApiError(res.status, `http_${res.status}`, res.statusText || "Request failed");
  }
}

/** POST a question and consume the SSE answer. Resolves with the stored assistant message. */
export async function streamTutorAnswer(
  sessionId: string,
  body: { content: string; lesson_id?: string | null },
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<TutorMessage | null> {
  const send = () => {
    const headers: Record<string, string> = { Accept: "text/event-stream", "Content-Type": "application/json" };
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf) headers[CSRF_HEADER] = csrf;
    const org = getActiveOrgId();
    if (org) headers[ORG_HEADER] = org;
    return fetch(buildUrl(`/ai/tutor/sessions/${sessionId}/messages/stream`), {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers,
      body: JSON.stringify({ content: body.content, lesson_id: body.lesson_id ?? null }),
      signal,
    });
  };
  let res: Response;
  try {
    res = await send();
    if (res.status === 401) {
      if (await refreshSession()) res = await send();
      else {
        redirectToLogin();
        throw new ApiError(401, "unauthorized", "Your session has expired.");
      }
    }
  } catch (err) {
    if (err instanceof ApiError || (err as Error)?.name === "AbortError") throw err;
    throw new ApiError(0, "network_error", "Network error");
  }
  if (!res.ok) throw await errorFrom(res);
  if (!res.body) throw new ApiError(0, "no_stream", "The tutor didn't return a response.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let final: TutorMessage | null = null;
  const handle = (block: string) => {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (!data.length) return;
    let payload: unknown;
    try {
      payload = JSON.parse(data.join("\n"));
    } catch {
      return;
    }
    if (event === "meta") handlers.onMeta?.(payload as StreamMeta);
    else if (event === "delta") handlers.onDelta?.((payload as { text: string }).text);
    else if (event === "done") {
      final = payload as TutorMessage;
      handlers.onDone?.(final);
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let i: number;
    while ((i = buffer.indexOf("\n\n")) >= 0) {
      handle(buffer.slice(0, i));
      buffer = buffer.slice(i + 2);
    }
  }
  if (buffer.trim()) handle(buffer);
  return final;
}

/** Friendly copy for AI gating errors. */
export function tutorErrorMessage(err: unknown): { title: string; body: string; tone: "warning" | "danger" | "info" } {
  if (err instanceof ApiError) {
    if (err.status === 402)
      return err.code === "ai_budget_exceeded"
        ? { title: "AI budget reached", body: "Your organisation has used this month's AI budget. Ask an administrator to raise it — the tutor will be back next month otherwise.", tone: "warning" }
        : { title: "Not included in your plan", body: "Your organisation's plan doesn't include the AI tutor. Ask an administrator about upgrading.", tone: "warning" };
    if (err.status === 429)
      return { title: "Let's take a short break", body: err.message || "You've reached the AI request limit for now. Please try again later.", tone: "info" };
    if (err.code === "tutor_disabled") return { title: "Tutor disabled for this course", body: "Your instructor has turned off the AI tutor for this course.", tone: "info" };
    if (err.code === "not_enrolled") return { title: "Enrol to use the tutor", body: "Enrol in this course to ask its AI tutor questions.", tone: "info" };
    if (err.code === "ai_feature_disabled") return { title: "AI tutor is turned off", body: "An administrator has disabled the AI tutor for your organisation.", tone: "info" };
    if (err.status === 503) return { title: "The tutor is unavailable", body: "The AI service didn't respond. Please try again in a moment.", tone: "danger" };
    if (err.isNetwork) return { title: "You're offline", body: "We couldn't reach the server. Check your connection and try again.", tone: "danger" };
    return { title: "Something went wrong", body: err.message, tone: "danger" };
  }
  return { title: "Something went wrong", body: "Please try again.", tone: "danger" };
}
