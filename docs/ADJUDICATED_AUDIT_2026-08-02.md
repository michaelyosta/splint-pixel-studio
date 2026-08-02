/goal

## Verification metadata

This file remains the canonical adjudicated specification supplied for the review. It is not a substitute for runtime evidence. The independent local evidence and claim-level verdicts are recorded in [remediation/FINAL_REPORT.md](remediation/FINAL_REPORT.md). Verification date: 2026-08-02. PostgreSQL, object storage, Telegram WebView, and restore are intentionally still marked as environment validation gates.

Доведи репозиторий `michaelyosta/splint-pixel-studio` от состояния контролируемого MVP до состояния, пригодного для публичной альфы без реальных платежей, и подготовь технический контур для последующего безопасного подключения Telegram Stars.

Исходная точка аудита: `main @ 68d751e1da35de3bfd92f6bec382f0af830ac502`.

Основной источник решений: `docs/ADJUDICATED_AUDIT_2026-08-02.md`. Если этого файла ещё нет в репозитории, используй предоставленный adjudicated-аудит как спецификацию и добавь его в `docs/` без смысловых изменений. Не создавай новый параллельный список замечаний. Этот документ должен стать каноническим реестром.

Работай последовательно по фазам 0–7, описанным ниже. Не ограничивайся планом или рекомендациями: реализуй изменения, миграции, тесты, документацию и CI-проверки. После каждой фазы запускай релевантные проверки и фиксируй доказательства выполнения.

Не объявляй весь goal завершённым, пока не закрыты все технически выполнимые пункты и не сформирован отдельный перечень проверок, которые объективно требуют внешней Telegram-, S3- или production-среды.

## Главные принципы

1. Сначала проверь актуальное состояние репозитория. Не предполагай, что код всё ещё полностью соответствует коммиту аудита.
2. Для каждого finding установи один статус:

   * `resolved`;
   * `partially_resolved`;
   * `needs_environment_validation`;
   * `strategic_decision_required`;
   * `not_applicable`.
3. Не закрывай finding только изменением документации.
4. Любой исправленный дефект должен иметь автоматический regression test либо явное объяснение, почему автоматизация невозможна.
5. PostgreSQL является production-источником истины. SQLite считается только локальным dev-режимом.
6. Все миграции должны быть повторяемыми, безопасными для существующих данных и иметь PostgreSQL- и SQLite-вариант там, где проект продолжает поддерживать оба движка.
7. Не ослабляй существующие сильные механизмы:

   * Telegram HMAC authentication;
   * fail-closed production configuration;
   * server-authoritative progress actions;
   * CAS revisions;
   * transaction/idempotency invariants внутреннего ledger.
8. Не выполняй масштабный косметический рефакторинг раньше integrity- и durability-фиксов.
9. Не имитируй результаты реального Telegram WebView, S3/IAM, backup/restore или payment flow. Для непроверяемого окружения подготовь исполняемые скрипты, чек-листы и runbooks, оставив статус `needs_environment_validation`.
10. Не добавляй необоснованные зависимости. Для новых библиотек оцени поддержку, размер, безопасность и необходимость.
11. Не храни новые бинарные изображения в JSON/base64-полях БД.
12. Не делай breaking API changes без миграционного переходного периода или явного обновления всех клиентов и тестов.
13. Делай небольшие логические коммиты. В сообщении каждого коммита указывай закрываемые audit ID.
14. Если доступны параллельные агенты, разделяй независимые направления: DB/integrity, frontend durability, media/feed, abuse/security, performance, CI/operations. Перед объединением проведи общий review инвариантов.

## До начала реализации

Выполни:

```bash
git status
git log -1 --oneline
npm ci
npm --prefix server ci
npm test
npm --prefix server test
npm run lint
npm run build
```

Если доступен PostgreSQL:

```bash
npm --prefix server run migrate:postgres
npm --prefix server run test:postgres
```

Если доступен Playwright:

```bash
npm run test:e2e
```

Зафиксируй исходные результаты в `docs/remediation/BASELINE.md`.

Создай `docs/remediation/IMPLEMENTATION_PLAN.md` со следующими колонками:

* audit ID;
* проблема;
* выбранное решение;
* затрагиваемые файлы;
* миграция;
* тесты;
* риск совместимости;
* статус;
* commit SHA;
* внешняя проверка, если требуется.

