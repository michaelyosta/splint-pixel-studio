# Реестр findings: повторная проверка

Проверено 28.07.2026 на default branch `origin/main`, commit `750b9f25cd7429b6ddeb63c7721f802951486b76`. Локальная `feature/public-alpha-hardening` соответствует draft PR [#10](https://github.com/michaelyosta/splint-pixel-studio/pull/10): её изменения отмечены `in_progress`, а не закрытыми.

Сводка исходной проверки: **open 28**, **partially_resolved 6**, **in_progress 4**, **resolved 3**, **requires_environment_validation 6**, **not_reproducible 0**, **regressed 0**, **obsolete 0**, **duplicate 0** (всего 47). Статусы относятся к возможности эксплуатации или подтверждения, а не к качеству описания PR. Ниже добавлена сверка draft PR #10; она не меняет риска `origin/main`, но переводит найденные там исправления в `in_progress`.

| ID | Категория | Серьёзность | Статус | Проблема | Доказательство | Исправление | Подтверждение | Остаточный риск |
|---|---|---:|---|---|---|---|---|---|
| SEC-001 | Dependencies | critical | open | `fast-xml-parser` в production server tree. | `npm --prefix server audit --omit=dev`: GHSA-m7jm-9gc2-mpf2; цепочка `@aws-sdk/client-s3` → `@aws-sdk/core`. | Нет; npm сообщает fixAvailable. | audit, 28.07. | S3 code реально используется; обновление может быть breaking. |
| SEC-002 | Achievements | high | open | Direct unlock достижений. | `server/routes/meta.js`, `POST /achievements/:id/unlock`. | Нет. | code_only; нет negative API test. | Любой auth user выдаёт achievement себе. |
| SEC-003 | Anti-cheat | high | open | Клиент присылает готовую карту. | `server/routes/colorings.js`, `PUT /:id/progress`, `isComplete`; cells отдаются GET template. | CAS из PR #4 решает race, не доверие к карте. | integration-tested CAS, не anti-cheat. | completion/rewards обходятся API. |
| SEC-004 | Content integrity | medium | open | Client result image выдаётся за artwork. | `colorings.js`, `resultDataUrl` → `artworks.image_url`. | Только signature/size validation. | unit/integration validation. | Нет server rendering. |
| SEC-005 | Upload/storage | medium | partially_resolved | Path traversal снижен, image content недостаточно валидируется. | `media-storage.js`: UUID, `safeLocalPath`; `decodeImageDataUrl` без decode/pixel limit. | Локальный traversal fix в main. | local media tests. | S3/MinIO и image bombs не доказаны. |
| SEC-006 | Rate limiting | medium | partially_resolved | Общий IP limiter. | `server/index.js`, `express-rate-limit`. | Есть 100/min limiter. | server tests cover basic limiter. | Нет per-user/per-route/persistent store. |
| SEC-007 | Telegram | medium | open | Future `auth_date` не отвергается. | `middleware/auth.js: validateTelegramInitData`. | Нет. | auth integration проверяет expired/hash, не future. | Long-lived future-signed initData. |
| SEC-008 | Analytics | medium | open | Arbitrary payload до global 15MiB. | `meta.js: POST /analytics`, `index.js` JSON limit. | Нет. | code_only. | Storage abuse. |
| SEC-009 | CORS | low | in_progress | Dev/non-production разрешает все origins. | `server/index.js`, `cors({ origin: '*' })`. | Strict config есть только draft PR #10. | code_only; PR не merged. | Main остаётся уязвимым до merge и production validation. |
| SEC-013 | Report abuse | medium | in_progress | Main создаёт reports без dedupe/target validation. | `server/routes/moderation.js: POST /reports/create` в `origin/main`. | `server/services/reporting.js` и новый route code есть только draft PR #10. | code_only в PR; no merged negative test. | Исправление не в main. |
| SEC-010 | Telegram profile | low | partially_resolved | Identity HMAC-derived, profile stale. | `middleware/auth.js: ensureTelegramUser`. | No identity override; no profile refresh. | auth integration. | Не security boundary bypass, но live runtime не проверен. |
| FUNC-001 | E2E runner | high | open | Playwright teardown на Windows не возвращает финальный code. | `playwright.config.js`; local run reaches `Terminating the WebServer`. | Нет в main. | local reproduction. | Нельзя считать E2E green. |
| FUNC-002 | Zones E2E | low | in_progress | Явные status checks в zone-test существуют локально. | локальный `e2e/creator.spec.js`; отсутствуют в `origin/main`. | Изменение вне main, не связано с merged PR. | Не подтверждено clean run. | Draft/local change не закрывает main. |
| FUNC-003 | Free exploration | high | open | Guided route transition не имеет complete reliable E2E. | `e2e/stabilization.spec.js`; full suite not green. | Нет подтверждённого main fix. | unit only / incomplete E2E. | Основной игровой flow. |
| FUNC-004 | Target state | medium | partially_resolved | Smart engine merged PR #1, но device matrix не завершена. | PR #1 merged `9d8913c`; E2E incomplete. | State fixes in #1. | unit_tested. | iPhone/Pixel not proven. |
| REL-001 | Autosave | high | open | Нет unload/pagehide flush. | `src/lib/progressSaveQueue.js`, `src/App.jsx`. | Нет. | unit queue only. | Последний snapshot теряется при закрытии. |
| REL-002 | Delete consistency | medium | open | DB deletes не transactionally grouped. | `colorings.js: DELETE /:id`. | PR #10 меняет relation, не atomic delete. | code_only. | Частичное удаление/orphans. |
| REL-003 | Storage cleanup | medium | open | Media delete failure только логируется. | `colorings.js`, `deletePrivateOriginal(...).catch`. | Нет. | code_only. | Orphan objects. |
| DATA-001 | SQLite durability | high | requires_environment_validation | Нет backup/restore drill. | `server/splint.db.bin`, отсутствуют jobs/runbook. | Нет. | not_verified. | Потеря данных. |
| DATA-002 | DB growth | medium | open | Preview/artwork data URLs остаются в DB. | `colorings.js`, schema. | Нет. | code_only. | DB growth. |
| DATA-003 | PostgreSQL | high | requires_environment_validation | PG tests skipped без `DATABASE_URL`. | `npm run test:server`: 53 skipped. | PG suites есть. | not_verified. | PG-specific integrity unknown. |
| DATA-004 | S3/MinIO | high | requires_environment_validation | Нет S3 integration suite. | `media-storage.js`; only local test. | Нет. | not_verified. | ACL/delete/error path unknown. |
| OPS-001 | Deployment | high | open | Нет app Dockerfile/reverse proxy deployment. | `docker-compose.yml` only services. | Нет. | code_only. | Deployment cannot be reproduced. |
| OPS-002 | Backups | high | open | Нет backup/restore automation. | No scripts/CI runbook. | Нет. | not_verified. | Recovery not proven. |
| OPS-003 | E2E ports | medium | partially_resolved | Env overrides есть, strict default ports still collide. | `playwright.config.js`. | `E2E_WEB_PORT`, `E2E_API_PORT`. | local reproduction. | Runner teardown remains. |
| OPS-004 | E2E duration | medium | open | Three projects cannot complete reliably. | `playwright.config.js`, local timeout. | Нет. | not_verified. | CI signal unreliable. |
| OPS-005 | Local install | low | resolved | Recursive `node_modules` junction was local artifact, удалён; не tracked. | `git status`, no tracked junction. | Local cleanup, no repo code. | filesystem inspection. | Clean install still needs verification. |
| API-001 | Unconnected API | medium | open | Messages/moderation portions server-only. | `src/App.jsx` vs route files. | Нет. | code_only. | Attack surface/exposure unclear. |
| API-002 | Validation | medium | open | Manual inconsistent validation. | routes; e.g. numeric filters. | PR #10 adds some report validation only. | partial integration. | Invalid inputs elsewhere. |
| API-003 | Following feed | low | open | API exists, UI not wired. | `feed.js`, `App.jsx`. | Нет. | code_only. | Product scope mismatch. |
| API-004 | Analytics summary | low | open | Client facade unused. | `src/api/client.js`. | Нет. | code_only. | Dead API surface. |
| API-005 | Messages/Stars | medium | resolved | Atomic Stars work merged PR #7 after revert/reapply sequence. | main commit `279cce1`; `stars-transactions.js`, migration 005. | idempotency + immutable ledger. | SQLite concurrency/integration tests. | PG verification still DATA-003. |
| TEST-001 | PG skips | medium | requires_environment_validation | Green server suite permits 53 skips. | `server/package.json`, test output. | No release gate. | not_verified. | False confidence. |
| TEST-002 | Zone robustness | low | in_progress | Local test changed, not main. | local diff only. | Draft/local. | no final E2E exit. | See FUNC-002. |
| TEST-003 | Lint debt | low | open | Warnings/constant comparison. | `server/test/database.test.js:832`, lint output. | Нет. | lint exits 0. | Real issue can hide among warnings. |
| DOC-001 | Security status | medium | resolved | Старый follow-up устарел. | Previous file claimed done/in-progress inconsistently. | This re-verification. | code/PR/history checked. | Must refresh after PR #10 merge. |
| DOC-002 | Startup claim | medium | open | Fresh DB empty without explicit seed. | `index.js: SEED_DEMO_DATA`. | Нет. | code_only. | Docs/product flow mismatch. |
| DOC-003 | Production docs | high | open | No deployment runbook. | README/DEVELOPMENT; no app deploy artifacts. | Нет. | not_verified. | Production unsupported. |
| DOC-004 | Encoding | low | open | Windows output shows mojibake for older docs/source output. | Console inspection. | No code action. | not_verified. | Human-operability issue. |
| ARCH-001 | Dual engine | medium | partially_resolved | Smart engine merged, legacy fallback remains. | `PlayerView.jsx`, legacy and features dirs. | PR #1. | unit_tested. | Multiple paths increase regressions. |
| ARCH-002 | Monolith state | medium | open | Large coupled UI state. | `App.jsx`, `ColoringSession.jsx`. | Нет. | code_only. | Change risk. |
| ARCH-003 | N+1 | medium | open | Enrichment calls per row. | `feed.js`, `meta.js`. | Нет. | code_only. | Load risk. |
| PROD-001 | Scope | medium | open | Server capabilities lack full UI. | routes vs client calls. | Нет. | code_only. | Misleading readiness. |
| PROD-002 | Empty product | high | open | No automatic safe production catalog bootstrap. | `index.js`. | Explicit seed only. | code_only. | Empty first-user experience. |
| PROD-003 | Telegram runtime | high | requires_environment_validation | Real Telegram not executed. | synthetic auth tests only. | None. | not_verified. | Production auth unproven. |
| PROD-004 | Native capabilities | medium | requires_environment_validation | Haptics/share need WebView. | App/Player calls. | None. | not_verified. | Device behavior unknown. |
| PROD-005 | Moderator UX | medium | open | Moderator routes API-only. | `moderation.js`, no client calls. | PR #10 adds server audit only. | code_only. | Operational misuse. |

## Выполненные команды

- `npm test`: 200 pass, 0 fail (локальная рабочая ветка; не отдельный clean-main checkout).
- `npm run test:server`: 151 pass, 53 skipped, 0 fail; skipped PostgreSQL требует `DATABASE_URL`.
- `npm run build`: success; `npm run lint`: exit 0 with existing warnings.
- Playwright: assertions запускались, но runner зависает в Windows teardown; полноценный итог не получен.
- `npm audit --omit=dev --json`: 0 root production vulnerabilities.
- `npm --prefix server audit --omit=dev --json`: 18 server production vulnerabilities: 1 critical, 17 moderate; fixAvailable true.

## Сверка draft PR #10 после последующих коммитов

Проверка выполнена 28.07.2026 на `feature/public-alpha-hardening`, commit `77f2b95`. PR [#10](https://github.com/michaelyosta/splint-pixel-studio/pull/10) остаётся draft и не merged в `origin/main` (`750b9f25cd7429b6ddeb63c7721f802951486b76`), поэтому ни одна запись этого раздела не имеет статус `resolved`.

| ID | Категория | Серьёзность | Статус | Проблема | Доказательство | Исправление | Подтверждение | Остаточный риск |
|---|---|---:|---|---|---|---|---|---|
| SEC-001 | Dependencies | critical | in_progress | Транзитивный `fast-xml-parser` в server production tree. | В старом main: audit 18 vulnerabilities. В draft `npm --prefix server audit --omit=dev --json` возвращает 0. | `2972fc7`: `@aws-sdk/client-s3` `^3.1096.0`; `77f2b95`: Node `>=20` в `server/package.json` и lockfile. | `server/test/media-storage.test.js`: 9 passed; полный server suite: 152 passed, 53 skipped. | S3/MinIO не запущен; main остаётся уязвим до merge. |
| SEC-002 | Achievements | high | in_progress | Пользователь мог выдать себе achievement прямым POST. | `server/routes/meta.js`, `POST /meta/achievements/:id/unlock`. | `756826f`: public endpoint возвращает `403 ACHIEVEMENT_UNLOCK_FORBIDDEN`; `src/App.jsx`/`src/api/client.js` больше его не вызывают. | `server/test/api.integration.test.js`: 403 и achievement остаётся locked. | Forged completion по SEC-003 всё ещё может косвенно выполнить server-side unlock. |
| SEC-007 | Telegram | medium | in_progress | Future-signed Telegram init data. | `server/middleware/auth.js: validateTelegramInitData`. | `756826f`: max age 24h и future skew 300 sec. | `server/test/auth.integration.test.js`: future `auth_date` даёт 401. | Не заменяет реальный WebView/production time validation. |
| SEC-008 | Analytics | medium | in_progress | Произвольные event/payload раздували analytics. | `server/routes/meta.js: POST /meta/analytics`. | `756826f`: allowlist, object-only payload, 4096-byte limit. | `server/test/api.integration.test.js`: unknown event 400; valid `open_level` 200. | Нет persistent quota на пользователя; main не содержит изменения. |
| SEC-011 | Progress/streak | high | in_progress | Пользователь мог изменить streak direct API. | `server/routes/meta.js: POST /meta/streak/touch`. | `756826f`: 403 `STREAK_TOUCH_FORBIDDEN`; вызовы удалены из клиентского потока. | `server/test/api.integration.test.js`: 403 и streak неизменен. | SEC-003 сохраняет подделку completion/progress. |
| SEC-014 | Authorization / data exposure | high | in_progress | `GET /users` мог раскрывать чужие `stars_balance` и `is_banned`. | Прежний server endpoint был доступен auth user; в draft `server/routes/profiles.js` использует `requireRole('moderator', 'admin')`, public DTO не содержит чувствительных полей. | `e57b1ba`, public DTO/RBAC route hardening. | `server/test/security-hardening.integration.test.js` проверяет отсутствие sensitive fields; `api.integration.test.js` проверяет public profile. | Нужен merge и PostgreSQL regression. |
| SEC-015 | IDOR / privacy | high | in_progress | `GET /users/:id/artworks` раскрывал чужие private/unpublished artworks. | `server/routes/profiles.js`: non-owner query делает JOIN c `posts` и фильтрует active public content. | `e57b1ba`, public DTO/content hardening. | `server/test/security-hardening.integration.test.js`: hidden artworks не возвращаются. | PostgreSQL suite skipped; main уязвим до merge. |
| SEC-016 | Authorization / banned account | high | in_progress | Забаненный пользователь мог отправлять messages. | `server/middleware/auth.js: requireActiveUser`; middleware вызывается до `messages.js`. | `e57b1ba`, active-user gate. | `server/test/security-hardening.integration.test.js` покрывает message route matrix; `api.integration.test.js` ожидает `ACCOUNT_BANNED`. | Не проверено на deployed multi-instance backend. |

Изменение счётчика после добавления SEC-014…SEC-016 и переоценки исправлений в draft: **open 23**, **partially_resolved 6**, **in_progress 12**, **resolved 3**, **requires_environment_validation 6** (всего 50). Это счётчик реестра с draft-статусами; для одного только `origin/main` записи `SEC-001`, `SEC-002`, `SEC-007`, `SEC-008`, `SEC-011`, `SEC-014`, `SEC-015` и `SEC-016` по-прежнему эксплуатируемы.

### Локальная инфраструктурная перепроверка — 28.07.2026, commit `cca3b43`

- `npm --prefix server run test:postgres` с локальным Docker PostgreSQL: **90 passed, 0 skipped, 0 failed**.
- Новый `server/test/media-storage-s3.integration.test.js` с локальным MinIO: **1 passed** — upload, HeadObject (`image/png`), delete и подтверждённый 404.
- `server/test/media-storage.test.js`: **9 passed**.
- `npm --prefix server test` с глобальным `DATABASE_URL` дал **183 passed, 8 failed**: это несовместимость aggregate-команды с SQLite HTTP fixtures, которые наследуют PostgreSQL URL; отдельные SQLite и PostgreSQL команды проходят. Не трактовать этот запуск как регрессию PostgreSQL-кода.

Следовательно, DATA-003, DATA-004 и TEST-001 остаются `requires_environment_validation` только для production-среды, а не для локальных Docker PostgreSQL/MinIO. В production всё ещё нужны backup/restore, IAM/ACL, domain/proxy и нагрузочные проверки.

### Повторная проверка E2E (28.07.2026, локальная ветка)

- Изолированный запуск с уже поднятыми временными сервисами и `E2E_REUSE_EXISTING=true` подтвердил Chromium assertions: `e2e/stabilization.spec.js` — **18/18 passed** за 44 с; `e2e/creator.spec.js` — **19/19 passed** за 33 с.
- Тесты теперь используют уникальный development user на каждый test case; это устраняет зависимость прогресса, onboarding и созданных раскрасок от порядка сценариев. Zone-сценарий получает конкретный template/zones API и проверяет HTTP status.
- `FUNC-002`, `TEST-002` и `FUNC-003` имеют локальное подтверждение Chromium, но не считаются `resolved`: изменения ещё не в `origin/main`, а обычный автозапуск Playwright остаётся неисправным.
- `FUNC-001` остаётся `open`: без `E2E_REUSE_EXISTING=true` Playwright поднимает Vite и изолированный API, выполняет тест до этапа завершения, но Windows runner не возвращает итоговый результат до внешнего timeout. Поэтому `npm run test:e2e` и мобильная матрица не являются надёжным CI-сигналом.

### Исправление lifecycle Playwright (28.07.2026, ветка `fix/playwright-windows-lifecycle`)

- `playwright.config.js` больше не использует встроенный `webServer`; `scripts/e2e-global-setup.mjs` явно запускает Vite и изолированный API, ждёт доступности HTTP и завершает только созданные PID. На Windows для этого применяется `taskkill /T /F` в teardown.
- Дефолтные E2E-порты перенесены с dev-портов 5173/3001 на 5190/3012, поэтому штатный `npm run test:e2e` не конфликтует с обычными `npm run dev` и `npm run dev:api`.
- Подтверждение на Windows: `npm run test:e2e` — **107 passed, 4 skipped, 0 failed**, exit 0 за 4,5 минуты. Skips — desktop-only wheel/free-exploration сценарии на двух мобильных профилях.
- До merge этой ветки `FUNC-001` и `OPS-004` сохраняют статус `in_progress` относительно `main`; после merge обычный E2E запуск может стать обязательным CI-gate.
