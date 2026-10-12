"use client";

import * as React from "react";
import { Markdown } from "@/components/common/markdown";
import type { LearnLesson } from "../types";
import { ActivityBlock } from "./activities";
import { Flashcards } from "./flashcards";
import { CodeLessonBlock, InteractiveHtmlBlock } from "./interactive-blocks";
import { AssignmentLessonCard, QuizLessonCard, SimulationLessonCard, TutorLessonCard } from "./linked";
import { AudioBlock, DocumentBlock, ImageBlock, VideoBlock } from "./media-blocks";
import { str } from "./media";
import { ScenarioBlock } from "./scenario";

/** Main content renderer for every lesson type, followed by the lesson's activity blocks. */
export function LessonBody({
  data,
  courseId,
  enrolled,
  onPosition,
  openTutor,
  tutorEnabled,
}: {
  data: LearnLesson;
  courseId: string;
  enrolled: boolean;
  onPosition: (p: Record<string, unknown>) => void;
  openTutor: () => void;
  tutorEnabled: boolean;
}) {
  const lesson = data.lesson;
  const c = lesson.content ?? {};
  const resume = typeof data.progress.last_position?.video_seconds === "number" ? (data.progress.last_position.video_seconds as number) : undefined;
  const intro = lesson.lesson_type !== "text" && lesson.lesson_type !== "ai_tutor" && lesson.lesson_type !== "infographic" && lesson.lesson_type !== "scenario" && !["pdf", "powerpoint"].includes(lesson.lesson_type) ? str(c.body_markdown) : undefined;

  let main: React.ReactNode = null;
  switch (lesson.lesson_type) {
    case "text":
      main = <Markdown className="text-base leading-relaxed sm:text-[17px]">{str(c.body_markdown) ?? ""}</Markdown>;
      break;
    case "video":
      main = <VideoBlock content={c} startAt={resume} onPosition={onPosition} title={lesson.title} />;
      break;
    case "audio":
      main = <AudioBlock content={c} onPosition={onPosition} />;
      break;
    case "pdf":
      main = <DocumentBlock content={c} kind="pdf" />;
      break;
    case "powerpoint":
      main = <DocumentBlock content={c} kind="powerpoint" />;
      break;
    case "image":
    case "infographic":
      main = <ImageBlock content={c} title={lesson.title} />;
      break;
    case "interactive_html":
      main = <InteractiveHtmlBlock content={c} title={lesson.title} />;
      break;
    case "code":
      main = <CodeLessonBlock content={c} />;
      break;
    case "flashcards":
      main = <Flashcards content={c} />;
      break;
    case "scenario":
      main = <ScenarioBlock content={c} />;
      break;
    case "quiz":
      main = <QuizLessonCard lesson={lesson} />;
      break;
    case "assignment":
      main = <AssignmentLessonCard lesson={lesson} />;
      break;
    case "simulation":
      main = <SimulationLessonCard lesson={lesson} progress={data.progress} />;
      break;
    case "ai_tutor":
      main = <TutorLessonCard content={c} onOpen={openTutor} enabled={tutorEnabled} />;
      break;
    case "mixed":
    default:
      main = str(c.body_markdown) && !intro ? <Markdown className="text-base leading-relaxed">{str(c.body_markdown)!}</Markdown> : null;
  }

  const instructions = ["quiz", "assignment", "simulation"].includes(lesson.lesson_type) ? str(c.instructions) : undefined;
  const activities = [...(lesson.activities ?? [])].sort((a, b) => a.position - b.position);

  return (
    <div className="space-y-8">
      {intro && <Markdown className="text-base leading-relaxed">{intro}</Markdown>}
      {instructions && <Markdown>{instructions}</Markdown>}
      {main}
      {activities.map((a) => (
        <ActivityBlock key={a.id} activity={a} courseId={courseId} enrolled={enrolled} onPosition={onPosition} />
      ))}
    </div>
  );
}
