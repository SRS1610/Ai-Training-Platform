"use client";

import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, EmptyState, SimpleSelect, Skeleton, Spinner } from "@praxis/ui";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Pencil, Plus, Scale, Sparkles } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { api } from "@/lib/api";
import { ak } from "../keys";
import { RubricEditor, RubricGrid, WeightBar } from "../rubrics/rubric-editor";
import { AIBadge } from "../shared";
import type { Page, Rubric } from "../types";

/** Rubric dialog (create or edit) usable from anywhere in authoring. */
export function RubricDialog({
  open,
  onOpenChange,
  rubric,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  rubric?: Rubric | null;
  onSaved?: (r: Rubric) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <span className="mb-1 grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-glow">
            <Scale className="size-5" aria-hidden />
          </span>
          <DialogTitle>{rubric ? "Edit rubric" : "Create a rubric"}</DialogTitle>
          <DialogDescription>Weighted criteria with clear level descriptors — used by assessors and the AI grader.</DialogDescription>
        </DialogHeader>
        {open && (
          <RubricEditor
            rubric={rubric}
            onCancel={() => onOpenChange(false)}
            onSaved={(r) => {
              onSaved?.(r);
              onOpenChange(false);
            }}
            submitLabel={rubric ? "Save rubric" : "Create & attach"}
            inDialog
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Choose / create / edit the rubric an assignment is graded with. */
export function RubricPicker({ value, onChange, aiMode }: { value: string | null; onChange: (id: string | null) => void; aiMode: boolean }) {
  const [dialog, setDialog] = React.useState<{ rubric: Rubric | null } | null>(null);
  const list = useQuery({
    queryKey: ak.rubrics.list({ picker: true }),
    queryFn: ({ signal }) => api.get<Page<Rubric>>("/rubrics", { signal, query: { page_size: 200 } }),
    staleTime: 30_000,
  });
  const detail = useQuery({
    queryKey: ak.rubrics.detail(value ?? ""),
    enabled: !!value,
    queryFn: ({ signal }) => api.get<Rubric>(`/rubrics/${value}`, { signal }),
  });
  const r = detail.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          {list.isLoading ? (
            <Skeleton className="h-11 rounded-xl" />
          ) : (
            <SimpleSelect
              aria-label="Rubric"
              value={value ?? "none"}
              onValueChange={(v) => onChange(v === "none" ? null : v)}
              options={[{ value: "none", label: aiMode ? "No rubric (required for AI grading)" : "No rubric" }, ...(list.data?.items ?? []).map((x) => ({ value: x.id, label: x.title }))]}
            />
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          {r && (
            <Button variant="secondary" size="sm" leftIcon={<Pencil />} onClick={() => setDialog({ rubric: r })}>
              Edit
            </Button>
          )}
          <Button variant="soft" size="sm" leftIcon={<Plus />} onClick={() => setDialog({ rubric: null })}>
            New rubric
          </Button>
        </div>
      </div>
      {value && detail.isLoading ? (
        <div className="grid h-32 place-items-center">
          <Spinner />
        </div>
      ) : r ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              {r.title} {r.ai_generated && <AIBadge />}
            </p>
            <Link href={`/app/instructor/rubrics/${r.id}`} className="inline-flex items-center gap-1 rounded text-xs font-semibold text-brand-700 hover:underline focus-visible:focus-ring">
              Open in rubric library <ArrowUpRight className="size-3.5" aria-hidden />
            </Link>
          </div>
          <WeightBar criteria={r.criteria} />
          <RubricGrid criteria={r.criteria} />
        </div>
      ) : (
        <EmptyState
          bordered
          size="sm"
          illustration="trophy"
          title={aiMode ? "AI grading needs a rubric" : "No rubric attached"}
          description="Rubrics make grading consistent and let the AI explain every score against your criteria."
          action={
            <Button size="sm" leftIcon={<Sparkles />} onClick={() => setDialog({ rubric: null })}>
              Create a rubric
            </Button>
          }
        />
      )}
      <RubricDialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)} rubric={dialog?.rubric} onSaved={(nr) => onChange(nr.id)} />
    </div>
  );
}
