# FoodGood launch checklist

## Required infrastructure

- Managed PostgreSQL with SSL and automated backups.
- Application hosting with HTTPS and all secrets stored outside Git.
- A cron invocation every minute:

  ```http
  POST /api/internal/reconcile
  Authorization: Bearer <CRON_SECRET>
  ```

- An SMS adapter accepting `POST { "type": "OTP", "phone": "+7...", "code": "123456" }`
  with `Authorization: Bearer <SMS_WEBHOOK_TOKEN>`.
- A real payment provider implementing `PaymentProvider` in `src/lib/payments.ts`.

## Required production environment

```env
NODE_ENV=production
DATABASE_URL=postgresql://...
SESSION_SECRET=<at least 32 random bytes>
OTP_SECRET=<different random secret>
CRON_SECRET=<different random secret>
ADMIN_PHONE=+7...
SMS_WEBHOOK_URL=https://...
SMS_WEBHOOK_TOKEN=...
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
