# Security

This document describes the security controls implemented in Praxis and how they map to common frameworks.

> **Compliance statement.** Praxis is *designed for* GDPR, the Australian Privacy Act 1988 (APPs) and SOC 2 readiness. It is **not** certified or audited against any of these. Certification requires an independent audit of the deployed system and of the operating organisation's processes, and no such audit has been completed.

## Identity & authentication

| Control | Implementation |
|---|---|
| Password storage | Argon2id (`argon2-cffi`) with transparent rehash on login when parameters change |
| Password policy | NIST 800-63B style: ≥10 characters, deny-list of common passwords, repetition check, no composition rules |
| Brute force | Per-account lockout (5 failures → 15 minutes) plus per-IP auth rate limit (20/min) |
| Sessions | 15-minute JWT access tokens (HS256, `aud`/`iss`/`typ` checked) bound to a server-side session row. Opaque refresh tokens are hashed at rest (HMAC-SHA256) and **rotated on every use**. Reusing an old token revokes the session (theft detection). Logout, password change/reset and admin actions revoke sessions immediately. |
| Device history | `auth_sessions` records device label, IP and last use. Users can revoke individual sessions or all other devices. |
| MFA | TOTP (RFC 6238) with QR enrolment. Secrets are encrypted at rest (Fernet, `ENCRYPTION_KEY`). Users get 8 single-use recovery codes stored as Argon2 hashes. MFA challenges are short-lived and attempt-limited. Organisations can require MFA. |
| Email verification / reset | Single-use, hashed, expiring tokens. Reset responses never reveal whether an account exists. |
| Federated login | Google, Microsoft and enterprise OIDC with authorization code + PKCE and a server-side single-use `state`. Federated identities link to existing accounts only when the IdP asserts a *verified* email. An organisation's IdP can only assert emails in that organisation's DNS-verified domains, which prevents cross-tenant account takeover. Organisations can enforce SSO. |
| SAML | Connection metadata is stored, but the assertion consumer requires an XML-signature library (python3-saml/xmlsec). It is an adapter extension point and is **not enabled** in this build. |
| API keys | `pk_<prefix>_<secret>`, shown once and stored as an HMAC hash with constant-time comparison. Scoped to a subset of the creator's permissions, org-bound, expirable and revocable. |

## Authorisation & tenant isolation

* Granular RBAC: 27 permission codes, 7 system role templates copied into each organisation, and custom roles. A user can hold different roles in different organisations. Privilege escalation is blocked: you cannot grant permissions you don't hold, and the last org admin cannot be removed.
* **Two-layer tenant isolation**:
  1. Every service query filters by the authenticated organisation, and rows from another org return `404`.
  2. **PostgreSQL row-level security** on all 52 tenant tables (`FORCE ROW LEVEL SECURITY`), with policies keyed on the transaction-local `app.org_id`. The API connects as a non-superuser `NOBYPASSRLS` role. A query without a tenant bound returns no rows (fail closed), and inserting another tenant's rows violates the `WITH CHECK` policy. Both behaviours are covered by `tests/test_tenancy.py`.
* Super-admin cross-tenant access is explicit (`require_superadmin`) and audited.

## Web & API protections (OWASP Top 10)

| Risk | Mitigation |
|---|---|
| Injection | SQLAlchemy parameterised queries throughout. No string-built SQL from input. The simulation condition DSL is a JSON-logic interpreter with **no `eval`/`exec`**. Code questions are pattern-matched, never executed. |
| XSS | React escaping by default. Markdown is rendered with `rehype-sanitize`. Interactive HTML lessons run in a sandboxed `iframe` (no same-origin). Strict CSP on the API and a CSP plus `frame-ancestors 'none'` on the web app. |
| CSRF | `SameSite=Lax` cookies plus double-submit token (`X-CSRF-Token`) on all cookie-authenticated mutations. Bearer and API-key requests are exempt because browsers don't send those headers automatically. |
| Broken access control | Permission dependencies on every endpoint, ownership checks on learner resources, RLS |
| SSRF | Knowledge-base URL ingestion resolves hosts and blocks private, loopback, link-local and metadata ranges. It is http(s) only, with size and time limits. |
| Security misconfiguration | Production start-up fails on a default `AUTH_SECRET`, a missing `ENCRYPTION_KEY` or non-secure cookies. Security headers on every response: HSTS (when secure), nosniff, frame deny, referrer policy, permissions policy, COOP. |
| Rate limiting / abuse | Redis fixed-window limits (global, auth, AI). Per-user daily AI request limits and org AI budgets with hard caps. |
| Logging & monitoring | Structured JSON logs with request ids, Sentry, and an immutable audit trail |

