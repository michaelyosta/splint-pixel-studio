# Splint Pixel Studio: понятная инструкция для первого staging/deploy

Этот документ объясняет, как впервые разместить Splint Pixel Studio в интернете и открыть его как Telegram Mini App. Он рассчитан на человека, который раньше не разворачивал Telegram-приложения.

Главная мысль: в этом репозитории есть код frontend, Node.js API, миграции и локальный `docker-compose.yml`, но нет готового production Dockerfile, reverse proxy, Terraform/IaC или автоматического deploy. Docker Compose из репозитория поднимает только PostgreSQL и MinIO, а не само приложение. Поэтому hosting для frontend, API и домена нужно выбрать отдельно.

> **Безопасный порядок:** сначала staging с тестовыми данными и отдельным ботом, затем ручная проверка, затем production. Не вставляйте токены в Git, чат, скриншоты или `VITE_*`-переменные.

---

## 1. Как устроен продукт

```text
Telegram Web App (HTTPS)
          │  initData
          ▼
Frontend: собранный Vite dist/
          │  /api/* (reverse proxy убирает префикс /api)
          ▼
Node.js / Express API :3001
       │             │
       ▼             ▼
PostgreSQL       S3/MinIO
данные, прогресс  private originals
```

В браузере при разработке Vite проксирует `/api` на `http://localhost:3001` (`vite.config.js`). В собранном клиенте по умолчанию используется `VITE_API_URL=/api` (`src/api/client.js`), поэтому production reverse proxy должен направлять `/api/...` к API и убрать префикс `/api`. Сам Express API знает маршруты `/health`, `/colorings`, `/feed` и т. д.; маршрута `/api` в нём нет.

### Что где находится

| Часть | Фактическая точка входа | Что делает |
|---|---|---|
| Frontend | `src/main.jsx`, `src/App.jsx` | Каталог, плеер, создание раскрасок, сохранение прогресса |
| Сборка frontend | `npm run build` → `dist/` | Статические файлы для HTTPS-hosting |
| API | `server/index.js` | Express, авторизация, маршруты, health check |
| База | `server/db.js`, `server/database/migrations.js` | SQLite по умолчанию или PostgreSQL при `DATABASE_URL` |
| Файлы | `server/services/media-storage.js` | Локальное хранилище или S3-compatible private originals |
| Telegram SDK | скрипт в `index.html`, `src/lib/telegram.js` | `ready`, `expand`, тема, haptics, BackButton, share |
| Локальная инфраструктура | `docker-compose.yml` | Только PostgreSQL 16, MinIO и создание bucket |

---

## 2. Что понадобится до начала

Поставьте галочки до того, как запускать команды:

- [ ] Node.js 20 или новее. В `server/package.json` указано `engines.node >=20`; Node 22 использовался в проверках.
- [ ] npm (поставляется вместе с Node.js).
- [ ] Git и копия проекта.
- [ ] HTTPS-домен, например `stage.example.com`. Telegram Mini App нельзя считать production-ready на обычном `http://`.
- [ ] Сервер или hosting, где можно запустить Node.js API и поставить PostgreSQL/S3 либо подключиться к managed-сервисам.
- [ ] Тестовый Telegram-бот и его Bot Token. Для staging лучше отдельный бот, а не production-бот.
- [ ] PostgreSQL database и пользователь с минимальными нужными правами.
- [ ] S3-compatible bucket (AWS S3, Cloudflare R2, Backblaze, MinIO и т. п.) с private-доступом.
- [ ] Доступ к DNS и настройкам TLS-сертификата.
- [ ] Secret manager или защищённая панель переменных hosting-а.

Если какой-то пункт отсутствует, приложение можно изучать локально, но это ещё не deploy Telegram Mini App.

### Что подтверждено локально, а что нет

По последнему аудиту репозитория:

- локальные unit, API, SQLite, PostgreSQL Docker и MinIO проверки проходили;
- frontend собирается командой `npm run build`;
- локальный launcher запускает API на `3001` и Vite на `5173`;
- настоящий Telegram WebView, боевой домен, внешний reverse proxy, production secrets, облачный S3 и реальный backup/restore не проверены;
- локальные Docker-проверки не доказывают, что выбранный hosting корректно работает в production.

