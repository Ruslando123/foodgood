# FoodGood launch checklist

## Required infrastructure

- Render web service and managed PostgreSQL in the Frankfurt region (`render.yaml`).
- Paid PostgreSQL with SSL, automated backups, point-in-time recovery where available, and a tested restore procedure.
- Redis with persistence/availability appropriate for distributed rate limits and short-lived caches.
- S3-compatible object storage plus a public CDN/base URL for venue photos.
- Four continuously running processes, deployed independently from the web process:

  ```bash
  npm run worker:payments
  npm run worker:expiry
  npm run worker:notifications
  npm run worker:outbox
  ```

- Mobizon Kazakhstan account, API key, and an approved sender name.
- Freedom Pay Kazakhstan merchant account with test mode and manual clearing enabled.
- Freedom Pay Merchant API with signed result callback, two-step hold/capture, cancel/refund, and daily reconciliation.

The retired `/api/internal/reconcile` endpoint is not a scheduler target. All reconciliation is performed by the dedicated workers above.

## Required production environment

```env
NODE_ENV=production
DATABASE_URL=postgresql://...        # pooled runtime connection
DIRECT_URL=postgresql://...          # direct migrations/admin connection
REDIS_URL=rediss://...
SESSION_SECRET=<at least 32 random bytes>
OTP_SECRET=<different random secret>
ADMIN_PHONE=+7...
MOBIZON_API_KEY=...
MOBIZON_SENDER=FoodGood
APP_BASE_URL=https://foodgood.example.kz
FREEDOM_PAY_MERCHANT_ID=...
FREEDOM_PAY_SECRET_KEY=...
FREEDOM_PAY_TEST_MODE=false
S3_ENDPOINT=https://...
S3_REGION=...
S3_BUCKET=...
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_PUBLIC_BASE_URL=https://cdn.example.kz
METRICS_SECRET=<different random secret>
TELEGRAM_AUTH_ENABLED=false
TELEGRAM_NOTIFICATIONS_ENABLED=false
ALLOW_MOCK_PAYMENTS_IN_PRODUCTION=false
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
| `worker:payments` | HOLD/CAPTURE/REFUND and payment retries | payment failures, `NEEDS_REVIEW`, expired leases |
| `worker:expiry` | stale-order expiry and TTL cleanup | stale active orders, missing heartbeat |
| `worker:notifications` | durable notification and reminder jobs | queue age/depth, failed jobs |
| `worker:outbox` | Telegram/external outbox delivery | failed outbox messages, queue age |

Scrape the authenticated web `/api/metrics` endpoint. It aggregates durable queue state and the four worker heartbeats from PostgreSQL. Load `ops/prometheus/alerts.yml` and configure Render deploy/unhealthy notifications in the Dashboard.

## Staging smoke test

First deploy migrations with the direct database URL, then run:

```bash
STAGING_BASE_URL=https://... METRICS_SECRET=... npm run staging:smoke
BASE_URL=https://... npm run load:k6:staging
STAGING_DATABASE_URL=... RESTORE_DATABASE_URL=... RESTORE_CONFIRM_EMPTY=true npm run staging:restore
```

The staging load profile is read-only so it cannot generate real Freedom Pay operations. Run the full mutating `load:k6` plus `load:check` only in a separate mock-provider load environment. The restore target must be an isolated empty PostgreSQL 16/PostGIS database. A staging gate is incomplete without the restore evidence.

1. Request an SMS code and verify expiry, single use, and guaranteed lock after five parallel failures.
2. Create an order and observe `PENDING_PAYMENT -> PAID` through the payments worker.
3. Redeem it and observe `CAPTURE_PENDING -> COMPLETED`.
4. Cancel another paid order and observe `REFUND_PENDING -> CANCELLED`.
5. Stop only the payments worker, confirm payment operations remain queued, restart it, and confirm recovery.
6. Stop only the notifications or outbox worker, confirm its queue remains durable, restart it, and confirm drain.
7. Simulate provider timeout and verify `RETRY`; exhaust retries and verify `NEEDS_REVIEW` in `/admin/operations`.
8. Retry the operation from the admin screen and verify an audit record is created.

## Production integration checklist

### Freedom Pay

- Validate test merchant ID, secret, callback URL allowlist, signature verification, and manual clearing.
- Reconcile duplicate callbacks and repeat HOLD/CAPTURE/REFUND calls with stable idempotency keys.
- Exercise timeout-after-success, declined payment, delayed callback, refund, and daily settlement reconciliation.
- Confirm production rejects mock payments and that the configuration guard finds no enabled mock-payment bypass assignment.

### SMS

- Validate Mobizon sender approval, delivery receipts, Kazakhstan phone formatting, throughput, and account balance alerts.
- Confirm OTP secrets differ from session secrets and that logs never contain OTP values.
- Test provider timeout/failure without leaving an unusable active challenge.

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

- Start with 1–3 venues and manually reconcile every payment daily.
- Alert on worker heartbeat loss, `NEEDS_REVIEW`, failed outbox messages, and orders stuck in intermediate states.
- Keep a documented manual refund and customer-support procedure.
- Do not enable Telegram until its authentication and notification flows are tested separately.
