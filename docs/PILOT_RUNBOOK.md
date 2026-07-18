# FoodGood pilot runbook (1–3 venues)

## Entry criteria

- Staging migration, smoke, load, and isolated backup restore are complete with recorded evidence.
- No bank, card-provider, commission, or online-refund configuration exists in the web service.
- Every pilot venue confirms that it accepts payment on its own till and issues the fiscal receipt before completing the pickup code.
- Telegram OTP webhook is healthy, S3/CDN health is green, required worker heartbeats are green, and alerts reach the on-call owner.
- `main` requires the `production-gate` status check and disallows direct/force pushes.

## Venue selection

Choose 1–3 venues with a named owner, predictable pickup window, fewer than 10 pilot bags per day, and staff available to scan/enter pickup codes. Record the venue IDs, owner contacts, opening dates, refund contact, and daily order cap before activation.

## Daily operating loop

1. Before sales: verify `/api/health/deep`, expiry/notification worker heartbeats, Telegram OTP delivery, and S3 access.
2. During sales: watch `RESERVED` orders, no-shows, inventory, and customer support.
3. At pickup: staff accepts payment, issues the venue receipt, then confirms the pickup code. FoodGood does not collect or settle pilot money.
4. Record reservations, successful pickups, cancellations, no-shows, support cases, and the amount accepted by each venue.
5. Reconcile completed FoodGood orders against each venue's till report at the end of the day.

## Rollout guardrails

- Start with one venue for at least one full pickup cycle; add the second/third only after reconciliation is clean.
- Pause new orders immediately for a code completed before payment, missing receipt, negative inventory, repeated no-shows, or untested restore evidence.
- Do not expand beyond three venues until seven consecutive days reconcile cleanly with venue till reports and the backup restore drill meets the agreed RPO/RTO.