Не трать отдельную фазу только на написание плана. После фиксации baseline немедленно переходи к реализации.

# Phase 0 — Монетизация и терминология

Закрой риск A-001 настолько, насколько это возможно без продуктового владельца и реального Telegram payment environment.

## Требуется

1. Создай ADR:

```text
docs/adr/ADR-00X-telegram-stars-monetization.md
```

ADR должен сравнить:

* нативные Telegram Paid Messages;
* invoice за цифровую услугу приложения через `XTR`;
* внутренние credits без обещания вывода;
* отказ от платных сообщений на текущем этапе.

2. Зафиксируй, что текущий `stars_balance` не является подтверждённым балансом настоящих Telegram Stars.
3. До отдельного продуктового решения выбери безопасное поведение по умолчанию:

   * реальные Telegram payments выключены;
   * production UI не обещает перевод или вывод настоящих Stars;
   * внутренний баланс явно называется demo/internal credits;
   * dev-пополнение не существует в production;
   * paid messaging можно выключить одним fail-closed feature flag.
4. Создай конфигурационный флаг, например:

```text
PAYMENTS_MODE=disabled|internal_credits|telegram_stars
```

Production должен отказываться стартовать с `telegram_stars`, пока не настроены необходимые secrets, webhook/payment handlers и support/refund configuration.
5. Добавь тесты production-конфигурации.
6. Подготовь отдельный design document для будущего flow:

* invoice;
* `pre_checkout_query`;
* `successful_payment`;
* `telegram_payment_charge_id`;
* idempotent webhook processing;
* refund;
* `/paysupport`;
* reconciliation.

Не реализуй фиктивный Telegram payment flow и не называй его завершённым без реальной среды.

## Готовность фазы

* пользователь не может принять внутренние credits за выводимые Telegram Stars;
* production payments fail closed;
* дальнейшее подключение payments имеет ADR и техническую спецификацию;
* A-001 получает статус `strategic_decision_required` или `needs_environment_validation`, но риск ложной финансовой терминологии закрыт.

# Phase 1 — Целостность завершения раскраски

Закрой A-002, A-003 и A-008.

## 1. Canonical server-side result

Клиент не должен определять authoritative final image.

Реализуй детерминированный серверный renderer, который строит результат только из:

* серверного `template.width`;
* `template.height`;
* `template.palette`;
* `template.cells`;
* серверного `filled`.

Требования:

* одинаковый ввод всегда даёт одинаковые пиксели;
* renderer поддерживает текущий предел до `160×160`;
* результат проходит реальный image encode;
* вычисляются MIME, width, height, byte size и content hash;
* клиентский `resultDataUrl` больше не используется как authoritative source;
* подменённый клиентский PNG игнорируется или отклоняется;
* желательно полностью удалить `resultDataUrl` из progress API после переходного периода.

Добавь тест, в котором пользователь завершает правильный progress, но отправляет произвольный валидный PNG. Опубликованный результат должен соответствовать canonical server render, а не клиентскому изображению.

## 2. Atomic/idempotent finalization

Перепроектируй completion как идемпотентную доменную операцию.

Она должна согласованно обеспечивать:

* CAS update progress;
* фиксацию completion;
* создание или upsert artwork;
* canonical render metadata либо постановку render job;
* выдачу достижений;
* обновление streak;
* outbox event, если используется асинхронное хранилище;
* безопасное повторное выполнение после частичного сбоя.

S3/network I/O нельзя маскировать под DB-атомарность. Выбери и задокументируй один корректный паттерн:

* transactional outbox + idempotent worker;
* либо предварительная детерминированная подготовка с компенсирующими действиями;
* либо другая схема с доказанным recovery.

У artwork должен быть явный render lifecycle, если сохранение асинхронное:

```text
pending -> ready
pending -> failed -> retrying
```

Публикация разрешается только для `ready` canonical artwork.

Добавь failure-injection tests минимум для падения:

* после progress update;
* до artwork upsert;
* после artwork upsert;
* до achievement update;
* во время media job;
* после media upload до фиксации DB state;
* при повторной доставке outbox job.

Повтор запроса или job не должен создавать второе artwork, повторную награду или расходящиеся данные.

## 3. Achievement semantics

Исправь:

* достижение за 5 завершений должно выдаваться на пятой работе;
* тематическое достижение за 3 работы должно выдаваться на третьей;
* `ach_first_zone` должно либо выдаваться за реальное завершение первой зоны, либо быть переименовано в соответствии с фактическим условием.

