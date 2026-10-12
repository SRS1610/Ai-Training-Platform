"use client";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, Badge, Card, CardContent, CardHeader, CardTitle, cn } from "@praxis/ui";
import { BookOpenCheck, CheckCircle2, CircleDashed, EyeOff } from "lucide-react";
import { Markdown } from "@/components/common/markdown";
import type { AssignmentOut, EvidenceItem, SubmissionVersion } from "./types";

function provided(ev: EvidenceItem, v: SubmissionVersion | undefined): boolean {
  if (!v) return false;
  const files = v.files ?? [];
  switch (ev.type) {
    case "text":
      return !!v.text_content?.trim();
    case "code":
      return !!v.code_content?.trim();
    case "structured":
      return Object.keys(v.structured_answers ?? {}).length > 0;
    case "screenshot":
      return files.some((f) => f.content_type.startsWith("image/"));
    case "video":
      return files.some((f) => f.content_type.startsWith("video/"));
    case "audio":
      return files.some((f) => f.content_type.startsWith("audio/"));
    default:
      return files.length > 0;
  }
}

export function AssignmentBrief({ assignment, version }: { assignment: AssignmentOut; version?: SubmissionVersion }) {
  const evidence = (assignment.required_evidence ?? []) as EvidenceItem[];
  const sections = [
    { id: "scenario", title: "Scenario", body: assignment.scenario },
    { id: "objective", title: "Objective", body: assignment.objective },
    { id: "instructions", title: "Instructions", body: assignment.instructions },
    { id: "criteria", title: "Evaluation criteria", body: assignment.evaluation_criteria },
  ].filter((s) => s.body && s.body.trim());
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-amber-50 text-amber-600">
            <BookOpenCheck className="size-[18px]" aria-hidden />
          </span>
          <div>
            <CardTitle as="h2">Assignment brief</CardTitle>
            <p className="text-xs text-muted-foreground">What the learner was asked to do</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {evidence.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Required evidence</p>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {evidence.map((ev) => {
                const ok = provided(ev, version);
                return (
                  <li key={ev.id} className={cn("flex items-center gap-2 rounded-xl px-3 py-2 text-sm ring-1 ring-inset", ok ? "bg-emerald-50 text-emerald-900 ring-emerald-200" : "bg-slate-50 text-slate-700 ring-slate-200")}>
                    {ok ? <CheckCircle2 className="size-4 shrink-0 text-emerald-600" aria-hidden /> : <CircleDashed className="size-4 shrink-0 text-slate-400" aria-hidden />}
                    <span className="min-w-0 flex-1 truncate">{ev.label}</span>
                    <span className="sr-only">{ok ? "provided" : "not detected"}</span>
                    {ev.required === false && (
                      <Badge tone="neutral" size="sm">
                        optional
                      </Badge>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <Accordion type="multiple" defaultValue={["instructions"]}>
          {sections.map((s) => (
            <AccordionItem key={s.id} value={s.id}>
              <AccordionTrigger>{s.title}</AccordionTrigger>
              <AccordionContent>
                <Markdown>{s.body!}</Markdown>
              </AccordionContent>
            </AccordionItem>
          ))}
          {assignment.expected_output && (
            <AccordionItem value="expected">
              <AccordionTrigger>
                <span className="flex items-center gap-2">
                  Expected output
                  <Badge tone="violet" size="sm">
                    <EyeOff aria-hidden /> Staff only
                  </Badge>
                </span>
              </AccordionTrigger>
              <AccordionContent>
                <Markdown>{assignment.expected_output}</Markdown>
              </AccordionContent>
            </AccordionItem>
          )}
        </Accordion>
      </CardContent>
    </Card>
  );
}
