# FoodGood closed-pilot checklist

Copy this file for each phase and link every checked item to timestamped evidence. An unchecked item or a statement without evidence keeps the gate open.

## Shared release evidence

- [ ] Owner, date/time, release SHA, application deployment ID, and database target are recorded.
- [ ] `production-gate` passed, including explicit migration deploy and migration status validation.
- [ ] `npm run production:env:check` passed against the exact deployed environment; no secret values are copied into evidence.
- [ ] `npm run production:health:check` output identifies healthy live/ready/deep endpoints and both worker metrics targets.
- [ ] Alert-routing test reached the named on-call owner; attach alert and receipt timestamps.
- [ ] Telegram OTP contact-match, expiry, single-use, and lockout evidence is attached.
- [ ] S3 upload/read/delete and CDN-read evidence is attached.
- [ ] Backup restore drill evidence is complete using [the drill template](evidence/BACKUP_RESTORE_DRILL_TEMPLATE.md).
- [ ] No unresolved inventory mismatch, delayed reminder, failed queue job, or complaint beyond the two-hour first-contact SLA exists.
- [ ] No bank, card, settlement, commission, or online-refund flow is enabled; customers pay at each venue's till.

## Phase A — 1–2 venues

- [ ] Each venue has an ID, named venue owner, FoodGood owner, support contact, daily bag cap, and pickup window.
- [ ] Staff rehearsed: accept till payment, issue venue receipt, then complete the FoodGood pickup code.
- [ ] A named internal customer cohort and invite-code owner are recorded.
- [ ] At least one reservation → till payment/receipt → completion flow passed per venue.
- [ ] At least one cancellation restored inventory per venue; no refund workflow was invoked.
- [ ] One order-linked complaint reached `/admin/support`, received first contact within two hours, and has a recorded resolution.
- [ ] Notifications worker stop/restart preserved and drained the durable queue.
- [ ] At least one complete pickup cycle was reconciled line by line against each venue's till report.
- [ ] Every discrepancy has order ID, venue, expected/actual amount and status, owner, resolution, and closure timestamp.
- [ ] Phase decision is recorded as `GO`, `HOLD`, or `STOP`, with approver and evidence links.

## Phase B — 3–5 venues

- [ ] Phase A is `GO`; no Phase A evidence item is waived silently.
- [ ] New venues completed the same staff rehearsal and one controlled pickup before a larger cohort was invited.
- [ ] Named cohorts total no more than 20–50 invited customers.
- [ ] Daily reconciliation covers every active venue: FoodGood completed orders, till lines, receipt presence, cancellations, and no-shows.
- [ ] Inventory mismatch remains zero and all worker/queue/reminder signals remain within gate thresholds.
- [ ] Complaint volume is below the mass-complaint trigger and every case meets the two-hour first-contact SLA.
- [ ] Expansion stops at five venues/50 invites until seven consecutive daily reconciliations are clean and RPO/RTO targets are met.

## Daily till reconciliation record

| Date | Venue ID | FoodGood completed count/amount | Till count/amount | Receipt exceptions | Cancellations/no-shows | Difference | Owner | Evidence link | Status |
|---|---|---:|---:|---:|---:|---:|---|---|---|
| YYYY-MM-DD | | | | | | | | | OPEN |

Do not edit completed orders to make totals match. Investigate and retain the original records and resolution evidence.
