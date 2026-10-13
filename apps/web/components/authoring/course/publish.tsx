"use client";

import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Textarea,
  cn,
  toast,
} from "@praxis/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, ArrowRight, ArrowUpRight, CheckCircle2, Layers, ListTree, PartyPopper, Rocket, Timer } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { api, ApiError, errorMessage } from "@/lib/api";
import { formatMinutes } from "@/lib/format";
import { ak } from "../keys";
import type { PublishProblem, Structure, VersionDiff, VersionSummary } from "../types";
import { editHrefFor } from "./link-picker";
import { DiffSummary } from "./versions";

export function PublishDialog({
  open,
  onOpenChange,
  structure,
  onGoToLesson,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  structure: Structure;
  onGoToLesson: (lessonId: string) => void;
}) {
  const qc = useQueryClient();
  const reduce = useReducedMotion();
  const course = structure.course;
  const [changelog, setChangelog] = React.useState("");
  const [problems, setProblems] = React.useState<PublishProblem[]>([]);
  const [done, setDone] = React.useState<VersionSummary | null>(null);
  const current = course.current_version_number;

  React.useEffect(() => {
    if (open) {
      setProblems([]);
      setDone(null);
      setChangelog("");
    }
  }, [open]);

  const diff = useQuery({
    queryKey: ak.courses.diff(course.id, current ?? 0, "draft"),
    enabled: open && !!current,
    queryFn: ({ signal }) => api.get<VersionDiff>(`/courses/${course.id}/versions/diff`, { signal, query: { from: current!, to: "draft" } }),
    staleTime: 0,
  });

  const lessons = structure.modules.flatMap((m) => m.lessons);
  const minutes = lessons.reduce((s, l) => s + (l.duration_minutes || 0), 0);

  const publish = useMutation({
    mutationFn: () => api.post<{ version: VersionSummary }>(`/courses/${course.id}/publish`, { changelog: changelog.trim() || null }),
    onSuccess: (out) => {
      setDone(out.version);
      setProblems([]);
      qc.invalidateQueries({ queryKey: ak.courses.all });
      toast.success(`Version ${out.version.version_number} is live`);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "publish_validation_failed") {
        const d = e.details as { problems?: PublishProblem[] } | undefined;
        setProblems(d?.problems ?? []);
      } else toast.error(errorMessage(e));
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !publish.isPending && onOpenChange(o)}>
      <DialogContent size="lg">
        {done ? (
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <motion.span
              initial={reduce ? false : { scale: 0.6, rotate: -12, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, opacity: 1 }}
              transition={{ type: "spring", stiffness: 260, damping: 16 }}
              className="grid size-20 place-items-center rounded-3xl bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-glow"
            >
              <PartyPopper className="size-10" aria-hidden />
            </motion.span>
            <DialogHeader className="items-center pr-0">
              <DialogTitle className="text-2xl">Version {done.version_number} is live!</DialogTitle>
              <DialogDescription>
                New enrolments get this version immediately. Existing learners can upgrade from their course page.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap justify-center gap-2">
              <Badge tone="success">{done.stats.lesson_count ?? lessons.length} lessons</Badge>
              <Badge tone="info">{done.stats.module_count ?? structure.modules.length} modules</Badge>
              {done.stats.duration_minutes ? <Badge tone="violet">{formatMinutes(done.stats.duration_minutes)}</Badge> : null}
            </div>
            <Button variant="gradient" onClick={() => onOpenChange(false)}>
              Back to the builder
            </Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <span className="mb-1 grid size-11 place-items-center rounded-2xl bg-brand-gradient text-white shadow-glow">
                <Rocket className="size-5" aria-hidden />
              </span>
              <DialogTitle>Publish {current ? `version ${current + 1}` : "the first version"}</DialogTitle>
              <DialogDescription>Publishing freezes the current draft into an immutable version learners can take.</DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-3 gap-2">
              {[
                { icon: ListTree, label: "Modules", value: structure.modules.length, c: "from-indigo-50 text-indigo-700" },
                { icon: Layers, label: "Lessons", value: lessons.length, c: "from-sky-50 text-sky-700" },
                { icon: Timer, label: "Duration", value: formatMinutes(minutes), c: "from-violet-50 text-violet-700" },
              ].map((s) => (
                <div key={s.label} className={cn("rounded-2xl border border-slate-200 bg-gradient-to-br to-white p-3", s.c)}>
                  <s.icon className="size-4" aria-hidden />
                  <p className="mt-1 font-display text-xl font-bold text-slate-900">{s.value}</p>
                  <p className="text-2xs font-semibold uppercase tracking-wider">{s.label}</p>
                </div>
              ))}
            </div>

            {current ? (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-slate-800">Changes since v{current}</p>
                {diff.isLoading ? (
                  <div className="h-16 animate-pulse rounded-2xl bg-slate-100" />
                ) : diff.data ? (
                  <DiffSummary diff={diff.data} compact />
                ) : diff.isError ? (
                  <p className="text-sm text-rose-700">{errorMessage(diff.error)}</p>
                ) : null}
              </div>
            ) : null}

            {problems.length > 0 && (
              <Alert tone="danger" title={`${problems.length} thing${problems.length === 1 ? "" : "s"} to fix before publishing`}>
                <ul className="mt-2 space-y-1.5">
                  {problems.map((p, i) => (
                    <li key={i} className="flex flex-wrap items-start gap-2 rounded-xl bg-white/70 px-3 py-2 text-slate-800">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rose-600" aria-hidden />
                      <span className="min-w-0 flex-1 basis-48">
                        {p.lesson_title && <strong className="block">{p.lesson_title}</strong>}
                        <span className="text-sm">{p.message}</span>
                      </span>
                      {p.linked_type && p.linked_id && editHrefFor(p.linked_type === "assessment" ? "quiz" : p.linked_type, p.linked_id) && (
                        <Button asChild size="xs" variant="soft" rightIcon={<ArrowUpRight />}>
                          <Link href={editHrefFor(p.linked_type === "assessment" ? "quiz" : p.linked_type, p.linked_id)!}>
                            {p.linked_status === "empty" ? "Add questions" : `Open ${p.linked_type}`}
                          </Link>
                        </Button>
                      )}
                      {p.lesson_id && (
                        <Button
                          size="xs"
                          variant="secondary"
                          rightIcon={<ArrowRight />}
                          onClick={() => {
                            onGoToLesson(p.lesson_id!);
                            onOpenChange(false);
                          }}
                        >
                          Fix
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </Alert>
            )}

            <FormField label="What changed?" hint="Shown in version history and to learners offered an upgrade.">
              <Textarea rows={3} value={changelog} onChange={(e) => setChangelog(e.target.value)} maxLength={10000} placeholder="e.g. Added a phishing triage simulation and refreshed module 2 examples." />
            </FormField>
            {!structure.has_unpublished_changes && current ? (
              <Alert tone="info" icon={<CheckCircle2 aria-hidden />}>
                The draft matches the live version — publishing creates an identical new version.
              </Alert>
            ) : null}
            <DialogFooter>
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button variant="gradient" leftIcon={<Rocket />} loading={publish.isPending} onClick={() => publish.mutate()}>
                Publish now
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