---

## 3. Staging и production — не одно и то же

### Staging

Это безопасная репетиция:

- отдельный домен (`stage.example.com`);
- отдельный Telegram-бот;
- отдельная PostgreSQL database;
- отдельный S3 bucket;
- отдельные ключи и переменные;
- можно использовать тестовые изображения и пользователей.

Staging должен быть максимально похож на production, но его данные не должны быть ценными.

### Production

Это публичная среда с реальными пользователями. В production нельзя включать dev-auth и demo seed. Сервер намеренно завершает запуск, если не заданы обязательные Telegram, PostgreSQL, S3, CORS и proxy-параметры (`server/config.js`).

Не переносите staging database или bucket в production простым переименованием: создайте отдельные ресурсы и проверьте backup/restore.

---

## 4. Подготовка проекта локально

В корне репозитория выполните в PowerShell:

```powershell
npm.cmd ci
npm.cmd --prefix server ci
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run test:integration
npm.cmd --prefix server test
```

Если `npm ci` сообщает о несовпадении lock-файла, не используйте `npm install` для исправления вслепую: сначала проверьте, что checkout соответствует выбранному commit.

Для локальной работы с SQLite достаточно скопировать `.env.example` в `.env.local`, включить dev-auth и запустить два процесса. Этот режим **не является** способом запуска production.

Для локальной репетиции PostgreSQL и MinIO:

```powershell
docker compose up -d postgres minio minio-init
docker compose ps
```

`docker-compose.yml` хранит данные в volumes `postgres_data` и `minio_data`. Убедитесь, что оба сервиса healthy, прежде чем запускать API.

---

## 5. Переменные окружения без секретов

В production переменные передаются процессу API через secret manager или защищённую панель hosting-а. Не создавайте production `.env` в репозитории.

### Обязательные переменные API

| Переменная | Пример формы | Назначение и правило |
|---|---|---|
| `NODE_ENV` | `production` | Включает строгую проверку production-конфигурации |
| `PORT` | `3001` | Порт Express API за reverse proxy |
| `DATABASE_URL` | `postgresql://user:password@host:5432/db` | Production обязана использовать PostgreSQL |
| `STORAGE_DRIVER` | `s3` | В production значение должно быть ровно `s3` |
| `S3_ENDPOINT` | `https://s3.example.com` | Endpoint S3-compatible сервиса |
| `S3_BUCKET` | `splint-originals-stage` | Private bucket для исходных изображений |
| `S3_ACCESS_KEY_ID` | `stage-access-key` | Ключ сервисного пользователя, не Telegram-токен |
| `S3_SECRET_ACCESS_KEY` | `***` | Секрет S3, только в secret manager |
| `S3_REGION` | `us-east-1` | Регион, если его требует выбранный S3 |
| `TELEGRAM_BOT_TOKEN` | `***` | Токен BotFather; сервер проверяет Telegram `initData` |
| `CORS_ORIGINS` | `https://stage.example.com` | Точный HTTPS origin, без пути и завершающего `/` |
| `TRUST_PROXY` | `203.0.113.10/32` | IP/CIDR reverse proxy; не число hop count |
| `ALLOW_DEV_AUTH` | `false` | В production `true` запрещено кодом |
| `SEED_DEMO_DATA` | `false` | В production `true` запрещено кодом |

`TRUST_PROXY` должен содержать реальные адреса вашего proxy, а не пример из таблицы. Если proxy использует несколько адресов, перечислите их через запятую.

### Переменные frontend

| Переменная | Рекомендация |
|---|---|
| `VITE_API_URL` | Оставьте `/api`, если proxy обслуживает API на том же домене. Иначе укажите полный HTTPS API origin на этапе `npm run build`. |
| `VITE_ALLOW_DEV_AUTH` | Не задавать или оставить `false` для production-сборки. |
| `VITE_DEV_USER_ID` | Только локальная разработка; не секрет, но не нужен в production. |
| `VITE_SHOW_COLORING_DIAGNOSTICS` | Оставить `false`. |

