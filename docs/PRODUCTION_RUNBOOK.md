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

## Delayed pickup reminders

`foodgood_delayed_reminders` counts `PICKUP_REMINDER` jobs that are more than five minutes past `nextAttemptAt` and are still pending, retrying, or processing.

1. Check notification-worker heartbeat, `foodgood_queue_oldest_age_seconds{queue="notifications"}`, failed jobs, expired leases, and PostgreSQL/PgBouncer saturation.
2. Keep reservations and pickup windows available to venue/support staff; do not claim that a reminder was sent until the durable `Notification` record confirms it.
3. Restart only the notifications worker if its heartbeat is stale. Let leases expire and be reclaimed; do not clear lease fields manually.
4. If a pickup window is near, have the support owner contact the affected pilot customers through the approved channel and record the contact against the order without copying OTP data.
5. Close only after `foodgood_delayed_reminders` is zero, the queue drains, failed jobs are resolved, and the affected orders are reviewed for missed pickup impact.

## Inventory mismatch

`foodgood_inventory_mismatch_bags` detects oversold quantities and `ACTIVE`/`SOLD_OUT` status inconsistencies. A merchant's intentional stock reduction is not a mismatch unless committed orders plus remaining inventory exceed the published total.

1. Pause new reservations for every affected bag or venue; do not silently rewrite completed orders or till totals.
2. Capture bag ID, venue, `quantityTotal`, `quantityLeft`, committed order quantities/statuses, recent audit entries, and reconciliation timestamp in restricted evidence.
3. Compare FoodGood completed orders and pickup codes with the venue till/receipt report. The till is the source for money received; FoodGood is the source for reservation intent.
4. Determine whether the cause is an in-flight reservation, staff action, data repair, or defect. Apply a reviewed, transaction-safe repair only after preserving the original values.
5. Reopen only when the metric is zero, the venue/till discrepancy is resolved, and a second owner has reviewed the repair evidence.

## Overdue or mass complaints

`foodgood_overdue_complaints` counts open cases with no first contact two hours after `supportOpenedAt`. Treat three related complaints in 60 minutes, complaints affecting at least 20% of one pickup cycle, or any food-safety allegation as a mass-complaint incident even if the SLA metric is still zero.

