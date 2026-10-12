# API

REST + JSON, versioned under **`/api/v1`**. The OpenAPI 3.1 spec is generated from the code:

* Interactive docs: `http://localhost:8000/api/docs` (Swagger UI) and `/api/redoc`
* Spec: `GET /api/v1/openapi.json`. TypeScript types for the web app are generated from it with `pnpm gen:types` into `packages/types/src/openapi.ts`.

## Authentication

| Client | Mechanism |
|---|---|
| Web app (same origin) | `HttpOnly` cookies `praxis_access` (15 min JWT) and `praxis_refresh` (opaque, rotating, 14 days). Mutating requests must send `X-CSRF-Token` equal to the `praxis_csrf` cookie (double-submit). |
| Mobile / first-party clients | `POST /auth/login` with `include_refresh_token: true`, then `Authorization: Bearer <access_token>`. Refresh with `POST /auth/refresh {refresh_token}`. Refresh tokens rotate, and reusing an old one revokes the session. |
| Integrations | `X-API-Key: pk_<prefix>_<secret>`. Keys are org-bound, scoped to a subset of permissions, revocable, and can expire (`/api-keys`). |
| Federated login | Google / Microsoft (`/auth/oauth/{google\|microsoft}/authorize`) and per-organisation OIDC SSO (`/auth/sso/discover?email=`, `/auth/oauth/sso-<connection-id>/authorize`). All use authorization code + PKCE. |

MFA: when `mfa_enabled`, `POST /auth/login` returns `{mfa_required: true, mfa_token}`. Complete it with
`POST /auth/mfa/verify {mfa_token, code | recovery_code}`.

## Tenancy & authorisation