Любая переменная `VITE_*` попадает в JavaScript bundle. Никогда не помещайте туда Bot Token, пароль базы или S3 secret.

---

## 6. PostgreSQL и миграции

### Managed PostgreSQL (рекомендуется для первого deploy)

1. Создайте отдельную staging database.
2. Создайте пользователя приложения с доступом только к этой database.
3. Скопируйте готовый `DATABASE_URL` в secret manager.
4. Проверьте сетевое правило: API-хост может подключиться к PostgreSQL, публичный интернет — нет.
5. Один раз примените миграции:

   ```powershell
   npm.cmd --prefix server run migrate:postgres
   ```

   Команда должна выполняться с теми же переменными окружения, что и API.

6. Проверьте таблицу `schema_migrations` и наличие последних migration versions в checkout.
7. При первом запуске production отдельно выполните `npm.cmd --prefix server run bootstrap:system`, если нужны определения achievements, collections и каталог. Не включайте `SEED_DEMO_DATA`.

Миграции также запускаются при `initDb()` во время старта API, но ручной запуск до первого старта даёт более понятный лог. Уже применённый SQL-файл нельзя редактировать: `server/database/migrations.js` проверяет SHA-256 checksum и остановит API при несовпадении.

### Локальный Docker PostgreSQL

`docker compose up -d postgres` использует значения `POSTGRES_*` из `.env` или значения по умолчанию для разработки. Это тестовая база. Не оставляйте development password доступным в интернете и не используйте его в production.

---

## 7. S3/MinIO и приватные изображения

Splint принимает пользовательские PNG/JPEG/WebP как data URL и сохраняет исходник через `server/services/media-storage.js`. В production сервер требует S3 driver. Исходные файлы предназначены для private storage и не должны раздаваться публичным URL.

### Создайте bucket

1. Создайте новый bucket только для staging, например `splint-originals-stage`.
2. Оставьте public access выключенным.
3. Создайте отдельный access key только для этого bucket.
4. Разрешите приложению только нужные операции (`PutObject`, `DeleteObject` и чтение, если его требует выбранный S3-провайдер). Не выдавайте владельцу приложения глобальный admin.
5. Запишите endpoint, bucket, region и ключи в secret manager.

В локальном Compose сервис `minio` слушает `9000`, web console — `9001`, а `minio-init` создаёт bucket из `S3_BUCKET`. Это удобная локальная проверка, но не модель публичного production bucket.

### Ограничения, которые нужно учитывать

- исходник принимает только `image/png`, `image/jpeg`, `image/webp`;
- размер исходника ограничен 10 MiB в `media-storage.js`;
- preview ограничен 300 000 символами в `server/routes/colorings.js`;
- JSON body Express ограничен 15 MiB в `server/index.js`;
- оригинальный media key не отдаётся в обычном DTO coloring API;
- удаление coloring пытается удалить private original, но backup и orphan cleanup нужно проверить отдельно.

После настройки выполните тест: загрузите небольшое тестовое изображение, убедитесь, что artwork создаётся, а попытка открыть объект по публичному URL невозможна. Сам API не заменяет bucket policy.

---

## 8. Соберите и разместите frontend

### Вариант с одним доменом (проще всего)

1. На build-машине задайте production `VITE_*` без секретов.
2. Выполните:

   ```powershell
   npm.cmd run build
   ```

3. Разместите содержимое `dist/` на HTTPS static hosting или на том же сервере, где работает reverse proxy.
4. Настройте fallback для client-side routes на `index.html`.
5. Направьте запросы `/api/` на Express API `http://127.0.0.1:3001/`, убирая префикс `/api`.
6. Убедитесь, что `https://stage.example.com/api/health` возвращает JSON со `status: "ok"`.

Концептуальный пример для Nginx (адреса и TLS-блок адаптируйте под свой hosting):