Добавь boundary tests для 1, 3, 5 и следующего после порога события.

## 4. Удаление simulate completion

Удалить production-доступный:

```text
POST /artworks/:id/complete
```

Допустимые варианты:

* удалить полностью;
* вынести в dev-only router, который физически не монтируется в production;
* заменить валидированной domain-командой, использующей серверный progress finalizer.

Добавь production integration test, доказывающий отсутствие обходного пути completion.

## Готовность фазы

* сервер определяет и факт, и визуальный результат completion;
* finalization можно безопасно повторить;
* partial failure восстанавливается;
* достижения выдаются на правильном событии;
* production не содержит simulate-completion endpoint.

# Phase 2 — Надёжность сохранения прогресса

Закрой A-004.

## 1. Исправление lifecycle очереди

Заменить последовательность:

```js
flush();
dispose();
```

на единый API:

```js
await flushAndDispose();
```

Он должен:

* перестать принимать новые snapshots;
* дождаться текущего drain;
* отправить последний pending snapshot;
* не инвалидировать generation раньше завершения;
* завершиться только после success либо сохранения durable retry state;
* быть идемпотентным при повторном вызове.

Обычная навигация внутри приложения должна `await` завершение либо явно показывать пользователю состояние сохранения.

## 2. Durable local journal

Добавь журнал незавершённых progress batches в IndexedDB.

Храни минимум:

* template ID;
* user/session scope;
* client batch ID;
* base server revision;
* ordered changes либо authoritative local snapshot;
* created time;
* retry count;
* state.

После перезапуска приложение должно:

1. прочитать journal;
2. сверить server revision;
3. безопасно повторить или разрешить конфликт;
4. удалить запись только после server acknowledgement.

Не храни неограниченную историю. Реализуй compaction, TTL и лимит размера.

## 3. Server idempotency для batches

Добавь устойчивый `client_batch_id` или эквивалентный idempotency mechanism.

Повтор одного batch после network timeout не должен:

* увеличить revision дважды;
* повторно запустить completion;
* повторно выдать награды;
* вернуть неразрешимый конфликт.

Сохрани совместимость CAS-модели.

## 4. Page lifecycle

`pagehide`, reload и закрытие вкладки не могут гарантировать ожидание Promise.

Используй:

* durable journal как основную гарантию;
* `fetch({ keepalive: true })` или beacon только как best-effort ускорение;
* восстановление при следующем запуске.

## 5. Тесты

Добавь unit/integration/E2E:

* штрих → немедленная смена раскраски;
* штрих → переход в другой view;
* штрих → reload;
* штрих → pagehide;
* network timeout после фактического server commit;
* network failure до server commit;
* два in-flight batches;
* conflict с другим устройством;
* восстановление IndexedDB journal после нового запуска;
* completion batch при потере ответа.

## Готовность фазы

Последний пользовательский batch не исчезает молча при навигации, перезагрузке или временной потере сети.

# Phase 3 — Изображения, storage и feed

Закрой A-005, B-001 и B-002.

## 1. Модель media

Перестать хранить новые canonical images и thumbnails как `data:image/...` в основных таблицах.

Добавь миграции для метаданных:

* storage key;
* thumbnail key;
* content hash;
* MIME;
* width;
* height;
* byte size;
* render status;
* optional legacy source marker.

Существующие base64-данные должны иметь безопасный переход:

* lazy migration;
* backfill script;
* либо временный compatibility reader.

Новые записи не должны создавать base64 в БД.

## 2. Storage API

Расширь media service:

* canonical image upload;
* thumbnail generation;
* idempotent object keys;
* content hash;
* typed metadata;
* safe image decode;
* dimension/pixel limits;
* re-encode;
* delete jobs;
* retry policy.

Не доверяй только declared MIME или magic bytes.

## 3. Media lifecycle

Закрой orphan-сценарии:

* upload success + DB failure;
* DB delete + storage delete failure;
* повторный delete;
* object уже отсутствует;
* worker crash;
* duplicate job.

Используй transactional outbox/cleanup queue либо эквивалентную устойчивую схему.

Добавь:

* orphan sweeper;
* media delete jobs;
* dry-run mode;
* метрики и логи;
* tests с искусственными storage failures.

## 4. Feed DTO

