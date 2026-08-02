# Splint Pixel Studio

Локальный MVP Telegram Mini App для раскрашивания пиксельных изображений по номерам. Пользователь выбирает готовую раскраску или создаёт приватную из собственного изображения, сохраняет прогресс на сервере, завершает работу и публикует её в ленте.

## Что работает

- каталог серверных пиксельных раскрасок;
- Canvas-редактор с номерами, палитрой, подсветкой, отменой и повтором;
- игровые задания по цветам, комбо, XP, уровни, этапы прогресса и тактильная обратная связь Telegram;
- серверное автосохранение прогресса с ревизиями;
- восстановление прогресса после перезапуска;
- создание приватной раскраски из PNG, JPG или WebP в браузере;
- точное превью результата перед сохранением и удаление собственных загрузок;
- завершение работы и публикация в ленте;
- API лайков, комментариев, подписок, профилей и модерации;
- локальный режим пользователя `user_pixelhunter`.
- каталог из шести оригинальных Image Gen-сцен, преобразованных в точные карты 28–32 пикселя.

## Требования

- Node.js 20 или новее;
- npm.

## Первый запуск

Установите зависимости в корне и в серверной папке:

```powershell
npm.cmd install
Set-Location server
npm.cmd install
Set-Location ..
```

В первом терминале запустите API:

```powershell
npm.cmd run dev:api
```

Во втором терминале запустите клиент:

```powershell
npm.cmd run dev
```

Откройте `http://localhost:5173`. При первом запуске API автоматически создаст файл локальной базы `server/splint.db.bin`, тестовых пользователей и каталог раскрасок.

## Проверка

```powershell
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run catalog:build
Set-Location server
npm.cmd run check
```

## PostgreSQL и MinIO локально

Для production-совместимой базы и объектного хранилища скопируйте `.env.example` в `.env`, затем запустите сервисы:

```powershell
docker compose up -d
Set-Location server
Copy-Item .env.example .env
npm.cmd run dev:postgres
```

PostgreSQL-миграция описывает ту же доменную модель, что и локальная БД: пользователей, раскраски, прогресс, готовые работы, публикации и социальные связи. При заданном `DATABASE_URL` API автоматически выбирает PostgreSQL и применяет миграцию при старте; без него продолжает использовать файл `server/splint.db.bin`. MinIO сохраняет исходные пользовательские изображения приватно, а API отдаёт только производную миниатюру и карту клеток.

## Архитектура

- `src/App.jsx` — экранный слой и состояния приложения;
- `src/components/PixelCanvas.jsx` — Canvas-редактор;
- `src/lib/pixelColoring.js` — игровая логика и преобразование пользовательского изображения;
- `server/catalog-templates.json` — карты клеток и палитры встроенного каталога;
- `server/scripts/build-catalog-assets.py` — воспроизводимая сборка Image Gen-исходников в точные пиксельные превью и шаблоны;
- `src/api/client.js` — HTTP-клиент;
- `server/routes/colorings.js` — каталог, приватные шаблоны и сохранение прогресса;
- `server/db.js` — адаптер локальной `sql.js` или PostgreSQL и стартовые данные.

В разработке Vite перенаправляет `/api/*` на `http://localhost:3001`. При наличии `DATABASE_URL` тот же слой `server/db.js` подключается к PostgreSQL без изменения контрактов API.

## Переменные окружения

Клиент поддерживает:

```env
VITE_API_URL=/api
VITE_DEV_USER_ID=user_pixelhunter
```

When `TELEGRAM_BOT_TOKEN` is configured, the server validates `X-Telegram-Init-Data` from Telegram Web Apps and creates a local user profile on first sign-in. `X-User-Id` is accepted only outside production or when `ALLOW_DEV_AUTH=true` is explicitly set.

В production-режиме авторизацию через заголовок `X-User-Id` нужно заменить проверкой Telegram Mini Apps `initData`.

## Public-alpha release-candidate posture (2026-08-02)

This repository is a local public-alpha release candidate without real payments. Production defaults to `PAYMENTS_MODE=disabled`; internal credits are not Telegram Stars. Completion is server-authoritative, canonical feed media is thumbnail-based, and new canonical artwork rows do not store base64 images.

Local verification passed: root tests 201/201, server tests 163 passed with 56 environment-conditional skips, E2E 110 passed with 4 expected skips, lint 89 warnings within the 100-warning budget, syntax/build checks passed, and dependency audits report 0 vulnerabilities. The disposable external pass also passed PostgreSQL 91/91, MinIO/S3 2/2, migrations, database backup/restore, media sweep, and readiness checks. Telegram WebView, real Telegram Stars, production credentials, object-storage restore, `/live`, and target-runtime graceful shutdown remain required gates. See [docs/remediation/FINAL_REPORT.md](docs/remediation/FINAL_REPORT.md) and [docs/remediation/EXTERNAL_VALIDATION.md](docs/remediation/EXTERNAL_VALIDATION.md).
