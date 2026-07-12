# FoodGood launch checklist

## Required infrastructure

- Render web service and managed PostgreSQL in the Frankfurt region (`render.yaml`).
- Paid PostgreSQL with backups, SSL, and all secrets stored outside Git.
- A cron invocation every minute:

  ```http
  POST /api/internal/reconcile
  Authorization: Bearer <CRON_SECRET>
  ```

- Mobizon Kazakhstan account, API key, and an approved sender name.
- Freedom Pay Kazakhstan merchant account with test mode and manual clearing enabled.
- A Freedom Pay implementation of `PaymentProvider`; production intentionally rejects the current mock.

## Required production environment

```env
NODE_ENV=production
DATABASE_URL=postgresql://...
SESSION_SECRET=<at least 32 random bytes>
OTP_SECRET=<different random secret>
CRON_SECRET=<different random secret>
ADMIN_PHONE=+7...
MOBIZON_API_KEY=...
MOBIZON_SENDER=FoodGood
FREEDOMPAY_MERCHANT_ID=...
FREEDOMPAY_SECRET_KEY=...
TELEGRAM_AUTH_ENABLED=false
TELEGRAM_NOTIFICATIONS_ENABLED=false
ALLOW_MOCK_PAYMENTS_IN_PRODUCTION=false
```

Generate independent secrets with `openssl rand -base64 48`.

## Deployment gate

```bash
npm ci
npm run lint
npx tsc --noEmit
npm test
npm run build
npx prisma migrate deploy
```

Never run `npm run seed` against production.

## Selected providers

- Hosting and PostgreSQL: Render, Frankfurt. Apply the included `render.yaml` Blueprint.
- SMS: Mobizon Kazakhstan (`https://mobizon.kz/help/api-docs/message`).
- Payments: Freedom Pay Kazakhstan (`https://freedompay.kz/docs`). Ask the manager to enable
  test mode and manual clearing (`pg_auto_clearing=0`) before integration testing.

## Staging smoke test

1. Request an SMS code and verify that it expires, cannot be reused, and locks after five failures.
2. Create an order and observe `PENDING_PAYMENT -> PAID` after cron.
3. Redeem it and observe `CAPTURE_PENDING -> COMPLETED`.
4. Cancel another paid order and observe `REFUND_PENDING -> CANCELLED`.
5. Stop cron temporarily, confirm operations remain queued, then restart it and confirm recovery.
6. Simulate provider timeout and verify `RETRY`; exhaust retries and verify it appears in `/admin/operations`.
7. Retry the operation from the admin screen and verify an audit record is created.

## Production pilot

- Start with 1–3 venues and manually reconcile every payment daily.
- Alert on failed cron runs, `NEEDS_REVIEW`, failed outbox messages, and orders stuck in an intermediate status.
- Keep a documented manual refund and customer-support procedure.
- Do not enable Telegram until its authentication and notification flows are tested separately.
