# Praxis web (`apps/web`)

Next.js 15 (App Router) + React 19 + TypeScript (strict) + Tailwind 3.4. The design system lives in
`packages/ui` (`@praxis/ui`), tokens and shared config in `packages/config`, API types in `packages/types`.

**Product rules:** light theme only (no dark mode, no `dark:` classes, no theme toggle). Colourful but
accessible: every text/background pair must pass WCAG 2.2 AA.

---

## Running

```bash
pnpm install                       # from the repo root
pnpm dev                           # http://localhost:3000 (proxies /api/* → $API_URL, default http://localhost:8000)
pnpm --filter web typecheck        # tsc --noEmit
pnpm --filter web lint             # eslint (flat config from @praxis/config)
pnpm --filter web build            # production build
pnpm gen:types                     # regenerate packages/types/src/openapi.ts from the running API
pnpm test:e2e                      # Playwright (needs the API on :8000; starts `next start` if :3000 is free)
```

Environment (`.env.example`): `API_URL` (server-side rewrite target), `NEXT_PUBLIC_SITE_URL`.

## Workspace layout

```
apps/web
  app/
    (marketing)/page.tsx           "/" landing page
    (auth)/                        login (+MFA step, SSO discovery, OAuth), register, forgot/reset password,
                                   verify-email, accept-invite. Split-screen layout.
    (public)/verify/[n]/           public certificate verification
    app/                           authenticated area (/app/*) — AppShell in layout.tsx
      dashboard/ catalog/ learning/ learn/ quiz/ assignments/ simulations/ tutor/ certificates/ skills/
      achievements/ notifications/ profile/{security,privacy}/
      instructor/                  authoring, grading, simulation builder, analytics (Teach)
      admin/                       organisation administration (Manage)
      platform/                    super-admin console
    not-found.tsx                  404 for any unknown URL (including /app/*)
  components/
    shell/                         AppShell, Sidebar, Topbar, OrgSwitcher, CommandPalette, NotificationsBell, MobileNav, UserMenu
    dashboard/                     learner dashboard sections
    auth/                          PasswordInput + strength meter, OtpInput, provider buttons
    forms/form.tsx                 react-hook-form + zod helpers
    common/                        Logo, ErrorState, Markdown, useUnsavedGuard
  lib/
    api.ts                         API client (see "Data fetching")
    auth.tsx                       AuthProvider, useAuth, usePermission, <Can>
    org.ts                         active organisation persistence
    nav.ts                         navigation config (sections, permissions, colours)
    query-keys.ts                  TanStack Query key factory
    format.ts                      dates, durations, greetings
    branding.ts                    org primary colour → brand CSS variables
  middleware.ts                    redirects signed-out visitors away from /app/*
packages/ui                        design system (components, charts, illustrations, colour helpers)
packages/config                    tsconfig bases, ESLint flat config, Tailwind preset + tokens
packages/types                     hand-written API types + generated OpenAPI schema
tests/e2e                          Playwright config + specs
```

New pages go under `app/app/<route>/page.tsx`. Add/adjust the entry in `lib/nav.ts` (label, href, icon, colour,
permissions); sub-pages without their own entry highlight their parent (longest matching href, plus `ROUTE_PARENTS`).

---

## Design tokens

All tokens come from `packages/config/tokens.cjs` and are exposed by the Tailwind preset
(`@praxis/config/tailwind-preset`). Never hard-code hex values in components — use Tailwind classes or
the helpers in `@praxis/ui`.

### Brand

| Token | Value | Use |
|---|---|---|
| `brand-50 … brand-950` | indigo scale (CSS vars, `rgb(var(--brand-600))`) | primary actions, focus rings, active nav |
| `bg-brand-gradient` | indigo-600 → violet-600 → fuchsia-600 | hero banners, primary CTA (`Button variant="gradient"`), logo |
| `bg-brand-gradient-soft` | brand-50 → violet-50 → fuchsia-50 | soft feature panels |
| `.text-gradient` | gradient text | one highlighted phrase per hero heading, never body copy |
| `bg-aurora`, `bg-grid-faint` | radial colour washes / faint grid | marketing + auth backgrounds |

