# Повторная проверка security follow-ups

Проверка: 28 июля 2026, основная ветка `origin/main` — `750b9f25cd7429b6ddeb63c7721f802951486b76`. Рабочая ветка `feature/public-alpha-hardening` — **draft PR #10**, поэтому её изменения не считаются исправлением основной ветки.

## Сводка

| Severity | Open | Partially resolved | In progress | Resolved | Requires environment validation |
|---|---:|---:|---:|---:|---:|
| critical | 1 | 0 | 0 | 0 | 0 |
| high | 3 | 0 | 0 | 0 | 1 |
| medium | 3 | 2 | 1 | 0 | 0 |
| low | 0 | 1 | 1 | 0 | 0 |

## Активные проблемы

| ID | Severity | Статус | Проблема и доказательство | Остаточный риск / направление |
|---|---|---|---|---|
| SEC-001 | critical | open | `npm --prefix server audit --omit=dev` сообщает GHSA-m7jm-9gc2-mpf2 для транзитивного `fast-xml-parser` (1 critical, 17 moderate). Цепочка начинается с прямого production dependency `@aws-sdk/client-s3`, используемого в `server/services/media-storage.js`. Доступно исправление npm; версия должна быть проверена на совместимость AWS SDK. | Уязвимая XML-обработка достижима при S3-сценарии; не обновлять lockfile без отдельной проверки storage. |
| SEC-002 | high | open | `POST /meta/achievements/:id/unlock` в `server/routes/meta.js` основной ветки проверяет лишь существование achievement и вставляет его для `req.userId`. | Любой авторизованный пользователь выдаёт себе любое достижение прямым API. Нужна server-authoritative проверка условий. |
| SEC-003 | high | partially_resolved | `PUT /colorings/:id/progress` теперь возвращает 405; `POST /colorings/:id/progress/actions` принимает не более 64 изменений и сервер сам строит `filled`, проверяя каждый цвет по `template.cells`. | Нельзя подменить карту, процент или completion одним запросом; проверка есть в `server/test/api.integration.test.js`. Однако `GET /colorings/:id` всё ещё раскрывает карту, поэтому модифицированный клиент может автоматизировать последовательность допустимых действий. |
| SEC-004 | medium | open | Тот же endpoint принимает `resultDataUrl` и сохраняет его в `artworks.image_url` после только префиксной/PNG-signature проверки (`validateResultDataUrl`). | Пользователь может опубликовать произвольное изображение как результат. Нужен server rendering либо криптографически/семантически проверяемый результат. |
| SEC-005 | medium | partially_resolved | `server/services/media-storage.js`: UUID и `safeLocalPath()` защищают локальный путь, MIME allowlist и 10 MiB лимит есть. Но `decodeImageDataUrl()` не декодирует изображение и не ограничивает dimensions/pixels; S3 key/delete не подтверждены интеграцией. | Malformed/decompression-bomb изображение и поведение object storage требуют отдельной проверки. |
| SEC-006 | medium | partially_resolved | `server/index.js` основной ветки применяет единый `express-rate-limit` 100/min по IP. Нет per-user/per-route лимитов и persistent store. | Write, analytics, reports и финансовые API в multi-instance могут обходить лимит. |
| SEC-007 | medium | open | `validateTelegramInitData()` в `server/middleware/auth.js` отвергает старую подпись, но не будущий `auth_date`: условие только `Date.now()/1000 - authDate > 86400`. | Подписанный initData с future timestamp остаётся действительным дольше ожидаемого. |
| SEC-008 | medium | open | `POST /meta/analytics` ограничивает имя события 64 символами, но записывает произвольный `payload` при глобальном JSON limit 15 MiB (`server/routes/meta.js`, `server/index.js`). | Хранилище analytics можно раздувать валидными запросами. Нужны схема, малый limit и отдельный quota. |
| SEC-013 | medium | in_progress | Main `POST /reports/create` в `server/routes/moderation.js` не имеет target validation/deduplication; новый `services/reporting.js` существует только в draft PR #10. | Исправление не в main и не подтверждено production-тестом. |
| SEC-009 | low | in_progress | В non-production `server/index.js` использует `cors({ origin: '*' })`; strict CORS есть только в draft PR #10. | Main остаётся уязвимым до merge и production validation. |
| SEC-010 | low | partially_resolved | Telegram identity формируется сервером (`tg_<id>`), HMAC используется. Но `ensureTelegramUser()` создаёт профиль один раз и не обновляет разрешённые profile поля. | Это не даёт захватить identity, но данные профиля устаревают; реальный WebView не проверен. |
| SEC-011 | high | open | `POST /meta/streak/touch` в `server/routes/meta.js` меняет streak любого текущего дня без доказательства игрового действия. | Статистику можно накрутить прямым API; нужны server-derived события/правила. |
| SEC-012 | high | requires_environment_validation | Основная ветка требует bot token и запрещает `ALLOW_DEV_AUTH` в production (`server/index.js`), но реальный Telegram Mini App, HTTPS domain и секреты не запускались. | Нельзя считать production authentication подтверждённой без реального initData smoke-test. |