* Send **`X-Organisation-Id: <uuid>`** to select the active organisation. Without it, the user's default organisation is used. The caller must be an active member (super admins may access any org).
* Each endpoint requires one or more permission codes (see [ARCHITECTURE.md §7](./ARCHITECTURE.md#7-rbac-model)). Missing permissions return `403 {"error": {"code": "forbidden", "details": {"required": [...]}}}`.
* Rows belonging to another organisation are always reported as `404`.
* Plan limits and paid features return `402 {"error": {"code": "plan_limit", ...}}`.

## Conventions

| Topic | Convention |
|---|---|
| Errors | `{"error": {"code": "snake_case", "message": "Human readable", "details": ..., "request_id": "..."}}`. Validation errors return `422` with `code: "validation_error"` and per-field `details`. |
| Pagination | `?page=1&page_size=25` (max 200) returns `{items, total, page, page_size}` |
| Rate limits | Per IP / API key globally (default 300/min), stricter on auth (20/min/IP) and AI endpoints. `429` includes `Retry-After`. |
| Idempotency | Simulation actions carry `client_seq` (a mismatch returns `409` with the expected value). Stripe webhooks dedupe by event id. Course publish creates exactly one new version. |
| Time | ISO-8601 UTC timestamps |
| IDs | UUID v4 |
| Request tracing | Every response has `x-request-id` (send your own to correlate) and `server-timing` |
| Async work | Long-running operations (AI generation, document ingestion, AI grading, data export) return `202` and are polled via their resource (`status` field) |

## Core flows

```text
Register / login        POST /auth/register · POST /auth/login → (MFA) → cookies / tokens · GET /me
Author & publish        POST /courses → POST /courses/{id}/modules → POST …/lessons → POST /courses/{id}/publish
AI course builder       POST /ai/generations {kind: "course", input} → GET /ai/generations/{id} → approve → apply (draft course)
Assign training         POST /enrolments/assign {course_id, user_ids|department_ids|team_ids, due_date}
Learn                   GET /learn/{course_id} → POST /progress/lessons/{id}/start|heartbeat|complete
Quiz                    POST /assessments/{id}/attempts → PUT /attempts/{id}/answers/{qid} → POST /attempts/{id}/submit → GET /attempts/{id}/result
Assignment              PUT /assignments/{id}/submission (draft) → POST /assignments/{id}/submission/submit → AI grade → POST /grading/submissions/{id}/grade
Simulation              POST /simulations/{id}/sessions → POST /simulation-sessions/{id}/actions|chat → POST …/finish → GET …/result
AI tutor                POST /ai/tutor/sessions → POST /ai/tutor/sessions/{id}/messages (or /messages/stream, SSE)
Certificate             issued automatically on course completion → GET /certificates/{id}/pdf · public GET /verify/{number}
Analytics & reports     GET /analytics/{learner/me|courses/{id}|organisation|platform} · POST /reports/{type}?format=pdf|csv|xlsx
```

## Webhooks (inbound)

* `POST /api/v1/billing/webhook`: Stripe. Signature verified with `STRIPE_WEBHOOK_SECRET`; events are processed idempotently.

## Versioning policy

Breaking changes ship under a new prefix (`/api/v2`). Additive changes (new fields, endpoints) may ship within v1, so clients must ignore unknown fields.

## Endpoint index

<!-- endpoint-index:start -->
_326 operations across 40 groups (generated)._

### ai

| Method | Path | Summary |
|---|---|---|
| `POST` | `/api/v1/ai/budget/check` | Run Budget Check |
| `GET` | `/api/v1/ai/config` | Get Config |
| `PUT` | `/api/v1/ai/config` | Put Config |
| `GET` | `/api/v1/ai/providers` | Get Providers |
| `GET` | `/api/v1/ai/usage` | Get Usage |

### ai-generations

| Method | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/ai/generations` | List Generations |
| `POST` | `/api/v1/ai/generations` | Create |
| `GET` | `/api/v1/ai/generations/{generation_id}` | Get |
| `PATCH` | `/api/v1/ai/generations/{generation_id}` | Edit |
| `POST` | `/api/v1/ai/generations/{generation_id}/apply` | Apply |
| `POST` | `/api/v1/ai/generations/{generation_id}/approve` | Approve |
| `POST` | `/api/v1/ai/generations/{generation_id}/regenerate` | Regenerate |
| `POST` | `/api/v1/ai/generations/{generation_id}/reject` | Reject |

### ai-tutor

| Method | Path | Summary |
|---|---|---|
| `POST` | `/api/v1/ai/tutor/messages/{message_id}/rating` | Rate |
| `GET` | `/api/v1/ai/tutor/sessions` | List Sessions |
| `POST` | `/api/v1/ai/tutor/sessions` | Create Session |
| `DELETE` | `/api/v1/ai/tutor/sessions/{session_id}` | Delete Session |
| `GET` | `/api/v1/ai/tutor/sessions/{session_id}` | Get Session |
| `GET` | `/api/v1/ai/tutor/sessions/{session_id}/messages` | List Messages |
| `POST` | `/api/v1/ai/tutor/sessions/{session_id}/messages` | Send Message |
| `POST` | `/api/v1/ai/tutor/sessions/{session_id}/messages/stream` | Send Message Stream |

### analytics

| Method | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/analytics/courses` | Courses Overview |
| `GET` | `/api/v1/analytics/courses/{course_id}` | Course Analytics |
| `GET` | `/api/v1/analytics/learner/me` | My Analytics |
| `GET` | `/api/v1/analytics/learner/{user_id}` | Learner Analytics |
| `GET` | `/api/v1/analytics/organisation` | Organisation Analytics |
| `GET` | `/api/v1/analytics/platform` | Platform Analytics |

### api-keys

| Method | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/api-keys` | List Keys |
| `POST` | `/api/v1/api-keys` | Create Key |
| `DELETE` | `/api/v1/api-keys/{key_id}` | Revoke Key |

### assessments

| Method | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/assessments` | List Assessments |
| `POST` | `/api/v1/assessments` | Create Assessment |
| `GET` | `/api/v1/assessments/review-queue` | Review Queue |
| `DELETE` | `/api/v1/assessments/{assessment_id}` | Delete Assessment |
| `GET` | `/api/v1/assessments/{assessment_id}` | Get Assessment |
| `PATCH` | `/api/v1/assessments/{assessment_id}` | Update Assessment |
| `POST` | `/api/v1/assessments/{assessment_id}/archive` | Archive |
| `POST` | `/api/v1/assessments/{assessment_id}/attempts` | Start Attempt |
| `PUT` | `/api/v1/assessments/{assessment_id}/items` | Replace Items |
| `GET` | `/api/v1/assessments/{assessment_id}/overview` | Overview |
| `POST` | `/api/v1/assessments/{assessment_id}/publish` | Publish |
| `GET` | `/api/v1/assessments/{assessment_id}/stats` | Stats |
| `GET` | `/api/v1/attempts/{attempt_id}` | Get Attempt |
| `PUT` | `/api/v1/attempts/{attempt_id}/answers/{question_id}` | Save Answer |
| `PUT` | `/api/v1/attempts/{attempt_id}/answers/{question_id}/grade` | Grade Answer |
| `POST` | `/api/v1/attempts/{attempt_id}/finalize` | Finalize |
| `POST` | `/api/v1/attempts/{attempt_id}/integrity` | Integrity |
| `GET` | `/api/v1/attempts/{attempt_id}/result` | Result |
| `POST` | `/api/v1/attempts/{attempt_id}/submit` | Submit |
| `GET` | `/api/v1/question-banks` | List Banks |
| `POST` | `/api/v1/question-banks` | Create Bank |
| `DELETE` | `/api/v1/question-banks/{bank_id}` | Delete Bank |
| `GET` | `/api/v1/question-banks/{bank_id}` | Get Bank |
| `PATCH` | `/api/v1/question-banks/{bank_id}` | Update Bank |
| `GET` | `/api/v1/question-banks/{bank_id}/export` | Export Bank |
| `POST` | `/api/v1/question-banks/{bank_id}/import` | Import Bank |
| `GET` | `/api/v1/questions` | List Questions |
| `POST` | `/api/v1/questions` | Create Question |
| `DELETE` | `/api/v1/questions/{question_id}` | Delete Question |
| `GET` | `/api/v1/questions/{question_id}` | Get Question |
| `PATCH` | `/api/v1/questions/{question_id}` | Update Question |

### assignments

| Method | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/assignments` | List Assignments |
| `POST` | `/api/v1/assignments` | Create Assignment |
| `DELETE` | `/api/v1/assignments/{assignment_id}` | Delete Assignment |
| `GET` | `/api/v1/assignments/{assignment_id}` | Get Assignment |
| `PATCH` | `/api/v1/assignments/{assignment_id}` | Update Assignment |
| `POST` | `/api/v1/assignments/{assignment_id}/archive` | Archive Assignment |
| `POST` | `/api/v1/assignments/{assignment_id}/publish` | Publish Assignment |
| `GET` | `/api/v1/assignments/{assignment_id}/submission` | My Submission |
| `PUT` | `/api/v1/assignments/{assignment_id}/submission` | Save Draft |
| `POST` | `/api/v1/assignments/{assignment_id}/submission/request-review` | Request Review |
| `POST` | `/api/v1/assignments/{assignment_id}/submission/submit` | Submit |
| `GET` | `/api/v1/assignments/{assignment_id}/submission/versions` | Versions |
| `POST` | `/api/v1/grading/integrity-signals/{signal_id}/review` | Review Signal |
| `GET` | `/api/v1/grading/queue` | Queue |
| `GET` | `/api/v1/grading/submissions/{submission_id}` | Grading Detail |
| `POST` | `/api/v1/grading/submissions/{submission_id}/grade` | Grade |
| `POST` | `/api/v1/grading/submissions/{submission_id}/return-for-resubmission` | Return For Resubmission |
| `GET` | `/api/v1/rubrics` | List Rubrics |
| `POST` | `/api/v1/rubrics` | Create Rubric |
| `DELETE` | `/api/v1/rubrics/{rubric_id}` | Delete Rubric |
| `GET` | `/api/v1/rubrics/{rubric_id}` | Get Rubric |
| `PATCH` | `/api/v1/rubrics/{rubric_id}` | Update Rubric |

### audit

| Method | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/audit-logs` | List Audit Logs |
| `GET` | `/api/v1/audit-logs/export` | Export Audit Logs |
| `GET` | `/api/v1/audit-logs/verify` | Verify Audit Chain |
| `GET` | `/api/v1/audit-logs/{log_id}` | Get Audit Log |

### auth

| Method | Path | Summary |
|---|---|---|
| `POST` | `/api/v1/auth/email/resend` | Resend Verification |
| `POST` | `/api/v1/auth/email/verify` | Verify Email |
| `POST` | `/api/v1/auth/login` | Login |
| `POST` | `/api/v1/auth/logout` | Logout |
| `POST` | `/api/v1/auth/mfa/disable` | Mfa Disable |
| `POST` | `/api/v1/auth/mfa/enable` | Mfa Enable |
| `POST` | `/api/v1/auth/mfa/setup` | Mfa Setup |
| `POST` | `/api/v1/auth/mfa/verify` | Mfa Verify |
| `GET` | `/api/v1/auth/oauth/{provider}/authorize` | Oauth Authorize |
| `GET` | `/api/v1/auth/oauth/{provider}/callback` | Oauth Callback |
| `POST` | `/api/v1/auth/password/change` | Change Password |
| `POST` | `/api/v1/auth/password/forgot` | Forgot Password |
| `POST` | `/api/v1/auth/password/reset` | Reset Password |
| `GET` | `/api/v1/auth/providers` | Providers |
| `POST` | `/api/v1/auth/refresh` | Refresh |
| `POST` | `/api/v1/auth/register` | Register |
| `GET` | `/api/v1/auth/sessions` | List Sessions |
| `POST` | `/api/v1/auth/sessions/revoke-others` | Revoke Other Sessions |
| `DELETE` | `/api/v1/auth/sessions/{session_id}` | Revoke Session |
| `GET` | `/api/v1/auth/sso/discover` | Sso Discover |

### billing

| Method | Path | Summary |
|---|---|---|
| `POST` | `/api/v1/billing/checkout` | Checkout |
| `GET` | `/api/v1/billing/invoices` | Invoices |
| `GET` | `/api/v1/billing/plans` | List Plans |
| `POST` | `/api/v1/billing/portal` | Portal |
| `GET` | `/api/v1/billing/subscription` | Get Subscription |
| `POST` | `/api/v1/billing/subscription/cancel` | Cancel |
| `POST` | `/api/v1/billing/subscription/resume` | Resume |
| `POST` | `/api/v1/billing/subscription/seats` | Change Seats |
| `GET` | `/api/v1/billing/usage` | Usage |

### catalog

| Method | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/catalog` | Browse |
| `GET` | `/api/v1/catalog/categories` | Categories |
| `GET` | `/api/v1/catalog/{course_id}` | Catalog Detail |

### certificates

| Method | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/certificates` | List Certificates |
| `POST` | `/api/v1/certificates/issue` | Issue |
| `GET` | `/api/v1/certificates/me` | My Certificates |
| `GET` | `/api/v1/certificates/{certificate_id}` | Get Certificate |
| `GET` | `/api/v1/certificates/{certificate_id}/pdf` | Certificate Pdf |
| `POST` | `/api/v1/certificates/{certificate_id}/revoke` | Revoke |

### courses

| Method | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/courses` | List Courses |
| `POST` | `/api/v1/courses` | Create Course |
| `DELETE` | `/api/v1/courses/{course_id}` | Delete Course |
| `GET` | `/api/v1/courses/{course_id}` | Get Course |
| `PATCH` | `/api/v1/courses/{course_id}` | Update Course |
| `DELETE` | `/api/v1/courses/{course_id}/activities/{activity_id}` | Delete Activity |
| `PATCH` | `/api/v1/courses/{course_id}/activities/{activity_id}` | Update Activity |
| `POST` | `/api/v1/courses/{course_id}/archive` | Archive Course |
| `POST` | `/api/v1/courses/{course_id}/duplicate` | Duplicate Course |
| `DELETE` | `/api/v1/courses/{course_id}/lessons/{lesson_id}` | Delete Lesson |
| `GET` | `/api/v1/courses/{course_id}/lessons/{lesson_id}` | Get Lesson |
| `PATCH` | `/api/v1/courses/{course_id}/lessons/{lesson_id}` | Update Lesson |
| `POST` | `/api/v1/courses/{course_id}/lessons/{lesson_id}/activities` | Create Activity |
| `PUT` | `/api/v1/courses/{course_id}/lessons/{lesson_id}/activities/order` | Reorder Activities |
| `POST` | `/api/v1/courses/{course_id}/modules` | Create Module |
| `DELETE` | `/api/v1/courses/{course_id}/modules/{module_id}` | Delete Module |
| `PATCH` | `/api/v1/courses/{course_id}/modules/{module_id}` | Update Module |
| `POST` | `/api/v1/courses/{course_id}/modules/{module_id}/lessons` | Create Lesson |
| `POST` | `/api/v1/courses/{course_id}/publish` | Publish |
| `POST` | `/api/v1/courses/{course_id}/restore` | Restore Course |
| `PUT` | `/api/v1/courses/{course_id}/skills` | Set Skills |
| `GET` | `/api/v1/courses/{course_id}/structure` | Get Structure |
| `PUT` | `/api/v1/courses/{course_id}/structure` | Reorder Structure |
| `GET` | `/api/v1/courses/{course_id}/versions` | List Versions |
| `GET` | `/api/v1/courses/{course_id}/versions/diff` | Diff Versions |
| `GET` | `/api/v1/courses/{course_id}/versions/{number}` | Get Version |

### dashboard

| Method | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/dashboard/instructor` | Instructor |
| `GET` | `/api/v1/dashboard/learner` | Learner |

### departments

| Method | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/departments` | List Departments |
| `POST` | `/api/v1/departments` | Create Department |
| `GET` | `/api/v1/departments/tree` | Department Tree |
| `DELETE` | `/api/v1/departments/{department_id}` | Delete Department |
| `GET` | `/api/v1/departments/{department_id}` | Get Department |
| `PATCH` | `/api/v1/departments/{department_id}` | Update Department |

### enrolments

| Method | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/enrolments` | List Enrolments |
| `POST` | `/api/v1/enrolments` | Self Enrol |
| `POST` | `/api/v1/enrolments/assign` | Assign |
| `GET` | `/api/v1/enrolments/me` | My Enrolments |
| `PATCH` | `/api/v1/enrolments/{enrolment_id}` | Update Enrolment |
| `POST` | `/api/v1/enrolments/{enrolment_id}/withdraw` | Withdraw |

### files

| Method | Path | Summary |
|---|---|---|
| `POST` | `/api/v1/files` | Upload |
| `DELETE` | `/api/v1/files/{file_id}` | Delete |
| `GET` | `/api/v1/files/{file_id}` | Metadata |
| `GET` | `/api/v1/files/{file_id}/download` | Download |

### gamification

| Method | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/gamification/badges` | List Badges |
| `POST` | `/api/v1/gamification/badges` | Create Badge |
| `DELETE` | `/api/v1/gamification/badges/{badge_id}` | Delete Badge |
| `PATCH` | `/api/v1/gamification/badges/{badge_id}` | Update Badge |
| `POST` | `/api/v1/gamification/badges/{badge_id}/award` | Award Badge |
| `GET` | `/api/v1/gamification/leaderboard` | Get Leaderboard |
| `GET` | `/api/v1/gamification/me` | My Gamification |
| `PUT` | `/api/v1/gamification/me/leaderboard-opt-out` | Set Opt Out |

### invitations

| Method | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/invitations` | List Invitations |
| `POST` | `/api/v1/invitations` | Create Invitation |
| `POST` | `/api/v1/invitations/accept` | Accept |
| `POST` | `/api/v1/invitations/bulk` | Bulk Invite |
| `GET` | `/api/v1/invitations/lookup` | Lookup |
| `DELETE` | `/api/v1/invitations/{invitation_id}` | Revoke |
| `POST` | `/api/v1/invitations/{invitation_id}/resend` | Resend |

### knowledge

| Method | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/knowledge/documents` | List Documents |
| `POST` | `/api/v1/knowledge/documents/text` | Add Text |
| `POST` | `/api/v1/knowledge/documents/upload` | Upload Document |
| `POST` | `/api/v1/knowledge/documents/url` | Add Url |
| `DELETE` | `/api/v1/knowledge/documents/{document_id}` | Delete Document |
| `GET` | `/api/v1/knowledge/documents/{document_id}` | Get Document |
| `PATCH` | `/api/v1/knowledge/documents/{document_id}` | Update Document |
| `POST` | `/api/v1/knowledge/documents/{document_id}/approve` | Approve |
| `GET` | `/api/v1/knowledge/documents/{document_id}/chunks` | List Chunks |
| `POST` | `/api/v1/knowledge/documents/{document_id}/reprocess` | Reprocess |
| `POST` | `/api/v1/knowledge/documents/{document_id}/unapprove` | Unapprove |
| `POST` | `/api/v1/knowledge/search` | Search |

### learn

| Method | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/learn/{course_id}` | Learn Course |
| `POST` | `/api/v1/learn/{course_id}/activities/{activity_id}/check` | Check Activity |
| `GET` | `/api/v1/learn/{course_id}/lessons/{lesson_id}` | Learn Lesson |
| `POST` | `/api/v1/learn/{course_id}/upgrade` | Upgrade |

### learning-paths

| Method | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/learning-paths` | List Paths |
| `POST` | `/api/v1/learning-paths` | Create Path |
| `GET` | `/api/v1/learning-paths/me` | My Paths |
| `DELETE` | `/api/v1/learning-paths/{path_id}` | Delete Path |
| `GET` | `/api/v1/learning-paths/{path_id}` | Get Path |
| `PATCH` | `/api/v1/learning-paths/{path_id}` | Update Path |
| `POST` | `/api/v1/learning-paths/{path_id}/enrol` | Enrol |
| `PUT` | `/api/v1/learning-paths/{path_id}/items` | Set Items |
| `POST` | `/api/v1/learning-paths/{path_id}/join` | Join |

### me

| Method | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/me` | Me |
| `PATCH` | `/api/v1/me` | Update Me |
| `GET` | `/api/v1/me/organisations` | My Organisations |

### notifications

| Method | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/notifications` | List Notifications |
| `GET` | `/api/v1/notifications/preferences` | Get Preferences |
| `PUT` | `/api/v1/notifications/preferences` | Update Preferences |
| `DELETE` | `/api/v1/notifications/push-subscriptions` | Unsubscribe Push |
| `POST` | `/api/v1/notifications/push-subscriptions` | Subscribe Push |
| `POST` | `/api/v1/notifications/read-all` | Read All |
| `GET` | `/api/v1/notifications/unread-count` | Unread Count |
| `DELETE` | `/api/v1/notifications/{notification_id}` | Delete Notification |
| `POST` | `/api/v1/notifications/{notification_id}/read` | Mark Read |
| `POST` | `/api/v1/notifications/{notification_id}/unread` | Mark Unread |

### organisations

| Method | Path | Summary |
|---|---|---|
| `POST` | `/api/v1/organisations` | Create Organisation |
| `GET` | `/api/v1/organisations/current` | Get Current |
| `PATCH` | `/api/v1/organisations/current` | Update Current |
| `DELETE` | `/api/v1/organisations/current/domain` | Remove Domain |
| `GET` | `/api/v1/organisations/current/domain` | Get Domain |
| `PUT` | `/api/v1/organisations/current/domain` | Set Domain |
| `POST` | `/api/v1/organisations/current/domain/verify` | Verify Domain |

### platform

| Method | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/platform/health` | Platform Health |
| `GET` | `/api/v1/platform/organisations` | List Organisations |
| `GET` | `/api/v1/platform/organisations/{org_id}` | Get Organisation |
| `PATCH` | `/api/v1/platform/organisations/{org_id}/plan` | Change Plan |
| `POST` | `/api/v1/platform/organisations/{org_id}/reactivate` | Reactivate Organisation |
| `POST` | `/api/v1/platform/organisations/{org_id}/suspend` | Suspend Organisation |
| `GET` | `/api/v1/platform/users` | List Users |
| `PUT` | `/api/v1/platform/users/{user_id}/superadmin` | Set Superadmin |

### privacy

| Method | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/privacy/consents` | Get Consents |
| `PUT` | `/api/v1/privacy/consents` | Update Consents |
| `POST` | `/api/v1/privacy/delete-account` | Delete Account |
| `POST` | `/api/v1/privacy/export` | Request Export |
| `GET` | `/api/v1/privacy/requests` | List Requests |
| `GET` | `/api/v1/privacy/requests/{request_id}/download` | Download Export |
| `GET` | `/api/v1/privacy/retention` | Get Retention |
| `PUT` | `/api/v1/privacy/retention` | Set Retention |
| `POST` | `/api/v1/privacy/retention/run` | Run Retention |

### progress

| Method | Path | Summary |
|---|---|---|
| `POST` | `/api/v1/progress/lessons/{lesson_id}/complete` | Complete |
| `POST` | `/api/v1/progress/lessons/{lesson_id}/heartbeat` | Heartbeat |
| `POST` | `/api/v1/progress/lessons/{lesson_id}/start` | Start |

### public

| Method | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/verify/{certificate_number}` | Verify |

### recommendations

| Method | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/recommendations/me` | My Recommendations |
| `GET` | `/api/v1/recommendations/me/plan` | My Plan |
| `POST` | `/api/v1/recommendations/me/refresh` | Refresh |
| `POST` | `/api/v1/recommendations/{recommendation_id}/dismiss` | Dismiss |

### reports

| Method | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/reports/types` | Report Types |
| `POST` | `/api/v1/reports/{report_type}` | Generate Report |

### roles

| Method | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/roles` | List Roles |
| `POST` | `/api/v1/roles` | Create Role |
| `GET` | `/api/v1/roles/permissions` | Permission Catalogue |
| `DELETE` | `/api/v1/roles/{role_id}` | Delete Role |
| `GET` | `/api/v1/roles/{role_id}` | Get Role |
| `PATCH` | `/api/v1/roles/{role_id}` | Update Role |

### search

| Method | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/search` | Search |

### simulation-sessions

| Method | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/simulation-sessions` | My Sessions |
| `GET` | `/api/v1/simulation-sessions/{session_id}` | Get Session |
| `POST` | `/api/v1/simulation-sessions/{session_id}/abandon` | Abandon Session |
| `POST` | `/api/v1/simulation-sessions/{session_id}/actions` | Perform Action |
| `POST` | `/api/v1/simulation-sessions/{session_id}/chat` | Chat |
| `POST` | `/api/v1/simulation-sessions/{session_id}/finish` | Finish Session |
| `GET` | `/api/v1/simulation-sessions/{session_id}/replay` | Replay |
| `GET` | `/api/v1/simulation-sessions/{session_id}/result` | Get Result |

### simulations

| Method | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/simulations` | List Simulations |
| `POST` | `/api/v1/simulations` | Create Simulation |
| `POST` | `/api/v1/simulations/ai-build` | Ai Build |
| `POST` | `/api/v1/simulations/from-template` | Create From Template |
| `GET` | `/api/v1/simulations/templates` | List Templates |
| `DELETE` | `/api/v1/simulations/{sim_id}` | Delete Simulation |
| `GET` | `/api/v1/simulations/{sim_id}` | Get Simulation |
| `PATCH` | `/api/v1/simulations/{sim_id}` | Update Simulation |
| `GET` | `/api/v1/simulations/{sim_id}/analytics` | Simulation Analytics |
| `GET` | `/api/v1/simulations/{sim_id}/draft` | Get Draft |
| `PUT` | `/api/v1/simulations/{sim_id}/draft` | Save Draft |
| `GET` | `/api/v1/simulations/{sim_id}/graph` | Get Graph |
| `PUT` | `/api/v1/simulations/{sim_id}/graph` | Save Graph |
| `POST` | `/api/v1/simulations/{sim_id}/publish` | Publish |
| `GET` | `/api/v1/simulations/{sim_id}/sessions` | Simulation Sessions |
| `POST` | `/api/v1/simulations/{sim_id}/sessions` | Start Session |
| `POST` | `/api/v1/simulations/{sim_id}/validate` | Validate Definition |
| `GET` | `/api/v1/simulations/{sim_id}/versions` | List Versions |
| `GET` | `/api/v1/simulations/{sim_id}/versions/{version}` | Get Version |

### skills

| Method | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/competencies` | List Competencies |
| `POST` | `/api/v1/competencies` | Create Competency |
| `DELETE` | `/api/v1/competencies/{competency_id}` | Delete Competency |
| `GET` | `/api/v1/competencies/{competency_id}` | Get Competency |
| `PATCH` | `/api/v1/competencies/{competency_id}` | Update Competency |
| `GET` | `/api/v1/skills` | List Skills |
| `POST` | `/api/v1/skills` | Create Skill |
| `GET` | `/api/v1/skills/me` | My Skills |
| `DELETE` | `/api/v1/skills/{skill_id}` | Delete Skill |
| `GET` | `/api/v1/skills/{skill_id}` | Get Skill |
| `PATCH` | `/api/v1/skills/{skill_id}` | Update Skill |

### sso

| Method | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/sso/connections` | List Connections |
| `POST` | `/api/v1/sso/connections` | Create Connection |
| `DELETE` | `/api/v1/sso/connections/{conn_id}` | Delete Connection |
| `GET` | `/api/v1/sso/connections/{conn_id}` | Get Connection |
| `PATCH` | `/api/v1/sso/connections/{conn_id}` | Update Connection |
| `POST` | `/api/v1/sso/connections/{conn_id}/test` | Test Connection |
| `POST` | `/api/v1/sso/connections/{conn_id}/verify-domains` | Verify Domains |

### system

| Method | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/health` | Health |

### teams

| Method | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/teams` | List Teams |
| `POST` | `/api/v1/teams` | Create Team |
| `DELETE` | `/api/v1/teams/{team_id}` | Delete Team |
| `GET` | `/api/v1/teams/{team_id}` | Get Team |
| `PATCH` | `/api/v1/teams/{team_id}` | Update Team |
| `GET` | `/api/v1/teams/{team_id}/members` | Team Members |
| `POST` | `/api/v1/teams/{team_id}/members` | Add Team Members |
| `DELETE` | `/api/v1/teams/{team_id}/members/{user_id}` | Remove Team Member |

### users

| Method | Path | Summary |
|---|---|---|
| `GET` | `/api/v1/users` | List Members |
| `POST` | `/api/v1/users` | Create Member |
| `POST` | `/api/v1/users/import` | Import Members |
| `DELETE` | `/api/v1/users/{user_id}` | Remove Member |
| `GET` | `/api/v1/users/{user_id}` | Get Member |
| `PATCH` | `/api/v1/users/{user_id}` | Update Member |
| `POST` | `/api/v1/users/{user_id}/reactivate` | Reactivate |
| `PUT` | `/api/v1/users/{user_id}/roles` | Set Roles |
| `POST` | `/api/v1/users/{user_id}/suspend` | Suspend |

<!-- endpoint-index:end -->
