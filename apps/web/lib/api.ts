/**
 * Praxis API client (browser).
 *
 * - Calls same-origin `/api/v1/*` (Next rewrites to the FastAPI service), so auth cookies flow.
 * - Adds `X-CSRF-Token` (double-submit, from the `praxis_csrf` cookie) on mutating requests.
 * - Adds `X-Organisation-Id` for the active organisation (see lib/org.ts).
 * - On 401: tries `POST /auth/refresh` once (deduplicated across concurrent calls) and retries;
 *   if that fails, redirects to `/login?next=<current path>` (unless `redirectOn401: false`).
 * - On 403 `no_organisation` with a stale org header: clears the stored org and retries once.
 * - Parses `{error: {code, message, details}}` into a typed `ApiError`.
 * - Supports JSON, FormData (multipart) uploads with progress, and file downloads.
 */

import type { ApiErrorBody, ValidationErrorDetail } from "@praxis/types";
import { clearActiveOrgId, getActiveOrgId } from "./org";

export const API_BASE = "/api/v1";
export const CSRF_COOKIE = "praxis_csrf";
export const CSRF_HEADER = "X-CSRF-Token";
export const ORG_HEADER = "X-Organisation-Id";

const NO_REFRESH_PATHS = ["/auth/login", "/auth/refresh", "/auth/mfa/verify", "/auth/register", "/auth/logout"];

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly requestId?: string;

  constructor(status: number, code: string, message: string, details?: unknown, requestId?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }

  get isNotFound() {
    return this.status === 404;
  }
  get isUnauthorized() {
    return this.status === 401;
  }
  get isForbidden() {
    return this.status === 403;
  }
  get isValidation() {
    return this.status === 422 || this.code === "validation_error";
  }
  get isNetwork() {
    return this.status === 0;
  }

  /** Field errors from a 422 validation response, keyed by the last `loc` segment. */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    if (Array.isArray(this.details)) {
      for (const d of this.details as ValidationErrorDetail[]) {
        const key = d?.loc?.[d.loc.length - 1];
        if (key !== undefined && d.msg) out[String(key)] = d.msg.replace(/^Value error, /, "");
      }
    }
    return out;
  }
}

