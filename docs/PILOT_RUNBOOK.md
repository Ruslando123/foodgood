# FoodGood closed-pilot runbook (1–2 venues, then 3–5)

## Entry criteria

- Staging migration, smoke, load, and isolated backup restore are complete with recorded evidence.
- No bank, card-provider, commission, or online-refund configuration exists in the web service.
- Every pilot venue confirms that it accepts payment on its own till and issues the fiscal receipt before completing the pickup code.
- Timestamped evidence demonstrates Telegram OTP webhook health, S3/CDN access, required worker heartbeats, and alert delivery to the on-call owner. Configuration alone does not satisfy these external gates.
- `main` requires the `production-gate` status check and disallows direct/force pushes.
- The support owner can open `/admin/support`, contact a customer within two hours, and record the resolution against the order.

## Venue selection

Choose an initial 1–2 venues with a named owner, predictable pickup window, fewer than 10 pilot bags per day, and staff available to scan/enter pickup codes. Record the venue IDs, owner contacts, opening dates, support contact, and daily order cap before activation. Expand to 3–5 venues and invite 20–50 customers in controlled cohorts only after the first phase passes [the pilot checklist](PILOT_CHECKLIST.md). Keep a named owner for each cohort and do not add a cohort until the previous pickup cycle is reconciled.

## Customer cohorts and consent

1. Create a new random invite code for each cohort. Store only its SHA-256 digest in `PILOT_INVITE_CODE_HASH`; never put the plaintext code in Git, logs, screenshots, or analytics.
2. Send the plaintext code only to the named cohort. Existing accounts can continue signing in after the hash is rotated; only new accounts need the current code.
3. Every new customer must separately accept the displayed, versioned terms and privacy policy. Each acceptance is written to the audit log. News and special offers use a third, optional switch in Settings and remain off by default.
4. Use the admin CSV only for the stated pilot communication. It contains only active customers with current privacy acceptance and active communications consent. Access is recorded in the audit log.
5. Account deletion requests immediately deactivate login, revoke all sessions and optional communications, and enter the retention queue. Do not manually delete orders, support cases or audit rows that must be retained for legal/accountability review.

## Server-enforced pilot scope

The pilot runs only in `PAY_AT_VENUE` mode. Configure the city, district centre/radius, allowed categories and caps with the `FOODGOOD_PILOT_*` variables documented in `.env.example`. Public reviews are off by default. Before each cohort, verify that direct API requests for another city or disabled category are rejected and that venue, offer and customer reservation caps cannot be exceeded.

Do not enable delivery, PREPAID, loyalty or AI in the pilot. The customer pays the actual venue seller at its cash desk and receives that seller's fiscal receipt; FoodGood never initiates an automatic refund.
5. Store the downloaded CSV in an approved encrypted location, do not upload it to third-party mailing tools, and delete working copies after the communication is completed. Revoked contacts disappear from subsequent exports.

## Daily operating loop

1. Before sales: verify `/api/health/deep`, expiry/notification worker heartbeats, Telegram OTP delivery, and S3 access.
2. During sales: watch `RESERVED` orders, no-shows, inventory, and customer support. Encourage each customer to use the order-card “Обратная связь или помощь” entry point; it is linked to that order.
3. At pickup: staff accepts payment, issues the venue receipt, then confirms the pickup code. FoodGood does not collect or settle pilot money.
4. Record reservations, successful pickups, cancellations, no-shows, support cases, and the amount accepted by each venue. For every support case, record first-contact time, owner, venue response, resolution, and whether the customer confirmed it was resolved.
5. Reconcile completed FoodGood orders against each venue's till report at the end of the day.

## Rollout guardrails

- Start with 1–2 venues for at least one full pickup cycle; expand to 3–5 only after every till line is reconciled, inventory mismatches are zero, and support cases meet the two-hour first-contact target.
- Pause new orders immediately for a code completed before payment, missing receipt, negative inventory, repeated no-shows, or untested restore evidence.
- Pause a venue's new orders when an open support case passes two hours without customer contact; resume only after the case owner documents the response.
- Do not expand beyond five venues or 50 invited customers until seven consecutive days reconcile cleanly with venue till reports and the backup restore drill meets the agreed RPO/RTO.
