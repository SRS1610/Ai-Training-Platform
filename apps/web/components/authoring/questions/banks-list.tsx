"use client";

import {
  Alert,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  FilterBar,
  FormField,
  Input,
  PageHeader,
  Pagination,
  SimpleSelect,
  Skeleton,
  Textarea,
  cn,
  colorClasses,
  colorFor,
  toast,
} from "@praxis/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Download, FileQuestion, Library, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { ErrorState } from "@/components/common/error-state";
import { api, errorMessage } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { downloadJson, problemsMessage } from "../hooks";
import { ak } from "../keys";
import { SubNav } from "../shared";
import type { Bank, Page } from "../types";
import { useCourseOptions } from "../use-options";

export const ASSESS_NAV = [
  { href: "/app/instructor/question-banks", label: "Question banks", icon: Library, color: "sky" as const },
  { href: "/app/instructor/assessments", label: "Assessments", icon: FileQuestion, color: "violet" as const },
];

export function BankDialog({ open, onOpenChange, bank }: { open: boolean; onOpenChange: (o: boolean) => void; bank?: Bank | null }) {
  const qc = useQueryClient();
  const router = useRouter();
  const courses = useCourseOptions(open);
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [courseId, setCourseId] = React.useState("none");
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) {
      setTitle(bank?.title ?? "");
      setDescription(bank?.description ?? "");
      setCourseId(bank?.course_id ?? "none");
      setError(null);
    }
  }, [open, bank]);
  const save = useMutation({
    mutationFn: () => {
      const body = { title: title.trim(), description: description.trim() || null, course_id: courseId === "none" ? null : courseId };
      return bank ? api.patch<Bank>(`/question-banks/${bank.id}`, body) : api.post<Bank>("/question-banks", body);
    },
    onSuccess: (b) => {
      toast.success(bank ? "Bank updated" : `Bank “${b.title}” created`);
      qc.invalidateQueries({ queryKey: ak.banks.all });
      onOpenChange(false);
      if (!bank) router.push(`/app/instructor/question-banks/${b.id}`);
    },
    onError: (e) => setError(problemsMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{bank ? "Edit question bank" : "New question bank"}</DialogTitle>
          <DialogDescription>Banks group reusable questions. Assessments draw fixed questions or random pools from them.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return setError("Give the bank a title");
            save.mutate();
          }}
        >
          <FormField label="Title" required>
            <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={255} placeholder="e.g. Phishing fundamentals" />
          </FormField>
          <FormField label="Description">
            <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </FormField>
          <FormField label="Course" hint="Optional — scope the bank to a course.">
            {(aria) => <SimpleSelect {...aria} value={courseId} onValueChange={setCourseId} options={[{ value: "none", label: "Not linked to a course" }, ...courses.options]} />}
          </FormField>
          {error && <Alert tone="danger">{error}</Alert>}
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              {bank ? "Save" : "Create bank"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const PAGE_SIZE = 18;

export function BanksList() {
  const qc = useQueryClient();
  const [q, setQ] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [dialog, setDialog] = React.useState<{ bank: Bank | null } | null>(null);
  const [toDelete, setToDelete] = React.useState<Bank | null>(null);
  const courses = useCourseOptions();
  const list = useQuery({
    queryKey: ak.banks.list({ q, page }),
    queryFn: ({ signal }) => api.get<Page<Bank>>("/question-banks", { signal, query: { q: q || undefined, page, page_size: PAGE_SIZE } }),
    placeholderData: (p) => p,
  });
  const exportBank = async (b: Bank) => {
    try {
      const data = await api.get(`/question-banks/${b.id}/export`);
      downloadJson(`${b.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.praxis-bank.json`, data);
      toast.success("Bank exported");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const totalQuestions = items.reduce((s, b) => s + b.question_count, 0);

  return (
    <>
      <PageHeader
        title="Question banks"
        description="Reusable questions across all 14 types — drawn into quizzes, finals and practice tests."
        icon={<Library />}
        actions={
          <Button variant="gradient" leftIcon={<Plus />} onClick={() => setDialog({ bank: null })}>
            New bank
          </Button>
        }
      />
      <SubNav items={ASSESS_NAV} />
      <div className="mb-4">
        <FilterBar
          search={q}
          onSearchChange={(v) => {
            setQ(v);
            setPage(1);
          }}
          searchPlaceholder="Search banks…"
          actions={
            total > 0 ? (
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {total} bank{total === 1 ? "" : "s"} · {totalQuestions} questions on this page
              </p>
            ) : undefined
          }
        />
      </div>
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-2xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          bordered
          size="lg"
          illustration={q ? "search" : "inbox"}
          title={q ? "No banks match" : "No question banks yet"}
          description={q ? "Try a different search." : "Create a bank, then add questions by hand, import a JSON file, or generate a quiz with AI."}
          action={
            !q ? (
              <Button variant="gradient" leftIcon={<Plus />} onClick={() => setDialog({ bank: null })}>
                Create your first bank
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((b) => {
              const c = colorClasses(colorFor(b.title));
              const course = courses.titleOf(b.course_id);
              return (
                <article key={b.id} className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-soft transition duration-300 ease-spring hover:-translate-y-1 hover:shadow-lift">
                  <div className={cn("pointer-events-none absolute -right-10 -top-10 size-36 rounded-full opacity-[0.12] blur-2xl", c.solid)} aria-hidden />
                  <div className="relative flex items-start gap-3">
                    <span className={cn("grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br text-white shadow-sm", c.gradient)} aria-hidden>
                      <Library className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 className="font-display text-base font-semibold text-slate-900">
                        <Link href={`/app/instructor/question-banks/${b.id}`} className="rounded after:absolute after:inset-0 focus-visible:focus-ring">
                          {b.title}
                        </Link>
                      </h2>
                      {course && (
                        <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <BookOpen className="size-3.5" aria-hidden /> {course}
                        </p>
                      )}
                    </div>
                    <div className="relative z-10">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${b.title}`}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setDialog({ bank: b })}>
                            <Pencil /> Edit details
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => void exportBank(b)}>
                            <Download /> Export JSON
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem destructive onSelect={() => setToDelete(b)}>
                            <Trash2 /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  <p className="relative mt-3 line-clamp-2 min-h-10 text-sm text-muted-foreground">{b.description || "No description"}</p>
                  <div className="relative mt-4 flex items-end justify-between">
                    <div>
                      <p className="font-display text-3xl font-bold tabular-nums text-slate-900">{b.question_count}</p>
                      <p className="text-xs font-medium text-slate-500">question{b.question_count === 1 ? "" : "s"}</p>
                    </div>
                    <p className="text-2xs text-muted-foreground">Updated {formatRelative(b.updated_at)}</p>
                  </div>
                </article>
              );
            })}
          </div>
          {total > PAGE_SIZE && <Pagination className="mt-6" page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />}
        </>
      )}
      <BankDialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)} bank={dialog?.bank} />
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        destructive
        title={`Delete “${toDelete?.title}”?`}
        description={`The bank and its ${toDelete?.question_count ?? 0} question(s) are removed. Assessments that draw from it will need new items.`}
        confirmLabel="Delete bank"
        onConfirm={async () => {
          if (!toDelete) return;
          try {
            await api.delete(`/question-banks/${toDelete.id}`);
            toast.success("Bank deleted");
            qc.invalidateQueries({ queryKey: ak.banks.all });
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </>
  );
}
