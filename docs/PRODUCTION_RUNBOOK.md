# FoodGood production runbook

## Monitoring setup

Scrape `GET /api/metrics` from the web service with `Authorization: Bearer $METRICS_SECRET` every 30 seconds. Load `ops/prometheus/alerts.yml` into the Prometheus-compatible alert manager. Also configure Render workspace notifications for deploy failure and unhealthy services; these platform notifications are configured in the Render Dashboard, not in `render.yaml`.

The web metrics endpoint aggregates durable queue state and all four worker heartbeats from PostgreSQL. Background workers do not need public inbound ports.

## Web or database down

1. Check the latest Render deploy and `/api/health/ready`.
2. Pause deploys; do not run a second migration.
3. Check Render Postgres availability, connection usage, and PgBouncer.
4. If data is damaged, perform point-in-time recovery into a new isolated database, validate it, then switch services together.

## Worker heartbeat missing

1. Identify the stale worker in `/api/health/deep`.
2. Check its Render logs and restart only that worker.
3. Confirm the durable queue drains and `foodgood_queue_lag_seconds` returns below 60.
4. Investigate expired leases before manually retrying any provider mutation.

## Payment needs review

1. Locate the operation and its `PaymentEvent` records in the admin operations screen.
2. Query Freedom Pay by `providerRef` before retrying. Never create a second payment to compensate for an unknown result.
3. For a held payment, either capture after pickup or cancel the hold. For a captured payment, use refund/revoke.
4. Record operator, provider reference, amount, decision, and evidence in the audit log.

## Reconciliation mismatch

1. Treat Freedom Pay as the source for actual card movement and FoodGood as the source for order intent.
2. Compare provider reference, amount, currency, captured flag, clearing amount, and revoked/refunded amount.
3. Freeze automatic action for the affected payment. Resolve it with an explicit capture/cancel/refund and document the decision.
4. Re-run reconciliation and confirm a successful event before closing the incident.

## Backup restore drill

Use an isolated, empty PostgreSQL 16 database. Run `npm run staging:restore` with `STAGING_DATABASE_URL`, `RESTORE_DATABASE_URL`, and `RESTORE_CONFIRM_EMPTY=true`. Keep the resulting counts, start/end time, RPO/RTO, operator, and S3 object verification as drill evidence. Never point `RESTORE_DATABASE_URL` at staging or production.
