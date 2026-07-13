# FoodGood 🌱 — маркетплейс излишков еды

MVP фудшеринг-платформы для Казахстана: кофейни, пекарни и супермаркеты продают свежую, но нераспроданную еду в конце дня со скидкой 60–70% в формате **«пакетов-сюрпризов»**. Покупатель оплачивает пакет в приложении (деньги холдируются), приходит в окно выдачи и показывает QR-код — заказ завершается, деньги уходят заведению за вычетом комиссии платформы.

## Быстрый старт

```bash
npm install
npm run db:generate
npm run db:push   # применяет схему к PostgreSQL из DATABASE_URL
npm run seed      # демо-данные: 6 заведений Алматы + пакеты на вечер
npm run dev       # http://localhost:3000
```

Фоновые процессы запускаются независимо от web-приложения:

```bash
npm run worker:payments
npm run worker:expiry
npm run worker:notifications
npm run worker:outbox
```

Workers постоянно забирают короткие пакеты задач через `FOR UPDATE SKIP LOCKED`; их можно масштабировать независимо количеством процессов. HTTP-запросы только изменяют локальное состояние и атомарно ставят durable job в PostgreSQL.

`20260711134610_init` — полная baseline-миграция, включая `PaymentOperation`. Не отмечайте её
как applied на существующей базе: Prisma пропустит создание новой таблицы. Для локальной базы
разработчика безопаснее пересоздать схему:

```bash
DATABASE_URL="..." npx prisma migrate reset
```

Для production-базы с данными нужна отдельная проверенная data migration/бэкап; не применяйте
baseline через `migrate resolve` без сверки фактической схемы.

Демо-аккаунты (код подтверждения всегда `0000`):

| Роль       | Телефон        |
|------------|----------------|
| Покупатель | `+77070000001` |
| Мерчант    | `+77010000001` |
| Мерчант 2  | `+77010000002` |

## Что внутри

- **Покупатель** (`/`) — список и карта пакетов поблизости (геолокация + сортировка по расстоянию), карточка пакета, мок-оплата с холдированием, «Мои заказы» с QR-кодом для выдачи, отмена с возвратом денег.
- **Заведение** (`/business`) — дашборд (выручка, комиссия, «спасено пакетов»), публикация пакета-сюрприза в пару кликов, выдача заказа по коду с кассы, регистрация заведения с точкой на карте.
- **API** (`/api/*`) — REST на route handlers; платёжные операции имеют уникальный idempotency key, статусы `CAPTURE_PENDING`/`REFUND_PENDING` и lease-based reconciliation для безопасных повторов.

## Тесты

```bash
npm test   # поднимает временный PostgreSQL через Docker Compose, применяет миграции и запускает Vitest
npm run test:upgrade # обновляет схему коммита e5efe8a и требует пустой prisma migrate diff
```

Для CI или уже запущенной БД достаточно передать `TEST_DATABASE_URL` — Docker тогда не используется.

Тесты покрывают жизненный цикл заказа, отказ провайдера, recovery после сбоя БД и параллельные worker retry. Тестовый контейнер использует PostgreSQL 16 + PostGIS.

## Нагрузочный прогон

[`load/k6.js`](load/k6.js) содержит warm-up (5 мин), ожидаемый peak (15 мин), spike 2× (7 мин) и soak (30 мин), а также отдельные сценарии каталога, истории, уведомлений, гонки за последний пакет, выдачи, массового истечения и деградации mock-провайдера. Перед запуском staging должен быть заполнен production-подобным объёмом данных.

```bash
LOAD_SEED_CONFIRM=foodgood-load-only \
LOAD_VENUES=100 LOAD_BAGS_PER_VENUE=50 LOAD_EXPIRY_ORDERS=10000 \
npm run load:seed

BASE_URL=https://staging.example \
LOAD_FIXTURE_FILE=load/fixtures.local.json \
LOAD_TEST_CONTROL_SECRET='staging-only-secret' \
npm run load:k6

LOAD_FIXTURE_FILE=load/fixtures.local.json \
LOAD_DRAIN_TIMEOUT_MS=300000 npm run load:check
```

Seed создаёт production-подобный каталог, пул изолированных customer/merchant-сессий, отдельный пакет с остатком `1`, большой degradation-пакет, оплаченные заказы для выдачи и 10 000 истекающих заказов. Сессионные cookies пишутся с правами `0600` в игнорируемый `load/fixtures.local.json` и не выводятся в лог. Web и payments worker изолированного staging должны получить `LOAD_TEST_MODE=true` и одинаковый `LOAD_TEST_CONTROL_SECRET`; production blueprint оставляет mode выключенным и вообще не содержит control secret. k6 аварийно останавливается, если fault не сохранился или payment worker не подтвердил его применение. Финальная проверка контролирует fault statistics, терминальные ошибки, согласованность Order/Payment/Operation, успешные HOLD/CAPTURE, точного победителя last-bag, queue drain и lease.

## Production-инфраструктура

