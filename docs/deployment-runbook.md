# Runbook развёртывания и отката

Этот документ описывает безопасную ручную процедуру для текущего репозитория. В нём намеренно нет команды «развернуть одной кнопкой»: в репозитории отсутствуют Dockerfile приложения, reverse proxy, IaC и CI-деплой. До появления этих артефактов конкретный способ доставки frontend и Node API выбирает владелец инфраструктуры.

## Граница ответственности

- API запускается командой `npm --prefix server start` и слушает `PORT` (по умолчанию 3001).
- frontend собирается `npm run build`; артефакт — `dist/`.
- production API не стартует без PostgreSQL, S3-compatible storage, Telegram bot token, точных HTTPS CORS origins и списка доверенных proxy IP/CIDR. Это проверяет `server/config.js`.
- `docker-compose.yml` предназначен только для локальных PostgreSQL и MinIO. Он **не** разворачивает приложение.

## Предварительные условия

1. Зафиксировать SHA релиза и получить зелёные jobs `verify`, `postgres`, `e2e`.
2. Использовать Node.js 22 (CI) и выполнить:

   ```bash
   npm ci
   npm --prefix server ci
   npm test
   npm run lint
   npm run build
   npm --prefix server run test:postgres
   npm run test:e2e
   npm --prefix server audit --omit=dev
   ```

3. В secret manager, а не в репозитории, задать минимум:

   ```env
   NODE_ENV=production
   PORT=3001
   DATABASE_URL=postgresql://...
   TELEGRAM_BOT_TOKEN=...
   STORAGE_DRIVER=s3
   S3_ENDPOINT=https://...
   S3_BUCKET=...
   S3_ACCESS_KEY_ID=...
   S3_SECRET_ACCESS_KEY=...
   S3_REGION=...
   CORS_ORIGINS=https://mini-app.example
   TRUST_PROXY=<точные IP или CIDR reverse proxy>
   ALLOW_DEV_AUTH=false
   SEED_DEMO_DATA=false
   ```

   `CORS_ORIGINS` допускает только полные HTTPS origins без пути; `TRUST_PROXY` не может быть числом/hop count. Не передавать `VITE_DEV_USER_ID` в production-сборку.
4. Создать private bucket до первого запуска. У application user должны быть только необходимые `PutObject`, `DeleteObject` и операции чтения, которые реально требуются выбранным storage endpoint; публичный доступ к оригиналам не включать.
5. Настроить HTTPS reverse proxy перед frontend/API, TLS и ограниченный доступ к PostgreSQL и S3. Прокси должен передавать адрес клиента корректно и иметь адрес, включённый в `TRUST_PROXY`.
6. На первой production-инсталляции отдельным контролируемым запуском выполнить `npm --prefix server run bootstrap:system`. Не использовать `SEED_DEMO_DATA`: production configuration его блокирует.

## Backup перед каждым релизом

Сначала подтвердить, что backup завершён и доступен вне узла приложения. Не выполнять миграции, пока это не сделано.

```bash
# PostgreSQL: выполняется с узла, где доступен pg_dump.
pg_dump --format=custom --file="splint-$(date +%F-%H%M%S).dump" "$DATABASE_URL"

# S3: пример для AWS CLI. Для MinIO/S3-compatible окружения используйте
# эквивалентную команду с его endpoint и профилем.
aws s3 sync "s3://$S3_BUCKET" "./splint-objects-$(date +%F-%H%M%S)"
```

Проверить размер/контрольные суммы архива, число объектов и доступность копии из отдельного места хранения. Локальный drill от 28.07.2026 подтвердил восстановление PostgreSQL в изолированную базу (6 миграций, 21 таблица) и чтение контрольного MinIO-объекта из изолированного bucket; он не заменяет drill на production IAM, endpoint и объёме данных.

## Выпуск

1. Включить maintenance/read-only режим на уровне платформы, если он доступен, либо запланировать короткое окно для миграций.
2. Выполнить миграции один раз на production URL:

   ```bash
   npm --prefix server run migrate:postgres
   ```

   Файлы из `server/migrations/` не редактировать после применения: их checksum контролируется в `schema_migrations`.
3. Собрать клиент `npm run build` и опубликовать ровно этот `dist/` на выбранном HTTPS-hosting.
4. Развернуть ровно тот же SHA API с production secrets и запустить `npm --prefix server start`.
5. Проверить `/health`, затем вручную в настоящем Telegram Mini App:

   - вход с валидным Telegram `initData`;
   - отказ при истёкшем/подменённом `initData`;
   - запросы frontend с разрешённого origin и отказ браузера с постороннего origin;
   - загрузку, чтение и удаление тестового private original;
   - создание и сохранение раскраски.
6. Проверить логи на migration/configuration errors, рост 4xx/5xx и rate-limit события. Снять maintenance только после этих smoke checks.

## Откат

1. При ошибке нового API немедленно вернуть предыдущий проверенный frontend artifact и предыдущий API SHA. Это безопасно только когда старая версия совместима с уже применённой схемой.
2. В репозитории нет down migrations. **Не** пытаться автоматически откатывать PostgreSQL-миграции и не восстанавливать базу поверх активной production-базы без отдельного окна и подтверждённого backup.
3. Если данные повреждены, остановить записи, сохранить текущий state для расследования, создать новую пустую recovery-базу и восстановить custom dump туда:

   ```bash
   createdb splint_recovery
   pg_restore --exit-on-error --dbname=splint_recovery splint-<timestamp>.dump
   ```

   Сверить `schema_migrations`, количество критичных таблиц и выборочно пользователей/works. Только после проверки согласовать переключение приложения на recovery database.
4. Восстановить S3 в отдельный recovery bucket, сравнить inventory и несколько объектов по содержимому, затем переключать application configuration. Не делать массовый `sync --delete` в рабочий bucket без утверждённого плана и вторичного backup.
5. Зафиксировать SHA, время, затронутые миграции, состояние данных и решение об откате в incident log.

## Нерешённые обязательные действия до публичного production

- Владелец инфраструктуры должен выбрать и зафиксировать hosting, reverse proxy, secrets/IAM, monitoring и retention backups.
- Нужны production drills для Telegram, PostgreSQL, S3 и фактического домена. Кодовые и локальные Docker-проверки не доказывают эти границы.
- Защита прогресса раскраски должна быть проверена после её серверной реализации отдельными API и E2E негативными сценариями.
