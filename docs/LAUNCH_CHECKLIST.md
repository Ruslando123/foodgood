# FoodGood launch checklist

## Required infrastructure

- Выбранная площадка для web-приложения, PostgreSQL и двух фоновых workers. Конкретный хостинг пока не зафиксирован.
- Paid PostgreSQL with SSL, automated backups, point-in-time recovery where available, and a tested restore procedure.
- Redis with persistence/availability appropriate for distributed rate limits and short-lived caches.
- S3-compatible object storage plus a public CDN/base URL for venue photos.
- Two continuously running processes, deployed independently from the web process:

  ```bash
  npm run worker:expiry
  npm run worker:notifications
  ```

- Telegram-бот FoodGood, публичный HTTPS webhook и отдельный webhook secret.
- No bank or payment-provider credentials are configured for the pilot.

## Required production environment

```env
NODE_ENV=production
DATABASE_URL=postgresql://...        # pooled runtime connection
DIRECT_URL=postgresql://...          # direct migrations/admin connection
REDIS_URL=rediss://...
REDIS_REQUIRED=true
SESSION_SECRET=<at least 32 random bytes>
OTP_SECRET=<different random secret>
ADMIN_PHONE=+7...
APP_BASE_URL=https://foodgood.example.kz
TELEGRAM_OTP_ENABLED=true
TELEGRAM_BOT_TOKEN=123456:...
TELEGRAM_BOT_USERNAME=FoodGoodBot
TELEGRAM_WEBHOOK_SECRET=<at least 32 random bytes>
S3_ENDPOINT=https://...
S3_REGION=...
S3_BUCKET=...
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_PUBLIC_BASE_URL=https://cdn.example.kz
METRICS_SECRET=<different random secret>
TELEGRAM_AUTH_ENABLED=false
TELEGRAM_NOTIFICATIONS_ENABLED=false
```

Generate independent secrets with `openssl rand -base64 48`. Never set `FOODGOOD_E2E_DEV_OTP` or load-test control variables in production.

## Deployment gate

The `production-gate` GitHub Actions check must be required by the protected main branch:

```bash
npm ci
npm audit --omit=dev --audit-level=high
npm run lint
npx tsc --noEmit
npm test
npm run test:upgrade
npm run build
npm run test:e2e
npx prisma migrate deploy
```

Never run `npm run seed` against production.

## Worker deployment and monitoring

| Process | Responsibility | Primary alerts |
|---|---|---|
| `worker:expiry` | stale-order expiry and TTL cleanup | stale active orders, missing heartbeat |
| `worker:notifications` | durable notification and reminder jobs | queue age/depth, failed jobs |

Scrape the authenticated `/api/metrics` endpoint on every web replica. Also scrape `/metrics` on both workers with the same bearer secret under `job="foodgood-worker"`; process-local worker failure and lease metrics exist only there. Load `ops/prometheus/alerts.yml` and configure deploy/unhealthy notifications on the selected hosting platform.

## Staging smoke test

First deploy migrations with the direct database URL, then run:

```bash
STAGING_BASE_URL=https://... METRICS_SECRET=... npm run staging:smoke
BASE_URL=https://... npm run load:k6:staging
STAGING_DATABASE_URL=... RESTORE_DATABASE_URL=... RESTORE_CONFIRM_EMPTY=true npm run staging:restore
```

The staging load profile is read-only. Run the mutating profiles only in a separate test environment backed by a disposable database:

```bash
LOAD_SEED_CONFIRM=foodgood-load-only SESSION_SECRET=load-only-secret npm run load:seed
BASE_URL=https://isolated-load.example npm run load:k6:normal
npm run load:check:normal
BASE_URL=https://isolated-load.example npm run load:k6:hot
npm run load:check:hot

# Ramp и soak мутируют normal-фикстуры: перед каждым нужен новый disposable seed.
BASE_URL=https://isolated-load.example npm run load:k6:ramp
npm run load:check:ramp
BASE_URL=https://isolated-load.example npm run load:k6:soak
npm run load:check:soak
```

