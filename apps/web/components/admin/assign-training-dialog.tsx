"use client";

/**
 * "Assign training" flow (POST /enrolments/assign): pick a course, people / departments / teams and an
 * optional due date, then show the created / reactivated / skipped summary.
 * Exported for reuse from course rows elsewhere in the app.
 */

import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  cn,
  colorClasses,
  toast,
} from "@praxis/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BookOpenCheck, Building2, CalendarClock, CheckCircle2, RefreshCcw, SkipForward, UserRound, UsersRound } from "lucide-react";
import * as React from "react";
import { api, errorMessage } from "@/lib/api";
import { ak } from "./keys";
import { CourseSelect, DepartmentMultiPicker, MemberMultiPicker, TeamMultiPicker, type Option } from "./pickers";
import type { AssignOut } from "./types";
import { UpgradeNotice, isPlanLimit } from "./ui";

function plural(n: number, one: string, many = `${one}s`) {
  return n === 1 ? one : many;
}

export function AssignTrainingDialog({
  open,
  onOpenChange,
  course: initialCourse = null,
  users: initialUsers = [],
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  course?: Option | null;
  users?: Option[];
}) {
  const qc = useQueryClient();
  const [course, setCourse] = React.useState<Option | null>(initialCourse);
  const [users, setUsers] = React.useState<Option[]>(initialUsers);
  const [departments, setDepartments] = React.useState<Option[]>([]);
  const [teams, setTeams] = React.useState<Option[]>([]);
  const [due, setDue] = React.useState("");
  const [result, setResult] = React.useState<AssignOut | null>(null);

  React.useEffect(() => {
    if (open) {
      setCourse(initialCourse);
      setUsers(initialUsers);
      setDepartments([]);
      setTeams([]);
      setDue("");
      setResult(null);
      assign.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const assign = useMutation({
    mutationFn: () =>
      api.post<AssignOut>("/enrolments/assign", {
        course_id: course!.value,
        user_ids: users.map((u) => u.value),
        department_ids: departments.map((d) => d.value),
        team_ids: teams.map((t) => t.value),
        due_date: due || null,
      }),
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ak.enrolments.all });
      // Member detail pages show an enrolment summary — refresh them too.
      qc.invalidateQueries({ queryKey: ak.members.all });
      qc.invalidateQueries({ queryKey: ["analytics"] });
      const n = r.created + r.reactivated;
      if (n === 0) toast.info(r.skipped === 1 ? "Already enrolled — nothing to assign" : `All ${r.skipped} people are already enrolled — nothing to assign`);
      else toast.success(`Training assigned — ${n} ${plural(n, "enrolment")}`);
    },
  });

  const allSkipped = !!result && result.created + result.reactivated === 0;
  const hasTargets = users.length + departments.length + teams.length > 0;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <span className="mb-1 grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-sm">
            <BookOpenCheck className="size-5" aria-hidden />
          </span>
          <DialogTitle>{!result ? "Assign training" : allSkipped ? "Everyone is already enrolled" : "Training assigned"}</DialogTitle>
          <DialogDescription>
            {!result
              ? "Enrol people, whole departments or teams in a published course, with an optional due date."
              : allSkipped
                ? `Nobody new was enrolled in ${course?.label} — ${result.skipped === 1 ? "the selected person is" : `all ${result.skipped} selected people are`} already enrolled. No notifications were sent.`
                : `${course?.label} has been assigned to ${result.created + result.reactivated} ${plural(result.created + result.reactivated, "person", "people")}. They're notified and see it on their dashboard.`}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-4" aria-live="polite">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <ResultTile icon={CheckCircle2} color="emerald" label="Newly enrolled" value={result.created} />
              <ResultTile icon={RefreshCcw} color="sky" label="Reactivated" value={result.reactivated} />
              <ResultTile icon={SkipForward} color="amber" label="Skipped" value={result.skipped} hint="Already enrolled" />
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setResult(null)}>
                Assign more
              </Button>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (course && hasTargets) assign.mutate();
            }}
          >
            <FormField label="Course" required hint="Only published courses can be assigned.">
              {(aria) => <CourseSelect id={aria.id} value={course} onChange={setCourse} publishedOnly />}
            </FormField>

            <fieldset className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
              <legend className="px-1 text-sm font-semibold text-slate-900">Who should take it?</legend>
              <FormField label={<span className="inline-flex items-center gap-1.5"><UserRound className="size-4 text-sky-600" aria-hidden />People</span>}>
                {(aria) => <MemberMultiPicker id={aria.id} value={users} onChange={setUsers} />}
              </FormField>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField label={<span className="inline-flex items-center gap-1.5"><Building2 className="size-4 text-teal-600" aria-hidden />Departments</span>} hint="Includes sub-departments">
                  {(aria) => <DepartmentMultiPicker id={aria.id} value={departments} onChange={setDepartments} />}
                </FormField>
                <FormField label={<span className="inline-flex items-center gap-1.5"><UsersRound className="size-4 text-violet-600" aria-hidden />Teams</span>}>
                  {(aria) => <TeamMultiPicker id={aria.id} value={teams} onChange={setTeams} />}
                </FormField>
              </div>
            </fieldset>

            <FormField label={<span className="inline-flex items-center gap-1.5"><CalendarClock className="size-4 text-amber-600" aria-hidden />Due date</span>} hint="Optional. Overdue training is flagged in compliance reports.">
              <Input type="date" min={today} value={due} onChange={(e) => setDue(e.target.value)} className="sm:max-w-xs" />
            </FormField>

            {assign.isError &&
              (isPlanLimit(assign.error) ? (
                <UpgradeNotice error={assign.error} compact />
              ) : (
                <Alert tone="danger" title="Couldn't assign training">
                  {errorMessage(assign.error)}
                </Alert>
              ))}

            <DialogFooter>
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="gradient" loading={assign.isPending} disabled={!course || !hasTargets}>
                Assign training
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ResultTile({
  icon: Icon,
  color,
  label,
  value,
  hint,
}: {
  icon: typeof CheckCircle2;
  color: "emerald" | "sky" | "amber";
  label: string;
  value: number;
  hint?: string;
}) {
  const c = colorClasses(color);
  return (
    <div className={cn("rounded-2xl border bg-gradient-to-br p-4", c.border, c.tint)}>
      <Icon className={cn("size-5", c.icon)} aria-hidden />
      <p className="mt-2 font-display text-3xl font-bold tabular-nums text-slate-900">{value}</p>
      <p className="text-sm font-medium text-slate-700">{label}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
