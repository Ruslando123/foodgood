# FoodGood production runbook

## Monitoring setup

Scrape each web replica directly at `GET /api/metrics` with `Authorization: Bearer $METRICS_SECRET` every 30 seconds; do not scrape only through the load balancer. Scrape `/metrics` on both worker processes with the same bearer token under `job="foodgood-worker"`, because worker failure/lease counters are process-local. Give every target a stable `instance` label and load [the FoodGood rules](../ops/prometheus/alerts.yml). Probe the load-balanced `/api/health/ready` endpoint separately with the Prometheus blackbox exporter under `job="foodgood-ready"`. Scrape the PgBouncer exporter under `job="pgbouncer"`.

The web metrics endpoint publishes per-process HTTP/query histograms and Redis state, plus durable PostgreSQL queue and worker-heartbeat state. The reservation-only pilot requires the expiry and notifications workers. Alert delivery must be exercised before a release, not merely configured.

Health endpoints have distinct contracts:

- `/api/health/live` checks only that the process can serve HTTP. Use it to restart a wedged process.
- `/api/health/ready` checks PostgreSQL and returns `503` when the replica must leave load-balancer rotation.
- `/api/health/deep` reports workers, failed/overdue jobs, object storage, and Redis. Degradation is operational evidence; it does not remove a replica while safe fallbacks still work.

## Web instance or database down

1. Check each replica's `/api/health/live` and `/api/health/ready`, then the load-balanced readiness probe.
2. If one replica is unhealthy, remove only that target and follow [one web instance down](#one-web-instance-down).
3. If every replica is unready, pause deploys and check PostgreSQL availability, PgBouncer client waiters, and the connection budget. Do not start a second migration.
4. If data is damaged, perform point-in-time recovery into a new isolated database, validate it, then switch services together.

## One web instance down

1. Confirm the surviving replica is ready and PostgreSQL/PgBouncer still have at least 20% connection reserve.
2. Ensure the failed target is out of load-balancer rotation. Run the single-instance failover gate described in [staging release gates](#staging-release-gates).
3. Watch 5xx, p95/p99, PgBouncer waiters, Redis fallback, and dropped load iterations while traffic uses the survivor.
4. Restore or replace the failed replica. Re-run the two-instance baseline gate before returning to normal operation.

## Latency or capacity regression

1. Identify the affected `method`/`route` in `foodgood_http_request_duration_seconds`; compare API p95/p99 with `foodgood_prisma_query_duration_seconds`.
2. Check `foodgood_db_pool_connections / foodgood_db_max_connections` and `pgbouncer_pools_client_waiting_connections`. Any sustained PgBouncer waiter means the pool budget is exhausted even if PostgreSQL remains below `max_connections`.
3. Check Redis availability and PostgreSQL writes to `RateLimitBucket`; a Redis outage intentionally shifts rate-limit work to PostgreSQL.
4. Check dropped k6 iterations before accepting latency numbers. A generator that cannot maintain the arrival rate has not validated capacity.
5. Scale only after identifying the constrained layer. Keep a 20–30% PostgreSQL connection reserve across both web replicas and workers.

## Worker heartbeat or queue failure

1. Identify the stale worker or queue in `/api/health/deep`, `foodgood_worker_last_heartbeat_seconds`, `foodgood_queue_failed_jobs`, and queue lag/depth metrics.
2. Check its process logs and restart only that worker. Do not manually clear `leaseOwner`; expired leases are reclaimed through `SKIP LOCKED`.
3. Confirm expired leases return to zero, failed jobs are explicitly resolved, and queue depth/lag returns to baseline.
4. Do not declare recovery based only on a fresh heartbeat: terminally failed jobs require investigation and an intentional retry or repair.

## Redis unavailable

1. Confirm `/api/health/ready` stays healthy while `/api/health/deep` reports Redis `unavailable`.
2. Confirm `foodgood_redis_available` is `0` and `foodgood_rate_limit_fallback_reason_total{reason=~"unavailable|command_error"}` increases during a rate-limited request.
3. Watch PgBouncer waiters and PostgreSQL `RateLimitBucket` writes. Reduce traffic if fallback load consumes the connection reserve.
4. Restore Redis, then confirm `foodgood_redis_available` returns to `1` and a newly created rate-limit key has a positive `PTTL`.

## Staging release gates

Use two distinct direct instance URLs plus the load-balanced URL. Keep all credentials outside shell history and committed files.

1. Verify both replicas and the load balancer:

   ```sh
   STAGING_BASE_URL=https://staging.example \
   STAGING_INSTANCE_URLS=https://web-1.example,https://web-2.example \
   npm run staging:failover
   ```

2. Run `npm run staging:smoke`. Run k6 with an exported summary, then apply the non-negotiable p95, p99, error, check-rate, and zero-dropped-iteration gate:

   ```sh
   k6 run --summary-trend-stats 'avg,min,med,max,p(90),p(95),p(99)' \
     --summary-export /tmp/foodgood-k6-summary.json load/k6-staging.js
   K6_SUMMARY_FILE=/tmp/foodgood-k6-summary.json npm run staging:k6:check
   ```

3. Remove one web target from rotation and stop only that instance. Confirm the survivor and the load balancer handle 50 consecutive readiness requests:

   ```sh
   STAGING_BASE_URL=https://staging.example \
   STAGING_INSTANCE_URLS=https://web-1.example,https://web-2.example \
   STAGING_EXPECT_DOWN_URL=https://web-1.example \
   npm run staging:failover
   ```

4. Repeat the short k6 gate against the load balancer with one instance stopped. Restore the instance, wait for readiness, and repeat step 1.
5. During the test, record API p95/p99, PostgreSQL connections, PgBouncer waiters, Redis fallback, queue failures/lag, worker heartbeats, dropped iterations, and load-generator CPU. A release fails if any configured alert fires or any gate script exits non-zero.

## Till reconciliation mismatch

1. Treat the venue till report as the source for money received and FoodGood as the source for reservation intent.
2. Compare completed pickup codes, amounts, timestamps, cancellations, and no-shows.
3. Do not edit completed orders silently. Record the venue, order, discrepancy, owner, and resolution in support/audit notes.
4. Pause the affected venue if staff completed pickup codes before receiving payment or if inventory cannot be reconciled.

## Backup restore drill

Use an isolated, empty PostgreSQL 16 database. Run `npm run staging:restore` with `STAGING_DATABASE_URL`, `RESTORE_DATABASE_URL`, and `RESTORE_CONFIRM_EMPTY=true`. Keep the resulting counts, start/end time, RPO/RTO, operator, and S3 object verification as drill evidence. Never point `RESTORE_DATABASE_URL` at staging or production.