1. Assign an incident owner and a case owner for every order. Pause the affected bag/venue when complaints share a venue, batch, pickup window, or safety symptom.
2. Preserve order, venue, complaint category/note, first-contact time, venue response, resolution, and customer confirmation. Keep personal data out of public channels.
3. Contact every affected customer within two hours; use one coordinated message approved by the incident owner, but retain individual case accountability.
4. For suspected food safety, follow [food incident](#food-incident). For personal-data exposure, follow [privacy breach](#privacy-breach).
5. Close only after the complaint metric is zero, the cluster/root cause is documented, each case has a resolution, and the venue resume/stop decision has an approver.

## Suspicious logins

`foodgood_suspicious_login_challenges` counts OTP challenges created in the last 15 minutes with at least three failed code attempts. It intentionally exposes no phone or IP labels.

1. Check the aggregate metric, OTP/rate-limit error rate, Redis availability, and structured application logs. Do not paste phone numbers, OTP hashes, bot tokens, or raw webhook payloads into incident chat.
2. If activity is concentrated or rising, temporarily restrict the invite cohort and reduce traffic at the edge while retaining the PostgreSQL idempotency/rate-limit boundary.
3. For a suspected account compromise, block the account, increment `sessionVersion` through the supported logout-all/block workflow, and preserve relevant audit evidence.
4. Rotate a secret only when exposure is suspected; coordinate rollout so web and both workers keep matching `METRICS_SECRET`, and Telegram keeps its independently managed webhook/token credentials.
5. Close after the signal returns to zero or is explained, affected accounts are reviewed, and any control change has an owner and rollback point.

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
   npm run staging:failover:check
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
   npm run staging:failover:check
   ```

4. Repeat the short k6 gate against the load balancer with one instance stopped. Restore the instance, wait for readiness, and repeat step 1.
5. During the test, record API p95/p99, PostgreSQL connections, PgBouncer waiters, Redis fallback, queue failures/lag, worker heartbeats, dropped iterations, and load-generator CPU. A release fails if any configured alert fires or any gate script exits non-zero.

## Till reconciliation mismatch

1. Treat the venue till report as the source for money received and FoodGood as the source for reservation intent.
2. Compare completed pickup codes, amounts, timestamps, cancellations, and no-shows.
3. Do not edit completed orders silently. Record the venue, order, discrepancy, owner, and resolution in support/audit notes.
4. Pause the affected venue if staff completed pickup codes before receiving payment or if inventory cannot be reconciled.

## Food incident

1. Immediately suspend the affected bag/venue and stop pickup of the suspected batch. Do not delete orders, complaints, photos, or audit records.
2. Assign an incident owner; record report time, reporter, venue, bag/pickup window, order IDs, symptoms/allegation, and product traceability supplied by the venue in a restricted record.
3. Contact affected customers with approved safety guidance and a support route. Do not diagnose, minimize, or promise compensation through FoodGood; pilot payment remains with the venue till.
4. Require the venue to isolate the food and provide its traceability/handling evidence. Escalate to the named safety/legal owner and relevant authority according to the approved notification matrix.
5. Resume only with documented root cause, affected-scope decision, venue corrective action, customer follow-up, and explicit approval. If scope is uncertain, keep the venue suspended.

## Privacy breach

1. Contain access without destroying evidence: revoke exposed sessions/credentials, restrict the affected export/object/path, and pause the responsible feature if needed.
2. Assign the privacy incident owner and record discovery time, data categories, likely subjects/records, systems, access window, and who received the data. Store evidence in the approved restricted location.
3. Rotate only affected secrets and verify independent session, OTP, webhook, metrics, database, Redis, and S3 credentials remain distinct. Never include their values in tickets or logs.
4. Ask the privacy/legal owner to assess notification duties and deadlines using the approved jurisdiction/contact matrix; do not claim regulatory notification is complete without evidence.
5. Validate containment, session revocation, access logs, S3 permissions, exports, and deletion/return by unintended recipients where applicable. Close only with approver, impact record, corrective actions, and follow-up date.

## Application rollback

1. Stop the rollout and new migrations. Record release SHA/deployment ID, previous known-good artifact, incident owner, and rollback decision time.
2. Confirm the previous application is compatible with the current database schema. Prisma migrations are forward-only operationally: do not delete `_prisma_migrations`, run `migrate resolve` blindly, or reverse SQL against production.
3. Roll back web and both worker processes to the same compatible artifact. Keep only one migration deploy active and leave affected venues paused if data correctness is uncertain.
4. Run live/ready/deep and authenticated web/worker metrics gates, then a reservation/cancellation/redeem smoke flow that uses venue till payment only.
5. Compare inventory, reminder queue, complaint SLA, suspicious-login signals, 5xx, and latency to the pre-deploy baseline. Reopen traffic gradually and retain deployment/monitoring evidence.
6. If rollback cannot restore data compatibility, follow the verified backup/PITR procedure into an isolated database, validate it, then switch services together.

## Backup restore drill

Use an isolated, empty PostgreSQL 16 database and matching-major `pg_dump`/`pg_restore` clients; the script rejects older or newer client majors before changing the target. Run `npm run staging:restore` with `STAGING_DATABASE_URL`, `RESTORE_DATABASE_URL`, and `RESTORE_CONFIRM_EMPTY=true`. Record results in [the backup restore drill evidence template](evidence/BACKUP_RESTORE_DRILL_TEMPLATE.md), including source/restored database counts, start/end time, achieved RPO/RTO, owner, and object-level S3 verification. Never point `RESTORE_DATABASE_URL` at staging or production. A successful database script does not prove S3, alerting, Telegram, backup scheduling, or hosting recovery.