/** Human-friendly message for any thrown error. */
export function errorMessage(err: unknown, fallback = "Something went wrong. Please try again."): string {
  if (err instanceof ApiError) {
    if (err.isNetwork) return "Can't reach the server. Check your connection and try again.";
    if (err.status === 429) return "Too many attempts. Please wait a moment and try again.";
    if (err.isValidation) {
      const fields = Object.values(err.fieldErrors());
      if (fields.length) return fields[0]!;
    }
    return err.message || fallback;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${name.replace(/[.$?*|{}()[\]\\/+^]/g, "\\$&")}=([^;]*)`));
  return m ? decodeURIComponent(m[1]!) : null;
}

function clearCsrfCookie() {
  if (typeof document !== "undefined") document.cookie = `${CSRF_COOKIE}=; Max-Age=0; path=/`;
}

export type Query = Record<string, string | number | boolean | null | undefined | (string | number)[]>;

export interface RequestOptions {
  query?: Query;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Redirect to /login when the session cannot be refreshed (default true). */
  redirectOn401?: boolean;
  /** Skip the X-Organisation-Id header. */
  noOrg?: boolean;
}

export function buildUrl(path: string, query?: Query): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  const url = `${API_BASE}${p}`;
  if (!query) return url;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) v.forEach((x) => qs.append(k, String(x)));
    else qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `${url}?${s}` : url;
}

let refreshing: Promise<boolean> | null = null;

/** Rotate the refresh token. Concurrent callers share one in-flight request. */
export function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json" },
    })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => {
        setTimeout(() => (refreshing = null), 0);
      });
  }
  return refreshing;
}

export function redirectToLogin() {
  if (typeof window === "undefined") return;
  clearCsrfCookie();
  const here = window.location.pathname + window.location.search;
  if (window.location.pathname.startsWith("/login")) return;
  window.location.assign(`/login?next=${encodeURIComponent(here)}`);
}

async function parseError(res: Response): Promise<ApiError> {
  let body: Partial<ApiErrorBody> | null = null;
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    /* non-JSON */
  }
  const e = body?.error;
  const fallback =
    res.status === 404
      ? "Not found"
      : res.status === 403
        ? "You don't have permission to do that."
        : res.status >= 500
          ? "The server had a problem. Please try again."
          : res.statusText || "Request failed";
  return new ApiError(res.status, e?.code ?? `http_${res.status}`, e?.message ?? fallback, e?.details, e?.request_id);
}

function headersFor(method: string, opts: RequestOptions, isForm: boolean): Headers {
  const h = new Headers({ Accept: "application/json", ...(opts.headers ?? {}) });
  if (!isForm && opts.body !== undefined) h.set("Content-Type", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf) h.set(CSRF_HEADER, csrf);
  }
  const org = opts.noOrg ? null : getActiveOrgId();
  if (org) h.set(ORG_HEADER, org);
  return h;
}

async function rawRequest(method: string, path: string, opts: RequestOptions, attempt = 0): Promise<Response> {
  const isForm = typeof FormData !== "undefined" && opts.body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method,
      credentials: "include",
      headers: headersFor(method, opts, isForm),
      body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
      signal: opts.signal,
      cache: "no-store",
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new ApiError(0, "network_error", "Network error");
  }

  if (res.status === 401 && attempt === 0 && !NO_REFRESH_PATHS.some((p) => path.startsWith(p))) {
    if (await refreshSession()) return rawRequest(method, path, opts, attempt + 1);
    if (opts.redirectOn401 !== false) redirectToLogin();
  }
  if (res.status === 403 && attempt < 2 && !opts.noOrg && getActiveOrgId()) {
    const clone = res.clone();
    try {
      const body = (await clone.json()) as ApiErrorBody;
      if (body?.error?.code === "no_organisation") {
        clearActiveOrgId();
        return rawRequest(method, path, opts, attempt + 1);
      }
    } catch {
      /* ignore */
    }
  }
  return res;
}

export async function request<T = unknown>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const res = await rawRequest(method, path, opts);
  if (!res.ok) throw await parseError(res);
  if (res.status === 204 || res.headers.get("content-length") === "0") return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

/** Upload with progress (XMLHttpRequest, since fetch has no upload progress). */
function uploadWithProgress<T>(path: string, form: FormData, onProgress: (pct: number) => void, opts: RequestOptions, retried = false): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", buildUrl(path, opts.query));
    xhr.withCredentials = true;
    headersFor("POST", opts, true).forEach((v, k) => xhr.setRequestHeader(k, v));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onerror = () => reject(new ApiError(0, "network_error", "Network error"));
    opts.signal?.addEventListener("abort", () => xhr.abort());
    xhr.onload = async () => {
      if (xhr.status === 401 && !retried) {
        if (await refreshSession()) return resolve(uploadWithProgress<T>(path, form, onProgress, opts, true));
        if (opts.redirectOn401 !== false) redirectToLogin();
      }
      const res = new Response(xhr.status === 204 ? null : xhr.responseText, {
        status: xhr.status,
        headers: { "content-type": xhr.getResponseHeader("content-type") ?? "application/json" },
      });
      if (!res.ok) return reject(await parseError(res));
      onProgress(100);
      resolve(xhr.responseText ? (JSON.parse(xhr.responseText) as T) : (undefined as T));
    };
    xhr.send(form);
  });
}

function filenameFrom(res: Response, fallback: string): string {
  const cd = res.headers.get("content-disposition") ?? "";
  const star = cd.match(/filename\*=UTF-8''([^;]+)/i);
  if (star) return decodeURIComponent(star[1]!);
  const plain = cd.match(/filename="?([^";]+)"?/i);
  return plain ? plain[1]! : fallback;
}

export const api = {
  get: <T>(path: string, opts?: Omit<RequestOptions, "body">) => request<T>("GET", path, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>("POST", path, { ...opts, body }),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>("PUT", path, { ...opts, body }),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>("PATCH", path, { ...opts, body }),
  delete: <T = void>(path: string, opts?: RequestOptions) => request<T>("DELETE", path, opts),

  /**
   * Multipart upload. `fields` may include File/Blob values.
   * Pass `onProgress` to receive 0-100 upload progress.
   */
  upload: <T>(
    path: string,
    fields: Record<string, string | Blob | File | (string | Blob)[] | undefined | null> | FormData,
    opts: RequestOptions & { onProgress?: (pct: number) => void } = {},
  ): Promise<T> => {
    let form: FormData;
    if (fields instanceof FormData) form = fields;
    else {
      form = new FormData();
      for (const [k, v] of Object.entries(fields)) {
        if (v === undefined || v === null) continue;
        if (Array.isArray(v)) v.forEach((x) => form.append(k, x));
        else form.append(k, v);
      }
    }
    if (opts.onProgress) return uploadWithProgress<T>(path, form, opts.onProgress, opts);
    return request<T>("POST", path, { ...opts, body: form });
  },

  /** Download a file (GET by default) and trigger the browser save dialog. Returns the filename. */
  download: async (path: string, opts: RequestOptions & { method?: string; filename?: string } = {}): Promise<string> => {
    const res = await rawRequest(opts.method ?? "GET", path, opts);
    if (!res.ok) throw await parseError(res);
    const blob = await res.blob();
    const name = opts.filename ?? filenameFrom(res, path.split("/").pop() || "download");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return name;
  },
};

export type Api = typeof api;
