"use client";

import * as React from "react";
import type { LearnCourse, OutlineLesson } from "../types";

export interface PlayerContextValue {
  courseId: string;
  /** Undefined while loading or when previewing without an enrolment. */
  course: LearnCourse | undefined;
  enrolled: boolean;
  openTutor: () => void;
  tutorEnabled: boolean;
}

export const PlayerContext = React.createContext<PlayerContextValue | null>(null);

export function usePlayer(): PlayerContextValue {
  const ctx = React.useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used inside the lesson player layout");
  return ctx;
}

export function flatLessons(course: LearnCourse | undefined): (OutlineLesson & { moduleIndex: number; moduleTitle: string })[] {
  if (!course) return [];
  return course.modules.flatMap((m, mi) => m.lessons.map((l) => ({ ...l, moduleIndex: mi, moduleTitle: m.title })));
}