```nginx
server {
    listen 443 ssl;
    server_name stage.example.com;

    root /srv/splint/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:3001/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Этот фрагмент не является готовой конфигурацией для копирования в production: добавьте сертификаты, firewall, лимиты тела запроса и логирование по правилам выбранного proxy. Важен сам контракт: браузер видит `/api`, а Express получает `/health`, `/colorings` и другие реальные пути.

### Запустите API

На сервере с установленными зависимостями и переменными:

```powershell
npm.cmd --prefix server start
```

Для постоянного процесса используйте systemd, Windows service, managed Node hosting или другой process manager. В репозитории такой manager не настроен. API должен быть доступен reverse proxy на `127.0.0.1:3001`, а PostgreSQL и S3 не должны быть открыты через интернет без необходимости.

Проверьте до Telegram:

```powershell
Invoke-WebRequest https://stage.example.com/api/health
```

Ожидается HTTP 200 и JSON с `status: "ok"`.

---

## 9. Настройте Telegram Mini App

### Создайте staging-бота

1. В Telegram найдите `@BotFather`.
2. Выполните `/newbot` и сохраните выданный token в secret manager. Не публикуйте token.
3. Откройте настройки бота и настройте кнопку меню (`Bot Settings` → `Menu Button` → `Configure menu button`) с HTTPS URL staging Mini App.
4. Если ваша конфигурация BotFather предлагает отдельную настройку Web App / Main Mini App, укажите тот же staging URL.
5. Откройте бота с тестового Telegram-аккаунта и нажмите кнопку. Не проверяйте production-бота до завершения staging smoke-test.

В URL указывайте именно `https://stage.example.com`, без `http://`, локального `127.0.0.1` или случайного Cloudflare Quick Tunnel. Quick Tunnel удобен для краткого локального теста, но его адрес меняется и он не заменяет стабильный staging domain.

### Что произойдёт при входе

1. `index.html` загружает Telegram Web App SDK.
2. `src/main.jsx` вызывает `initializeTelegramWebApp()`.
3. SDK предоставляет `window.Telegram.WebApp.initData`.
4. `src/api/client.js` отправляет её в `X-Telegram-Init-Data`.
5. `server/middleware/auth.js` проверяет HMAC, `auth_date` (не старше 24 часов и не более чем на 5 минут в будущем), извлекает Telegram user ID и создаёт локального пользователя `tg_<id>` при первом входе.
6. Забаненный пользователь получает `403 ACCOUNT_BANNED`.

`X-User-Id` предназначен только для локального dev-auth. В production `ALLOW_DEV_AUTH=true` блокируется на старте, поэтому отсутствие Telegram `initData` должно приводить к `401`, а не к созданию произвольного пользователя.

---

## 10. Первый staging smoke-test

Выполняйте этот список с настоящего Telegram-аккаунта, а не только в обычном Chrome:

| Шаг | Действие | Ожидаемый результат |
|---:|---|---|
| 1 | Открыть кнопку Mini App в staging-боте | Открывается HTTPS-приложение без 401 в каталоге |
| 2 | Открыть DevTools/серверный лог | В запросах есть `X-Telegram-Init-Data`, не `X-User-Id` |
| 3 | Открыть готовую раскраску | Загружаются template, zones и progress |
| 4 | Закрасить несколько клеток | Прогресс сохраняется, после обновления клетки на месте |
| 5 | Закрыть Mini App и открыть снова | Незавершённая работа восстанавливается |
| 6 | Завершить раскраску | Сервер принимает завершение и создаёт artwork |
| 7 | Вернуться в каталог | Пользователь видит собственный результат согласно visibility |
| 8 | Создать раскраску из маленького PNG | Приватный template создаётся; оригинал не публичен |
| 9 | Переключить visibility | Только владелец может публиковать собственную user-created раскраску |
| 10 | Открыть ссылку как второй пользователь | Private template и чужой progress недоступны |
| 11 | Отправить устаревший/подменённый initData в тестовой среде | API отвечает 401; не создаёт нового пользователя |
| 12 | Открыть `https://stage.example.com/api/health` | HTTP 200 и `status: "ok"` |

Пункты 1, 2 и 11 нельзя подтвердить локальным unit-тестом: они требуют настоящего Telegram WebView и staging domain.

---

## 11. Backup и восстановление

Backup должен включать **и PostgreSQL, и S3 objects**. Одной копии базы недостаточно: в базе хранятся media keys, а сами исходные изображения лежат в bucket.