Feed не должен включать:

* full base64 image;
* ненужные поля artwork;
* приватные media keys;
* original image;
* тяжёлые внутренние JSON.

Возвращай компактный DTO:

* post;
* минимальный author;
* thumbnail URL;
* dimensions/aspect ratio;
* like/follow state;
* pagination cursor.

## 5. Устранение N+1

Перепиши feed retrieval через:

* JOIN/CTE;
* batched lookups;
* `EXISTS`;
* либо ограниченное число запросов независимо от размера страницы.

Не выполняй отдельные запросы author/artwork/like/follow для каждого поста.

Добавь query-count test или instrumentation assertion.

## 6. Cursor pagination

Реализуй cursor pagination для:

* recommended;
* following;
* user posts, где применимо.

Cursor должен быть стабильным при одинаковом ranking/timestamp. Используй дополнительный уникальный ID как tie-breaker.

Ограничь page size и валидируй cursor.

## 7. Performance budgets

Определи и тестируй:

* максимальный JSON payload страницы feed;
* максимальное число DB queries;
* максимальный page size;
* отсутствие `data:image/` в response;
* отсутствие full image до открытия detail view.

## Готовность фазы

* новые изображения хранятся в object storage;
* feed DTO bounded;
* в JSON нет base64;
* media failures восстанавливаются;
* feed использует cursor pagination и ограниченное число запросов.

# Phase 4 — Социальная целостность и abuse-control

Закрой A-006, A-007, B-003, B-006 и B-007.

## 1. Likes, comments и karma

Объедини связанные действия в DB transactions.

Для like:

* `INSERT ... ON CONFLICT DO NOTHING RETURNING` либо эквивалент;
* обновляй counter/karma только если реально вставлена одна строка.

Для unlike:

* `DELETE ... RETURNING`;
* decrement только если удалена одна строка.

Для comment delete:

* conditional mutation:

```sql
UPDATE ...
WHERE id=? AND status='active'
RETURNING ...
```

* decrement только при реальном переходе active → deleted.

Добавь PostgreSQL concurrency tests:

* два одновременных like;
* два unlike;
* like/unlike race;
* два delete одного comment;
* rollback между mutation и aggregate update.

Добавь reconciliation command, сверяющую:

* `posts.like_count` с `COUNT(likes)`;
* `posts.comment_count` с active comments;
* karma с принятой формулой.

Поддержи dry-run и repair mode.

## 2. Уникальная публикация artwork

Добавь DB-level гарантию, что один artwork нельзя одновременно опубликовать двумя активными постами.

Для PostgreSQL предпочтителен partial unique index. Для SQLite реализуй совместимый constraint или транзакционную альтернативу.

Два параллельных publish request должны дать один success и один conflict.

## 3. Message create

Добавь:

* обязательный idempotency key либо server-generated dedup token;
* per-user quota;
* per-receiver quota;
* limit pending requests;
* duplicate suppression;
* expiration для `payment_pending`;
* safe cleanup job;
* audit event.

Повтор запроса после timeout не должен создавать второе сообщение.

## 4. Message state machine

Reply/reject должны использовать conditional CAS transitions:

```text
delivered -> answered
delivered -> rejected
```

Только одна конкурирующая операция может победить.

Запрещены переходы из terminal states.

Добавь concurrency tests reply vs reject.

## 5. Pagination

Добавь cursor pagination для inbox/outbox.

Убери per-row enrichment sender/receiver. Используй batched query или JOIN.

Ограничь page size.

## 6. Shared abuse limiter

Создай централизованную abuse matrix:

```text
docs/security/ABUSE_MATRIX.md
```

Для каждого endpoint определи:

* субъект ограничения: user/IP/receiver/resource;
* окно;
* quota;
* burst;
* shared storage;
* response code;
* audit event;
* privileged exceptions.

Минимальные классы:

* message create;
* message payment;
* template create/publish;
* posts;
* comments;
* likes/follows;
* reports;
* analytics;
* media upload.

Production multi-instance не должен полагаться только на process-local memory. Реализуй shared limiter store, совместимый с выбранной infrastructure. Если Redis не является частью архитектуры, используй PostgreSQL-backed или другой обоснованный механизм.

Сбой limiter storage должен иметь явно выбранный fail-open/fail-closed режим для каждого класса операций.

## Готовность фазы

