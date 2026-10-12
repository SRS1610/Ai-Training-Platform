"use client";

import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FileDropzone,
  FormField,
  Input,
  SimpleSelect,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
} from "@praxis/ui";
import { useQueryClient } from "@tanstack/react-query";
import { BookPlus, FileUp, Globe, ScrollText } from "lucide-react";
import * as React from "react";
import { api, errorMessage } from "@/lib/api";
import { problemsMessage } from "../hooks";
import { ak } from "../keys";
import type { KnowledgeDocument } from "../types";
import { useCourseOptions } from "../use-options";

export type AddMode = "upload" | "url" | "text";

const ACCEPT = ".pdf,.docx,.pptx,.txt,.md";
const MAX = 50 * 1024 * 1024;

function ScopeFields({
  courseId,
  setCourseId,
  category,
  setCategory,
  options,
}: {
  courseId: string;
  setCourseId: (v: string) => void;
  category: string;
  setCategory: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <FormField label="Scope" hint="Course-scoped documents are only retrieved for that course's tutor.">
        {(aria) => <SimpleSelect {...aria} value={courseId} onValueChange={setCourseId} options={[{ value: "none", label: "Organisation-wide" }, ...options]} />}
      </FormField>
      <FormField label="Category" hint="e.g. policy, sop, manual">
        <Input value={category} onChange={(e) => setCategory(e.target.value)} maxLength={64} list="kb-categories" />
      </FormField>
      <datalist id="kb-categories">
        {["policy", "sop", "manual", "runbook", "faq", "glossary", "reference"].map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </div>
  );
}

/** Add knowledge: upload files (PDF/DOCX/PPTX/TXT/MD), a web page URL, or pasted text. */
export function AddKnowledgeDialog({ open, onOpenChange, mode, onModeChange, onAdded }: { open: boolean; onOpenChange: (o: boolean) => void; mode: AddMode; onModeChange: (m: AddMode) => void; onAdded?: (doc: KnowledgeDocument) => void }) {
  const qc = useQueryClient();
  const courses = useCourseOptions(open);
  const [courseId, setCourseId] = React.useState("none");
  const [category, setCategory] = React.useState("");
  const [files, setFiles] = React.useState<{ file: File; progress?: number; error?: string; done?: boolean }[]>([]);
  const [title, setTitle] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [text, setText] = React.useState("");
  const [format, setFormat] = React.useState("markdown");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setFiles([]);
      setTitle("");
      setUrl("");
      setText("");
      setFormat("markdown");
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const scope = () => ({ course_id: courseId === "none" ? null : courseId, category: category.trim() || null });
  const finish = (doc: KnowledgeDocument | null, msg: string) => {
    qc.invalidateQueries({ queryKey: ak.knowledge.all });
    toast.success(msg);
    if (doc) onAdded?.(doc);
    onOpenChange(false);
  };

  const submit = async () => {
    setError(null);
    if (mode === "upload") {
      const pending = files.filter((f) => !f.done);
      if (!pending.length) return setError("Choose at least one file");
      setBusy(true);
      let ok = 0;
      let last: KnowledgeDocument | null = null;
      for (let i = 0; i < files.length; i++) {
        const f = files[i]!;
        if (f.done) continue;
        try {
          const s = scope();
          last = await api.upload<KnowledgeDocument>(
            "/knowledge/documents/upload",
            {
              file: f.file,
              title: files.length === 1 && title.trim() ? title.trim() : undefined,
              course_id: s.course_id ?? undefined,
              category: s.category ?? undefined,
            },
            { onProgress: (p) => setFiles((prev) => prev.map((x, j) => (j === i ? { ...x, progress: p } : x))) },
          );
          ok++;
          setFiles((prev) => prev.map((x, j) => (j === i ? { ...x, done: true, progress: 100 } : x)));
        } catch (e) {
          setFiles((prev) => prev.map((x, j) => (j === i ? { ...x, error: errorMessage(e), progress: undefined } : x)));
        }
      }
      setBusy(false);
      qc.invalidateQueries({ queryKey: ak.knowledge.all });
      if (ok === pending.length) finish(ok === 1 ? last : null, ok === 1 ? "Uploaded — indexing has started" : `${ok} documents uploaded — indexing has started`);
      else if (ok) setError(`${ok} uploaded, ${pending.length - ok} failed — see the errors above.`);
      else setError("Nothing was uploaded — see the errors above.");
      return;
    }
    if (mode === "url") {
      if (!/^https?:\/\/\S+\.\S+/i.test(url.trim())) return setError("Enter a full http(s) link");
      setBusy(true);
      try {
        const doc = await api.post<KnowledgeDocument>("/knowledge/documents/url", { url: url.trim(), title: title.trim() || null, ...scope() });
        finish(doc, "Page added — fetching and indexing now");
      } catch (e) {
        setError(problemsMessage(e));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!title.trim()) return setError("Give the document a title");
    if (!text.trim()) return setError("Paste some text to index");
    setBusy(true);
    try {
      const doc = await api.post<KnowledgeDocument>("/knowledge/documents/text", { title: title.trim(), text, format, ...scope() });
      finish(doc, "Text added — indexing now");
    } catch (e) {
      setError(problemsMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent size="lg">
        <DialogHeader>
          <span className="mb-1 grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-teal-400 to-emerald-500 text-white shadow-glow">
            <BookPlus className="size-5" aria-hidden />
          </span>
          <DialogTitle>Add to the knowledge base</DialogTitle>
          <DialogDescription>Documents are split into searchable chunks. The AI tutor cites them in answers once they&apos;re ready.</DialogDescription>
        </DialogHeader>
        <Tabs value={mode} onValueChange={(v) => onModeChange(v as AddMode)}>
          <TabsList className="w-full">
            <TabsTrigger value="upload" className="flex-1">
              <FileUp aria-hidden /> Upload
            </TabsTrigger>
            <TabsTrigger value="url" className="flex-1">
              <Globe aria-hidden /> Web page
            </TabsTrigger>
            <TabsTrigger value="text" className="flex-1">
              <ScrollText aria-hidden /> Paste text
            </TabsTrigger>
          </TabsList>
          <TabsContent value="upload" className="space-y-4">
            <FileDropzone
              multiple
              accept={ACCEPT}
              maxSize={MAX}
              disabled={busy}
              label="Drop PDF, Word, PowerPoint, text or Markdown files — or browse"
              hint="Up to 50 MB each. Scanned PDFs need selectable text."
              files={files.map((f) => ({ name: f.file.name, size: f.file.size, progress: f.done ? 100 : f.progress, error: f.error }))}
              onFiles={(list) => setFiles((prev) => [...prev, ...list.map((file) => ({ file }))])}
              onRemove={(i) => setFiles((prev) => prev.filter((_, j) => j !== i))}
            />
            {files.length === 1 && (
              <FormField label="Title" hint="Defaults to the file name.">
                <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={255} />
              </FormField>
            )}
          </TabsContent>
          <TabsContent value="url" className="space-y-4">
            <FormField label="Page URL" required hint="Public pages only — private and internal network addresses are blocked for safety.">
              <Input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://support.example.com/articles/reset-mfa" leftIcon={<Globe />} />
            </FormField>
            <FormField label="Title" hint="Optional — defaults to the page address.">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={255} />
            </FormField>
          </TabsContent>
          <TabsContent value="text" className="space-y-4">
            <FormField label="Title" required>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={255} placeholder="e.g. Password reset policy" />
            </FormField>
            <FormField label="Content" required hint={`${text.length.toLocaleString()} characters`}>
              <Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste a policy, FAQ, runbook… Markdown headings become chunk headings." className="font-mono text-xs" />
            </FormField>
            <FormField label="Format">
              {(aria) => (
                <SimpleSelect
                  {...aria}
                  value={format}
                  onValueChange={setFormat}
                  options={[
                    { value: "markdown", label: "Markdown (headings split sections)" },
                    { value: "text", label: "Plain text" },
                  ]}
                />
              )}
            </FormField>
          </TabsContent>
        </Tabs>
        <ScopeFields courseId={courseId} setCourseId={setCourseId} category={category} setCategory={setCategory} options={courses.options} />
        {error && <Alert tone="danger">{error}</Alert>}
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="gradient" loading={busy} onClick={() => void submit()} leftIcon={<BookPlus />}>
            {mode === "upload" ? `Upload${files.filter((f) => !f.done).length > 1 ? ` ${files.filter((f) => !f.done).length} files` : ""}` : mode === "url" ? "Add page" : "Add text"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
