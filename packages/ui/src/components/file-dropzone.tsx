"use client";

import { FileText, UploadCloud, X } from "lucide-react";
import * as React from "react";
import { cn } from "../lib/cn";
import { Progress } from "./progress";

export interface FileDropzoneProps {
  onFiles: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  /** Max size per file in bytes. */
  maxSize?: number;
  disabled?: boolean;
  className?: string;
  label?: React.ReactNode;
  hint?: React.ReactNode;
  /** Files currently queued/uploading, for display. */
  files?: { name: string; size: number; progress?: number; error?: string }[];
  onRemove?: (index: number) => void;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/** Drag-and-drop + click file picker (keyboard accessible). Validates type/size client-side. */
export function FileDropzone({
  onFiles,
  accept,
  multiple,
  maxSize,
  disabled,
  className,
  label = "Drag & drop files here, or browse",
  hint,
  files,
  onRemove,
}: FileDropzoneProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [drag, setDrag] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const hintId = React.useId();

  const accepts = (f: File) => {
    if (!accept) return true;
    return accept.split(",").some((a) => {
      const t = a.trim().toLowerCase();
      if (t.startsWith(".")) return f.name.toLowerCase().endsWith(t);
      if (t.endsWith("/*")) return f.type.startsWith(t.slice(0, -1));
      return f.type === t;
    });
  };

  const handle = (list: FileList | null) => {
    if (!list) return;
    const arr = Array.from(list);
    const bad = arr.find((f) => !accepts(f));
    if (bad) return setError(`${bad.name}: file type not allowed`);
    const big = maxSize ? arr.find((f) => f.size > maxSize) : undefined;
    if (big) return setError(`${big.name} is larger than ${formatBytes(maxSize!)}`);
    setError(null);
    onFiles(multiple ? arr : arr.slice(0, 1));
  };

  return (
    <div className={cn("space-y-3", className)}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-describedby={hintId}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !disabled) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (!disabled) handle(e.dataTransfer.files);
        }}
        className={cn(
          "group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-all focus-visible:focus-ring",
          drag ? "border-brand-500 bg-brand-50" : "border-slate-300 bg-gradient-to-b from-slate-50 to-white hover:border-brand-400 hover:bg-brand-50/40",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <span className="grid size-12 place-items-center rounded-2xl bg-brand-gradient text-white shadow-glow transition-transform group-hover:-translate-y-0.5">
          <UploadCloud className="size-6" aria-hidden />
        </span>
        <p className="text-sm font-semibold text-slate-800">{label}</p>
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint ?? [accept && `Accepted: ${accept}`, maxSize && `Max ${formatBytes(maxSize)}`].filter(Boolean).join(" · ")}
        </p>
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          tabIndex={-1}
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          onChange={(e) => {
            handle(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {error && (
        <p role="alert" className="text-xs font-medium text-rose-700">
          {error}
        </p>
      )}
      {files && files.length > 0 && (
        <ul className="space-y-2">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
              <span className="grid size-9 place-items-center rounded-lg bg-sky-50 text-sky-600">
                <FileText className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800">{f.name}</p>
                {f.error ? (
                  <p className="text-xs text-rose-700">{f.error}</p>
                ) : f.progress !== undefined && f.progress < 100 ? (
                  <Progress value={f.progress} size="xs" className="mt-1.5" aria-label={`Uploading ${f.name}`} />
                ) : (
                  <p className="text-xs text-muted-foreground">{formatBytes(f.size)}</p>
                )}
              </div>
              {onRemove && (
                <button type="button" onClick={() => onRemove(i)} className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:focus-ring" aria-label={`Remove ${f.name}`}>
                  <X className="size-4" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