* social counters согласованы при concurrency;
* повторные запросы не создают дубликаты;
* message states атомарны;
* inbox/outbox bounded;
* abuse limits единообразны и работают между инстансами.

# Phase 5 — Performance safety

Закрой B-004, B-005 и B-011.

## 1. Complexity validator

Перед публикацией пользовательского шаблона вычисляй complexity metrics:

* total cells;
* palette size;
* connected component count;
* components per color;
* максимальное число мелких регионов;
* checkerboard/fragmentation score;
* предполагаемое число working windows;
* estimated clustering/merge cost.

Сервер должен отклонять или оставлять private шаблон, который превышает публичный complexity budget.

Не ограничивайся только размером `160×160`.

Добавь adversarial fixtures:

* checkerboard;
* случайный шум;
* тысячи одноячейковых областей;
* полосы;
* максимальная палитра;
* один огромный регион.

## 2. Web Worker для creator

Перенеси CPU-heavy image pipeline из main thread:

* decode;
* sampling;
* palette generation;
* smoothing;
* region cleanup;
* preview computation.

Поддержи:

* cancellation предыдущей задачи;
* generation token;
* progress reporting;
* fallback/error state;
* transferable buffers, где уместно.

Изменение sliders не должно блокировать UI.

## 3. Worker или другой bounded execution для clustering

Перенеси либо алгоритмически переработай:

* `findClusters`;
* `findUnfilledClusters`;
* `mergeClusters`;
* working window calculation.

Устрани повторный pairwise merge/restart worst case либо докажи budget валидатором, что патологический ввод невозможен.

Не допускай stale worker result после смены template/color/progress.

## 4. Budgets и benchmarks

Создай воспроизводимый benchmark suite для:

* 32×32;
* 64×64;
* 120×120;
* 160×160;
* adversarial patterns.

Зафиксируй budgets для:

* creator compute;
* route compute;
* input latency;
* frame time;
* memory;
* worker cancellation.

Не утверждай соответствие слабому Android без реального устройства. Подготовь browser benchmark page и device checklist.

## Готовность фазы

Публичный пользовательский шаблон не может вызвать очевидное многосекундное зависание по известным pathological patterns, а тяжёлые вычисления не блокируют основной UI thread.

# Phase 6 — Production gate и operations

Закрой техническую часть A-009, A-010, B-008 и B-009.

## 1. Health и readiness

Раздели:

* liveness;
* readiness.

Readiness должна проверять как минимум:

* PostgreSQL connection;
* migrations/schema compatibility;
* object storage access;
* обязательную production configuration;
* worker/outbox health, если применимо.

Не выполняй тяжёлые destructive checks на каждом health request.

## 2. Structured logging

Добавь:

* request ID;
* structured JSON logs;
* user ID только там, где это допустимо;
* route;
* status;
* duration;
* error class;
* audit/security event;
* background job ID;
* idempotency key hash, но не секреты.

Не логируй Telegram initData, tokens, S3 secrets, payment payload secrets или полные пользовательские сообщения.

## 3. Metrics

Минимум:

* HTTP latency/error rate;
* DB pool;
* outbox backlog;
* render jobs;
* media failures;
* save conflicts;
* idempotency replays;
* abuse limiter rejects;
* feed query count/payload;
* message state conflicts;
* payment/reconciliation metrics в будущем.

## 4. Graceful shutdown

Обработай SIGTERM/SIGINT:

1. readiness становится false;
2. прекращается приём новых запросов;
3. завершаются in-flight requests;
4. останавливаются workers;
5. закрываются DB/S3 clients;
6. фиксируется timeout и forced exit.

Добавь integration test graceful shutdown с in-flight save и background job.

## 5. Backup/restore

Добавь:

* PostgreSQL backup script;
* restore script;
* checksum/integrity verification;
* object-storage inventory;
* retention policy documentation;
* staging restore drill runbook.

Не утверждай, что restore проверен, если команда не выполнялась. Статус должен оставаться environment validation до приложения реальных логов.

## 6. Release CI

Сохрани быстрый PR CI и добавь release-candidate gate.

PR CI:

* install;
* unit;
* lint;
* build;
* SQLite/server;
* PostgreSQL;
* E2E.

Release gate:

* dependency audit;
* migrations from clean DB;
* migrations from previous supported schema;
* repeat bootstrap;
* concurrency tests;
* failure-injection tests;
* MinIO/S3 integration;
* production config smoke;
* legacy engine smoke либо доказанное удаление;
* feed performance/payload assertions;
* backup/restore script validation;
* generated artifact checks.