## Закрытые проблемы (история сохранена)

| Finding | Старое заявление | Новый статус | Основание в main | Подтверждение и ограничения |
|---|---|---|---|---|
| SF-001 / Stars transactions | «DONE in PR #7» | resolved | PR #7 влит commit `279cce1`; `server/services/stars-transactions.js`, migration 005, idempotency и immutable ledger присутствуют в `origin/main`. | Server suite содержит SQLite/concurrency tests. PostgreSQL-подтверждение требует `DATABASE_URL`, поэтому это не доказательство всей PG-инфраструктуры. |
| SF-002 / Seed-reset | «DONE in PR #3» | resolved | PR #3 (`5a6cdbf`) в main; `server/index.js` запускает demo seed только при `SEED_DEMO_DATA=true`, production блокирует этот флаг. | Code + server tests. Fresh production bootstrap не проверялся. |
| SF-007 / SQLite-Postgres sync | «DONE in PR #3» | partially_resolved | Миграции и checksum runner есть в `server/database/migrations.js`; SQLite и PostgreSQL варианты миграций существуют. | Локально PostgreSQL tests skipped без `DATABASE_URL`; статус не может быть resolved. |
| SF-012 / Database runtime integrity | «DONE in PR #4» | partially_resolved | PR #4 (`45cc808`) в main: transaction context и CAS в `server/db.js`, `server/routes/colorings.js`. | SQLite tests подтверждают conflict handling; прямой forged-progress API остаётся (SEC-003), а PG не запущен. |

## Проблемы в работе — draft PR #10

Исправление **ещё не находится в основной ветке и не должно считаться закрытым**.

| Связанные finding | Статус | Код в PR #10 | Что меняется | Почему не closed |
|---|---|---|---|---|
| CORS / production config | in_progress | `server/config.js`, `server/index.js` | HTTPS allowlist origins, explicit proxy CIDR, обязательные PG/S3 config, Helmet CSP. | PR #10 draft, merge commit отсутствует. |
| Report abuse | in_progress | `server/services/reporting.js`, `server/routes/moderation.js` | validation, duplicate handling, transaction/audit actions. | PR #10 draft; production route в main всё ещё принимает reports без этой логики. |
| Public DTO/content integrity | in_progress | migration 006, `colorings.js`, `meta.js`, `posts.js`, `profiles.js` | исправляет template/artwork relation и уменьшает лишние поля DTO. | PR #10 draft; main не содержит migration 006. |
| Banned accounts | in_progress | `server/middleware/auth.js` | authenticated user проверяется на `is_banned`. | В main после auth `next()` вызывается без такой проверки. |

## Требующие инфраструктурной проверки

| Finding | Статус | Что именно не доказано |
|---|---|---|
| Telegram auth | requires_environment_validation | Реальная подпись/initData, WebView, HTTPS origin и lifecycle токена. Синтетические tests не заменяют это. |
| PostgreSQL | requires_environment_validation | Все PostgreSQL suites пропущены без `DATABASE_URL`; транзакции, migration checksum и concurrency не запускались на реальном сервере. |
| S3/MinIO | requires_environment_validation | Нет integration test create/delete, private ACL, orphan cleanup и error/retry для `server/services/media-storage.js`. |
| Production CORS/proxy/secrets | requires_environment_validation | Main использует `origin: '*'`; proposed strict config только в draft PR #10. Нужен deploy behind actual proxy. |

## Журнал изменений статусов

