# FoodGood operational runbook

## Worker stopped or queue failed

1. Check `worker:<name>` in `SystemState`, `foodgood_queue_depth`, `foodgood_queue_oldest_age_seconds`, `foodgood_queue_failed_jobs`, and the worker `/metrics` endpoint.
2. Restart only the affected worker. Do not manually clear `leaseOwner`: an expired lease is reclaimed through `SKIP LOCKED`.
3. Confirm `foodgood_queue_expired_leases` returns to zero and queue depth decreases.
4. Run `DATABASE_URL="$DIRECT_URL" npm run load:check` after drain.

## Queue keeps growing

1. Identify the queue label and inspect external dependency latency and PostgreSQL pool saturation.
2. Scale replicas for that worker if the database connection budget still has 20–30% reserve.
3. Do not increase per-process concurrency without recalculating the total connection budget.
4. The queue must begin draining after the spike and reach its baseline within five minutes.

## Redis unavailable

1. Confirm readiness stays healthy, deep health reports Redis unavailable, and `foodgood_rate_limit_fallback_reason_total{reason=~"unavailable|command_error"}` increases.
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

- Confirm both web replicas, PgBouncer, Redis, S3/CDN, both workers, backups, metrics, and alerts.
- Keep staging credentials and cookies outside Git and CI output.
- Run the two-instance baseline and one-instance failover gates in `docs/PRODUCTION_RUNBOOK.md`.
- Export the k6 summary and run `K6_SUMMARY_FILE=<path> npm run staging:k6:check`; dropped iterations must be zero.
- Production sizing is approved only after p95/p99, PostgreSQL/PgBouncer saturation, Redis fallback, memory, queue drain, expired leases, WAL, and query plans meet the documented SLOs.
