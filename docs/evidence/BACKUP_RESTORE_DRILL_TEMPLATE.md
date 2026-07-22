# Backup restore drill evidence — YYYY-MM-DD

Use an isolated, empty PostgreSQL 16/PostGIS target. Redact credentials and customer data. A checkbox is not evidence: attach immutable logs, screenshots, object metadata, or query output with timestamps.

## Ownership and scope

| Field | Value |
|---|---|
| Drill ID | |
| Backup/source environment | |
| Restore target (non-production) | |
| Release SHA / migration head | |
| Operator (restore owner) | |
| Incident/on-call owner | |
| Start time (UTC) | |
| Service restored time (UTC) | |
| Validation complete time (UTC) | |
| Next drill date | |

## RPO and RTO

| Objective | Agreed target | Achieved | Evidence/calculation | Pass? |
|---|---:|---:|---|---|
| RPO | | | backup snapshot timestamp → last durable record timestamp | |
| RTO | | | restore start → validated service-ready timestamp | |

Record both restoration time and validation time. If either target is missing or missed, the restore gate is not closed; add an owner and due date for remediation.

## Database restore and counts

- Backup artifact ID, creation timestamp, encryption evidence:
- Restore command/run ID (secrets redacted):
- `npm run db:migrate:validate` output:
- `npm run test:upgrade` output against an isolated copy:
- Integrity output from `npm run staging:restore`:

| Table/check | Source count/result | Restored count/result | Match? | Evidence link |
|---|---:|---:|---|---|
| `User` | | | | |
| `Venue` | | | | |
| `Bag` | | | | |
| `Order` | | | | |
| `Notification` | | | | |
| `BatchJob` | | | | |
| negative inventory | 0 | | | |
| duplicate pickup codes | 0 | | | |
| failed Prisma migrations | 0 | | | |
| PostGIS extension/version | | | | |

Explain every expected count difference (for example, writes after the backup cutoff). Unexplained differences fail the drill.

## S3 verification

| Check | Expected | Observed | Timestamp | Evidence link | Pass? |
|---|---|---|---|---|---|
| Referenced object sample/count derived from restored DB | all selected keys exist | | | | |
| Object size and checksum/ETag against backup manifest | match documented manifest semantics | | | | |
| Content type and allowed extension | jpg/png/webp only | | | | |
| CDN read for restored sample | HTTP 200 and correct content | | | | |
| Upload/read/delete canary in isolated prefix | succeeds without unrelated-bucket access | | | | |
| Missing/orphan object report | zero or explained | | | | |

Do not mark S3 verified from database counts or `HeadBucket` alone. Record the exact sampled keys or manifest ID in a restricted evidence location, not in Git if it contains customer-linked data.

## Functional validation

- [ ] Restored web `/api/health/ready` is `ok`.
- [ ] Restored `/api/health/deep` results are attached and explained.
- [ ] Customer reservation/cancellation flow passed against the isolated restore.
- [ ] Merchant ready/redeem flow passed without a bank/refund flow.
- [ ] Worker heartbeats and reminder drain passed.
- [ ] Evidence contains no plaintext credentials, OTP values, or customer personal data.

## Outcome

Decision: `PASS` / `FAIL`  
Approver:  
Decision time (UTC):  
Open remediation items, owner, due date:  