| Дата проверки | Finding | Старый статус | Новый статус | Основание |
|---|---|---|---|---|
| 2026-07-28 | SEC-001 | open | open | Повторный server production audit: 1 critical + 17 moderate. |
| 2026-07-28 | SEC-002 | open | open | Direct unlock endpoint в `origin/main` остаётся. |
| 2026-07-28 | SF-001 | DONE | resolved | PR #7 реально merged в main; code и SQLite tests существуют. |
| 2026-07-28 | SF-007 | DONE | partially_resolved | PG tests skipped, поэтому full database parity не доказан. |
| 2026-07-28 | Report/CORS/content fixes | отсутствовал / follow-up | in_progress | Код существует только в draft PR #10. |

## Дополнение от 28.07.2026: проверка текущего HEAD draft PR #10

Проверен commit `77f2b95` ветки `feature/public-alpha-hardening` (PR [#10](https://github.com/michaelyosta/splint-pixel-studio/pull/10), draft). Этот раздел **не меняет состояние `origin/main`**: все перечисленные исправления имеют статус `in_progress` до merge в основную ветку.

| Finding | Старый статус для main | Статус в реестре | Доказательство исправления в draft | Подтверждение | Остаточное ограничение |
|---|---|---|---|---|---|
| SEC-001 — AWS/`fast-xml-parser` | open | in_progress | `2972fc7`: `server/package.json` и lockfile обновляют `@aws-sdk/client-s3` до `^3.1096.0`; `77f2b95` объявляет Node.js `>=20`. | `npm --prefix server audit --omit=dev --json`: 0 vulnerabilities; `node --test server/test/media-storage.test.js`: 9 passed. | S3/MinIO integration и production credentials не проверялись; до merge main остаётся уязвимым. |
| SEC-002 — произвольный unlock achievement | open | in_progress | `756826f`, `server/routes/meta.js`: endpoint отвечает `403 ACHIEVEMENT_UNLOCK_FORBIDDEN`; выдача остаётся только во внутренней игровой логике. | `server/test/api.integration.test.js`: прямой POST возвращает 403 и achievement остаётся locked. | Не решает SEC-003: completion всё ещё можно подделать полным `filled`. |
| SEC-007 — future Telegram `auth_date` | open | in_progress | `756826f`, `server/middleware/auth.js`: предел 24 часа и future clock skew 300 секунд. | `server/test/auth.integration.test.js`: initData на 10 минут в будущем получает 401. | Реальный Telegram WebView/initData и production clock skew требуют проверки среды. |
| SEC-008 — analytics payload | open | in_progress | `756826f`, `server/routes/meta.js`: allowlist событий, object-only payload, лимит 4096 bytes. | `server/test/api.integration.test.js`: arbitrary event — 400, `open_level` — 200. | Нет persistent per-user quota, а PR ещё не merged. |
| SEC-011 — client-controlled streak | open | in_progress | `756826f`, `server/routes/meta.js`: публичный touch endpoint возвращает 403; `src/App.jsx` и `src/api/client.js` перестали его вызывать. | `server/test/api.integration.test.js`: POST `/meta/streak/touch` — 403 и данные streak неизменны. | Полный игровой completion остаётся client-authoritative (SEC-003). |
| SEC-013 — report abuse | in_progress | in_progress | `e57b1ba`, `server/services/reporting.js` и `server/routes/moderation.js`: dedupe, per-user daily limit, row lock и moderation audit. | `server/test/security-hardening.integration.test.js` покрывает security-boundary сценарии. | PostgreSQL execution этих гарантий не проверен; PR draft. |
| SEC-014 — утечка чужих Stars/ban state через `GET /users` | отсутствовал | in_progress | `e57b1ba`, `server/routes/profiles.js`: список требует `requireRole('moderator', 'admin')`; публичный DTO не отдаёт `stars_balance`/`is_banned`. | `server/test/security-hardening.integration.test.js`: public DTO assertions; `server/test/api.integration.test.js`: sensitive fields отсутствуют в public profile. | Нужен merge и роль-based regression на deployed PostgreSQL. |
| SEC-015 — IDOR чужих неопубликованных artworks | отсутствовал | in_progress | `e57b1ba`, `server/routes/profiles.js`: владелец получает свои работы; посторонний — только distinct artworks, связанные с активным публичным post. | `server/test/security-hardening.integration.test.js`: hidden artwork отсутствуют в ответе `/users/:id/artworks`. | Нужна PG/infrastructure проверка после миграции 006. |
| SEC-016 — banned user может отправлять messages | отсутствовал | in_progress | `e57b1ba`, `server/middleware/auth.js`: `requireActiveUser()` возвращает `403 ACCOUNT_BANNED` до routes, включая `messages.js`. | `server/test/security-hardening.integration.test.js`: матрица routes для banned account; `server/test/api.integration.test.js`: banned action возвращает 403. | Не проверено на multi-instance PostgreSQL с кешированием/репликами. |

Последний запуск на draft HEAD: `npm test` — 200 passed; `npm run test:server` — 152 passed, 53 skipped (нет `DATABASE_URL`); `npm --prefix server audit --omit=dev --json` — 0 vulnerabilities. Попытка поднять `docker compose up -d postgres` не дошла до тестов: Docker Desktop daemon не запущен (`dockerDesktopLinuxEngine` отсутствует).

## Дополнение от 28.07.2026: локальная инфраструктурная проверка

На commit `cca3b43` Docker PostgreSQL 16 и MinIO были подняты через `docker-compose.yml`; оба сервиса получили статус `healthy`, а bucket `splint-originals` был создан `minio-init`.

| Контур | Результат | Что именно подтверждено | Что всё ещё не доказано |
|---|---|---|---|
| PostgreSQL | `npm --prefix server run test:postgres`: **90 passed, 0 skipped, 0 failed** | migrations 001–006, CAS progress, HTTP concurrency, report locking/audit, Stars idempotency/ledger/triggers и production config. | Реальные production topology, backup/restore, latency и replica behaviour. |
| MinIO/S3 | `server/test/media-storage-s3.integration.test.js`: **1 passed**; local storage suite: **9 passed** | `storePrivateOriginal` загружает private original, HeadObject видит `image/png`, `deletePrivateOriginal` удаляет объект и HeadObject возвращает 404. | Реальный облачный S3, IAM/policy, retry/network failures, lifecycle/orphan cleanup. |

Это снимает локальную часть `requires_environment_validation` для PostgreSQL/MinIO, но не переводит production-проверки в `resolved`. Полный `npm --prefix server test` с глобально заданным `DATABASE_URL` сейчас **не является валидной aggregate-командой**: 8 SQLite-oriented HTTP suites наследуют PostgreSQL URL и не стартуют. Использовать отдельно `test:server` (SQLite) и `test:postgres` (PostgreSQL).

## Исторический список из `main` (сохранён при merge 28.07.2026)

Этот краткий список был добавлен в `main` коммитом `bd46c84`. Он сохранён для истории; актуальные статусы и доказательства находятся выше в реестре.

| Исходный пункт | Актуальная запись / состояние |
|---|---|
| Stars transactions | `SF-001`, resolved в `main` (PR #7). |
| Seed/reset database | `SF-002`, resolved в `main` (PR #3); безопасный production bootstrap остаётся отдельным продуктовым риском. |
| Report abuse | `SEC-013`, in_progress в draft PR #10. |
| Achievements validation | `SEC-002`, in_progress в draft PR #10; SEC-003 сохраняет обход через поддельный completion. |
| N+1 queries | `ARCH-003` в `docs/AUDIT_FINDINGS.md`, open. |
| Media-storage traversal | `SEC-005`, partially_resolved: local traversal защищён, остаются image validation и production storage вопросы. |
| SQLite/Postgres sync | `SF-007`, partially_resolved; локальный PostgreSQL suite прошёл, production parity требует отдельной проверки. |
| Smart Coloring Engine injection review | Не выделен как самостоятельная подтверждённая security finding: image pipeline требует отдельной модели угроз и проверки. |
| UI animations dependencies | Не выделен как самостоятельная подтверждённая security finding; root production audit на текущей ветке чист, но это не заменяет регулярный audit. |
| Large `App.jsx` refactor | `ARCH-002` в `docs/AUDIT_FINDINGS.md`, open; это технический долг, а не самостоятельная уязвимость. |
| AWS SDK audit | `SEC-001`, in_progress в draft PR #10: на ветке audit 0 vulnerabilities, в `main` до merge остаётся уязвимое дерево. |
| Database runtime integrity | `SF-012`, partially_resolved; CAS защищает от гонок, но не устраняет `SEC-003` client-authoritative progress. |
