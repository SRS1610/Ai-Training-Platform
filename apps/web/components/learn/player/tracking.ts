"use client";

import * as React from "react";
import { api } from "@/lib/api";
import type { ProgressOut } from "../types";

const HEARTBEAT_MS = 30_000;

/**
 * Lesson time tracking: `POST /progress/lessons/{id}/start` on open, then a heartbeat every 30s while the
 * tab is visible (`seconds` = visible time since the previous beat, plus the latest `position`), and a final
 * beat when the tab is hidden or the lesson is left. Returns a setter for the resume position
 * (e.g. `{ video_seconds: 93 }`).
 */
export function useLessonTracking(lessonId: string | null, enabled: boolean, onProgress?: (p: ProgressOut) => void) {
  const position = React.useRef<Record<string, unknown> | null>(null);
  const onProgressRef = React.useRef(onProgress);
  onProgressRef.current = onProgress;

  React.useEffect(() => {
    if (!enabled || !lessonId) return;
    let visibleSince: number | null = document.visibilityState === "visible" ? Date.now() : null;
    let banked = 0; // visible ms not yet reported
    let stopped = false;

    const take = () => {
      if (visibleSince !== null) {
        banked += Date.now() - visibleSince;
        visibleSince = document.visibilityState === "visible" ? Date.now() : null;
      }
      const secs = Math.floor(banked / 1000);
      banked -= secs * 1000;
      return secs;
    };

    const beat = (force = false) => {
      const seconds = take();
      if (seconds <= 0 && !force) return;
      api
        .post<ProgressOut>(`/progress/lessons/${lessonId}/heartbeat`, { seconds: Math.min(3600, seconds), position: position.current ?? undefined }, { redirectOn401: false })
        .then((p) => !stopped && onProgressRef.current?.(p))
        .catch(() => undefined);
    };

    api
      .post<ProgressOut>(`/progress/lessons/${lessonId}/start`, undefined, { redirectOn401: false })
      .then((p) => !stopped && onProgressRef.current?.(p))
      .catch(() => undefined);

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") beat();
    }, HEARTBEAT_MS);

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        beat();
        visibleSince = null;
      } else {
        visibleSince = Date.now();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      const seconds = take();
      if (seconds >= 3) {
        api
          .post(`/progress/lessons/${lessonId}/heartbeat`, { seconds: Math.min(3600, seconds), position: position.current ?? undefined }, { redirectOn401: false })
          .catch(() => undefined);
      }
    };
  }, [lessonId, enabled]);

  return React.useCallback((p: Record<string, unknown>) => {
    position.current = p;
  }, []);
}
