# Локальный production-like staging

Этот контур предназначен для проверки горизонтального web-масштабирования перед внешним staging. Он запускает PostgreSQL 16/PostGIS, PgBouncer в transaction mode, Redis, два независимых экземпляра Next.js, expiry/notifications workers и Nginx с `least_conn` балансировкой.

Клиентский адрес Nginx — `127.0.0.1:3000`. Для диагностики и failover-gate отдельные web-инстансы доступны только через loopback на портах 3001 и 3002; эти адреса не являются клиентскими endpoints. PostgreSQL, PgBouncer и Redis наружу не публикуются. Миграции подключаются напрямую к PostgreSQL; web-инстансы подключаются только через PgBouncer и имеют лимит по пять соединений каждый.

## Запуск

Требуются Docker Desktop с Compose v2 и свободные loopback-порты 3000, 3001, 3002, 9101 и 9102.

```bash
node ops/staging/create-env.mjs
docker compose --env-file .env.staging.local -f docker-compose.staging.yml config --quiet
docker compose --env-file .env.staging.local -f docker-compose.staging.yml up --build --wait
```

Генератор создаёт игнорируемый Git файл `.env.staging.local` с правами `0600`.
В нём лежат только независимые локальные секреты и настройки портов.

В local-staging телефонный сценарий намеренно использует demo OTP `0000`.
Он включён только при одновременных `FOODGOOD_E2E_DEV_OTP=true`,
`FOODGOOD_LOCAL_REHEARSAL=true` и `APP_BASE_URL` на `localhost`/`127.0.0.1`;
compose выставляет все три значения только для этого локального контура.
Новый клиент принимает политику и условия, а затем вводит `0000`. Внешний
staging и production эти флаги получать не должны.

Проверка локального контура допускает только ожидаемую деградацию object storage, поскольку S3 здесь намеренно не запускается:

```bash
set -a
source .env.staging.local
set +a
STAGING_BASE_URL=http://localhost:3000 \
METRICS_SECRET="$STAGING_METRICS_SECRET" \
STAGING_ALLOW_DEGRADED_CHECKS=storage \
npm run staging:smoke
```

Без `STAGING_ALLOW_DEGRADED_CHECKS` smoke остаётся строгим и требует полностью здоровый `/api/health/deep`.

Файл `.env.staging.local` создаётся с правами `0600`, содержит независимые случайные секреты и уже исключён правилом `.env*` из Git. Генератор никогда не перезаписывает существующие секреты.

Compose сначала ждёт PostgreSQL, применяет все Prisma-миграции через прямое соединение, затем ждёт PgBouncer и Redis и только после этого поднимает оба web-инстанса и proxy.

## Проверка

```bash
curl --fail http://localhost:3000/api/health/live
curl --fail http://localhost:3000/api/health/ready
curl --silent --dump-header - --output /dev/null http://localhost:3000/api/health/ready | grep X-FoodGood-Upstream

BASE_URL=http://localhost:3000 npm run load:k6:staging
```

Заголовок `X-FoodGood-Upstream` показывает контейнер, обработавший запрос. Несколько последовательных запросов должны задействовать оба адреса. Read-only профиль `load:k6:staging` безопасен для этого контура.

Прямая baseline-проверка двух инстансов:

```bash
STAGING_BASE_URL=http://localhost:3000 \
STAGING_INSTANCE_URLS=http://localhost:3001,http://localhost:3002 \
node scripts/staging-failover-check.mjs
```

Порты 3001/3002 следует использовать только для диагностики. Весь обычный и нагрузочный трафик направляется на порт 3000.

`/api/health/ready` проверяет рабочее подключение через PgBouncer. Оба worker-процесса пишут heartbeat в PostgreSQL и публикуют process-local метрики на внутреннем порту 9100; для локального Prometheus они доступны только через loopback на 9101 (expiry) и 9102 (notifications) с bearer-секретом. `/api/health/deep` ожидает ещё и production-хранилище фотографий; S3 не входит в этот локальный контур, поэтому только storage-проверка будет `degraded`.

## Одноразовая фикстура для ramp/soak

Профили `ramp` и `soak` изменяют данные. Перед каждым из них полностью сбросьте только local-staging volume, снова поднимите контур и создайте свежую фикстуру. Seed не запускается без точного подтверждения `foodgood-load-only`; дополнительно он принимает только PostgreSQL на `localhost`/`127.0.0.1` или внутреннем Docker host (`postgres`/`pgbouncer`) с именем БД, содержащим `test` либо `staging`. Он подключается к внутреннему PostgreSQL напрямую и записывает `load/fixtures.local.json` обратно на хост:

```bash
docker compose --env-file .env.staging.local -f docker-compose.staging.yml down --volumes
docker compose --env-file .env.staging.local -f docker-compose.staging.yml up --build --wait

LOAD_SEED_CONFIRM=foodgood-load-only \
docker compose --env-file .env.staging.local -f docker-compose.staging.yml \
  --profile load run --rm load-seed

BASE_URL=http://localhost:3000 k6 run -e LOAD_PROFILE=ramp \
  --summary-trend-stats 'avg,min,med,max,p(90),p(95),p(99)' \
  --summary-export load/ramp-summary.json load/k6.js
K6_SUMMARY_FILE=load/ramp-summary.json npm run staging:k6:check
LOAD_PROFILE=ramp \
docker compose --env-file .env.staging.local -f docker-compose.staging.yml \
  --profile load run --rm load-check
```

Для soak повторите полный сброс и seed, затем используйте тот же вызов k6 с `LOAD_PROFILE=soak`, отдельным `soak-summary.json` и `LOAD_PROFILE=soak` для `load-check`. Параметр `--summary-trend-stats` обязателен для release gate: он сохраняет p99 в JSON. Размер фикстуры можно изменить через `LOAD_VENUES`, `LOAD_BAGS_PER_VENUE`, `LOAD_CUSTOMERS`, `LOAD_RESERVATION_BAGS`, `LOAD_MERCHANTS` и `LOAD_REDEEM_ORDERS_PER_MERCHANT` перед командой seed. Не запускайте mutating-профили на сохранённой или production-базе.

## Наблюдение и отказ одного инстанса

```bash
docker compose --env-file .env.staging.local -f docker-compose.staging.yml ps
docker compose --env-file .env.staging.local -f docker-compose.staging.yml logs --tail=100 proxy web-1 web-2 worker-expiry worker-notifications pgbouncer redis postgres

docker compose --env-file .env.staging.local -f docker-compose.staging.yml stop web-1
STAGING_BASE_URL=http://localhost:3000 \
STAGING_INSTANCE_URLS=http://localhost:3001,http://localhost:3002 \
STAGING_EXPECT_DOWN_URL=http://localhost:3001 \
node scripts/staging-failover-check.mjs
docker compose --env-file .env.staging.local -f docker-compose.staging.yml start web-1
```

Proxy не повторяет неидемпотентные запросы после их отправки upstream. Защита заказа от повторов остаётся на PostgreSQL idempotency boundary.

## Остановка и удаление данных

Обычная остановка сохраняет named volume базы:

```bash
docker compose --env-file .env.staging.local -f docker-compose.staging.yml down
```

Полный сброс удаляет только volume проекта `foodgood-local-staging`. Используйте его лишь для одноразовой staging-базы:

```bash
docker compose --env-file .env.staging.local -f docker-compose.staging.yml down --volumes
```

Не используйте этот compose для production и не подставляйте в него production credentials или внешнюю production-базу.
