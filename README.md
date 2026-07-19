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
