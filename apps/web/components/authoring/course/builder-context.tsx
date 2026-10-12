"use client";

import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { ak } from "../keys";
import type { Activity, Lesson, Structure } from "../types";

export interface BuilderApi {
  courseId: string;
  structure: Structure | undefined;
  selectLesson: (id: string | null) => void;
  /** Patch a lesson in the cached structure (outline updates instantly). */
  patchLesson: (lessonId: string, patch: Partial<Lesson> | ((l: Lesson) => Lesson)) => void;
  setActivities: (lessonId: string, activities: Activity[]) => void;
  /** Mark the draft as changed since the last publish. */
  markDirty: () => void;
  refresh: () => Promise<unknown>;
}

const Ctx = React.createContext<BuilderApi | null>(null);

export function BuilderProvider({
  courseId,
  structure,
  selectLesson,
  children,
}: {
  courseId: string;
  structure: Structure | undefined;
  selectLesson: (id: string | null) => void;
  children: React.ReactNode;
}) {
  const qc = useQueryClient();
  const key = ak.courses.structure(courseId);

  const value = React.useMemo<BuilderApi>(() => {
    const update = (fn: (s: Structure) => Structure) =>
      qc.setQueryData<Structure>(key, (old) => (old ? fn(old) : old));
    return {
      courseId,
      structure,
      selectLesson,
      patchLesson: (lessonId, patch) =>
        update((s) => ({
          ...s,
          modules: s.modules.map((m) => ({
            ...m,
            lessons: m.lessons.map((l) => (l.id === lessonId ? (typeof patch === "function" ? patch(l) : { ...l, ...patch }) : l)),
          })),
        })),
      setActivities: (lessonId, activities) =>
        update((s) => ({
          ...s,
          has_unpublished_changes: true,
          modules: s.modules.map((m) => ({
            ...m,
            lessons: m.lessons.map((l) => (l.id === lessonId ? { ...l, activities } : l)),
          })),
        })),
      markDirty: () => update((s) => (s.has_unpublished_changes ? s : { ...s, has_unpublished_changes: true })),
      refresh: () => qc.invalidateQueries({ queryKey: key }),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, courseId, structure, selectLesson]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBuilder(): BuilderApi {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("useBuilder must be used inside <BuilderProvider>");
  return v;
}
