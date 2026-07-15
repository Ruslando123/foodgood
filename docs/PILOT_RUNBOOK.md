# FoodGood pilot runbook (1–3 venues)

## Entry criteria

- Staging migration, smoke, load, and isolated backup restore are complete with recorded evidence.
- Freedom Pay production merchant is enabled for two-step payments/manual clearing; signed callback and provider status lookup are verified with a real low-value transaction.
- Mobizon sender is approved, S3/CDN health is green, all four worker heartbeats are green, and alerts reach the on-call owner.
- `main` requires the `production-gate` status check and disallows direct/force pushes.

## Venue selection

Choose 1–3 venues with a named owner, predictable pickup window, fewer than 10 pilot bags per day, and staff available to scan/enter pickup codes. Record the venue IDs, owner contacts, opening dates, refund contact, and daily order cap before activation.

## Daily operating loop

1. Before sales: verify `/api/health/deep`, worker heartbeats, Freedom Pay balance/status, Mobizon balance, and S3 access.
2. During sales: watch stuck intermediate orders, queue lag, payment failures, and customer support.
3. After pickup: compare every pilot `Payment` and `PaymentEvent` with Freedom Pay provider reference, amount, captured flag, and refund/revoke amount.
4. Resolve all `NEEDS_REVIEW` and reconciliation mismatches the same day. Never create a replacement payment for an unknown provider result.
5. Record orders, successful pickups, cancellations, refunds, support cases, payment mismatches, and alert response times per venue.

## Rollout guardrails

- Start with one venue for at least one full pickup cycle; add the second/third only after reconciliation is clean.
- Pause new orders immediately for signature failures, incorrect amount/currency, duplicate capture, unavailable refunds, stale payment worker over two minutes, negative inventory, or untested restore evidence.
- Do not expand beyond three venues until seven consecutive days have no unresolved payment mismatch and the backup restore drill meets the agreed RPO/RTO.
