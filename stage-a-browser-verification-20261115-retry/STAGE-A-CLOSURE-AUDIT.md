# Stage A closure audit

Audit date: 2026-11-15  
Scope: read-only Stage A closure and verification evidence review. No application source, database records, permissions, migrations, or deployment state were changed.

## Checkpoint and evidence integrity

- `../stage-a-checkpoint-20261113.zip` exists. SHA-256 is `B675CEBBF547F5E657F69B3686FCEAC1EF6305E4423F99E4FCA53C9686FF92AE`, matching the recorded expected checksum.
- The archive has 116 files. Every archived file present in the workspace has the same SHA-256 as its archived copy; no differences were found. The workspace has no `.git` metadata, so a Git status/diff was unavailable.
- `browser-verification.json` records `passed`, 87 checks, no cleanup error, 14 screenshots, and an unchanged before/after integrity snapshot for existing trip/user-linked records.
- The browser run created two trips and six uniquely prefixed accounts. The artifact records cleanup of both trips and all six accounts, with zero remaining test trips/accounts. Invitation IDs, account IDs, and trip IDs are retained in the verification report for traceability.
- The selected screenshots and `browser-logs.json` are present in this directory. The screenshots show test-only account/trip information; the associated fixtures were cleaned.

## Architecture and current implementation

### Frontend

The frontend is a React 18, TypeScript, Vite application using React Router, React Query, Zustand, Tailwind CSS, and shared CSS tokens/components. `App.tsx` routes authentication, expenses, settlements, analytics, reports, My Trips, and trip management. The Stage A surfaces are `TripsPage.tsx` and `TripManagementPage.tsx`; they call the existing API through `apiRequest` and use the current session helper.

The My Trips page loads the authenticated user’s trips, pending invitations, and account email. It groups trips into active, upcoming, and completed sections, offers trip creation, and displays API/loading/empty/success states. Trip management displays member roles, pending invitations, budgets, and the cash-manager assignment; owner/admin controls call the existing management APIs.

### Backend, authentication, and authorization

The backend is Express with TypeScript, Prisma, and MySQL. Routes are grouped under `/api/auth`, `/api/invitations`, and `/api/trips`. Passwords are bcrypt-hashed. JWTs are signed for seven days. Startup validation requires `JWT_SECRET`; production additionally requires at least 32 bytes. The browser stores the JWT in `localStorage`; this means protection against cross-site scripting remains relevant to session security.

Protected routes verify the bearer token. Trip routes use active trip membership checks, with owner/admin role checks on management endpoints. Authorization is enforced by the server, regardless of frontend visibility. Notification queries are scoped to both the active trip and the authenticated member.

### Trip creation, invitations, and membership

Trip creation validates date ordering, currency code shape, and settings. In a single transaction, the server sets the authenticated account as trip owner and initial cash manager, creates its owner membership, and stores initial settings. The client does not choose an owner or initial cash-manager identity.

Invitation creation is owner/admin-only and accepts registered users. The server lowercases the target email and gives invitations a seven-day expiry. No email provider is configured; the invitation is surfaced in the registered account’s authenticated inbox. Acceptance and decline lock and check the invitation, require an exact normalized email match to the authenticated account, enforce expiry and active-trip status, and create/reactivate the member as `MEMBER`. Unauthorized or wrong-email invitation lookups return not found.

Direct member addition, role changes, pending-invitation listing, budget assignment, and cash-manager changes are owner/admin-only. Cash-manager assignment checks that the selected account is an active trip member. Cash advances are associated with that person’s own payer contribution; the model has no pooled shared cash balance.

### Budgets and financial ledger

Budget input and derived amounts are processed in integer minor units using `BigInt`. Budget responsibility is sourced from `RESPONSIBILITY` financial ledger entries (including their reversal entries), independently of `PAYER_ADVANCE` entries. Remaining budget is calculated as planned allocation minus total financial responsibility; a negative result is retained and reflected as overspending. Budget warnings are based on responsibility thresholds and are deduplicated/resolved as responsibility changes.

Expense payer contributions and responsibility allocations are separately persisted. The expense service checks that payer amounts sum to the expense total, calculates splits, verifies active membership, writes separate ledger entry types, and records cash-manager advances without changing responsibility. The Stage A browser test additionally checked a 100.00 payer contribution against 50.00 responsibility and 2,450.00 budget remaining.

### Settlement, realtime, analytics, and reports

Settlement code records manual payment attempts, requires creditor confirmation before posting confirmed-payment ledger entries, supports partial attempts, and preserves event/audit history. Disputed payments do not serve as confirmed payments. Refunds are added as refund and reversal ledger records rather than deleting payment history. These points were inspected in source and the existing settlement tests; the Stage A browser run did not exercise settlement end-to-end.

