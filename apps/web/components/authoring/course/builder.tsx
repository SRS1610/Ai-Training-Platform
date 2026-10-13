"use client";

import {
  Badge,
  Breadcrumbs,
  Button,
  Card,
  CategoryBadge,
  ConfirmDialog,
  EmptyState,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
  colorClasses,
  colorFor,
  toast,
} from "@praxis/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  CheckCircle2,
  Clock,
  Eye,
  GitBranch,
  Layers,
  ListTree,
  MousePointerClick,
  Rocket,
  Settings2,
  Sparkles,
  Users,
  Wand2,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { ErrorState } from "@/components/common/error-state";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatMinutes, formatRelative } from "@/lib/format";
import { useSearchParamState } from "../hooks";
import { ak } from "../keys";
import { difficultyMeta } from "../meta";
import { AIBadge, AStatus, GradientHeader, InlineTitle } from "../shared";
import type { Course, Structure, StructureModule } from "../types";
import { AddLessonDialog } from "./add-lesson-dialog";
import { BuilderProvider } from "./builder-context";
import { CoursePreview } from "./course-preview";
import { LessonEditor } from "./lesson-editor";
import { CourseOutline } from "./outline";
import { PublishDialog } from "./publish";
import { CourseSettings } from "./settings";
import { VersionsPanel } from "./versions";

function BuilderSkeleton() {
  return (
    <div className="space-y-6" aria-busy aria-label="Loading course builder">
      <Skeleton className="h-36 rounded-3xl" />
      <Skeleton className="h-10 w-80" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-[520px] rounded-2xl" />
      </div>
    </div>
  );
}

function ChangesPill({ dirty, published }: { dirty: boolean; published: boolean }) {
  if (!published) return null;
  return dirty ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-200" role="status">
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full rounded-full bg-amber-400 opacity-75 motion-safe:animate-ping" aria-hidden />
        <span className="relative inline-flex size-2 rounded-full bg-amber-500" aria-hidden />
      </span>
      Unpublished changes
    </span>
  ) : (
    <Badge tone="success">
      <CheckCircle2 aria-hidden /> Up to date
    </Badge>
  );
}

function Welcome({ structure, onAddLesson }: { structure: Structure; onAddLesson: (m: StructureModule) => void }) {
  const lessons = structure.modules.flatMap((m) => m.lessons);
  const types = new Set(lessons.map((l) => l.lesson_type));
  const minutes = lessons.reduce((s, l) => s + (l.duration_minutes || 0), 0);
  const tiles = [
    { icon: ListTree, label: "Modules", value: structure.modules.length, color: "indigo" as const },
    { icon: Layers, label: "Lessons", value: lessons.length, color: "sky" as const },
    { icon: Clock, label: "Duration", value: formatMinutes(minutes), color: "violet" as const },
    { icon: MousePointerClick, label: "Formats", value: types.size, color: "fuchsia" as const },
  ];
  return (
    <Card className="overflow-hidden">
      <div className="relative bg-brand-gradient-soft p-6 sm:p-8">
        <div className="pointer-events-none absolute -right-10 -top-10 size-48 rounded-full bg-fuchsia-300/30 blur-3xl" aria-hidden />
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">Course builder</p>
        <h2 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900">Pick a lesson to start editing</h2>
        <p className="mt-1 max-w-xl text-sm text-slate-600">
          Drag modules and lessons to reorder them (keyboard: focus a handle, press space, then the arrow keys). Edits save automatically — learners only see changes after you publish.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tiles.map((t) => {
            const c = colorClasses(t.color);
            return (
              <div key={t.label} className="rounded-2xl bg-white/80 p-3 shadow-sm ring-1 ring-white">
                <t.icon className={cn("size-4", c.icon)} aria-hidden />
                <p className="mt-1 font-display text-xl font-bold text-slate-900">{t.value}</p>
                <p className="text-2xs font-semibold uppercase tracking-wider text-slate-500">{t.label}</p>
              </div>
            );
          })}
        </div>
        {structure.modules[0] && (
          <Button className="mt-5" variant="primary" onClick={() => onAddLesson(structure.modules[structure.modules.length - 1]!)}>
            Add a lesson
          </Button>
        )}
      </div>
    </Card>
  );
}