- Redis (`REDIS_URL`) обслуживает rate limit и короткий кэш идемпотентных ответов. Durable результат заказа остаётся в PostgreSQL.
- Фото сохраняются в S3-compatible storage; `S3_PUBLIC_BASE_URL` должен указывать на CDN. Локальная файловая система остаётся только fallback для разработки.
- Каталог фильтруется и сортируется PostgreSQL, использует PostGIS/GiST для радиуса, trigram-индексы для поиска, агрегированный рейтинг и составной cursor.
- `/api/metrics` отдаёт Prometheus-метрики HTTP/query latency, queue depth/oldest age, expired leases, heartbeat, соединений БД и payment failures. Каждый worker отдаёт свои process-метрики на `WORKER_METRICS_PORT` (`/metrics`). Правила находятся в [`ops/alerts.yml`](ops/alerts.yml), действия — в [`ops/runbook.md`](ops/runbook.md).
- `DATABASE_CONNECTION_LIMIT` ограничивает Prisma pool каждого процесса. Конфигурация `render.yaml`: web 5 + workers 4/3/3/3 = 18 соединений; лимит PgBouncer/PostgreSQL должен оставлять минимум 20% резерва сверх этого и административных подключений.
- Миграции используют отдельный `DIRECT_URL`; PgBouncer URL применяется только работающими web/worker процессами.
- Health разделён на дешёвые `/api/health/live` и `/api/health/ready`, а также кэшируемый на 20 секунд `/api/health/deep` для очередей, workers и S3.
- Pickup reminder создаётся как scheduled durable job при успешном HOLD; старые заказы один раз догоняются командой `npm run jobs:backfill-reminders` после миграций, без постоянного сканирования обычным worker.
- Worker `/metrics` запускается только при явно заданном `WORKER_METRICS_PORT`; поэтому локальные workers не конфликтуют за порт, а изолированные deployment-процессы могут использовать собственные значения.

## Текущее состояние

- Есть рабочий покупательский сценарий: список и карта пакетов, геолокация, карточка пакета, демо-оплата, заказы, QR-код и отмена до начала окна выдачи.
- Есть кабинет заведения: регистрация точки, публикация пакетов, статистика, список активных пакетов и выдача заказа по коду.
- Есть серверная бизнес-логика: атомарный резерв остатков, статусы заказов, mock hold/capture/refund и независимо масштабируемые workers.
- Есть базовая авторизация: вход по телефону с dev-кодом `0000`, Telegram WebApp `initData`, httpOnly JWT-cookie.
- Есть демо-данные для Алматы, Prisma-схема и тесты для ключевых доменных правил.

## Что сделать дальше

Подробный поэтапный план развития продукта и архитектуры лежит в [`docs/PRODUCT_ARCHITECTURE_ROADMAP.md`](docs/PRODUCT_ARCHITECTURE_ROADMAP.md).

### Перед пилотом

- Выдать production credentials Mobizon и проверить approved sender, delivery receipts и баланс; OTP уже имеет TTL, rate limit, атомарный лимит попыток и production SMS adapter.
- Добавить Freedom Pay adapter и подписанные webhooks поверх уже реализованных hold/capture/refund, идемпотентности, retries и журнала платёжных событий.
- Провести и задокументировать восстановление PostgreSQL/S3 из backup в изолированное окружение.
- Усилить роли и доступы: явная проверка `MERCHANT`, приглашения сотрудников заведения, разделение владельца и кассира.

### Для продукта

- Добавить повтор заказа с проверкой актуальной цены и доступности пакета.
- Добавить push-канал и production-шаблоны SMS/Telegram для уже существующей durable notification очереди.
- Развить жалобы по качеству в отдельный SLA-процесс с вложениями и историей решений.

### Для эксплуатации

- Подключить существующие Prometheus endpoints и `ops/alerts.yml` к выбранному production-мониторингу.
- Расширить production-build e2e сценариями отмены и истечения заказа.
- Подготовить production-деплой: переменные окружения, секреты, домен, HTTPS, CSP/security headers.
- Проверить UX на мобильных устройствах и Telegram WebView, включая плохую сеть, отказ геолокации и пустые состояния.

## Стек

Next.js 15 (App Router, TypeScript) · Prisma + PostgreSQL/PostGIS · Redis · S3/CDN · Tailwind CSS 4 · Leaflet + OpenStreetMap · JWT-сессии в httpOnly-cookie (`jose`).

## Ключевые модули

| Файл | Назначение |
|------|-----------|
| `src/lib/orders.ts` | Жизненный цикл заказа: транзакционный резерв остатка, hold/capture/refund, выдача по коду |
| `src/lib/payments.ts` | Интерфейс `PaymentProvider` + мок-реализация |
| `src/lib/auth.ts` | Сессии, вход по телефону (dev-код `0000`), нормализация номеров КЗ |
| `src/lib/telegram.ts` | Верификация `initData` Telegram WebApp + уведомления через бота |
| `src/lib/config.ts` | Комиссия платформы (22%), категории, центр карты |
| `src/lib/jobs.ts` | Durable batch jobs для массовых уведомлений и возвратов |
| `src/modules/catalog/db.ts` | SQL-каталог, PostGIS и cursor pagination |
| `prisma/schema.prisma` | User / Venue / Bag / Order / Payment / BatchJob |

## Как подключить продакшен-интеграции

- **Платёжный шлюз**: для пилота выбран Freedom Pay с ручным клирингом; реализуйте `PaymentProvider` после получения test merchant credentials.
- **SMS-код**: выбран Mobizon Kazakhstan; durable OTP уже хранится в PostgreSQL, для production нужны `MOBIZON_API_KEY` и зарегистрированное имя отправителя.
- **Telegram WebApp**: создайте бота у @BotFather, пропишите `TELEGRAM_BOT_TOKEN` в `.env`, укажите URL приложения как WebApp — авторизация по `initData` и уведомления о выдаче заработают автоматически.
- **Карта 2ГИС/Яндекс**: карта изолирована в `src/components/MapView.tsx` — замените Leaflet-слой на MapGL с API-ключом.
- **PostgreSQL**: требуется PostgreSQL 16 с расширениями PostGIS и `pg_trgm`; применяйте миграции через `prisma migrate deploy`.

## Бизнес-модель

Платформа удерживает комиссию **22%** (`PLATFORM_FEE_PCT` в `src/lib/config.ts`) с каждого выданного заказа; комиссия фиксируется в заказе на момент покупки. Для заведения выручка от пакетов — это деньги из того, что иначе пошло бы в списание.