Realtime uses an outbox, per-trip sequence/cursor, and SSE event stream. The frontend reconnects with backoff and replays from a stored cursor. Notifications are materialized from events and read/unread queries are trip and user scoped. Analytics and reports are separate backend services/controllers; report exports include CSV escaping for formula-leading values and a print-friendly frontend report surface.

## Migration and test inventory

Prisma reports **13 migrations found** and **“Database schema is up to date!”** for the configured MySQL database `trip_app` on localhost. This was a status inspection only; no migration was applied. Migration directories cover initial schema, expense ledger, budget warnings, settlement/payment/refund flows, outbox and realtime, invitation acceptance/expiry, and trip dates.

The repository contains 20 API test files and 12 frontend test files, covering authentication/configuration, trip onboarding, invitation flows, budgets, expense ledger, analytics, notifications/realtime, CSV/reports, and settlements. No automated test suite, TypeScript check, build, or Prisma validation was run during this closure audit; avoiding unscoped database-writing integration tests was intentional. The earlier browser verification is the executed browser evidence.

## Browser verification findings

### Successfully exercised in Chrome

- Unique account registration, authenticated session, and login.
- Two trips created through the browser with dates, currency, and initial settings persisted; My Trips showed the upcoming trip and the trip selector switched between trips.
- Registered-user invitation creation, authenticated matching-email acceptance, decline, wrong-account rejection, and expired-invitation rejection.
- Member view omitted management controls; ordinary-member management API requests returned 403.
- Owner direct-add member flow; cash-manager assignment/change for an active member; backend rejection for an inactive member.
- Individual budget configuration and responsibility-based remaining-budget display.
- Empty expense state, My Trips API error display, and recovery when the API was restored.
- Desktop and mobile screenshots were captured.

The first browser attempt stopped at a harness assertion that expected monetary JSON to use two fixed fractional digits. The API returned the equivalent amount without trailing zeroes; the retry changed only the harness comparison to numeric equality and passed. No application defect was confirmed in the exercised workflows.

### Not fully exercised

- The completely empty My Trips dashboard, with no trips and no pending invitation. The run showed empty trip/expense states, but not this exact dashboard condition.
- Direct unauthorized browser navigation to every management screen. API authorization and ordinary-member UI visibility were checked, but not every route/role combination.
- Every form validation and error branch.
- Active and completed date/status categorization in a full browser workflow, or server-derived initial owner/cash-manager behavior as a dedicated browser assertion. Those paths are present in source; the browser run verified creation/settings and later manager assignment.
- Full settlement, analytics, reports, SSE reconnect/replay, and cross-trip privacy journeys in the browser.

The captured browser logs include Google Fonts requests blocked by the restricted network and expected authorization/expiry HTTP failures. These are recorded in `browser-logs.json`; they were not treated as application defects.

## Existing automated suites and related features

- API test files: `apps/api/test/` (20 files).
- Frontend test files: `apps/web/src/` (12 files).
- Relevant suites include `tripOnboardingE2e.test.ts`, `invitationE2e.test.ts`, `budgetNotificationsE2e.test.ts`, `expenseE2e.test.ts`, `notificationsRealtimeE2e.test.ts`, `analyticsE2e.test.ts`, `reportsE2e.test.ts`, and `settlementE2e.test.ts`.
- Tests were inspected as repository evidence, not executed in this audit. Their presence does not establish a passing current run.

## Evidence files

- Browser assertions, fixture IDs, cleanup counts, and integrity result: [`browser-verification.json`](browser-verification.json)
- Console/network log: [`browser-logs.json`](browser-logs.json)
- Mobile dashboard: [`my-trips-mobile.png`](my-trips-mobile.png)
- Invitation inbox: [`invitation-inbox.png`](invitation-inbox.png)
- Cash-manager assignment: [`cash-manager-assigned-to-member.png`](cash-manager-assigned-to-member.png)
- Budget after responsibility recalculation: [`member-budget-after-expense.png`](member-budget-after-expense.png)
- Browser harness copy: [`verify-onboarding.mjs`](verify-onboarding.mjs)

## Closure status

Stage A source matches the preserved checkpoint and the selected browser evidence is present. The recorded 87-check browser retry passed and its unique fixtures were cleaned with the pre-existing record snapshot unchanged. This closure audit ran only the read-only Prisma migration-status command; automated API/frontend suites and production builds were not rerun. No deployment or subsequent stage is included in this closure.

The pasted closure request available to this audit ended mid-line at “Trip” in its database section. This document covers the readable instructions; no omitted requirements were inferred.
