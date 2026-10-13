import { createHmac } from "node:crypto";
import { expect, request, test as base, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Test-data helpers for the E2E suite. Setup goes straight to the API (fast, deterministic); the journey
 * under test is driven through the UI. Every spec that mutates state creates its own organisation and
 * users, so the suite can be re-run against the same seeded database.
 */

export const API_URL = process.env.E2E_API_URL ?? "http://localhost:8000";
/** Password of the seeded demo accounts. */
export const DEMO_PASSWORD = process.env.E2E_DEMO_PASSWORD ?? "Praxis-Demo-2026!";
/** Password used for every account the suite creates. */
export const PASSWORD = "Correct-Horse-Battery-42";

export const DEMO = {
  superadmin: "superadmin@praxis.demo",
  admin: "admin@northwind.demo",
  instructor: "instructor@northwind.demo",
  assessor: "assessor@northwind.demo",
  learner: "learner@northwind.demo",
  contosoLearner: "learner@contoso.demo",
} as const;

export function uid(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function uniqueEmail(prefix = "e2e"): string {
  return `${prefix}.${uid()}@example.com`;
}

export interface Actor {
  email: string;
  password: string;
  fullName: string;
  userId: string;
  token: string;
  orgId: string | null;
}

type Body = Record<string, unknown> | unknown[] | undefined;

export class Api {
  private superadmin: Actor | null = null;

  constructor(readonly ctx: APIRequestContext) {}

  static async create(): Promise<Api> {
    return new Api(await request.newContext({ baseURL: API_URL, timeout: 60_000 }));
  }

  async dispose() {
    await this.ctx.dispose();
  }

  /** Call the API as ``actor`` (Bearer + organisation header) and return the parsed JSON body. */
  async call<T = any>(method: string, path: string, actor: Actor | null, body?: Body, expected = [200, 201, 202, 204]): Promise<T> {
    const headers: Record<string, string> = {};
    if (actor) {
      headers.Authorization = `Bearer ${actor.token}`;
      if (actor.orgId) headers["X-Organisation-Id"] = actor.orgId;
    }
    const res = await this.ctx.fetch(`/api/v1${path}`, { method, headers, data: body });
    const text = await res.text();
    if (!expected.includes(res.status())) {
      throw new Error(`${method} ${path} -> ${res.status()}: ${text.slice(0, 800)}`);
    }
    return (text ? JSON.parse(text) : null) as T;
  }

  get = <T = any>(path: string, actor: Actor | null) => this.call<T>("GET", path, actor);
  post = <T = any>(path: string, actor: Actor | null, body?: Body) => this.call<T>("POST", path, actor, body ?? {});
  put = <T = any>(path: string, actor: Actor | null, body?: Body) => this.call<T>("PUT", path, actor, body ?? {});
  patch = <T = any>(path: string, actor: Actor | null, body?: Body) => this.call<T>("PATCH", path, actor, body ?? {});

  private async withOrg(actor: Actor): Promise<Actor> {
    const me = await this.get("/me", actor);
    return { ...actor, orgId: me.organisation?.id ?? null };
  }

  async login(email: string, password = DEMO_PASSWORD): Promise<Actor> {
    const out = await this.post("/auth/login", null, { email, password });
    expect(out.mfa_required, `${email} unexpectedly requires MFA`).toBe(false);
    const me = await this.get("/me", { token: out.tokens.access_token, orgId: null } as Actor);
    return {
      email,
      password,
      fullName: me.full_name ?? me.user?.full_name ?? email,
      userId: out.tokens.user_id,
      token: out.tokens.access_token,
      orgId: me.organisation?.id ?? null,
    };
  }

  /** Register a new user; with ``orgName`` they become org_admin of a brand-new organisation. */
  async register(opts: { orgName?: string; fullName?: string; email?: string } = {}): Promise<Actor> {
    const email = opts.email ?? uniqueEmail("admin");
    const fullName = opts.fullName ?? "Casey Admin";
    const tok = await this.call("POST", "/auth/register", null, {
      email,
      password: PASSWORD,
      full_name: fullName,
      organisation_name: opts.orgName,
      accept_terms: true,
    }, [201]);
    return this.withOrg({ email, password: PASSWORD, fullName, userId: tok.user_id, token: tok.access_token, orgId: null });
  }

  /** A fresh organisation on the given plan (the platform super admin changes the plan). */
  async freshOrg(label: string, plan = "enterprise"): Promise<Actor> {
    const admin = await this.register({ orgName: `E2E ${label} ${uid()}`, fullName: "Casey Admin" });
    this.superadmin ??= await this.login(DEMO.superadmin);
    await this.patch(`/platform/organisations/${admin.orgId}/plan`, this.superadmin, { plan_code: plan });
    return admin;
  }

  /** Create an active member with a known password and sign them in (API token). */
  async addMember(admin: Actor, roles: string[], fullName: string): Promise<Actor> {
    const email = uniqueEmail(roles[0]!.replace(/_/g, "-"));
    await this.post("/users", admin, { email, full_name: fullName, roles, password: PASSWORD, send_email: false });
    const actor = await this.login(email, PASSWORD);
    return { ...actor, fullName, orgId: admin.orgId };
  }

  async enrol(admin: Actor, courseId: string, userIds: string[]) {
    return this.post("/enrolments/assign", admin, { course_id: courseId, user_ids: userIds });
  }
}

export interface LessonSpec {
  title: string;
  lesson_type?: string;
  content?: Record<string, unknown>;
  duration_minutes?: number;
  assessment_id?: string;
  assignment_id?: string;
  simulation_id?: string;
}

export interface BuiltCourse {
  id: string;
  title: string;
  moduleId: string;
  lessons: { id: string; title: string }[];
}

/** Create a course with one module and the given lessons; publish it unless ``publish`` is false. */
export async function buildCourse(
  api: Api,
  author: Actor,
  opts: { title: string; lessons: LessonSpec[]; publish?: boolean; extra?: Record<string, unknown>; before?: (courseId: string) => Promise<Partial<LessonSpec>[] | void> },
): Promise<BuiltCourse> {
  const course = await api.post("/courses", author, {
    title: opts.title,
    subtitle: "An end-to-end test course",
    description: "Created by the Playwright suite to exercise a learner journey.",
    category: "IT Support",
    difficulty: "beginner",
    duration_minutes: 20,
    certificate_enabled: true,
    sequential: false,
    ...opts.extra,
  });
  const mod = await api.post(`/courses/${course.id}/modules`, author, { title: "Getting started" });
  const lessons: { id: string; title: string }[] = [];
  for (const l of opts.lessons) {
    const body = {
      lesson_type: "text",
      duration_minutes: 5,
      content: { body_markdown: `## ${l.title}\n\nDNS translates names such as intranet.corp.local into IP addresses.` },
      ...l,
    };
    const created = await api.post(`/courses/${course.id}/modules/${mod.id}/lessons`, author, body);
    lessons.push({ id: created.id, title: l.title });
  }
  if (opts.publish !== false) await api.post(`/courses/${course.id}/publish`, author, { changelog: "Initial release." });
  return { id: course.id, title: opts.title, moduleId: mod.id, lessons };
}

/** Multiple-choice question payload for ``POST /question-banks/{id}/import``. */
export function mcq(prompt: string, choices: string[], correct: number) {
  return {
    question_type: "multiple_choice",
    prompt,
    options: { choices: choices.map((text, i) => ({ id: "abcdefgh"[i], text })) },
    answer_key: { choice_id: "abcdefgh"[correct] },
    explanation: `The answer is “${choices[correct]}”.`,
    points: 1,
    difficulty: 2,
    tags: ["e2e"],
  };
}

// ------------------------------------------------------------------------------------------- browser

/**
 * Sign the browser in without the login form (the auth spec covers the form): the login call goes
 * through the web origin so the auth cookies land in the page's context.
 */
export async function signIn(page: Page, email: string, password: string = DEMO_PASSWORD) {
  const res = await page.request.post("/api/v1/auth/login", { data: { email, password } });
  expect(res.status(), await res.text()).toBe(200);
  const body = await res.json();
  expect(body.mfa_required).toBe(false);
}

/**
 * Close any open toasts. Sonner pauses a toast while the pointer hovers it, so a toast sitting over a
 * sticky footer button would otherwise block that click indefinitely.
 */
export async function dismissToasts(page: Page) {
  await page.mouse.move(0, 0); // un-hover so the toasts' timers resume
  const toasts = page.locator("[data-sonner-toast]");
  await expect(async () => {
    const close = toasts.getByRole("button", { name: "Close toast" });
    for (let i = await close.count(); i > 0; i--) await close.nth(i - 1).dispatchEvent("click").catch(() => {});
    expect(await toasts.count()).toBe(0);
  }).toPass({ timeout: 15_000 });
}

// ------------------------------------------------------------------------------------------- TOTP

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) throw new Error(`Invalid base32 character: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** RFC 6238 TOTP (HMAC-SHA1, 30 s step, 6 digits). */
export function totp(secret: string, at = Date.now(), step = 30, digits = 6): string {
  const counter = Math.floor(at / 1000 / step);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secret)).update(msg).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return code.toString().padStart(digits, "0");
}

/**
 * A TOTP code that stays valid for a few more seconds. With ``after`` (a code already used), waits for the
 * next 30 s window so the server's replay protection does not reject a reused code.
 */
export async function freshTotp(secret: string, after?: string): Promise<string> {
  for (;;) {
    const remaining = 30 - (Math.floor(Date.now() / 1000) % 30);
    if (remaining >= 5) {
      const code = totp(secret);
      if (code !== after) return code;
    }
    await new Promise((r) => setTimeout(r, remaining * 1000 + 250));
  }
}

// ------------------------------------------------------------------------------------------- fixture

export const test = base.extend<{}, { api: Api }>({
  api: [
    async ({}, use) => {
      const api = await Api.create();
      await use(api);
      await api.dispose();
    },
    { scope: "worker" },
  ],
});

export { expect };