### Перед первым production-релизом

1. Сделайте PostgreSQL custom dump:

   ```powershell
   pg_dump --format=custom --file="splint-YYYYMMDD-HHMM.dump" "$env:DATABASE_URL"
   ```

2. Скопируйте S3 objects в отдельное защищённое место. Для AWS CLI это может быть:

   ```powershell
   aws s3 sync "s3://$env:S3_BUCKET" ".\splint-objects-YYYYMMDD-HHMM"
   ```

   Для MinIO/S3-compatible endpoint используйте профиль и параметры, соответствующие вашему провайдеру.

3. Сохраните размер файла, количество объектов, checksum/etag (если они доступны) и дату.
4. Храните backup вне application host и отдельно от исходных credentials.

### Обязательная проверка restore

Не называйте backup рабочим, пока не восстановили его в отдельную recovery database и отдельный recovery bucket:

```powershell
createdb splint_recovery
pg_restore --exit-on-error --dbname=splint_recovery splint-YYYYMMDD-HHMM.dump
```

После восстановления проверьте `schema_migrations`, пользователей, progress, artworks и несколько объектов S3. Не подключайте recovery database к production без отдельного решения. В репозитории нет автоматического backup job; расписание, retention, шифрование и alerting нужно настроить на выбранной инфраструктуре.

---

## 12. Частые ошибки и спокойный план диагностики

### API не стартует: missing production configuration

Откройте лог и проверьте по одному: `TELEGRAM_BOT_TOKEN`, `DATABASE_URL`, `STORAGE_DRIVER=s3`, все `S3_*`, `CORS_ORIGINS`, `TRUST_PROXY`. Это fail-closed поведение `server/config.js`, а не повод включать dev-auth.

### `Telegram Mini Apps authorization required`

- приложение открыто в обычном браузере, а не в Telegram;
- BotFather указывает старый URL;
- SDK не загрузился;
- production bundle случайно собран с локальными dev-флагами.

Проверьте вкладку Network и серверный лог. Не добавляйте `X-User-Id` вручную в production.

### CORS error

`CORS_ORIGINS` должен быть точным HTTPS origin, например `https://stage.example.com`, без `/`, `/api` и wildcard `*`. Убедитесь, что proxy действительно отправляет тот же host и scheme, которые видит Node.

### `502 Bad Gateway`

Проверьте, что API-процесс слушает `3001`, reverse proxy смотрит на правильный адрес, а `/api/health` снимает `/api` перед передачей в Express. Затем посмотрите API-лог и firewall.

### `Checksum mismatch for applied migration`

Не редактируйте уже применённый migration SQL. Проверьте checkout и SHA файла; для нового изменения нужна новая migration. Существующая база не должна чиниться удалением `schema_migrations` без backup и плана восстановления.

### S3 upload не работает

Проверьте endpoint из API-сервера, bucket, region, clock синхронизацию и IAM policy. Запрос к S3 из ноутбука не доказывает, что именно production API-хост имеет сетевой доступ.

### Большое изображение или результат получает 413/400

Текущие лимиты — исходник 10 MiB, preview 300 KB, общий JSON body 15 MiB. Это фактические ограничения кода, а не обещание поддержки произвольных больших изображений. Для теста начните с маленького PNG.

### `EADDRINUSE`

Порт 3001 уже занят API, а 5173 — Vite. На Windows:

```powershell
Get-NetTCPConnection -LocalPort 3001 -State Listen
Get-NetTCPConnection -LocalPort 5173 -State Listen
```

Закройте старый процесс только после проверки его PID. Для локального launcher оставьте окна API, frontend и tunnel открытыми.

---

## 13. Чек-лист «можно считать staging готовым»

