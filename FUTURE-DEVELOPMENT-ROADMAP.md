# Proposed future development roadmap

**Status:** Proposal only. Stage A is closed against the preserved checkpoint. No subsequent stage is approved or started by this document.

## Stage A — Frontend trip onboarding and management

**Status: Completed and browser-verified.**

The checkpoint is `stage-a-checkpoint-20261113.zip` (SHA-256 `B675CEBBF547F5E657F69B3686FCEAC1EF6305E4423F99E4FCA53C9686FF92AE`). Its 116 archived files match their workspace copies. The browser retry report records 87 passed checks, 14 screenshots, cleaned uniquely scoped fixtures, and an unchanged pre-existing-record snapshot. See [`stage-a-browser-verification-20261115-retry/STAGE-A-CLOSURE-AUDIT.md`](stage-a-browser-verification-20261115-retry/STAGE-A-CLOSURE-AUDIT.md) and the [browser report](stage-a-browser-verification-20261115-retry/browser-verification.json).

## Proposed next stages

### Stage B — Application integration and workflow assurance

**Goal:** Establish reliable end-to-end coverage across the existing UI and APIs before adding features.

Proposed work:

- Exercise the user journey across trip creation, invitation and member changes, expenses, budget warnings, notifications, realtime updates, analytics, reports, trip closure, and manual settlement.
- Add browser and API coverage for the currently unexercised cases: fully empty My Trips dashboard, unauthorized direct navigation across management screens, form validation/error branches, active/completed trip categorization, and initial server-assigned owner/cash-manager behavior.
- Verify contracts between pages and APIs, loading and error states, membership revocation, event replay/reconnect, and trip switching.
- Run integration tests only against a separately configured disposable MySQL database or fixtures that are uniquely scoped, ownership-checked, and cleaned by the test harness. Compare pre-existing data snapshots around any such run.
- Keep manual settlements and current financial rules unchanged during assurance work.

**Exit criteria:** documented scenario matrix with executed results; no unresolved critical/high integration failures; test runs identify their database target and fixture cleanup evidence.

### Stage C — Security and session review

**Goal:** Review and, if separately approved, improve application security before production use.

Proposed review areas:

- Session storage and XSS exposure from browser-held bearer tokens; evaluate safer session-cookie architecture and its CSRF requirements.
- JWT configuration, rotation, expiry/revocation behavior, password policy, authentication rate limits, and account recovery.
- Authorization coverage for every trip-scoped API, analytics/report downloads, membership changes, notification recipients, and event streams.
- CORS, request validation/size limits, safe error responses, audit logging, dependency exposure, and secret handling.
- Security testing against cross-trip access, membership revocation, replay/idempotency, and role changes.

**Exit criteria:** approved threat model and remediation decisions; security tests for high-risk boundaries; no secret values in logs, artifacts, or source control.

### Stage D — Production operations and data readiness

**Goal:** Prepare operational controls without changing the production database until separately authorized.

Proposed work:

- Document deployment topology, supported runtime versions, required environment variables, health checks, and background outbox worker behavior.
- Review MySQL backups, restore drills, migration sequencing/rollback limits, foreign keys, indexes, connection pooling, and query performance.
- Add monitoring and alerting for API health, failed outbox delivery, authentication failures, settlement/report errors, and database capacity.
- Establish privacy-aware log retention, support procedures, and incident response steps.
- Verify staging configuration and release artifacts without connecting to or changing production data.

**Exit criteria:** tested backup/restore procedure; reviewed migration/release runbook; monitored staging deployment; documented rollback and incident ownership.

### Stage E — Controlled release

**Goal:** Release only after explicit approval and completion of the prior stage gates.

Proposed steps:

- Obtain explicit release approval after reviewing the final test, security, data, and operations reports.
- Deploy to a controlled environment, verify health and critical workflows, then follow the separately approved production rollout plan.
- Keep payment handling manual. No UPI, bank connection, payment gateway, or automatic money transfer is included in this roadmap.

## Cross-stage constraints

- Preserve the existing MySQL database and records. No reset, recreation, or cleanup without explicit authorization.
- Use additive migrations only when a reviewed requirement makes one essential; review its data and rollback implications first.
- Keep payer advances separate from financial responsibility. Budgets use responsibility, settlement receipts require creditor confirmation, partial payments/refunds retain their audit history, and all monetary arithmetic remains in integer minor units.
- Make no application, authentication, database, or deployment changes without approval for the relevant stage.

## Planning note

The supplied final-closure instructions ended during Step 3 at “Perform a read-only repository inspection.” This roadmap uses only the visible request to propose future work; it does not infer approval for any stage or implementation.
