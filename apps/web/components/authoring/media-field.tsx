"use client";

import { Button, FormField, Input, Progress, cn, formatBytes, toast } from "@praxis/ui";
import { CheckCircle2, Link as LinkIcon, Loader2, UploadCloud, X } from "lucide-react";
import * as React from "react";
import { api, errorMessage } from "@/lib/api";
import type { FileOut } from "./types";

/** Upload a file to POST /files and report progress. */
export function useUpload(purpose = "lesson_media") {
  const [progress, setProgress] = React.useState<number | null>(null);
  const [name, setName] = React.useState<string | null>(null);
  const upload = React.useCallback(
    async (file: File): Promise<FileOut | null> => {
      setName(file.name);
      setProgress(0);
      try {
        const out = await api.upload<FileOut>("/files", { file, purpose }, { onProgress: setProgress });
        toast.success(`Uploaded ${file.name}`);
        return out;
      } catch (e) {
        toast.error(errorMessage(e));
        return null;
      } finally {
        setProgress(null);
      }
    },
    [purpose],
  );
  return { upload, progress, name, uploading: progress !== null };
}

/**
 * URL-or-upload field for lesson media. Uploads go to `POST /files` (purpose `lesson_media`);
 * the stored file's download path becomes the URL and `file_id` is kept alongside.
 */
export function MediaField({
  label,
  url,
  fileId,
  onChange,
  accept,
  hint,
  required,
  urlPlaceholder = "https://…",
  error,
}: {
  label: string;
  url: string;
  fileId?: string | null;
  onChange: (next: { url: string; file_id: string | null; filename?: string }) => void;
  accept: string;
  hint?: React.ReactNode;
  required?: boolean;
  urlPlaceholder?: string;
  error?: string | null;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const { upload, progress, name, uploading } = useUpload();
  const [drag, setDrag] = React.useState(false);

  const handle = async (file: File | undefined) => {
    if (!file) return;
    const out = await upload(file);
    if (out) onChange({ url: out.download_url, file_id: out.id, filename: out.filename });
  };

  return (
    <FormField label={label} hint={hint} required={required} error={error}>
      {(aria) => (
        <div
          className={cn(
            "rounded-2xl border-2 border-dashed p-3 transition-colors",
            drag ? "border-brand-400 bg-brand-50/60" : "border-slate-200 bg-slate-50/50",
          )}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            void handle(e.dataTransfer.files?.[0]);
          }}
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="min-w-0 flex-1">
              <Input
                {...aria}
                inputSize="sm"
                leftIcon={<LinkIcon />}
                value={url}
                placeholder={urlPlaceholder}
                onChange={(e) => onChange({ url: e.target.value, file_id: null })}
              />
            </div>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={uploading ? <Loader2 className="animate-spin" /> : <UploadCloud />}
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? "Uploading…" : "Upload file"}
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept={accept}
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => {
                void handle(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
          {uploading && (
            <div className="mt-2.5 space-y-1" aria-live="polite">
              <p className="truncate text-xs text-slate-600">Uploading {name}… {progress}%</p>
              <Progress value={progress ?? 0} size="xs" aria-label={`Uploading ${name}`} />
            </div>
          )}
          {!uploading && fileId && (
            <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-700">
              <CheckCircle2 className="size-3.5" aria-hidden />
              Uploaded file attached
              <button
                type="button"
                className="ml-1 inline-flex items-center gap-0.5 rounded text-slate-500 hover:text-rose-700 focus-visible:focus-ring"
                onClick={() => onChange({ url: "", file_id: null })}
              >
                <X className="size-3" aria-hidden /> Remove
              </button>
            </p>
          )}
          {!uploading && !fileId && (
            <p className="mt-2 text-2xs text-slate-500">Paste a link or drop a file here ({accept.replaceAll(",", ", ")}) · max 50 MB</p>
          )}
        </div>
      )}
    </FormField>
  );
}

export { formatBytes };