- [ ] Есть стабильный HTTPS staging domain.
- [ ] Frontend `dist/` отдаётся по этому домену, а client-side fallback работает.
- [ ] `/api/health` возвращает `status: ok`.
- [ ] API стартует с `NODE_ENV=production` без dev-auth и demo seed.
- [ ] PostgreSQL migrations применены и checksum не менялся.
- [ ] System bootstrap выполнен, если staging использует системный каталог.
- [ ] S3 bucket private; upload и delete тестового original подтверждены.
- [ ] `CORS_ORIGINS` и `TRUST_PROXY` соответствуют реальной инфраструктуре.
- [ ] BotFather указывает staging URL отдельного бота.
- [ ] В Telegram WebView работает вход, каталог, раскраска, сохранение и возврат.
- [ ] Проверена изоляция private template и чужого progress.
- [ ] Сделан PostgreSQL + S3 backup и проверено восстановление в изолированную среду.
- [ ] Секреты не попали в Git, `dist/`, логи или screenshots.

## 14. Чек-лист перед production

Production можно планировать только после успешного staging-чек-листа и решения по оставшимся security-рискам в `SECURITY_FOLLOWUPS.md` и `docs/AUDIT_FINDINGS.md`.

- [ ] Выбран отдельный production bot, domain, database и bucket.
- [ ] Проверены IAM, firewall, TLS renewal, monitoring и error alerts.
- [ ] Есть расписание backup, retention и регулярный restore drill.
- [ ] Зафиксирован release commit, а migrations применяются один раз из этого checkout.
- [ ] API и frontend разворачиваются совместимыми версиями.
- [ ] Нет `ALLOW_DEV_AUTH=true`, `VITE_ALLOW_DEV_AUTH=true` и `SEED_DEMO_DATA=true`.
- [ ] Проверены Telegram WebView, CORS, proxy headers и private objects на production-like окружении.
- [ ] Есть понятный rollback для frontend/API и plan восстановления данных; migration rollback автоматически не предполагается.

### Что пока нельзя обещать

Эта инструкция не подтверждает работу на конкретном cloud provider, реального BotFather WebView, production reverse proxy, production S3/IAM, DNS/TLS и backup/restore. Эти пункты нужно выполнить руками и записать результат для выбранной инфраструктуры.

Связанные документы: [deployment-runbook.md](deployment-runbook.md), [authentication.md](authentication.md), [database-operations.md](database-operations.md), [PROJECT_MAP.md](PROJECT_MAP.md), [SECURITY_FOLLOWUPS.md](../SECURITY_FOLLOWUPS.md).

---

## 15. Что уже проверено локально (01.08.2026)

В текущем окружении выполнена production-like локальная репетиция без реального Telegram и без публичного домена:

- Docker PostgreSQL и MinIO подняты через `docker compose up -d postgres minio minio-init`; оба healthcheck — `healthy`, bucket инициализирован.
- `npm.cmd --prefix server run test:postgres` — `90 passed, 0 skipped, 0 failed`.
- `node --test server/test/media-storage-s3.integration.test.js` с MinIO — `1 passed`: upload, `HeadObject` с `image/png`, delete и ожидаемый `404`.
- API с `NODE_ENV=production`, `STORAGE_DRIVER=s3`, PostgreSQL и MinIO стартовал на отдельном локальном порту; `/health` вернул `200`, запрос без Telegram `initData` — `401`.
- Разрешённый `CORS_ORIGINS` получил `Access-Control-Allow-Origin`; произвольный origin этого заголовка не получил. Helmet выдал CSP и HSTS.
- `npm.cmd run build` завершился успешно; Vite preview отдал собранный HTML и bundle с `200`.

Обнаружено ограничение staging: первый запуск API на PostgreSQL проходит, но повторный запуск с `SEED_DEMO_DATA=true` при уже существующих catalog rows падает до HTTP-startup из-за несогласованного статуса (`server/db.js:214` записывает `archived`, а `server/migrations/001_initial.sql:46` разрешает только `active/hidden/deleted`). Это зарегистрировано как `OPS-006` в [AUDIT_FINDINGS.md](AUDIT_FINDINGS.md) и требует отдельного исправления идемпотентного seed. Не обходите проблему ручным изменением схемы или удалением `schema_migrations`.

Это подтверждает локальную связность конфигурации и сервисов, но **не является staging sign-off**: не проверялись настоящий Telegram WebView/initData, DNS/TLS, внешний reverse proxy, cloud S3/IAM, production secrets и backup/restore drill.
