"use client";

import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Spinner, cn, toast } from "@praxis/ui";
import { Download, Eye, File, FileAudio, FileCode2, FileImage, FileText, FileVideo, ShieldCheck, ShieldQuestion, ShieldX } from "lucide-react";
import * as React from "react";
import { API_BASE, ApiError, errorMessage, api, refreshSession } from "@/lib/api";
import { getActiveOrgId } from "@/lib/org";
import type { FileRef } from "./types";

function iconFor(ct: string) {
  if (ct.startsWith("image/")) return FileImage;
  if (ct.startsWith("video/")) return FileVideo;
  if (ct.startsWith("audio/")) return FileAudio;
  if (ct.includes("pdf") || ct.startsWith("text/")) return FileText;
  if (ct.includes("json") || ct.includes("javascript") || ct.includes("x-python")) return FileCode2;
  return File;
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Fetch an authenticated file as a blob (keeps the org header + refresh behaviour of the API client). */
async function fetchBlob(fileId: string, retried = false): Promise<Blob> {
  const headers: Record<string, string> = {};
  const org = getActiveOrgId();
  if (org) headers["X-Organisation-Id"] = org;
  const res = await fetch(`${API_BASE}/files/${fileId}/download`, { credentials: "include", headers });
  if (res.status === 401 && !retried && (await refreshSession())) return fetchBlob(fileId, true);
  if (!res.ok) throw new ApiError(res.status, `http_${res.status}`, res.status === 403 ? "This file is blocked (scan failed)." : "Couldn't load the file.");
  return res.blob();
}

const PREVIEWABLE = (ct: string) => ct.startsWith("image/") || ct.startsWith("video/") || ct.startsWith("audio/") || ct.startsWith("text/") || ct.includes("json");

function ScanBadge({ status }: { status: string }) {
  if (status === "clean")
    return (
      <Badge tone="success" size="sm">
        <ShieldCheck aria-hidden /> Scanned
      </Badge>
    );
  if (status === "infected")
    return (
      <Badge tone="danger" size="sm">
        <ShieldX aria-hidden /> Blocked
      </Badge>
    );
  return (
    <Badge tone="neutral" size="sm">
      <ShieldQuestion aria-hidden /> {status === "pending" ? "Scan pending" : status}
    </Badge>
  );
}

function Preview({ file, onClose }: { file: FileRef; onClose: () => void }) {
  const [state, setState] = React.useState<{ url?: string; text?: string; error?: string }>({});
  React.useEffect(() => {
    let url: string | undefined;
    let cancelled = false;
    fetchBlob(file.id)
      .then(async (blob) => {
        if (cancelled) return;
        if (file.content_type.startsWith("text/") || file.content_type.includes("json")) {
          const text = await blob.text();
          if (!cancelled) setState({ text: text.slice(0, 200_000) });
        } else {
          url = URL.createObjectURL(blob);
          setState({ url });
        }
      })
      .catch((e) => !cancelled && setState({ error: errorMessage(e) }));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [file.id, file.content_type]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle className="truncate">{file.filename}</DialogTitle>
          <DialogDescription>
            {file.content_type} · {formatBytes(file.size_bytes)} · SHA-256 <span className="font-mono text-2xs">{file.sha256.slice(0, 12)}…</span>
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-48 place-items-center overflow-hidden rounded-2xl bg-slate-50 ring-1 ring-slate-200">
          {state.error ? (
            <p className="p-6 text-sm text-rose-700">{state.error}</p>
          ) : state.text !== undefined ? (
            <pre className="max-h-[60vh] w-full overflow-auto whitespace-pre-wrap p-4 font-mono text-xs text-slate-800">{state.text}</pre>
          ) : !state.url ? (
            <Spinner label="Loading preview" />
          ) : file.content_type.startsWith("image/") ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={state.url} alt={`Evidence: ${file.filename}`} className="max-h-[65vh] w-auto object-contain" />
          ) : file.content_type.startsWith("video/") ? (
            <video src={state.url} controls className="max-h-[65vh] w-full">
              <track kind="captions" />
            </video>
          ) : (
            <audio src={state.url} controls className="w-full max-w-md">
              <track kind="captions" />
            </audio>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function EvidenceFiles({ files, className }: { files: FileRef[]; className?: string }) {
  const [preview, setPreview] = React.useState<FileRef | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  if (!files.length) return <p className="text-sm text-muted-foreground">No files attached to this version.</p>;
  return (
    <>
      <ul className={cn("grid gap-2 sm:grid-cols-2", className)}>
        {files.map((f) => {
          const Icon = iconFor(f.content_type);
          const blocked = f.scan_status === "infected";
          return (
            <li key={f.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-sky-50 to-indigo-50 text-indigo-600 ring-1 ring-indigo-100">
                <Icon className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900" title={f.filename}>
                  {f.filename}
                </p>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-2xs text-slate-500">
                  <span>{formatBytes(f.size_bytes)}</span>
                  <ScanBadge status={f.scan_status} />
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                {PREVIEWABLE(f.content_type) && !blocked && (
                  <Button variant="ghost" size="icon-sm" aria-label={`Preview ${f.filename}`} onClick={() => setPreview(f)}>
                    <Eye />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Download ${f.filename}`}
                  disabled={blocked}
                  loading={busy === f.id}
                  onClick={async () => {
                    setBusy(f.id);
                    try {
                      await api.download(`/files/${f.id}/download`, { filename: f.filename });
                    } catch (e) {
                      toast.error(errorMessage(e));
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  <Download />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      {preview && <Preview file={preview} onClose={() => setPreview(null)} />}
    </>
  );
}
