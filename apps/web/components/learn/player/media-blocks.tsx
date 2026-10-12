"use client";

import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogTitle, cn, formatBytes, toast } from "@praxis/ui";
import { useQuery } from "@tanstack/react-query";
import { AudioLines, Captions, Download, ExternalLink, FileText, Film, Maximize2, Presentation, ScrollText } from "lucide-react";
import * as React from "react";
import { Markdown } from "@/components/common/markdown";
import { api, errorMessage } from "@/lib/api";
import type { FileOut } from "../types";
import { fileNameFromUrl, isPlaceholderUrl, mediaSrc, str, videoEmbedUrl } from "./media";

type Content = Record<string, unknown>;

/* ------------------------------------------------------------------ transcript */

const TS_LINE = /^\s*\[?(\d{1,2}):(\d{2})(?::(\d{2}))?\]?\s*[-–—:]?\s*(.*)$/;

function parseTranscript(text: string): { t: number | null; text: string }[] {
  return text
    .split(/\n+/)
    .map((line) => {
      const m = line.match(TS_LINE);
      if (!m) return { t: null, text: line };
      const [, a, b, c, rest] = m;
      const secs = c ? Number(a) * 3600 + Number(b) * 60 + Number(c) : Number(a) * 60 + Number(b);
      return { t: secs, text: rest ?? "" };
    })
    .filter((l) => l.text.trim());
}