Не делай CI зелёным через массовые skip.

## 7. Production-like staging assets

Подготовь:

* example reverse proxy config;
* security headers для frontend host;
* HTTPS/CORS checklist;
* Telegram WebView test checklist;
* S3 bucket/IAM checklist;
* secrets inventory;
* deployment runbook;
* rollback runbook.

Runtime-пункты оставить `needs_environment_validation`, пока не приложены настоящие доказательства.

## Готовность фазы

Репозиторий содержит полноценный release gate, readiness, graceful shutdown, логи, метрики и исполняемые backup/restore инструменты. Непроверенное окружение явно отделено от подтверждённого кода.

# Phase 7 — Архитектура и документация

Закрой B-012 и C-001–C-011 после integrity-фаз.

## 1. Декомпозиция App.jsx

Раздели по domain/view boundaries:

* app shell/navigation;
* catalog;
* player orchestration;
* creator;
* feed;
* profile;
* collections;
* comments/social actions;
* analytics;
* session/save controller.

Не переносить god component целиком в другой файл.

Используй domain hooks/reducers/services там, где это снижает связанность. Не добавляй глобальный state manager без доказанной необходимости.

Сохрани поведение через tests до и после рефакторинга.

## 2. Legacy engine

Прими явное решение:

* либо legacy rollback остаётся и получает CI E2E smoke с `VITE_NEW_COLORING_ENGINE=false`;
* либо legacy удаляется из кода, CSS, bundle и документации.

Не оставляй нетестируемый аварийный переключатель.

## 3. Domain constants

Перенеси achievements, collections, zone presets и другие доменные каталоги из DB adapter в отдельные domain/seed modules.

DB adapter должен отвечать за persistence, а не за продуктовый каталог.

## 4. SQLite

Явно документируй SQLite как dev-only.

Если текущий `sql.js` export на каждый write остаётся, добавь предупреждение и не позиционируй режим как load-capable. Оптимизируй только если это необходимо локальной разработке; не отвлекайся от production PostgreSQL.

## 5. Telegram profile sync

После валидной Telegram authentication обновляй разрешённые поля:

* username/nickname;
* avatar/photo;
* first/last name, если сохраняются.

Не позволяй Telegram sync перезаписывать независимые пользовательские настройки.

## 6. Moderation filters

Перестань представлять простой profanity/URL regex как полноценную модерацию.

Сохрани эвристику как первый слой, но основной контур должен включать:

* quotas;
* reports;
* moderation queue;
* audit trail;
* hide/ban operations;
* документацию ограничений.

## 7. Prefetch cache

Добавь:

* max size;
* TTL;
* cancellation;
* deduplication;
* invalidation;
* cleanup при logout/session change.

## 8. Repository hygiene

Добавь или обнови:

* LICENSE после явного выбора владельца;
* deployment documentation;
* CD workflow, если целевой hosting определён;
* cross-platform commands;
* CONTRIBUTING;
* CHANGELOG/version policy;
* useful IDEA/product document либо удали пустышку;
* README links на canonical docs.

Не выбирай лицензию от имени владельца без явного решения. Подготовь варианты и оставь action item, если выбор не дан.

## 9. Lint и test discovery

* сократи существующие warnings;
* введи warning budget, запрещающий рост;
* перейди от ручного списка test files к безопасному discovery/glob;
* добавь coverage report как диагностический сигнал;
* не ставь бессмысленный высокий global threshold;
* установи thresholds для критических модулей: completion, save queue, transactions, auth.

## 10. Имена canvas

Переименуй legacy/current canvas так, чтобы auto-import и stack traces не были двусмысленными.

## 11. Canonical documentation

Обнови:

* `docs/ADJUDICATED_AUDIT_2026-08-02.md`;
* `SECURITY_FOLLOWUPS.md`;
* `docs/AUDIT_FINDINGS.md`;
* `docs/PROJECT_MAP.md`;
* README;
* deployment/security docs.

Определи один canonical registry. Остальные документы должны ссылаться на него, а не вести независимые статусы.

Для каждого документа укажи:

```text
last_verified_commit: <sha>
last_verified_date: <date>
```

Исправь stale statements:

* seed behavior;
* production auth;
* уже влитые ветки;
* текущие статусы findings;
* PowerShell-only команды.

