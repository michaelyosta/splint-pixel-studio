# Карта проекта Splint Pixel Studio

> **Повторная security-верификация — 28.07.2026.** Этот документ первоначально описывал локальную ветку `feature/public-alpha-hardening` (`d8ed95b`). Default branch репозитория — `origin/main` на `750b9f25cd7429b6ddeb63c7721f802951486b76`; `feature/public-alpha-hardening` является draft PR [#10](https://github.com/michaelyosta/splint-pixel-studio/pull/10). Поэтому security-изменения этой ветки не являются состоянием production/main. Актуальный реестр — [SECURITY_FOLLOWUPS.md](../SECURITY_FOLLOWUPS.md) и [AUDIT_FINDINGS.md](AUDIT_FINDINGS.md).

> Аудит состояния ветки `feature/public-alpha-hardening`, commit `d8ed95b` от 28 июля 2026 года. Документ основан на исходном коде, Git history, импорт-графе, маршрутах, вызовах API и фактических запусках проверок. README использовался только как гипотеза и перепроверялся.

## 1. Что это за проект

Splint Pixel Studio — мобильное React-приложение в формате Telegram Mini App для раскрашивания пиксельных изображений по номерам. Пользователь выбирает готовый шаблон или преобразует своё изображение в сетку 8–64 пикселя, закрашивает клетки, сохраняет прогресс на сервере, завершает работу и при желании публикует её в общей ленте.

Предполагаемый пользователь — человек, которому нужна короткая расслабляющая игровая сессия на телефоне. Интерфейс рассчитан на узкий экран и Telegram WebView, но имеется локальный браузерный режим разработки.

Основной сценарий:

1. Telegram открывает Web App, либо разработчик открывает Vite локально.
2. Клиент получает каталог с API.
3. Пользователь открывает шаблон.
4. Клиент параллельно загружает полную карту, сохранённый прогресс и зоны.
5. Игровой движок предлагает участок и управляет камерой; пользователь красит в classic или reveal-режиме.
6. Очередь автосохранения отправляет карту `filled` и номер ревизии.
7. Сервер проверяет карту, разрешает конфликт ревизий и при полном совпадении создаёт `artwork`.
8. Завершённую работу можно скачать, отдать в native share или опубликовать как `post`.

Ядро продукта:

- игровой движок и Canvas: `src/features/coloring/`, `src/lib/pixelColoring.js`;
- экран сессии: `src/views/PlayerView.jsx`;
- orchestration пользовательских потоков: `src/App.jsx`;
- прогресс, шаблоны и завершённые работы: `server/routes/colorings.js`.

Инфраструктурная и расширяющая обвязка:

- Express API, авторизация и БД: `server/index.js`, `server/db.js`;
- SQLite для локальной работы, PostgreSQL для production;
- локальное/S3-хранилище исходников;
- социальная лента, профили, подписки, комментарии и модерация;
- Stars-операции, сообщения, коллекции, аналитика и мета-прогресс.

## 2. Текущее состояние проекта

**Стадия: функциональный MVP.**

Почему не «ранний MVP»: основной цикл каталог → игра → сохранение → завершение → публикация реализован сквозным кодом; есть создание раскраски из изображения, социальная лента, авторизация Telegram, миграции, SQLite/PostgreSQL-адаптер, unit/integration/E2E тесты. `npm test` прошёл 200/200, серверный suite — 151 pass, 53 skip, 0 fail; production build собирается.

Почему не beta:

- E2E runner на Windows не завершает процесс после тестовых assertions и поэтому не выдаёт достоверный итоговый exit code. После P0-стабилизации Chromium-набор smart coloring запустил все 18 проверок без напечатанной assertion-ошибки; однако полный green-прогон на трёх профилях ещё не подтверждён;
- production-путь с реальными PostgreSQL, S3/MinIO и Telegram не был подтверждён; 53 серверных PostgreSQL-теста пропущены;
- Docker Compose поднимает только PostgreSQL и MinIO, но не клиент и API;
- часть крупного backend-функционала не имеет UI;
- achievement unlock доступен прямым клиентским вызовом без проверки условия;
- server dependency audit содержит critical advisory;
- отсутствуют deployment manifests, CI-деплой, мониторинг и backup automation.

## 3. Что уже реализовано

| Функция | Статус | Где реализована | Как проверить | Ограничения |
|---|---|---|---|---|
| Каталог из 6 шаблонов | работает | `server/catalog-templates.json`, `server/db.js:196`, `server/routes/colorings.js:106`, `src/App.jsx:125` | локальный E2E и `GET /colorings` | требует `SEED_DEMO_DATA=true`; каталог не создаётся при обычном пустом старте |
| Фильтры mood/theme/time | работает | `src/App.jsx:626`, `src/api/client.js:47`, `server/routes/colorings.js:106` | выбрать фильтр, проверить query | query `max_minutes` не проверяется на число |
| «Сегодня» и quick picks | частично работает | `server/routes/colorings.js:120`, `src/App.jsx:139` | `GET /colorings/today` | данные загружаются, но роль блока в UI ограничена каталогом |
| Открытие раскраски | работает | `src/App.jsx:205`, `server/routes/colorings.js:133,213,220` | E2E creator #10 | при сбое любого из 3 параллельных запросов весь вход отменяется |
| Classic-раскрашивание по номеру | работает | `src/views/PlayerView.jsx`, `src/features/coloring/ColoringSession.jsx`, `ColoringCanvas.jsx` | unit + E2E creator #17 | E2E guided-сценариев частично падает |
| Reveal-режим | частично работает | те же файлы, `src/features/coloring/engine/` | unit + E2E creator #18 | часть stabilization E2E падает |
| Smart camera и guided targets | частично работает | `ColoringSession.jsx`, `camera/useSmartCamera.js`, `engine/routeTargeting.js`, `ColoringCanvas.jsx` | unit; Chromium `e2e/stabilization.spec.js` выполняет 18 assertions | итоговый код E2E и мобильные профили не подтверждены из-за runner teardown |
| Legacy Canvas fallback | реализовано, но не подключено по умолчанию | `src/components/LegacyPixelCanvas.jsx`, `src/views/PlayerView.jsx:8` | `VITE_NEW_COLORING_ENGINE=false` | не является штатным production-путём |
| Undo/redo | работает | `src/App.jsx`, `engine/historyOperations.js`, `ColoringSession.jsx` | unit, E2E creator #15/#17 | история только в памяти текущей сессии |
| Fill области | работает | `src/lib/floodFill.js`, `src/App.jsx`, меню PlayerView | E2E проверяет наличие; unit логики косвенный | специального сквозного теста сохранения fill нет |
| Автосохранение с ревизиями | работает на SQLite | `src/lib/progressSaveQueue.js`, `server/routes/colorings.js:229` | 22 queue-теста, integration | PostgreSQL HTTP-тесты пропущены без БД |
| Восстановление прогресса | работает на SQLite | `src/App.jsx:209`, `server/routes/colorings.js:220` | повторно открыть шаблон | не проверено на реальном Telegram/production |
| Завершение и artwork | работает на SQLite | `server/routes/colorings.js:303-336`, `src/App.jsx` | server integration «coloring progress can become a social post» | изображение результата доверено клиентскому PNG |
| Публикация в ленту | работает | `src/App.jsx:388`, `server/routes/posts.js:25` | E2E completion + server integration | доступна только после полного прогресса |
| Лайк, комментарий, подписка | работает | `src/App.jsx:518-576`, routes `likes.js`, `comments.js`, `follows.js` | E2E creator #12 | нет удаления комментария в UI; following-feed не подключён |
| Жалоба на пост | работает | `src/App.jsx:578`, `posts.js:109`, `reporting.js` | security integration | UI всегда отправляет причину `other` |
| Профиль и завершённые работы | работает | `src/App.jsx:175,695`, `profiles.js` | открыть профиль | редактирования профиля в текущем UI нет |
| Коллекции | частично работает | `src/App.jsx:679`, `meta.js:75`, `profiles.js:107` | открыть «Альбомы» | просмотр есть; покупка/добавление коллекции не подключены к UI |
| Достижения | частично работает | `src/App.jsx:147,687`, `meta.js:56,64`, `colorings.js:303` | завершить действие/открыть экран | прямой unlock endpoint позволяет обход условий |
| Серии дней (streak) | частично работает | `meta.js:21,36`, `colorings.js:303`, `src/App.jsx:143` | сохранить прогресс | часовой пояс — UTC сервера; UI отображает ограниченно |
| Аналитические события | частично работает | `meta.js:115`, вызовы `metaApi.track` в `App.jsx`/PlayerView | запросить summary | payload доверен клиенту; summary не имеет UI |
| Создание раскраски из изображения | работает локально | `src/App.jsx:438-500`, `pixelColoring.js`, `imageCrop.js`, `colorings.js:171` | E2E creator #2–#8 | обработка целиком на клиенте; исходник в dev может храниться локально |
| Удаление своей раскраски | работает | `src/App.jsx:505`, `colorings.js:148` | E2E creator #11 | каскад вручную, операция не обёрнута целиком в транзакцию |
| Скачать результат | работает в браузере | `src/App.jsx:423`, PlayerView | завершить и нажать download | не проверено в Telegram WebView |
| Native Share | невозможно подтвердить без запуска | `src/App.jsx:412`, PlayerView | устройство с `navigator.share` | зависит от WebView/HTTPS |
| Telegram initData auth | работает в integration | `src/api/client.js:6`, `server/middleware/auth.js:5` | auth integration tests | реальный Bot/WebView не проверен |
| Telegram haptic feedback | невозможно подтвердить без запуска | `App.jsx:295`, `PlayerView.jsx:173`, `telegram.js` | реальный Telegram | optional chaining скрывает отсутствие API |
| Dev auth | работает | `client.js:7`, `auth.js:55` | `ALLOW_DEV_AUTH=true`, `VITE_ALLOW_DEV_AUTH=true` | опасен вне локальной среды; production config блокирует |
| Moderation API | реализовано, но не подключено | `server/routes/moderation.js`, `reporting.js` | security integration | административного UI нет |
| Личные сообщения за Stars | реализовано, но не подключено | `server/routes/messages.js`, `stars-transactions.js` | SQLite HTTP tests | нет UI и реальных Telegram Payments |
| Покупка коллекции за Stars | реализовано, но не подключено | `profiles.js:113`, `stars-transactions.js` | SQLite HTTP tests | нет UI, webhook, refund/withdrawal |
| PostgreSQL runtime | невозможно подтвердить без запуска | `server/db.js`, `database/*`, migrations | задать `DATABASE_URL`, `npm run test:postgres` | все DB-зависимые PostgreSQL tests в аудите были skipped |
| S3/MinIO исходники | невозможно подтвердить без запуска | `media-storage.js`, `docker-compose.yml` | поднять MinIO и создать user coloring | local driver тестирован; S3 integration-теста нет |

## 4. Пользовательские сценарии

### 4.1 Первый локальный запуск

- Точка входа: `src/main.jsx` → `initializeTelegramWebApp()` → `<App />`.
- Компоненты: `App.jsx`, `src/api/client.js`.
- API: при mount — `/colorings`, `/colorings/today`, `/meta/streak`, `/meta/achievements`, затем `/users/me`.
- Данные: dev-user автоматически создаётся в `authMiddleware`, если включён dev auth.
- Точки отказа: не создан `.env.local`; не включены обе auth-переменные; API не запущен; demo seed выключен и каталог пуст.
- Тесты: shell и каталог покрыты E2E; отдельного теста «совершенно пустая БД без seed» для UI нет.

### 4.2 Авторизация Telegram

- Точка входа: Telegram SDK, подключённый в `index.html`, предоставляет `window.Telegram.WebApp.initData`.
- Клиент: `client.js:6-13` отправляет `X-Telegram-Init-Data`.
- Сервер: `auth.js:5-26` проверяет HMAC-SHA256, `auth_date <= 24h`, читает user JSON и создаёт `tg_<id>`.
- Сохранение: строка `users`, включая `telegram_id`, nickname и avatar.
- Точки отказа: нет token; подпись/дата неверны; Telegram user не содержит id; пользователь забанен.
- Тесты: valid/invalid/expired/precedence покрыты integration; реальный Telegram запуск не проверен.

### 4.3 Открытие и прохождение раскраски

- Вход: карточка `.coloring-card`, `openColoring()` в `App.jsx:205`.
- Запросы: `GET /colorings/:id`, `/progress`, `/zones`.
- Компоненты: `PlayerView` → `ColoringSession` → `ColoringCanvas`; engine modules строят кластеры, окна, route target и camera plan.
- Сохранение: `PUT /colorings/:id/progress` через debounce queue; `filled_json`, `revision`, timestamps.
- Отказы: любой из трёх GET; конфликт 409; ошибка queue; guided state machine; некорректные зоны. Notice показывает ошибку сохранения, но пользователь может продолжить и потерять последние изменения.
- Тесты: логика хорошо покрыта unit; E2E частично красный.

### 4.4 Завершение

- Сервер считает завершением только точное равенство всех `filled[i] === cells[i]`.
- Создаются/обновляются `coloring_progress` и `artworks`; streak и achievements обновляются сервером.
- Клиент открывает completion overlay и предлагает download/share/publish.
- Отказы: `resultDataUrl` может быть null — artwork возьмёт preview; публикация невозможна, если `artwork_id` ещё не пришёл после save.
- Тест: SQLite integration покрывает переход до социального поста; E2E completion проходит, но zone-completion тест падает.

### 4.5 Возврат к незавершённой работе

- «Мои» вызывает `GET /colorings/mine`.
- Endpoint возвращает private templates и любые шаблоны с прогрессом.
- Повторное открытие загружает `filled`/revision.
- Риск: незавершённый in-flight save при уходе со страницы не flush-ится явно; queue dispose защищает callbacks, но последний debounce может не попасть на сервер.
- Unit queue покрывает reset/dispose/races; browser unload не покрыт.

### 4.6 Создание из изображения

- Вход: вкладка «Создать».
- FileReader читает PNG/JPG/WebP; Canvas применяет crop/fit, grid size и palette reduction.
- `buildColoringFromImage()` выдаёт palette/cells, preview и originalDataUrl.
- `POST /colorings/create` сохраняет private template и оригинал через local/S3 driver.
- Риски: браузерная память, 15 MB JSON body, отсутствие декодирования/антивируса на сервере, S3 не проверен.
- E2E creator #2–#8 проходит на Chromium/iPhone до таймаута.

### 4.7 Лента

- Вход: вкладка «Лента».
- API: recommended feed, like/delete like, comments, follow, report.
- Сохраняются posts, likes, comments, follows, reports.
- Отказы: optimistic UI почти отсутствует — большинство операций перезагружают данные; report reason фиксирован.
- E2E creator #12 и security integration проходят.

### 4.8 Коллекции, достижения, streak

- Коллекции и achievements доступны из навигации.
- Streak touch вызывается клиентом при zone completion и сервером при любом успешном progress save.
- Achievement `ach_first_zone` вызывается клиентом и также сервером; endpoint принимает произвольный существующий achievement id.
- Покупка коллекции существует только в API.

### 4.9 Административный сценарий

- UI отсутствует.
- Moderator/admin может через API читать reports/actions, hide/approve content, ban/unban users.
- Роли проверяет `requireRole`, actor берётся из auth.
- Покрыто security integration, PostgreSQL-вариант пропущен.

## 5. Архитектура

### Стек

- React 19 + Vite 8, JavaScript/JSX, Canvas 2D;
- Node.js ESM + Express 4;
- SQLite через `sql.js` с сохранением бинарного файла либо PostgreSQL через `pg`;
- local filesystem либо S3-compatible storage через AWS SDK;
- Telegram Web Apps API;
- Node test runner, Oxlint, Playwright;
- Docker Compose только для PostgreSQL 16 и MinIO.

### Реальный поток данных

```text
Telegram WebView или обычный браузер
        │ initData / dev user id
        ▼
React App (App.jsx)
        │ Canvas + smart coloring engine
        │ fetch /api/*
        ▼
Vite dev proxy (только development)
        │ rewrite /api → /
        ▼
Express API :3001
   ┌────┴─────────────┐
   ▼                  ▼
SQLite sql.js         PostgreSQL
splint.db.bin         DATABASE_URL
   │                  │
   └────────┬─────────┘
            │ private original image
       ┌────┴────┐
       ▼         ▼
 local uploads  S3 / MinIO
```

Production reverse proxy/static hosting в репозитории отсутствует. Значит схема production до Express и раздача `dist/` остаются внешней ответственностью.

## 6. Карта директорий

- `src/App.jsx` — единый экранный orchestrator на 822 строки: навигация без router, загрузка данных, creator, game callbacks, социальные действия. Используется.
- `src/views/PlayerView.jsx` — композиция игрового экрана, выбор smart/legacy engine, меню и completion dialog. Используется.
- `src/features/coloring/` — новый smart engine:
  - `ColoringSession.jsx` — state machine маршрута/цели/камеры;
  - `ColoringCanvas.jsx` — pointer gestures и рисование;
  - `camera/` и `engine/` — чистая геометрия, кластеры, окна, target routing, reducer/history;
  - `ColoringHud`, `Palette`, `DevDiagnostics` — UI и dev telemetry.
  Используется по умолчанию; E2E указывает на незакрытые переходы состояния.
- `src/components/LegacyPixelCanvas.jsx` — fallback старого движка; достижим только через env flag. `PixelCanvas.jsx` импортируется только косвенно/исторически и выглядит дублирующим.
- `src/lib/` — преобразование изображений, crop, flood fill, игровой прогресс, save queue, Telegram bootstrap. Большинство используется и тестируется.
- `src/api/client.js` — единый JSON fetch wrapper и небольшие API facades. Используется.
- `server/index.js` — startup, middleware, routes, health и error handler. Используется.
- `server/routes/` — 57 обычных и 3 test-only endpoints. `colorings`, `feed`, часть posts/users/meta используются UI; messages, moderation, paid collection и многие list endpoints — server-only.
- `server/services/` — media storage, report policy, transactional Stars ledger. Используется маршрутами, хотя финансовые маршруты не имеют UI.
- `server/database/` — миграции, SQL conversion, transaction adapters, AsyncLocalStorage и SQLite scheduler. Используется.
- `server/migrations/` и `server/migrations/sqlite/` — параллельные PostgreSQL/SQLite схемы версий 001–006. Используются startup runner.
- `server/catalog-templates.json` — minified single-line seed с 6 картами. Используется bootstrap.
- `public/assets/catalog/` — оригинальные и pixel previews. Используются seed-данными.
- `assets/` и `server/scripts/build-catalog-assets.py` — исходники/генератор каталога. Скрипт ручной; runtime не использует.
- `test/` — unit игровой логики.
- `server/test/` — SQLite/PostgreSQL, auth, HTTP, security и finance suites.
- `e2e/` — Playwright creator и stabilization по трём браузерным профилям.
- `scripts/run-e2e-api.mjs` — изолированный API/SQLite/local media для E2E.
- `.github/workflows/ci.yml` — CI, включая PostgreSQL service; фактический текущий GitHub run не проверялся.
- `docker-compose.yml` — PostgreSQL + MinIO, не полный application stack.
- `docs/` — архитектурные/security документы. Полезны, но некоторые статусы устарели относительно code/history.
- `dist/`, `test-results/`, `node_modules/`, `.env.local`, SQLite/media runtime — локальные ignored artifacts.

Признак локальной проблемы установки: `server/node_modules/splint-gemini` является junction обратно на корень репозитория. Из-за него рекурсивные файловые инструменты получают бесконечное дерево; lockfile такого dependency не содержит, поэтому это не архитектура проекта, а повреждённое локальное `node_modules`.

## 7. Как запустить проект

### Требования

- Node.js **>= 20.6**: `server` использует `node --env-file`;
- npm;
- Python 3 только для `npm run catalog:build`;
- Docker Compose — только для PostgreSQL/MinIO режима;
- Playwright browsers: при необходимости `npx playwright install`.

### Локальный SQLite режим

1. Установить зависимости:

   ```powershell
   npm.cmd ci
   npm.cmd --prefix server ci
   ```

2. Создать `.env.local` из `.env.example`.
3. Для локального браузера установить:

   ```env
   ALLOW_DEV_AUTH=true
   VITE_ALLOW_DEV_AUTH=true
   VITE_DEV_USER_ID=user_pixelhunter
   SEED_DEMO_DATA=true
   STORAGE_DRIVER=local
   ```

4. Не задавать `NODE_ENV=production`.
5. Терминал 1:

   ```powershell
   npm.cmd run dev:api
   ```

6. Терминал 2:

   ```powershell
   npm.cmd run dev
   ```

7. Открыть `http://127.0.0.1:5173`; health: `http://127.0.0.1:3001/health`.

SQLite-файл задаётся `SQLITE_PATH`, по умолчанию `server/splint.db.bin`. Bootstrap каталога происходит только при `SEED_DEMO_DATA=true` или отдельном `npm --prefix server run bootstrap:system`.

### PostgreSQL + MinIO

```powershell
docker compose up -d
npm.cmd --prefix server run dev:postgres
npm.cmd run dev
```

Нужны значения `DATABASE_URL`, `STORAGE_DRIVER=s3`, `S3_ENDPOINT`, bucket/access/secret и соответствующая инициализация bucket. Compose создаёт инфраструктуру, но не запускает Node/Vite.

### Production

`server/config.js` требует:

- `NODE_ENV=production`;
- `TELEGRAM_BOT_TOKEN`;
- `DATABASE_URL`;
- `STORAGE_DRIVER=s3`;
- все `S3_*`;
- точные HTTPS origins в `CORS_ORIGINS`;
- явные proxy IP/CIDR в `TRUST_PROXY`;
- `ALLOW_DEV_AUTH` и `SEED_DEMO_DATA` не могут быть true.

В репозитории нет Dockerfile для frontend/backend, reverse proxy и команды раздачи `dist`; production deployment инструкция неполна.

### Проверки

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run build
npm.cmd run test:server
npm.cmd run test:e2e
```

PostgreSQL suite:

```powershell
$env:DATABASE_URL='postgresql://...'
npm.cmd --prefix server run test:postgres
```

Фактический аудит:

- root unit: 200 pass;
- lint: exit 0, много warnings и одна constant-comparison warning;
- build: pass;
- server: 151 pass, 53 skip, 0 fail;
- E2E: исходный audit запуск на свободных портах зафиксировал 16 падений. После P0-правок Chromium stabilization выполнил все 18 тестовых проверок без показанной assertion-ошибки, но Playwright не завершил teardown до timeout. Поэтому E2E нельзя пока считать зелёным.

Типичные проблемы:

- 401 `Telegram Mini Apps authorization required`: не совпали client/server dev-auth flags;
- пустой каталог: seed выключен;
- `EADDRINUSE`: заняты 5173/3001, а `reuseExistingServer=false`;
- PostgreSQL tests silently skip без `DATABASE_URL`;
- recursive file traversal из-за локального junction в `server/node_modules`;
- S3 bucket не создаётся приложением автоматически.

## 8. Данные и хранилище

### Сущности

- `users` — Telegram/dev identity, профиль, роль, ban, Stars/settings;
- `collections` — наборы шаблонов и цена;
- `coloring_templates` — palette/cells, metadata, visibility/owner;
- `coloring_progress` — `(user_id, template_id)`, filled map, revision, completion;
- `coloring_zones` — индексы клеток фрагмента;
- `artworks` — завершённый пользовательский результат;
- `posts`, `comments`, `likes`, `follows`;
- `message_requests`;
- `reports`, `moderation_actions`;
- `daily_streaks`, `achievements`, `user_achievements`;
- `analytics_events`;
- `stars_operations`, `stars_ledger_entries`, `collection_ownerships`;
- `schema_migrations`.

### Жизненный цикл прогресса

`GET progress` создаёт только пустой DTO, но не строку. Первый `PUT revision=0` вставляет строку revision 1. Дальнейшие PUT работают compare-and-set. Полное точное совпадение ставит `completed_at` и создаёт один artwork по owner/template. Публикация ссылается на artwork.

### Изображения

- catalog originals/previews — tracked files под `public/assets/catalog`;
- user original — private object `originals/<user>/<uuid>.<ext>` в local/S3;
- preview и completed image — data URL прямо в БД (`preview_url`, `artworks.image_url`);
- оригинал никогда не имеет публичного GET endpoint;
- delete user template удаляет original best-effort.

### Риски данных

- SQLite — целый DB binary перезаписывается после операций: аварийный процесс/диск требует backup strategy;
- удаление private template выполняет последовательные DELETE без общей транзакции;
- preview/result data URLs раздувают БД;
- local media и SQLite не production-durable;
- result PNG генерирует клиент, сервер не сверяет пиксели с template;
- миграции проверяют checksum и синхронизированы тестами, но PostgreSQL на этом компьютере не подтверждён;
- bootstrap архивирует все catalog templates перед upsert, что требует аккуратного управления составом каталога;
- нет repository-managed backup/restore и object orphan reconciliation.

## 9. API

Все обычные endpoints, кроме `/health`, используют `authMiddleware`.

| Метод | Путь | Назначение | Авторизация | Вход | Ответ | Где вызывается |
|---|---|---|---|---|---|---|
| GET | `/health` | health | нет | — | status/timestamp | Playwright, ops |
| GET | `/feed/recommended` | ranked feed | user | — | post DTO[] | `App.jsx:167` |
| GET | `/feed/following` | feed подписок | user | — | post DTO[] | не вызывается |
| POST | `/posts/create` | публикация artwork | user | artworkId,title,caption,commentsEnabled | post | `App.jsx:392` |
| GET | `/posts/:id` | post | user | id | post DTO | не вызывается |
| GET | `/posts/by-user/:authorId` | posts автора | user | authorId | post[] | не вызывается |
| DELETE | `/posts/:id` | удалить свой post | owner | id | success | не вызывается |
| POST | `/posts/:id/toggle-comments` | comments on/off | owner | id | comments_enabled | не вызывается |
| POST | `/posts/:id/report` | report post | user | reason | report result | `App.jsx:580` |
| POST/DELETE | `/posts/:id/like` | like toggle | user | id | counts/state | `App.jsx:521` |
| GET/POST | `/posts/:id/comments` | list/create | user | text для POST | comment[]/comment | `App.jsx:537,552` |
| POST | `/comments/:id/report` | report comment | user | reason | result | не вызывается |
| POST | `/users/:id/follow` | follow toggle | user | id | is_following | `App.jsx:568,595` |
| GET | `/users/:id/followers` | followers | user | id | user summary[] | не вызывается |
| GET | `/users/:id/following` | following | user | id | user summary[] | не вызывается |
| GET | `/users/me` | свой профиль | user | — | profile DTO | `App.jsx:177` |
| GET | `/users/:id/profile` | профиль | user | id | profile DTO | `App.jsx:177` |
| GET | `/users/:id/posts` | posts профиля | user | id | posts | не вызывается |
| GET | `/users/:id/artworks` | artworks | user | id | public artwork[] | `App.jsx:178` |
| GET | `/users` | users для moderation | moderator/admin | query | safe user DTO[] | не вызывается |
| PATCH | `/users/:id/settings` | изменить свои settings | self | profile/message price fields | user settings | не вызывается |
| POST | `/users/:id/add-stars` | debug Stars | dev auth/self | amount | balance | тесты |
| GET | `/users/collections/all` | collection catalog | user | — | collection[] | не вызывается |
| POST | `/users/collections/:id/add` | купить/add collection | user + idempotency | id | ownership/artworks/balance | не вызывается |
| POST | `/users/artworks/:id/complete` | отметить artwork complete | owner | id | artwork | не вызывается |
| GET | `/colorings` | catalog filters | user | query | summaries | `catalogApi.list` |
| GET | `/colorings/today` | daily/quick/new | user | — | groups | `catalogApi.today` |
| GET | `/colorings/:id/zones` | zones + progress | canRead | id | `{zones}` | `catalogApi.zones` |
| DELETE | `/colorings/:id` | delete private own template | owner | id | success | `App.jsx:509` |
| POST | `/colorings/create` | private user template | user | title,size,palette,cells,images | template | `App.jsx:488` |
| GET | `/colorings/mine` | owned/started | user | — | templates+progress | `App.jsx:157` |
| GET | `/colorings/:id` | full template | canRead | id | template+cells | `App.jsx:209` |
| GET | `/colorings/:id/progress` | progress | canRead | id | progress DTO | `App.jsx:209` |
| PUT | `/colorings/:id/progress` | CAS save/complete | canRead | filled,revision,resultDataUrl | progress/artwork_id | save queue |
| GET/POST | `/meta/streak`, `/streak/touch` | streak | user | — | streak | App/meta + server save |
| GET | `/meta/achievements` | definitions/state | user | — | achievements[] | `App.jsx:148` |
| POST | `/meta/achievements/:id/unlock` | force unlock | user | id | unlocked | `App.jsx:297` |
| GET | `/meta/collections` | collection progress | user | — | collection[] | `App.jsx:152` |
| GET | `/meta/collections/:id/templates` | templates | user | id | summary[] | `App.jsx:680` |
| POST | `/meta/analytics` | event | user | event,payload | accepted | many client calls |
| GET | `/meta/analytics/summary` | user counts | user | — | map | не вызывается |
| POST | `/messages/request/create` | contact request | user | receiverId,post,text | request | не вызывается |
| POST | `/messages/request/pay` | pay request | sender + key | requestId | transaction result | не вызывается |
| POST | `/messages/request/reply` | reply | receiver | requestId,replyText | result | не вызывается |
| POST | `/messages/request/reject` | reject | receiver | requestId | result | не вызывается |
| GET | `/messages/requests/inbox` | inbox | user | — | requests[] | не вызывается |
| GET | `/messages/requests/outbox` | outbox | user | — | requests[] | не вызывается |
| POST | `/moderation/reports/create` | generic report | user | targetType,targetId,reason | result | не вызывается |
| GET | `/moderation/reports` | report queue | moderator/admin | filters | reports | не вызывается |
| GET | `/moderation/actions` | audit log | moderator/admin | — | actions | не вызывается |
| POST | `/moderation/hide` | hide target | moderator/admin | type,id,reason | result | не вызывается |
| POST | `/moderation/approve` | approve target | moderator/admin | type,id,reason | result | не вызывается |
| POST | `/moderation/ban` | ban user | moderator/admin | userId,reason | result | не вызывается |
| POST | `/moderation/unban` | unban | moderator/admin | userId,reason | result | не вызывается |
| GET | `/moderation/banned-users` | banned list | moderator/admin | — | users | не вызывается |

Test-only при `NODE_ENV=test`: `GET /meta/_test/throw`, `GET /meta/_test/auth-error`, `PATCH /meta/_test/set-role`.

Проблемы контрактов:

- frontend-запросов без server endpoint не найдено;
- большая часть server API не вызывается frontend;
- `POST achievements/:id/unlock` не валидирует критерий;
- analytics payload не имеет схемы/ограничения глубины;
- `max_minutes` может стать `NaN`;
- result PNG проверяется по сигнатуре/размеру, но не соответствует ли содержимое шаблону;
- route-level validation реализована вручную и неодинаково;
- финансовые операции хорошо защищены idempotency/transaction, но пользовательского потока нет.

## 10. Telegram-интеграция

Mini App ожидает Telegram SDK из `index.html`, вызывает `WebApp.ready()` в `src/lib/telegram.js`, но не вызывает `expand()`, не настраивает theme params и не обрабатывает lifecycle/back button Telegram.

Подлинность `initData` проверяется правильно по общему алгоритму Telegram Web Apps:

- сортировка полей без `hash`;
- HMAC secret из bot token;
- timing-safe compare;
- ограничение возраста 24 часа;
- identity берётся из подписанного `user`, не из body.

Вне Telegram работает dev mode с `X-User-Id`; он активен только при обеих согласованных переменных на frontend/backend. Production startup запрещает dev auth.

Только внутри Telegram подтверждаемыми по коду являются haptic-вызовы. Их реальная работа, native share, layout safe areas и авторизация с настоящим ботом не проверены.

Недоделано/риск:

- срок 24 часа жёсткий и не конфигурируется;
- не отвергается `auth_date` из далёкого будущего;
- нет replay nonce, хотя повторное signed initData в окне 24h обычно допустимо;
- Telegram user profile при последующих входах не обновляет nickname/photo;
- нет bot setup/deep-link/deployment инструкции;
- нет реального payments webhook, несмотря на Stars ledger.

## 11. Тесты

### Наборы

- `test/pixelColoring.test.js`, `test/coloringEngine.test.js` — чистая игровая математика и state transitions;
- `src/lib/*.test.js` — queue, quality, environment, play loop;
- `server/test/api.integration.test.js` — progress → post;
- auth/error/security integration — HTTP auth, roles, bans, DTO, reports;
- database tests — migrations, transactions, concurrency и PostgreSQL adapters;
- Stars tests — service и HTTP idempotency/ledger;
- media storage — local driver/path traversal;
- `e2e/creator.spec.js` — shell, creator, completion, feed, delete, modes;
- `e2e/stabilization.spec.js` — camera/guided state/onboarding/viewport.

### Покрытие основных функций

| Функция | Unit | Integration | E2E | Доверие |
|---|---:|---:|---:|---|
| pixel conversion | да | нет | да | высокое локально |
| coloring primitives | да | нет | да, частично падает | среднее |
| smart camera/route | да | нет | да, падает | низкое для UI |
| save queue | очень подробно | API отдельно | косвенно | высокое на SQLite |
| progress CAS | частично | SQLite да, PG skipped | да | среднее |
| completion → post | да | да | да | высокое на SQLite |
| Telegram auth | нет | да | нет | среднее |
| social interactions | нет | security/API | да | средне-высокое |
| creator | да частично | create endpoint | да | высокое локально |
| local media | да | да | creator | высокое local |
| S3 | нет | нет | нет | неподтверждённо |
| PostgreSQL | adapter unit | 53 skipped | нет | низкое в этом аудите |
| moderation | нет | SQLite да | нет UI | среднее для API |
| Stars | подробно | SQLite HTTP | нет UI | высокое для API/SQLite |
| deployment | нет | нет | нет | отсутствует |

Непокрытые критические места: реальный Telegram WebView, production reverse proxy/CORS, S3, backup/restore, unload во время debounce save, полный PostgreSQL run, complete three-project E2E, accessibility.

Тесты нельзя считать полностью согласованными: zone E2E исправлен так, чтобы запрашивать конкретный template и проверять HTTP status; guided Chromium assertions стабилизированы. Но Playwright teardown на Windows не возвращает итоговый статус, а mobile-профили, PostgreSQL и S3 остаются неподтверждёнными.

## 12. Безопасность

| Severity | Доказательство | Сценарий и последствия | Направление исправления |
|---|---|---|---|
| **critical** | `server/package-lock.json`, npm audit: `fast-xml-parser <=5.6.0` через AWS SDK | уязвимый XML parser присутствует в production dependency tree; применимость зависит от обрабатываемых S3 XML-ответов | обновить AWS SDK/lockfile и повторить audit/tests |
| **high** | `server/routes/meta.js:64` | любой auth user вызывает unlock любого achievement без фактического условия; подмена прогресса/награды | убрать client-authoritative unlock, вычислять сервером |
| **high** | `server/routes/colorings.js:229-336` | клиент может одним PUT отправить точную `cells` карту, мгновенно завершить работу и получить artwork/achievements | серверные правила progression/anti-cheat, rate/time/event checks по продуктовой модели |
| **medium** | `colorings.js:328-331` | клиент задаёт completed PNG; можно сохранить постороннее изображение как результат и опубликовать | server rendering или проверка/перегенерация |
| **medium** | `media-storage.js:15-20` | original проверяется по data URL MIME/размеру, но не magic bytes/декодированию | decode+sniff+pixel limits, malware policy |
| **medium** | `server/index.js:47-54` | только глобальный IP limit; NAT блокирует всех, распределённый abuse обходит; Stars/login/report требуют разных лимитов | per-user/per-route persistent limiter |
| **medium** | `server/routes/colorings.js:148-167` | non-transactional delete может оставить частично удалённые данные/orphan media | DB transaction + outbox/reconciliation |
| **medium** | `auth.js:9` | future `auth_date` проходит, пока разность отрицательная | проверять допустимый future skew |
| **medium** | `meta.js:115`, `express.json 15mb` | auth user может массово писать произвольные analytics payload до общего лимита | schema/size/event allowlist/retention |
| **low** | `server/index.js:40-45` | dev CORS `*`; приемлемо локально, опасно при случайном публичном dev server | bind localhost, документировать, не публиковать |
| **low** | `auth.js:18-25` | nickname/photo не обновляются, возможны stale identity данные | безопасный upsert разрешённых полей |

Положительные меры: production fail-closed config, Telegram HMAC/timing-safe compare, ban check на каждом auth request, role middleware, parameterized SQL, generic 500 response, Helmet, strict production CORS, explicit trust proxy, safe path resolution, file size limits, report uniqueness/daily limit, append-only Stars ledger и idempotency.

SQL injection/path traversal/чтение чужого private template по исследованным путям не подтверждены. Прямой `userId` из body для авторизации не используется. Admin endpoints защищены ролью. Однако полный penetration test не проводился.

## 13. Что не закончено

- `SECURITY_FOLLOWUPS.md` частично устарел: называет Stars «in progress», хотя history и tests показывают merge; некоторые follow-ups уже исправлены.
- Сообщения, paid collections, followers/following lists, following feed, profile settings, post delete/toggle-comments, analytics summary и moderation — backend без UI.
- Реальные Telegram Payments/webhooks, refund/withdrawal отсутствуют (`docs/stars-transactions.md` это признаёт).
- Production app containers/deploy отсутствуют.
- PostgreSQL и S3 runtime не подтверждены.
- Guided coloring имеет красные E2E transitions.
- Zone celebration E2E падает на отсутствующем `zones`.
- `PixelCanvas.jsx` и `LegacyPixelCanvas.jsx` дублируют старый путь; штатно активен smart engine.
- `DevDiagnostics` содержит неиспользуемые props и показывается только special env.
- `IDEA.md` практически пуст (11 байт).
- `.env.example`/`DEVELOPMENT.md` полезны, но README содержит битую mojibake-кодировку в текущем terminal rendering и неоднозначное обещание автоматического каталога.
- Нет TODO/FIXME в production-коде; незавершённость выражена disconnected API и failing tests, а не маркерами.
- Mock/demo users/content создаются только explicit seed; это осознанный dev путь.
- В коде много hardcoded product values: achievement ids, 24h auth TTL, report limits, 15 MB body, grid 8–64, palette 2–32, rate 100/min, XP/combo rules.

## 14. Технический долг

### Блокирует запуск

- неправильный `.env.local`/несогласованный dev auth;
- seed не включён — пустой каталог;
- локальный junction `server/node_modules/splint-gemini` требует чистой переустановки зависимостей;
- занятые строгие порты блокируют Playwright/dev.

### Блокирует основной пользовательский сценарий

- guided target/free exploration/onboarding E2E failures;
- zone response/test failure;
- возможная потеря debounce-save при закрытии вкладки.

### Блокирует production

- critical dependency advisory;
- неподтверждённые PostgreSQL/S3/Telegram;
- нет app deployment/runtime topology;
- client-authoritative achievements/completion/result image;
- нет backup/restore/monitoring;
- полный E2E не зелёный.

### Желательно исправить позднее

- disconnected API/UI;
- ручная разрозненная валидация;
- N+1 enrichment queries;
- большие data URLs в БД;
- синхронизация Telegram profile.

### Косметика

- lint warnings;
- старые/битые документы;
- крупные монолитные App/ColoringSession (рефакторинг не делался);
- local `LOCAL` badge всегда видим по JSX.

## 15. История разработки

19 июля 2026 проект стартовал commit `4133f3f` сразу как full-stack pixel studio: React client, Express/SQLite social backend и базовый продуктовый цикл. В тот же день `38c99aa` добавил retention loop, meta progress и analytics; `8484dd6` отделил runtime-файлы.

21 июля отдельная длинная ветка smart coloring engine (`825a1b8`) добавила новый мобильный движок, после чего последовала серия мелких repair commits: camera state machine, route stability, gesture separation, undo/redo, reveal semantics и layout. Частота узких исправлений и формулировки «close blockers», «regression», «preserve patches for audit» похожи на итеративную работу нескольких ИИ-агентов/ревьюеров, но автор Git у всех один, поэтому это вывод по стилю истории, не доказанный факт об исполнителях.

22 июля параллельно прошла безопасность backend: PR #2 — fail-closed auth, роли, async errors; PR #3/#4 — migration runner, SQLite/Postgres parity, transaction context, concurrency и CAS progress. Это явный переход от локального демо к production-oriented data layer.

23 июля добавлена сложная Stars ledger архитектура с append-only operations, idempotency и ownership. В истории видны merge, revert и revert-revert PR #5–#7 — признак нестабильной интеграции, впоследствии восстановленной. Одновременно исправлялись Windows launch/tunnel scripts; в текущем дереве эти launcher scripts уже отсутствуют, то есть документационные/операционные идеи пережили ещё один переход.

24–25 июля появились изолированный E2E API, упрощённый startup, creator/full E2E и очередной guided-coloring hardening. Main содержит merge smart engine и docs status. Ветка аудита поверх main добавила content/report/moderation hardening, strict production config и security tests. Последний commit `d8ed95b` вновь «harden coloring experience», но текущий E2E показывает, что переход smart engine всё ещё не завершён.

Архитектурные следы переходов:

- legacy и smart Canvas существуют одновременно;
- local SQLite и production PostgreSQL поддерживаются параллельными миграциями;
- social/Stars backend существенно опережает UI;
- старые launcher/tunnel commits не соответствуют текущему дереву;
- security docs не полностью синхронизированы с merged code;
- Docker охватывает infrastructure, но не application deployment.

## 16. Главные риски

| # | Риск | Вероятность | Влияние | Доказательство | Что проверить/сделать |
|---:|---|---|---|---|---|
| 1 | Guided game ломается на реальных viewport/state transitions | высокая | высокое | 16 E2E failures до 90/111 | воспроизвести каждый failure, получить green E2E |
| 2 | Production dependency critical | высокая (наличие) | высокое | npm audit server | обновить dependency tree |
| 3 | Непроверенный production data path | высокая | critical | 53 PG skips, нет S3 tests | полный PG/S3 staging suite |
| 4 | Achievement/progress cheating | высокая | средне-высокое | `meta.js:64`, `colorings.js:229` | перенести авторитет на сервер |
| 5 | Нет deployable application stack | высокая | высокое | Compose только DB/MinIO | зафиксировать hosting/reverse proxy/deploy |
| 6 | Потеря последнего autosave при закрытии | средняя | высокое | debounce queue без unload flush | browser lifecycle test/strategy |
| 7 | Client-supplied result попадает в social content | средняя | высокое | `colorings.js:328` | server render/validation |
| 8 | SQLite/local media потеряны без backup | средняя | высокое | один binary + uploads | backup/restore drill |
| 9 | Backend-функции создают ложное ощущение готового продукта | высокая | среднее | десятки endpoints без calls | явно scope/disable/document |
| 10 | Документация и реальность расходятся | высокая | среднее | security followups, Docker/startup claims | сделать эту карту source of truth и обновлять по CI |

## 17. Что делать дальше

Ниже только стабилизация уже существующего продукта.

| Этап/задача | Приоритет | Результат | Зависимость | Критерий готовности |
|---|---|---|---|---|
| 1. Чисто переустановить root/server deps | P0 | нет recursive junction | — | `npm ci` в обоих деревьях, `rg` не зацикливается |
| 1. Зафиксировать минимальный `.env.local` и seed | P0 | повторяемый старт | deps | новый checkout запускается по инструкции |
| 1. Проверить health/catalog вручную | P0 | baseline | env | 200 health, 6 templates |
| 2. Разобрать все E2E failures по одному | P0 | подтверждён core flow | baseline | 111/111 или формально обновлённый корректный suite |
| 2. Проверить unload/return autosave | P0 | нет потери прогресса | core | browser test после reload |
| 2. Проверить complete/publish на desktop+mobile | P0 | основной цикл | saves | persisted artwork/post после restart |
| 3. Устранить critical dependency advisory | P0 | безопасный lockfile | tests | npm audit без critical + regression green |
| 3. Закрыть client-authoritative achievement/result | P0 | server authority | core | direct forged calls отклоняются тестом |
| 4. Прогнать PostgreSQL migrations/concurrency/HTTP | P0 | production DB confidence | Docker | 0 PG skips/fails |
| 4. Проверить S3 create/delete/orphan behavior | P0 | durable images | MinIO | integration tests green |
| 4. Backup/restore и consistency check | P1 | recoverability | storage | документированный успешный drill |
| 5. Threat model endpoints и per-route limits | P1 | public alpha boundary | auth/data | security matrix и abuse tests |
| 5. Проверить настоящий Telegram initData/WebView | P1 | real identity flow | HTTPS staging | successful login + expired/invalid rejection |
| 6. Сделать CI обязательным: unit/server/PG/E2E/audit | P1 | regressions блокируют merge | stable tests | required checks green |
| 6. Добавить S3/Telegram contract tests | P1 | закрыты пробелы | staging mocks | повторяемые tests |
| 7. Описать и собрать app deployment | P1 | раздаётся frontend/API | security/data | staging deploy из clean commit |
| 7. Настроить secrets, logs, health, backups | P1 | operability | deployment | restore + alert drill |
| 8. Зафиксировать UI scope существующих server-only функций | P2 | честный backlog | stable MVP | owner решает keep/disable/finish без новых идей |
| 8. Только после gate перейти к продуктовой разработке | P2 | контролируемое развитие | все P0/P1 | green release checklist |

## 18. Краткая памятка владельцу

### Что это

Это Telegram Mini App «раскраска по номерам». Главная ценность — открыть пиксельную картинку, удобно закрасить её на телефоне, вернуться к прогрессу и опубликовать результат.

### Как запустить

Установите зависимости в корне и `server`, скопируйте `.env.example` в `.env.local`, включите три локальных флага `ALLOW_DEV_AUTH`, `VITE_ALLOW_DEV_AUTH`, `SEED_DEMO_DATA`, затем отдельно запустите `npm run dev:api` и `npm run dev`. Откройте `http://127.0.0.1:5173`.

### Где главная логика

- приложение и переходы: `src/App.jsx`;
- игровой экран: `src/views/PlayerView.jsx`;
- smart engine: `src/features/coloring/`;
- преобразование картинки: `src/lib/pixelColoring.js`;
- сохранение: `src/lib/progressSaveQueue.js`;
- API раскрасок: `server/routes/colorings.js`;
- БД: `server/db.js` и `server/migrations/`.

### Главный сценарий

Каталог → открыть раскраску → покрасить → автосохранить → завершить → опубликовать.

### Что точно работает в проверенной локальной конфигурации

Сборка, 200 unit-тестов, 151 серверный тест на SQLite, каталог, creator, базовая игра, сохранение, завершение, публикация и социальные действия. Это подтверждено кодом и тестами.

### Что точно не готово

Полностью зелёный E2E, доказанный PostgreSQL/S3 production runtime, deployment всего приложения, защищённые от читинга achievements/progress, UI сообщений/Stars/modерации.

### Три ближайших действия

1. Получить чистый повторяемый локальный старт и полный green Playwright.
2. Прогнать весь PostgreSQL + MinIO suite без skips.
3. Закрыть critical dependency и client-authoritative achievements/completion до публичного доступа.

### Что требует отдельной реальной проверки

Настоящий Telegram бот/WebView, haptics/native share, PostgreSQL под нагрузкой, S3/MinIO жизненный цикл, production proxy/CORS, backup/restore и полный E2E на всех трёх профилях.

## Дополнение: синхронизация состояния после повторной security-проверки

### Что изменилось в выводах

- **Подтверждённо в основной ветке:** merged PR #2 добавил fail-closed Telegram/dev auth и RBAC; PR #3 — migration/seed safety; PR #4 — transaction/CAS foundation; PR #7 — atomic Stars ledger. Это не отменяет прямого unlock достижений и forged progress.
- **Только в draft PR #10:** strict production CORS/configuration, report hardening, banned-user check и migration 006. Эти изменения нельзя описывать как работающие в `main` до merge.
- **Остаётся открытым:** client-authoritative completion/result image, direct achievements unlock, Telegram future timestamp, общий IP-only limiter, analytics payload, dependency advisory, backup/deployment.
- **Требует среды:** real Telegram WebView, PostgreSQL, S3/MinIO, production domain/proxy and secrets. Локальные unit tests не заменяют эти проверки.

### Актуальная безопасность

Подробные статусы, пути и уровни подтверждения собраны в [SECURITY_FOLLOWUPS.md](../SECURITY_FOLLOWUPS.md) и [AUDIT_FINDINGS.md](AUDIT_FINDINGS.md). Критические ближайшие действия остаются прежними, но порядок уточнён:

1. Обновить production AWS SDK dependency tree и повторить `npm --prefix server audit --omit=dev`.
2. Сделать progress, completion, statistics и achievement conditions server-authoritative; добавить negative HTTP tests для forged requests.
3. До merge/production подтвердить PR #10 на чистом main-based deployment, затем запустить PostgreSQL, S3/MinIO и Telegram smoke tests.

### Результаты повторной проверки

| Проверка | Результат | Ограничение |
|---|---|---|
| Root production dependency audit | 0 vulnerabilities | Проверяет корень, не server tree. |
| Server production dependency audit | 18: 1 critical, 17 moderate | `fast-xml-parser` транзитивно через используемый `@aws-sdk/client-s3`; доступен update. |
| Root unit tests | 200 passed | Запущено в локальной рабочей ветке, не clean checkout main. |
| Server tests | 151 passed, 53 skipped | PostgreSQL suite не был запущен без `DATABASE_URL`. |
| Build / lint | success / exit 0 with warnings | Не является security proof. |
| Playwright | неполный | Windows teardown зависает; нет достоверного full-suite exit code. |

### Рабочая граница перед следующим этапом

На 28.07.2026 рабочее дерево не чисто. Это не один набор изменений и его нельзя без проверки объединять с security PR:

| Группа | Файлы | Назначение | Связь с main/PR |
|---|---|---|---|
| Локальная UI/E2E-стабилизация | `src/App.css`, `src/index.css`, `src/features/coloring/ColoringCanvas.jsx`, `src/features/coloring/coloring.css`, `e2e/*.spec.js`, `playwright.config.js` | compact-height UI, wheel viewport, offline Telegram mock и более точные E2E assertions | Незакоммичено; не входит в draft PR #10. |
| Security/public-alpha | `server/**`, migrations 006, server tests, `server/config.js` | production configuration, reporting, moderation, public DTOs/content integrity | Draft PR #10; до merge не является состоянием `main`. |
| Документация | `SECURITY_FOLLOWUPS.md`, `docs/AUDIT_FINDINGS.md`, этот файл | аудит и синхронизация статусов | Не меняет runtime. |

Следующее безопасное действие — отдельно подтвердить/закоммитить или откатить локальную UI/E2E-группу по результатам воспроизводимого E2E; затем review и merge-ready проверка PR #10. Нельзя объединять их в один commit или объявлять security issues закрытыми до merge в `main`.

### Обновление рабочей ветки `feature/public-alpha-hardening` (28.07.2026)

После предыдущего аудита в draft PR #10 добавлены три отдельных commit: `756826f` блокирует прямые API-вызовы для unlock achievement и streak, ограничивает Telegram `auth_date` и analytics; `2972fc7` обновляет AWS S3 SDK; `77f2b95` явно требует Node.js 20+. На текущем HEAD server production audit возвращает **0 vulnerabilities**, локальные media-storage tests проходят (9/9), полный server suite — **152 passed, 53 skipped**. Это улучшает готовность PR, но не состояние `main`.

Новые проверенные security-находки также закрыты только в draft: `GET /users` больше недоступен обычному пользователю и не раскрывает Stars/banned state (SEC-014); чужие private/unpublished artworks не попадают в `GET /users/:id/artworks` (SEC-015); `requireActiveUser()` блокирует забаненного пользователя до message routes (SEC-016). Подтверждение лежит в `server/test/security-hardening.integration.test.js` и `server/test/api.integration.test.js`.

Ключевой незакрытый риск прежний: `PUT /colorings/:id/progress` всё ещё принимает от клиента готовую карту `filled`; CAS устраняет гонку, но не подделку прохождения. Это требует отдельного продуктового решения о server-authoritative протоколе, а не локального патча UI. PostgreSQL и MinIO/S3 suites не выполнены: Docker Desktop daemon на рабочей машине не запущен, поэтому 53 PostgreSQL-теста остаются skipped. Актуальный реестр: [SECURITY_FOLLOWUPS.md](../SECURITY_FOLLOWUPS.md) и [AUDIT_FINDINGS.md](AUDIT_FINDINGS.md).
