"use client";

import {
  Alert,
  Button,
  ConfirmDialog,
  FormField,
  Input,
  PageHeader,
  RadioCard,
  RadioGroup,
  Skeleton,
  StatusPill,
  Textarea,
  toast,
} from "@praxis/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, FileEdit, Globe2, Layers, Save, Trash2, UsersRound } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import * as React from "react";
import { ak } from "@/components/admin/keys";
import { PathEnrolDialog, PathItemsEditor } from "@/components/admin/learning-paths";
import type { PathOut } from "@/components/admin/types";
import { PageGate, SectionCard, toastError } from "@/components/admin/ui";
import { ErrorState } from "@/components/common/error-state";
import { api, ApiError, errorMessage } from "@/lib/api";
import { formatRelative } from "@/lib/format";

function PathEditor() {
  const { pathId } = useParams<{ pathId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  // Once deleted, stop the detail query so leaving the page never refetches a 404.
  const [deleted, setDeleted] = React.useState(false);
  const q = useQuery({ queryKey: ak.paths.detail(pathId), queryFn: ({ signal }) => api.get<PathOut>(`/learning-paths/${pathId}`, { signal }), enabled: !deleted });
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [status, setStatus] = React.useState("draft");
  const [enrol, setEnrol] = React.useState(false);
  const [del, setDel] = React.useState(false);

  React.useEffect(() => {
    if (q.data) {
      setTitle(q.data.title);
      setDescription(q.data.description ?? "");
      setStatus(q.data.status);
    }
  }, [q.data]);

  const save = useMutation({
    mutationFn: () => api.patch<PathOut>(`/learning-paths/${pathId}`, { title: title.trim(), description: description.trim() || null, status }),
    onSuccess: (p) => {
      toast.success(p.status === "published" && q.data?.status !== "published" ? "Learning path published" : "Details saved");
      qc.setQueryData(ak.paths.detail(pathId), p);
      qc.invalidateQueries({ queryKey: ak.paths.all });
    },
  });

  if (q.isLoading || (!q.data && !q.isError))
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-80" />
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Skeleton className="h-[28rem] rounded-2xl xl:col-span-2" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      </div>
    );
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} size="lg" title={q.error instanceof ApiError && q.error.isNotFound ? "Learning path not found" : undefined} />;
  const p = q.data!;
  const dirty = title !== p.title || description !== (p.description ?? "") || status !== p.status;

  return (
    <>
      <PageHeader
        title={p.title}
        description={`${p.items.length} course${p.items.length === 1 ? "" : "s"} · ${p.enrolled_users} learner${p.enrolled_users === 1 ? "" : "s"} enrolled · updated ${formatRelative(p.updated_at)}`}
        breadcrumbs={[{ label: "Learning paths", href: "/app/admin/learning-paths" }, { label: p.title }]}
        linkComponent={Link}
        actions={
          <>
            <StatusPill status={p.status} />
            <Button variant="gradient" leftIcon={<UsersRound />} onClick={() => setEnrol(true)} disabled={p.status !== "published"}>
              Enrol learners
            </Button>
          </>
        }
      />
      {p.status !== "published" && (
        <Alert tone="info" title="This path is a draft" className="mb-6">
          Publish it (in Details) before enrolling learners. Learners only see published paths.
        </Alert>
      )}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <PathItemsEditor path={p} onSaved={() => { qc.invalidateQueries({ queryKey: ak.paths.all }); }} />
        </div>
        <div className="space-y-6">
          <SectionCard title="Details" icon={Layers} color="emerald">
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (title.trim()) save.mutate();
              }}
            >
              <FormField label="Title" required>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={255} />
              </FormField>
              <FormField label="Description">
                <Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={10000} />
              </FormField>
              <fieldset>
                <legend className="mb-2 text-sm font-medium text-slate-800">Status</legend>
                <RadioGroup value={status} onValueChange={setStatus} className="gap-2">
                  <RadioCard value="draft" title="Draft" description="Only admins can see it." icon={<FileEdit />} />
                  <RadioCard value="published" title="Published" description="Learners can join; you can enrol people." icon={<Globe2 />} />
                  <RadioCard value="archived" title="Archived" description="Hidden; existing progress is kept." icon={<Archive />} />
                </RadioGroup>
              </fieldset>
              {save.isError && (
                <Alert tone="danger" title="Couldn't save">
                  {errorMessage(save.error)}
                </Alert>
              )}
              <Button type="submit" block leftIcon={<Save />} loading={save.isPending} disabled={!dirty || !title.trim()}>
                Save details
              </Button>
            </form>
          </SectionCard>
          <div className="rounded-2xl border border-rose-200 bg-rose-50/50 p-5">
            <h2 className="font-display font-semibold text-rose-900">Delete learning path</h2>
            <p className="mt-1 text-sm text-rose-800">Learners keep their course enrolments and progress; the path grouping is removed.</p>
            <Button variant="destructive-soft" leftIcon={<Trash2 />} className="mt-3" onClick={() => setDel(true)}>
              Delete path
            </Button>
          </div>
        </div>
      </div>
      <PathEnrolDialog path={p} open={enrol} onOpenChange={setEnrol} />
      <ConfirmDialog
        open={del}
        onOpenChange={setDel}
        destructive
        title={`Delete “${p.title}”?`}
        description="This can't be undone. Course enrolments created through the path are kept."
        confirmText={p.enrolled_users > 0 ? "DELETE" : undefined}
        confirmLabel="Delete path"
        onConfirm={async () => {
          try {
            await api.delete(`/learning-paths/${p.id}`);
            setDeleted(true);
            router.push("/app/admin/learning-paths");
            qc.removeQueries({ queryKey: ak.paths.detail(p.id) });
            qc.invalidateQueries({ queryKey: ak.paths.all, refetchType: "none" });
            toast.success("Learning path deleted");
          } catch (e) {
            toastError(e);
          }
        }}
      />
    </>
  );
}

export default function Page() {
  return (
    <PageGate permission="enrolments.manage">
      <PathEditor />
    </PageGate>
  );
}