The normal profile is the steady-state release gate: its `setup()` first creates one reservation with a dedicated customer and bag to warm the lazy order route, rate-limit path, Prisma connection, and reservation SQL without recording that request in `distributed_reserve_duration`. It then spreads measured reservations deterministically across `LOAD_RESERVATION_BAGS` rows, drives catalog traffic with a bounded `constant-arrival-rate` of 100 requests/second, waits five seconds before starting reservation and redeem mutations, staggers each normal reservation cohort by `NORMAL_RESERVE_STAGGER_MS` (25 ms by default), interleaves redeem attempts round-robin across merchants, requires every prepared redeem code to complete once, and keeps p95/p99 reservation defaults at 750/1500 ms. The stagger is outside the custom HTTP latency metric and prevents `shared-iterations` from creating a synthetic simultaneous burst; the hot profile remains responsible for burst and contention behavior. Configure catalog demand with `NORMAL_CATALOG_RATE`, `NORMAL_CATALOG_PREALLOCATED_VUS`, and `NORMAL_CATALOG_MAX_VUS`; defaults preallocate 100 VUs with a 150-VU ceiling, and any dropped catalog iteration fails the gate. Configure the shared mutation warmup with `NORMAL_MUTATION_START_TIME`, or override each scenario with `NORMAL_RESERVE_START_TIME` and `NORMAL_REDEEM_START_TIME`. Cold-start after a new deployment is a separate deployment SLO and must not be inferred from this steady-state gate. The hot profile deliberately serializes work on one inventory row; its 2500/5000 ms defaults are a contention regression budget, while the last-bag scenario still requires only `201` or `409` and exactly one winner. Override thresholds only when the environment's agreed SLO is documented. Use a fresh seed for every pair of runs; `load:check:normal` and `load:check:hot` validate only the fixtures exercised by that profile. The background expiry wave is disabled by default so it cannot contaminate these measurements; enable it explicitly with `LOAD_EXPIRY_ORDERS`, and use `LOAD_EXPIRY_DELAY_SECONDS` to choose when it starts.

The production-like `ramp` profile uses `ramping-arrival-rate`: 25 requests/second at the start, then 50, 100, 200, and recovery at 50 requests/second over 1m/3m/2m/1m stages. The `soak` profile uses `constant-arrival-rate` at 100 requests/second for 30 minutes. Both also run exactly one finite normal mutation wave, so `load:check:ramp` and `load:check:soak` still require every seeded reservation and redeem to complete and every affected Bag to be `SOLD_OUT` with zero inventory. They retain the 400/900 ms catalog and 750/1500 ms mutation gates, require an unexpected-status rate below 0.5%, and fail on any dropped catalog iteration. Configure ramp with `RAMP_START_RATE`, `RAMP_WARMUP_*`, `RAMP_STEADY_*`, `RAMP_PEAK_*`, `RAMP_RECOVERY_*`, and `RAMP_CATALOG_{PREALLOCATED,MAX}_VUS`; configure soak with `SOAK_DURATION`, `SOAK_CATALOG_RATE`, and `SOAK_CATALOG_{PREALLOCATED,MAX}_VUS`. Profile-specific catalog SLO overrides are `RAMP_CATALOG_{P95,P99}_MS` and `SOAK_CATALOG_{P95,P99}_MS`; do not override them unless the agreed SLO changes. Short orchestration runs may reduce only durations (for example, all ramp stage durations to `10s`, or `SOAK_DURATION=2m`), not thresholds. Use a fresh disposable database and seed for each ramp or soak run because both consume the normal mutation fixtures.

The restore target must be an isolated empty PostgreSQL 16/PostGIS database. A staging gate is incomplete without the restore evidence.

1. Request a Telegram code, share the native contact, and verify phone matching, expiry, single use, and lock after five failures.
2. Create a reservation and verify `RESERVED` and the expected inventory decrement.
3. Mark it ready, accept payment at the venue till, issue the receipt, and redeem it as `COMPLETED`.
4. Cancel another reservation before pickup and verify inventory is restored without any bank refund flow.
5. Stop the notifications worker, confirm its queue remains durable, restart it, and confirm drain.
6. Verify the admin funnel records source, reservation, completion, cancellation, and repeat-customer signals.

## Production integration checklist

### Telegram OTP

- Run `npm run telegram:webhook`, verify the registered HTTPS URL and the secret-token header.
- Confirm that a manually forwarded or mismatched contact cannot produce an OTP.
- Confirm OTP secrets differ from session secrets and that logs never contain OTP values.
- Test Telegram timeout/failure without leaving an unusable active challenge.

### Redis

- Require TLS, authentication, connection limits, monitoring, and an eviction policy compatible with rate-limit/cache keys.
- Verify the application remains safe during Redis loss because PostgreSQL is the durable idempotency boundary.
- Alert on connection failures and memory pressure.

### S3

- Verify bucket policy, private write credentials, public CDN path, allowed MIME types, size limits, and lifecycle rules.
- Test upload/read/delete from the web service and `/api/health/deep`.
- Confirm credentials cannot list or modify unrelated buckets.

### Backup restore

- Take an encrypted production-format PostgreSQL backup and restore it into an isolated environment.
- Run migrations, `npm run test:upgrade`, integrity queries, and a customer/merchant smoke flow against the restore.
- Restore or verify S3 objects referenced by the database.
- Record achieved RPO/RTO, restoration owner, commands, evidence, and the next scheduled restore drill.

## Production pilot

- Start with 1–3 venues and reconcile completed FoodGood reservations against each venue's till report daily.
- Alert on worker heartbeat loss, failed notification jobs, expired reservations, and inventory mismatches.
- Keep a documented cancellation, no-show, and customer-support procedure. FoodGood does not process refunds in pilot mode.
- Do not enable Telegram until its authentication and notification flows are tested separately.