export function CourseBuilder({ courseId }: { courseId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [get, set] = useSearchParamState(searchParams, router.replace, pathname);
  const qc = useQueryClient();
  const { can } = useAuth();
  const tab = get("tab") ?? "content";
  const lessonId = get("lesson");
  const [addFor, setAddFor] = React.useState<StructureModule | null>(null);
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [previewOpen, setPreviewOpen] = React.useState(false);

  const q = useQuery({
    queryKey: ak.courses.structure(courseId),
    queryFn: ({ signal }) => api.get<Structure>(`/courses/${courseId}/structure`, { signal }),
  });
  const structure = q.data;
  const goToLesson = React.useCallback((id: string | null) => set({ lesson: id || null, tab: null }), [set]);
  // In-builder navigation (another lesson, another tab) unmounts the lesson editor. Pending valid edits are saved on
  // unmount, but edits held back as invalid (or a failed save) would be lost, so ask first.
  const leaveWarning = React.useRef<string | null>(null);
  const setLeaveWarning = React.useCallback((m: string | null) => {
    leaveWarning.current = m;
  }, []);
  const [pendingNav, setPendingNav] = React.useState<{ go: () => void; message: string } | null>(null);
  const guarded = React.useCallback((go: () => void) => {
    const message = leaveWarning.current;
    if (message) setPendingNav({ go, message });
    else go();
  }, []);
  const selectLesson = React.useCallback(
    (id: string | null) => {
      if ((id || null) === lessonId) return;
      guarded(() => goToLesson(id));
    },
    [guarded, goToLesson, lessonId],
  );

  if (q.isLoading) return <BuilderSkeleton />;
  if (q.isError || !structure) return <ErrorState error={q.error} onRetry={() => q.refetch()} size="lg" />;

  const course = structure.course;
  const cat = colorClasses(difficultyMeta(course.difficulty).color);
  const lesson = structure.modules.flatMap((m) => m.lessons).find((l) => l.id === lessonId) ?? null;
  const published = !!course.current_version_number;

  const rename = async (title: string) => {
    try {
      const out = await api.patch<Course>(`/courses/${courseId}`, { title });
      qc.setQueryData<Structure>(ak.courses.structure(courseId), (s) => (s ? { ...s, course: out, has_unpublished_changes: true } : s));
      toast.success("Course renamed");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <BuilderProvider courseId={courseId} structure={structure} selectLesson={selectLesson} setLeaveWarning={setLeaveWarning}>
      <div className="space-y-5">
        <Breadcrumbs
          linkComponent={Link}
          items={[{ label: "Courses", href: "/app/instructor/courses" }, { label: course.title }]}
        />
        <GradientHeader color={course.category ? colorFor(course.category) : "indigo"}>
          <div className="flex flex-col gap-4 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <span className="hidden size-14 shrink-0 place-items-center rounded-2xl bg-brand-gradient text-white shadow-glow sm:grid">
                <BookOpen className="size-7" aria-hidden />
              </span>
              <div className="min-w-0">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <AStatus status={course.status} size="sm" />
                  <ChangesPill dirty={structure.has_unpublished_changes} published={published} />
                  {course.category && <CategoryBadge category={course.category} size="sm" />}
                  <span className={cn("rounded-full px-2 py-0.5 text-2xs font-semibold ring-1 ring-inset", cat.soft, cat.text, cat.ring)}>{difficultyMeta(course.difficulty).label}</span>
                  {course.ai_generated && <AIBadge />}
                </div>
                <InlineTitle
                  value={course.title}
                  onCommit={rename}
                  disabled={!can("courses.edit")}
                  ariaLabel="Course title"
                  className="font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl"
                />
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <GitBranch className="size-3.5" aria-hidden />
                    {published ? `v${course.current_version_number} live · editing draft v${course.draft_version_number}` : `Draft v${course.draft_version_number}`}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Users className="size-3.5" aria-hidden />
                    {course.enrolment_count} enrolled
                  </span>
                  <span>Updated {formatRelative(course.updated_at)}</span>
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button variant="secondary" leftIcon={<Eye />} onClick={() => setPreviewOpen(true)}>
                Preview as learner
              </Button>
              {can("courses.create") && (
                <Button asChild variant="soft" leftIcon={<Wand2 />} className="hidden sm:inline-flex">
                  <Link href="/app/instructor/ai-builder">AI builder</Link>
                </Button>
              )}
              {can("courses.publish") && (
                <Button variant="gradient" leftIcon={<Rocket />} onClick={() => setPublishOpen(true)}>
                  Publish
                </Button>
              )}
            </div>
          </div>
        </GradientHeader>

        <Tabs value={tab} onValueChange={(v) => guarded(() => set({ tab: v === "content" ? null : v }))}>
          <TabsList variant="underline">
            <TabsTrigger value="content">
              <ListTree aria-hidden /> Content
            </TabsTrigger>
            <TabsTrigger value="settings">
              <Settings2 aria-hidden /> Settings
            </TabsTrigger>
            <TabsTrigger value="versions">
              <GitBranch aria-hidden /> Versions
              {published && <span className="rounded-full bg-violet-100 px-1.5 text-2xs font-bold text-violet-700">v{course.current_version_number}</span>}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="content">
            {structure.modules.length === 0 ? (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
                <CourseOutline structure={structure} selectedLessonId={null} onSelect={(id) => selectLesson(id || null)} onAddLesson={(mid) => setAddFor(structure.modules.find((m) => m.id === mid) ?? null)} />
                <Card className="p-6">
                  <EmptyState
                    illustration="rocket"
                    size="lg"
                    title="Let's build your course"
                    description="Start with a module (a week, a topic, a chapter), then add lessons in any of 16 formats — or let AI draft the whole structure for you to review."
                    action={
                      can("courses.create") ? (
                        <Button asChild variant="gradient" leftIcon={<Sparkles />}>
                          <Link href="/app/instructor/ai-builder">Draft it with AI</Link>
                        </Button>
                      ) : undefined
                    }
                  />
                </Card>
              </div>
            ) : (
              <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
                <aside className={cn("lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:pb-4 lg:pr-1 lg:scrollbar-thin", lesson && "hidden lg:block")} aria-label="Course outline">
                  <CourseOutline
                    structure={structure}
                    selectedLessonId={lesson?.id ?? null}
                    onSelect={(id) => selectLesson(id || null)}
                    onAddLesson={(mid) => setAddFor(structure.modules.find((m) => m.id === mid) ?? null)}
                  />
                </aside>
                <section className={cn("min-w-0", !lesson && "hidden lg:block")} aria-label="Lesson editor">
                  {lesson ? (
                    <LessonEditor key={lesson.id} lesson={lesson} modules={structure.modules} onBack={() => selectLesson(null)} />
                  ) : (
                    <Welcome structure={structure} onAddLesson={setAddFor} />
                  )}
                </section>
              </div>
            )}
          </TabsContent>
          <TabsContent value="settings">
            <CourseSettings key={course.id} course={course} />
          </TabsContent>
          <TabsContent value="versions">
            <VersionsPanel course={course} hasUnpublished={structure.has_unpublished_changes} />
          </TabsContent>
        </Tabs>
      </div>

      <AddLessonDialog open={!!addFor} onOpenChange={(o) => !o && setAddFor(null)} module={addFor} onCreated={(l) => selectLesson(l.id)} />
      <PublishDialog open={publishOpen} onOpenChange={setPublishOpen} structure={structure} onGoToLesson={(id) => selectLesson(id)} />
      <CoursePreview open={previewOpen} onOpenChange={setPreviewOpen} structure={structure} startLessonId={lesson?.id} />
      <ConfirmDialog
        open={!!pendingNav}
        onOpenChange={(o) => !o && setPendingNav(null)}
        destructive
        title="Leave this lesson without saving?"
        description={pendingNav?.message}
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        onConfirm={() => {
          const go = pendingNav?.go;
          leaveWarning.current = null;
          setPendingNav(null);
          go?.();
        }}
      />
    </BuilderProvider>
  );
}