# Общие тестовые требования

После каждой фазы запускай релевантный subset. Перед завершением goal обязательно:

```bash
npm ci
npm --prefix server ci
npm test
npm --prefix server run check
npm --prefix server test
npm run lint
npm run build
npm run test:e2e
```

При доступном PostgreSQL:

```bash
npm --prefix server run migrate:postgres
npm --prefix server run test:postgres
```

Также запусти новые:

* concurrency tests;
* failure-injection tests;
* idempotency replay tests;
* media integration tests;
* feed payload/query budget tests;
* production configuration tests;
* worker/adversarial grid benchmarks;
* release-candidate workflow локально или через CI.

Не скрывай failing tests. Не заменяй проверку массовыми skip. Новые environment-dependent tests могут быть условными только при ясном сообщении и наличии отдельного CI/staging job.

# Обязательные итоговые артефакты

Создай или обнови:

1. `docs/remediation/BASELINE.md`
2. `docs/remediation/IMPLEMENTATION_PLAN.md`
3. `docs/remediation/FINAL_REPORT.md`
4. `docs/adr/ADR-00X-telegram-stars-monetization.md`
5. `docs/security/ABUSE_MATRIX.md`
6. production/staging checklist
7. backup/restore runbook
8. deployment/rollback runbook
9. migration/backfill documentation
10. benchmark report
11. canonical audit registry

`FINAL_REPORT.md` должен содержать:

* исходный и конечный commit;
* закрытые audit IDs;
* частично закрытые IDs;
* environment validation;
* strategic owner decisions;
* миграции;
* API changes;
* новые dependencies;
* тестовые команды и фактические результаты;
* performance results;
* rollback instructions;
* известные ограничения;
* список manual actions владельца.

# Release gates

## Gate A — Ограниченная альфа без реальных Stars

Не считать достигнутым, пока не выполнено:

* canonical result;
* atomic/idempotent completion;
* save durability;
* transactional social actions;
* message/content abuse limits;
* удаление simulate completion;
* bounded feed payload;
* basic production-like staging assets.

## Gate B — Публичная альфа без платежей

Дополнительно:

* S3 thumbnails;
* cursor pagination;
* media lifecycle recovery;
* public template complexity gate;
* worker-based heavy processing;
* observability/readiness;
* backup/restore tooling;
* release CI;
* подготовленная mobile runtime checklist.

## Gate C — Реальные Telegram Stars

Не считать достигнутым без:

* принятого ADR;
* явного product-owner решения;
* настоящего invoice/payment flow;
* `successful_payment` verification;
* refund и `/paysupport`;
* charge ID storage;
* reconciliation;
* financial backup/restore;
* Terms;
* production payment monitoring;
* реального Telegram test evidence.

# Финальный Definition of Done

Техническая часть goal считается завершённой только если:

1. Клиент не задаёт authoritative final image.
2. Completion безопасно повторяется после сбоя.
3. Награды выдаются на правильных порогах.
4. Последний progress batch переживает навигацию, reload и network timeout.
5. Feed не содержит `data:image/...`.
6. Feed имеет bounded payload, cursor pagination и bounded query count.
7. Like/comment counters и karma согласованы под concurrency.
8. Один artwork нельзя одновременно опубликовать дважды.
9. Message create имеет quota, pagination, expiry и idempotency.
10. Reply/reject используют атомарный state transition.
11. Production не содержит simulate-completion endpoint.
12. Публичные шаблоны проходят complexity validation.
13. Тяжёлый creator/clustering pipeline не блокирует main thread.
14. Media upload/delete failures восстанавливаются.
15. Readiness, graceful shutdown, structured logs и metrics реализованы.
16. Backup/restore инструменты существуют и проверяемы.
17. CI запускает concurrency/failure/security/release проверки.
18. Canonical audit registry обновлён на конечный commit.
19. Все заявления в `FINAL_REPORT.md` подтверждены командами, тестами или явно помечены как environment validation.
20. В рабочем дереве нет случайных изменений, временных файлов, секретов и закомментированных обходных решений.

Если внешний runtime недоступен, не останавливай техническую работу. Заверши весь код, автоматизацию и runbooks, после чего выдай точный список ручных проверок с командами и ожидаемыми результатами. Не объявляй Gate C достигнутым без настоящего Telegram payment evidence.