The brand scale is driven by CSS variables so an organisation's `branding.primary_color` can re-tint the
app (`lib/branding.ts`). Colours too light for white text are darkened automatically to keep 4.5:1.

### Semantic surfaces

`bg-background` (#f7f8fc canvas), `bg-card`/`bg-white`, `text-foreground` (slate-900),
`text-muted-foreground` (slate-600, 7.2:1), `border-border` (slate-200), `ring` (brand-500),
`success` emerald-600, `warning` amber-600, `info` sky-600, `destructive` rose-600.

### Category colours

Nine colours for colour-coding courses, modules, tags and chart series — **always in this order**:

`indigo · sky · emerald · amber · rose · fuchsia · teal · orange · violet`

```tsx
import { colorFor, categoryClasses, colorClasses, CategoryBadge, ColorDot } from "@praxis/ui";

const c = categoryClasses(course.category); // stable colour per category name
<div className={cn("bg-gradient-to-br", c.gradient)} />       // header bar / avatar
<span className={cn(c.soft, c.text, "ring-1", c.ring)}>…</span> // pill (AA text on tint)
<CategoryBadge category="Security" />
```

Each colour exposes `solid`, `soft`, `text` (AA on white/soft), `icon`, `border`, `ring`, `gradient`,
`tint` (KPI/card wash), `hex`, `hexSoft`. Known categories map to fixed colours (Security → rose,
Leadership → violet, IT → sky, Customer service → teal, …); others hash to a stable colour.
**Tailwind only generates classes it can see**, so never build class names like `` `bg-${c}-500` `` —
use the helpers.

### Performance bands

| Band | Colour | Component |
|---|---|---|
| Fail | rose | `<BandChip band="fail" />` |
| Needs improvement | amber | `<BandChip band="needs_improvement" />` |
| Competent | sky | `<BandChip band="competent" />` |
| Advanced | violet | `<BandChip band="advanced" />` |
| Expert | emerald | `<BandChip band="expert" />` |

`bandMeta(band)` returns `{ label, color, description }` for custom renderings.

### Status tones

`<StatusPill status="in_progress" />` maps backend statuses to tones (`statusTone()`):
neutral (draft, not_started), info (in_progress, submitted), success (completed, published, passed),
warning (pending, due_soon), danger (overdue, failed, revoked), violet (in_review), brand (invited).

### Typography

| Role | Font | Classes |
|---|---|---|
| Body / UI | Inter (variable, self-hosted via `next/font/local`) | `font-sans` (default) |
| Headings, numbers in KPIs | Plus Jakarta Sans | `font-display` |
| Codes, IDs | system mono | `font-mono` |

Scale: page title `text-2xl sm:text-3xl font-bold tracking-tight` (via `PageHeader`), section/card title
`text-base/lg font-semibold`, body `text-sm`/`text-base`, meta `text-xs text-muted-foreground`,
eyebrow `text-xs font-semibold uppercase tracking-wider text-brand-700`. Use `tabular-nums` for figures.

### Spacing, radius, elevation, motion

* Spacing scale: Tailwind 4px grid. Page gutters `px-4 sm:px-6 lg:px-8`; section gap `space-y-6`;
  card padding `p-5 sm:p-6`; grid gaps `gap-4` (tiles) / `gap-6` (cards). Content max width 1400px.
* Radius: inputs/buttons `rounded-xl`, cards `rounded-2xl`, dialogs/hero panels `rounded-3xl`, pills `rounded-full`.
* Shadows: `shadow-soft` (resting cards), `shadow-lift` (hover, popovers), `shadow-glow` (gradient CTAs).
* Motion: `animate-fade-up` / `.stagger` for entrances, `hover:-translate-y-0.5` for interactive cards,
  `animate-float`, `animate-flicker` (streak flame). The preset disables animation under
  `prefers-reduced-motion`; use `motion-safe:` for anything decorative.

---

## Components (`@praxis/ui`)

| Group | Components |
|---|---|
| Actions | `Button` (`primary`, `gradient`, `secondary`, `soft`, `outline`, `ghost`, `destructive`, `destructive-soft`, `success`, `link`, `white`; sizes `xs sm md lg icon icon-sm`; `loading`, `leftIcon`, `rightIcon`, `asChild`) |
| Forms | `Input` (`leftIcon`, `rightSlot`), `Textarea`, `Label`, `FormField` (label + hint + error with aria wiring), `Select`/`SimpleSelect`, `Checkbox`, `Switch`, `RadioGroup`, `RadioCard`, `FileDropzone` |
| Layout | `Card` (+ Header/Title/Description/Content/Footer), `PageHeader`, `SectionHeader`, `Breadcrumbs`, `Tabs` (`pill`/`underline`), `Accordion`, `Separator`, `Stepper` |
| Overlays | `Dialog`, `Sheet` (`side="bottom"` = mobile bottom sheet), `DropdownMenu`, `Popover`, `Tooltip` (needs `TooltipProvider`, mounted in `app/providers.tsx`), `ConfirmDialog`, `CommandDialog` (cmdk) |
| Data | `Table` primitives, `SortableHeader`, `DataTable` (TanStack: sorting, client/server pagination, selection, row actions, column visibility, skeleton + empty state), `Pagination`, `FilterBar` |
| Feedback | `Alert`, `toast` + `Toaster` (sonner), `Skeleton`, `Spinner`, `EmptyState` (+ illustrations: `learning search inbox trophy rocket error chart shield`) |
| Display | `Badge`, `StatusPill`, `CategoryBadge`, `BandChip`, `ColorDot`, `Avatar`/`AvatarGroup`, `Progress`, `ProgressRing`, `KpiTile`/`StatCard`, `StreakFlame`, `Kbd` |
| Charts (`@praxis/ui/charts`) | `TrendAreaChart`, `TrendLineChart`, `ColorBarChart` (`colorByIndex`, horizontal), `DonutChart`, `SkillRadarChart`, `Sparkline`, `ActivityHeatmap` — all use the category palette |

App-level helpers: `components/forms/form.tsx` (`useZodForm`, `TextField`, `TextAreaField`,
`applyApiErrors`), `components/common/markdown.tsx` (`<Markdown>`: GFM, sanitised, no raw HTML),
`components/common/error-state.tsx` (`ErrorState`, `isNotDeployed`).

### Example page

```tsx
"use client";
export default function CoursesPage() {
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 });
  const q = useQuery({
    queryKey: ["courses", pagination],
    queryFn: () => api.get<Page<Course>>("/courses", { query: { page: pagination.pageIndex + 1, page_size: pagination.pageSize } }),
  });
  return (
    <>
      <PageHeader title="Courses" description="Build and publish training" icon={<GraduationCap />}
        actions={<Can permission="courses.create"><Button variant="gradient" leftIcon={<Plus />}>New course</Button></Can>} />
      {q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
        <DataTable columns={columns} data={q.data?.items ?? []} loading={q.isLoading}
          total={q.data?.total} pagination={pagination} onPaginationChange={setPagination}
          rowActions={[{ label: "Archive", destructive: true, onSelect: archive }]} />
      )}
    </>
  );
}
```

## Page conventions

1. Start with `PageHeader` (title, one-line description, optional icon chip, primary action on the right;
   only one `gradient` button per view).
2. Every data view has **loading** (`Skeleton` shaped like the content), **error** (`ErrorState` with retry)
   and **empty** (`EmptyState` with an illustration and a next step) states.
3. Gate UI with `<Can permission="…">` / `usePermission()`; the API is the real enforcement.
4. Mutations: disable + `loading` on the button, `toast.success` on success, inline `Alert` for form errors.
5. Destructive actions use `ConfirmDialog` (`destructive`, optional `confirmText`).
6. Colour-code by category/status with the helpers, not ad-hoc colours. Use 1–2 accent colours per card.
7. Endpoints that may not be deployed yet: check `isNotDeployed(err)` and degrade gracefully.
8. Mobile first: grids collapse to one column; tables scroll horizontally; the shell gives a bottom tab
   bar + "More" bottom sheet below `lg`. Leave `pb-28` space (handled by the shell) for the tab bar.

## Data fetching

* **Client**: `lib/api.ts` → `api.get/post/put/patch/delete/upload/download`. It calls same-origin
  `/api/v1/*` with `credentials: "include"`, adds `X-CSRF-Token` (from the `praxis_csrf` cookie) on
  mutations and `X-Organisation-Id` for the active org. On `401` it calls `POST /auth/refresh` once
  (shared across concurrent requests) and retries, otherwise redirects to `/login?next=…`
  (`redirectOn401: false` to opt out, e.g. public pages). A stale org header (`403 no_organisation`) is
  cleared and retried. Errors are thrown as `ApiError { status, code, message, details, requestId }`;
  use `errorMessage(err)` for display and `err.fieldErrors()` / `applyApiErrors(form, err)` for 422s.
* **Uploads**: `api.upload(path, { file, purpose }, { onProgress })` (multipart, progress via XHR).
  **Downloads**: `api.download(path, { filename? })` saves the response as a file.
* **Caching**: TanStack Query (`staleTime` 30s, no retries on 4xx). Keys come from `lib/query-keys.ts`
  and start with the resource name so related keys can be invalidated together. Switching organisation
  clears all non-`me` queries; the org is not part of keys.
* **Auth state**: `useAuth()` → `user`, `organisation`, `organisations`, `permissions`, `can()`,
  `switchOrganisation()`, `logout()`. Only available under `/app` (AuthProvider lives in the shell).
* **Types**: hand-written domain types in `@praxis/types`; for other endpoints use the generated
  `components["schemas"]["…"]` from `@praxis/types/openapi` (`pnpm gen:types`).
* **Security headers**: CSP (`frame-ancestors 'none'`, `object-src 'none'`, self-only scripts/fonts/connect),
  `X-Frame-Options: DENY`, `nosniff`, strict referrer policy, HSTS in production — see `next.config.ts`.
  Render user/AI text with `<Markdown>` (sanitised) — never `dangerouslySetInnerHTML`. Server-provided SVG
  (e.g. MFA QR) is rendered as an `<img src="data:image/svg+xml…">`, not inlined.

## Accessibility checklist (WCAG 2.2 AA)

- [ ] Text contrast ≥ 4.5:1 (≥ 3:1 for ≥ 18px bold / icons / focus rings). On tinted surfaces use the
      `-700`/`-800` text shade (`colorClasses().text`). Never put body text on gradients except white on `bg-brand-gradient`.
- [ ] Every interactive element is keyboard reachable with a **visible focus ring** (`focus-visible:focus-ring`).
- [ ] Icon-only buttons have `aria-label`; decorative icons/illustrations have `aria-hidden`.
- [ ] Form controls are wrapped in `FormField` (label, `aria-invalid`, `aria-describedby` for hint/error);
      errors are announced (`role="alert"`) and not conveyed by colour alone.
- [ ] One `h1` per page (via `PageHeader`), headings in order; landmarks: `main#main` (skip link target), `nav` with labels.
- [ ] Status is never colour-only: pills carry text, charts have `aria-label`s / textual summaries.
- [ ] Dialogs/menus use the Radix-based components (focus trap, Esc to close, focus return).
- [ ] Respect `prefers-reduced-motion` (preset handles CSS; use `motion-safe:` for decorative motion).
- [ ] Touch targets ≥ 24×24px (buttons are ≥ 28px; prefer `md` size on touch layouts); layouts work from 320px wide without horizontal scroll.
- [ ] Live updates that matter (pagination summary, password strength) use `aria-live="polite"`.
- [ ] Keyboard shortcuts: `⌘K`/`Ctrl K` or `/` open search; don't add single-key shortcuts that fire while typing.
