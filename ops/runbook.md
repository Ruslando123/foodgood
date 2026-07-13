# FoodGood operational runbook

## Worker stopped

1. Check `worker:<name>` in `SystemState`, `foodgood_queue_depth`, `foodgood_queue_oldest_age_seconds`, and the worker `/metrics` endpoint.
2. Restart only the affected worker. Do not manually clear `leaseOwner`: an expired lease is reclaimed through `SKIP LOCKED`.
3. Confirm `foodgood_queue_expired_leases` returns to zero and queue depth decreases.
4. Run `DATABASE_URL="$DIRECT_URL" npm run load:check` after drain.

## Queue keeps growing

1. Identify the queue label and inspect external dependency latency and PostgreSQL pool saturation.
2. Scale replicas for that worker if the database connection budget still has 20–30% reserve.
3. Do not increase per-process concurrency without recalculating the total connection budget.
4. The queue must begin draining after the spike and reach its baseline within five minutes.

## Redis unavailable

1. Confirm requests still work and `foodgood_rate_limit_fallback_total` increases.
2. Watch PostgreSQL writes to `RateLimitBucket` and pool saturation.
3. Restore Redis, then verify newly created rate-limit keys have a positive `PTTL`.

## S3 unavailable

1. Catalog and orders should remain available; photo uploads should fail with a controlled error.
2. `/api/health/ready` stays healthy while `/api/health/deep` reports storage degradation.
3. Restore object storage and verify a new upload plus CDN read before closing the incident.

## Migration failed

1. Do not switch web or workers to the new release.
2. Compare the actual schema and `_prisma_migrations`; do not run `migrate resolve` blindly.
3. Re-run `npm run test:upgrade` against an isolated database.
4. Restore from a verified backup/PITR only through the approved recovery procedure.

## Before and after staging load

- Confirm PgBouncer, Redis, S3/CDN, all four workers, backups, metrics, and alerts.
- Keep staging credentials and cookies outside Git and CI output.
- Run `DATABASE_URL="$DIRECT_URL" npm run load:seed`, execute `npm run load:k6`, then run `DATABASE_URL="$DIRECT_URL" npm run load:check`.
- Production sizing is approved only after p95/p99, pool saturation, memory, queue drain, expired leases, WAL, and query plans meet the documented SLOs.