export function TranscriptPanel({ transcript, onSeek, defaultOpen = false }: { transcript: string; onSeek?: (secs: number) => void; defaultOpen?: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen);
  const lines = React.useMemo(() => parseTranscript(transcript), [transcript]);
  const timed = lines.some((l) => l.t !== null);
  const id = React.useId();
  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold text-slate-800 transition hover:bg-slate-50 focus-visible:focus-ring"
      >
        <span className="grid size-8 place-items-center rounded-lg bg-sky-50 text-sky-600">
          <ScrollText className="size-4" aria-hidden />
        </span>
        <span className="flex-1">Transcript</span>
        <span className="text-xs font-medium text-brand-700">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div id={id} className="max-h-80 overflow-y-auto border-t border-slate-100 px-4 py-3 scrollbar-thin">
          {timed ? (
            <ol className="space-y-1.5">
              {lines.map((l, i) => (
                <li key={i} className="flex gap-3 text-sm leading-relaxed text-slate-700">
                  {l.t !== null && !onSeek ? (
                    <span className="shrink-0 rounded-md bg-slate-100 px-1.5 font-mono text-xs font-semibold text-slate-600">
                      {Math.floor(l.t / 60)}:{String(l.t % 60).padStart(2, "0")}
                    </span>
                  ) : null}
                  {l.t !== null && onSeek ? (
                    <button
                      type="button"
                      onClick={() => onSeek(l.t!)}
                      className="shrink-0 rounded-md bg-sky-50 px-1.5 font-mono text-xs font-semibold text-sky-700 hover:bg-sky-100 focus-visible:focus-ring"
                      aria-label={`Jump to ${Math.floor(l.t / 60)}:${String(l.t % 60).padStart(2, "0")}`}
                    >
                      {Math.floor(l.t / 60)}:{String(l.t % 60).padStart(2, "0")}
                    </button>
                  ) : null}
                  <span>{l.text}</span>
                </li>
              ))}
            </ol>
          ) : (
            <Markdown className="text-sm">{transcript}</Markdown>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ placeholders */

function MediaPlaceholder({ kind, title, reason }: { kind: "video" | "audio"; title?: string; reason: string }) {
  const Icon = kind === "video" ? Film : AudioLines;
  return (
    <div
      role="img"
      aria-label={`${kind === "video" ? "Video" : "Audio"} placeholder: ${reason}`}
      className={cn(
        "relative grid place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-indigo-950 to-violet-950 text-center text-white",
        kind === "video" ? "aspect-video" : "h-40",
      )}
    >
      <div className="pointer-events-none absolute -right-10 -top-10 size-48 rounded-full bg-fuchsia-500/25 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -bottom-12 left-6 size-48 rounded-full bg-sky-500/20 blur-3xl" aria-hidden />
      <div className="relative px-6">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-white/10 ring-1 ring-white/25">
          <Icon className="size-6" aria-hidden />
        </span>
        <p className="mt-3 font-display text-base font-semibold">{title ?? (kind === "video" ? "Video coming soon" : "Audio coming soon")}</p>
        <p className="mt-1 text-sm text-indigo-100">{reason}</p>
      </div>
      <Badge tone="warning" size="sm" className="absolute left-3 top-3">
        Placeholder
      </Badge>
    </div>
  );
}

/* ------------------------------------------------------------------ video */

export function VideoBlock({
  content,
  startAt,
  onPosition,
  title,
}: {
  content: Content;
  startAt?: number;
  onPosition?: (p: Record<string, unknown>) => void;
  title?: string;
}) {
  const src = mediaSrc(content, "video_url");
  const embed = videoEmbedUrl(str(content.video_url));
  const captions = str(content.captions_url);
  const poster = str(content.poster_url);
  const transcript = str(content.transcript);
  const ref = React.useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = React.useState(false);
  const placeholder = !embed && (isPlaceholderUrl(str(content.video_url), content) && !str(content.file_id));
  const seek = (s: number) => {
    if (ref.current) {
      ref.current.currentTime = s;
      void ref.current.play().catch(() => undefined);
    }
  };
  return (
    <figure>
      {embed ? (
        <div className="aspect-video overflow-hidden rounded-2xl bg-slate-900 shadow-lift">
          <iframe
            src={embed}
            title={title ?? "Lesson video"}
            className="size-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      ) : placeholder || failed || !src ? (
        <MediaPlaceholder kind="video" reason={failed ? "This video couldn't be loaded. Use the transcript below while it's fixed." : "The final recording hasn't been uploaded yet — the transcript covers the content."} />
      ) : (
        <div className="overflow-hidden rounded-2xl bg-slate-950 shadow-lift">
          <video
            ref={ref}
            controls
            preload="metadata"
            poster={poster}
            className="aspect-video w-full"
            src={src}
            onError={() => setFailed(true)}
            onLoadedMetadata={(e) => {
              if (startAt && startAt > 5 && startAt < e.currentTarget.duration - 5) e.currentTarget.currentTime = startAt;
            }}
            onTimeUpdate={(e) => onPosition?.({ video_seconds: Math.floor(e.currentTarget.currentTime) })}
          >
            <track kind="captions" src={captions} srcLang={str(content.captions_lang) ?? "en"} label={str(content.captions_label) ?? "English"} default={!!captions} />
            Your browser does not support HTML5 video.
          </video>
        </div>
      )}
      <figcaption className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        {captions && !placeholder && !failed && !embed && (
          <span className="inline-flex items-center gap-1">
            <Captions className="size-3.5" aria-hidden /> Captions available
          </span>
        )}
        {str(content.caption)}
      </figcaption>
      {transcript && <TranscriptPanel transcript={transcript} onSeek={!embed && !placeholder && !failed ? seek : undefined} defaultOpen={placeholder || failed} />}
    </figure>
  );
}

/* ------------------------------------------------------------------ audio */

export function AudioBlock({ content, onPosition }: { content: Content; onPosition?: (p: Record<string, unknown>) => void }) {
  const src = mediaSrc(content, "audio_url");
  const transcript = str(content.transcript);
  const ref = React.useRef<HTMLAudioElement>(null);
  const [failed, setFailed] = React.useState(false);
  const placeholder = isPlaceholderUrl(str(content.audio_url), content) && !str(content.file_id);
  return (
    <figure>
      {placeholder || failed || !src ? (
        <MediaPlaceholder kind="audio" reason={failed ? "This audio couldn't be loaded." : "The recording hasn't been uploaded yet."} />
      ) : (
        <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-br from-orange-50 via-rose-50 to-fuchsia-50 p-4 ring-1 ring-orange-100 sm:p-5">
          <span className="hidden size-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-orange-400 to-rose-500 text-white shadow-sm sm:grid">
            <AudioLines className="size-7" aria-hidden />
          </span>
          <audio
            ref={ref}
            controls
            preload="metadata"
            src={src}
            className="w-full"
            onError={() => setFailed(true)}
            onTimeUpdate={(e) => onPosition?.({ audio_seconds: Math.floor(e.currentTarget.currentTime) })}
          >
            <track kind="captions" />
          </audio>
        </div>
      )}
      {transcript && (
        <TranscriptPanel
          transcript={transcript}
          defaultOpen={placeholder || failed}
          onSeek={
            placeholder || failed
              ? undefined
              : (s) => {
                  if (ref.current) {
                    ref.current.currentTime = s;
                    void ref.current.play().catch(() => undefined);
                  }
                }
          }
        />
      )}
    </figure>
  );
}

/* ------------------------------------------------------------------ documents (pdf / slides / files) */

export function DocumentBlock({ content, kind = "pdf" }: { content: Content; kind?: "pdf" | "powerpoint" | "file" }) {
  const fileId = str(content.file_id);
  const url = str(content.url);
  const embed = videoEmbedUrl(str(content.embed_url));
  const meta = useQuery({
    queryKey: ["files", fileId],
    queryFn: ({ signal }) => api.get<FileOut>(`/files/${fileId}`, { signal }),
    enabled: !!fileId,
    staleTime: 300_000,
  });
  const href = url ?? (fileId ? `/api/v1/files/${fileId}/download` : undefined);
  const name = meta.data?.filename ?? str(content.title) ?? fileNameFromUrl(url, kind === "powerpoint" ? "Slide deck" : "Document");
  const [busy, setBusy] = React.useState(false);
  const Icon = kind === "powerpoint" ? Presentation : FileText;
  const grad = kind === "powerpoint" ? "from-orange-400 to-rose-500" : kind === "pdf" ? "from-rose-500 to-pink-500" : "from-sky-400 to-blue-500";
  const placeholder = !fileId && isPlaceholderUrl(url, content);

  const download = async () => {
    if (!fileId) return;
    setBusy(true);
    try {
      await api.download(`/files/${fileId}/download`, { filename: meta.data?.filename });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {embed && (
        <div className="aspect-video overflow-hidden rounded-2xl bg-slate-900 shadow-lift">
          <iframe src={embed} title={name} className="size-full" allowFullScreen />
        </div>
      )}
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-white p-5 sm:p-6">
        <div className="pointer-events-none absolute -right-12 -top-12 size-40 rounded-full bg-gradient-to-br from-rose-200/40 to-fuchsia-200/40 blur-2xl" aria-hidden />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className="relative mx-auto h-36 w-28 shrink-0 sm:mx-0" aria-hidden>
            <div className="absolute inset-0 translate-x-2 translate-y-2 rotate-3 rounded-xl bg-slate-200" />
            <div className="absolute inset-0 flex flex-col rounded-xl border border-slate-200 bg-white p-3 shadow-lift">
              <span className={cn("grid size-9 place-items-center rounded-lg bg-gradient-to-br text-white", grad)}>
                <Icon className="size-5" />
              </span>
              <span className="mt-3 h-1.5 w-full rounded bg-slate-200" />
              <span className="mt-1.5 h-1.5 w-4/5 rounded bg-slate-200" />
              <span className="mt-1.5 h-1.5 w-full rounded bg-slate-100" />
              <span className="mt-1.5 h-1.5 w-3/5 rounded bg-slate-100" />
              <span className="mt-auto text-2xs font-bold uppercase text-slate-400">{kind === "powerpoint" ? "PPT" : kind === "pdf" ? "PDF" : "FILE"}</span>
            </div>
          </div>
          <div className="min-w-0 flex-1 text-center sm:text-left">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{kind === "powerpoint" ? "Slide deck" : kind === "pdf" ? "PDF document" : "Resource"}</p>
            <p className="mt-1 break-words font-display text-lg font-semibold text-slate-900">{name}</p>
            {meta.data && (
              <p className="mt-0.5 text-xs text-slate-500">
                {formatBytes(meta.data.size_bytes)} · {meta.data.content_type}
              </p>
            )}
            {placeholder ? (
              <p className="mt-3 text-sm text-amber-800">This document is a placeholder — the instructor hasn&apos;t attached the final file yet.</p>
            ) : (
              <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
                {href && (
                  <Button asChild variant="primary" leftIcon={<ExternalLink />}>
                    <a href={href} target="_blank" rel="noopener noreferrer">
                      Open {kind === "powerpoint" ? "slides" : "document"}
                    </a>
                  </Button>
                )}
                {fileId ? (
                  <Button variant="secondary" leftIcon={<Download />} onClick={download} loading={busy}>
                    Download
                  </Button>
                ) : null}
              </div>
            )}
            {!placeholder && <p className="mt-3 text-xs text-slate-500">Opens in a new tab · your progress here is saved.</p>}
          </div>
        </div>
      </div>
      {str(content.body_markdown) && <Markdown>{str(content.body_markdown)!}</Markdown>}
    </div>
  );
}

/* ------------------------------------------------------------------ images / infographics */

export function ImageBlock({ content, title }: { content: Content; title?: string }) {
  const src = mediaSrc(content, "image_url");
  const alt = str(content.alt_text) ?? "";
  const caption = str(content.caption);
  const [zoom, setZoom] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const placeholder = !str(content.file_id) && isPlaceholderUrl(str(content.image_url), content);
  return (
    <figure className="space-y-4">
      {!src || failed || placeholder ? (
        <div role="img" aria-label={alt || "Image placeholder"} className="grid aspect-[16/9] place-items-center rounded-2xl bg-gradient-to-br from-teal-50 via-sky-50 to-indigo-50 text-center ring-1 ring-slate-200">
          <div className="px-6">
            <p className="font-display text-base font-semibold text-slate-800">{alt || "Image"}</p>
            <p className="mt-1 text-sm text-slate-600">{failed ? "This image couldn't be loaded." : "Image placeholder — the final visual hasn't been uploaded yet."}</p>
          </div>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setZoom(true)}
            className="group relative block w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 focus-visible:focus-ring"
            aria-label={`Enlarge image${alt ? `: ${alt}` : ""}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={alt} className="mx-auto max-h-[70vh] w-auto object-contain" onError={() => setFailed(true)} />
            <span className="absolute right-3 top-3 grid size-9 place-items-center rounded-xl bg-white/90 text-slate-700 opacity-0 shadow-soft transition group-hover:opacity-100 group-focus-visible:opacity-100">
              <Maximize2 className="size-4" aria-hidden />
            </span>
          </button>
          <Dialog open={zoom} onOpenChange={setZoom}>
            <DialogContent size="xl" className="p-3 sm:p-4">
              <DialogTitle className="sr-only">{title ?? alt ?? "Image"}</DialogTitle>
              <DialogDescription className="sr-only">{caption ?? alt}</DialogDescription>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={alt} className="max-h-[80vh] w-full rounded-2xl object-contain" />
            </DialogContent>
          </Dialog>
        </>
      )}
      {caption && <figcaption className="text-center text-sm text-slate-500">{caption}</figcaption>}
      {str(content.body_markdown) && <Markdown>{str(content.body_markdown)!}</Markdown>}
    </figure>
  );
}