## File uploads

Size limit (streamed, rejected early), extension allow-list plus executable/HTML/SVG deny-list, content-type versus extension check, magic-byte sniffing, randomised storage keys, filename sanitisation, and a ClamAV `INSTREAM` scan when configured. Infected files are rejected. When no scanner is configured, files are marked `skipped`, which is visible to admins. S3 objects use SSE; buckets are private with public access blocked, and downloads go through authorised endpoints or short-lived presigned URLs.

## AI safety

* Prompt isolation: system instructions, retrieved context and user input are separate messages. Untrusted content is delimited and labelled, and a heuristic prompt-injection detector flags and logs attempts.
* Retrieval from **approved** organisation knowledge, with citations.
* Assessment integrity: during graded work the tutor runs in hint mode. Protected facts (answer keys, expected outputs, simulation root causes) are never placed in prompts, and outputs are screened for leaks.
* Simulation characters only receive facts already revealed by the deterministic engine, which decides correctness and scoring.
* Generated content is never published without human approval. High-stakes grades require a human decision, and overrides need a recorded reason.
* Provider API keys stay server-side; the browser never sees them.
* AI cost controls: per-org budgets, alert thresholds, hard limits and a usage ledger.

## Audit trail

`audit_logs` records logins (success and failure), registrations, role and membership changes, content creation and publishing, submissions, grading and overrides, certificate issue and revocation, AI generations, billing changes, API key and SSO changes, privacy requests and platform actions. Entries are:

* append-only: database triggers block `UPDATE`, `DELETE` and `TRUNCATE`, even for administrators of the application
* **hash-chained per organisation**, with verification via `GET /audit-logs/verify`
* free of email addresses or other directly identifying labels, so erasure requests don't conflict with immutability (actors are user ids)

## Privacy

Consent records (append-only, versioned), self-service data export (JSON archive of all personal data), account deletion (pseudonymisation that keeps certificates and audit integrity), per-organisation retention policies with a scheduled sweep, data minimisation in logs, and encryption in transit (TLS 1.2+/1.3 at the ALB; `rds.force_ssl`; Redis TLS) and at rest (RDS, S3, ElastiCache encryption; field-level encryption for MFA secrets and SSO client secrets).

## Anti-cheating (supplementary signals only)

Question randomisation and pools, time and attempt limits, frozen attempt snapshots, focus-loss events, submission similarity (shingle Jaccard), simulation behaviour analysis (implausible speed, identical action sequences), and submission version history. Signals are stored as `integrity_signals` for human review and **never** automatically penalise or accuse a learner. AI-text detection, if added, would be one more supplementary signal.

## Secrets management

No secrets in the repository (`.env.example` holds placeholders only; gitleaks runs in CI). In AWS, secrets come from Secrets Manager into ECS task definitions. Rotate `AUTH_SECRET` and `ENCRYPTION_KEY` with a planned rollout: `ENCRYPTION_KEY` rotation requires re-encrypting MFA secrets.

## Security testing

`apps/api/tests` covers authentication bypass attempts, token tampering and reuse, CSRF, lockout, tenant isolation (API and RLS), RBAC denials per role, file upload validation, SSRF blocking, prompt-injection flagging, answer-leak screening, webhook signature verification, and audit immutability. CI adds Bandit, pip-audit, pnpm audit, gitleaks and Trivy (filesystem and IaC).

## Reporting a vulnerability

Email security@praxis.example with details and reproduction steps. We aim to acknowledge within 2 business days.
