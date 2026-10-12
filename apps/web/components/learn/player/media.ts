/** URL helpers for lesson media (uploaded files, placeholders, allowed embeds). */

export function fileDownloadUrl(fileId: string): string {
  return `/api/v1/files/${encodeURIComponent(fileId)}/download`;
}

export function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

/** Media source for a lesson/activity: explicit URL, else the uploaded file. */
export function mediaSrc(content: Record<string, unknown>, urlKey: string): string | undefined {
  const url = str(content[urlKey]);
  if (url) return url;
  const fid = str(content.file_id);
  return fid ? fileDownloadUrl(fid) : undefined;
}

const PLACEHOLDER_HOSTS = /(^|\.)(example\.(com|org|net)|placeholder\.[a-z]+|placehold\.co|dummyimage\.com|test)$/i;

/** True for obviously fake/demo URLs that will not play. */
export function isPlaceholderUrl(url: string | undefined, content?: Record<string, unknown>): boolean {
  if (content?.placeholder === true) return true;
  if (!url) return true;
  if (/placeholder|lorem|todo/i.test(url)) return true;
  try {
    const u = new URL(url, "http://localhost");
    if (u.origin === "http://localhost") return false;
    return PLACEHOLDER_HOSTS.test(u.hostname);
  } catch {
    return true;
  }
}

/** YouTube / Vimeo URL → privacy-friendly embed URL (the only third-party frames the CSP allows). */
export function videoEmbedUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") return `https://www.youtube-nocookie.com/embed/${u.pathname.slice(1)}`;
    if (host.endsWith("youtube.com") || host === "youtube-nocookie.com") {
      if (u.pathname.startsWith("/embed/")) return `https://www.youtube-nocookie.com${u.pathname}`;
      const v = u.searchParams.get("v");
      if (v) return `https://www.youtube-nocookie.com/embed/${v}`;
    }
    if (host === "vimeo.com") {
      const id = u.pathname.split("/").filter(Boolean)[0];
      if (id && /^\d+$/.test(id)) return `https://player.vimeo.com/video/${id}`;
    }
    if (host === "player.vimeo.com") return url;
  } catch {
    /* not a URL */
  }
  return null;
}

/** True when the URL is one the page CSP allows in an iframe. */
export function isEmbeddable(url: string | undefined): boolean {
  return !!videoEmbedUrl(url);
}

export function fileNameFromUrl(url: string | undefined, fallback = "Document"): string {
  if (!url) return fallback;
  try {
    const last = new URL(url, "http://localhost").pathname.split("/").filter(Boolean).pop();
    return last && last !== "download" ? decodeURIComponent(last) : fallback;
  } catch {
    return fallback;
  }
}
