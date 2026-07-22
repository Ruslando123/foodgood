# Closed pilot rehearsal report — 2026-07-18

## Verdict

FoodGood passed the local closed-pilot rehearsal for 50 synthetic customers. The reservation, pickup, consent, export, analytics, support, concurrency, and database-upgrade paths are ready for a controlled 3–5 venue / 20–50 customer pilot.

No bank integration, platform commission, online settlement, or Render dependency was used or introduced.

## Load results

The test used a disposable PostgreSQL database, the production Next.js build, two background workers, and the repository's k6 scenarios through the local `grafana/k6` image.

### Normal profile

- 50/50 distributed reservations created.
- 6/6 pickup redemptions completed.
- 201 catalog requests completed; 258/258 checks passed.
- HTTP errors: 0; unexpected statuses: 0; dropped catalog iterations: 0.
- Catalog: p95 15.93 ms, p99 172.86 ms.
- Reservation: p95 609.10 ms, p99 669.98 ms.
- Redemption: p95 724.80 ms, p99 727.54 ms.
- Queue drained completely; failed jobs and expired leases: 0.

### Hot-row profile

- 50/50 concurrent reservations against one offer completed.
- Hot reservation: p95 447.98 ms, p99 453.67 ms.
- Twenty customers raced for the last package: exactly one order won.
- Last-package race: p95 407.71 ms.
- Negative inventory, unexpected statuses, and failed jobs: 0.

## Functional and integrity checks

- Unit/integration tests: 83/83 passed.
- Mobile Chromium E2E: 9/9 passed.
- Full legacy database upgrade preserved data, validated constraints, and left the Prisma schema diff empty.
- Production build, ESLint, TypeScript, Prisma validation, and Docker Compose validation passed.
- Production-like local staging smoke passed with PostgreSQL, PgBouncer, Redis, two web instances, proxy, and both workers.
- Local onboarding passed: demo OTP, privacy and terms acceptance, and customer creation.
- Deep health was degraded only for object storage, which is intentionally absent from local staging.

## Problems found and fixed

- Made the mobile pickup E2E deterministic by selecting an offer owned by the test merchant.
- Added consented CSV inclusion/revocation and audit coverage.
- Added accountable support handling: immutable first-contact timestamp and owner, venue response, resolution, and explicit customer confirmation.
- Replaced the inaccessible mobile confirmation radio with touch-safe controls.
- Added a localhost-only demo-OTP rehearsal mode with three independent guards.
- Added a technical allowlist so destructive load seeding refuses remote or non-test databases.

## External pilot checks still required

These require real operators or external infrastructure and were not simulated:

- real Telegram OTP delivery;
- production object storage/CDN for uploaded venue photos;
- venue staff accepting payment and issuing a fiscal receipt at the till;
- end-of-day reconciliation against each venue's till report;
- observing the two-hour support SLA with real customers.

Do not treat the local result as a public-production release approval until those checks pass.
