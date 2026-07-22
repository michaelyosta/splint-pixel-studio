# Authentication

## Overview

Splint supports two authentication modes:

1. **Telegram Mini App** — production mode using Telegram's initData HMAC verification.
2. **Dev-auth** — development-only mode using `X-User-Id` header.

## Production

```
NODE_ENV=production
TELEGRAM_BOT_TOKEN=...
ALLOW_DEV_AUTH=false
```

- `ALLOW_DEV_AUTH` must never be enabled in production. The server will refuse to start if `NODE_ENV=production` and `ALLOW_DEV_AUTH=true`.
- `TELEGRAM_BOT_TOKEN` is mandatory in production. The server will refuse to start without it.
- The Telegram SDK (`telegram-web-app.js`) must be loaded in the Mini App context. It provides `initData` which is sent as the `X-Telegram-Init-Data` header.

## Local browser development

```
NODE_ENV=development
ALLOW_DEV_AUTH=true
VITE_ALLOW_DEV_AUTH=true
VITE_DEV_USER_ID=user_pixelhunter
```

- `ALLOW_DEV_AUTH=true` enables the server to accept `X-User-Id` headers.
- `VITE_ALLOW_DEV_AUTH=true` enables the frontend to send `X-User-Id` when Telegram initData is not available.
- If neither Telegram initData nor dev-auth is enabled, the server returns `401`.

> **Warning**: `ALLOW_DEV_AUTH` must never be enabled in production.

## Auth flow

1. If `window.Telegram?.WebApp?.initData` is non-empty, the client sends `X-Telegram-Init-Data`.
2. If Telegram initData is absent and `VITE_ALLOW_DEV_AUTH=true`, the client sends `X-User-Id`.
3. If neither is present, the client sends no auth headers, and the server returns `401`.

## Roles

Users have one of three roles stored in the `role` column:

- `user` — default role, basic access
- `moderator` — can access moderation panel, ban users, hide content
- `admin` — full access (same as moderator, reserved for future)

Rights are enforced by the `requireRole()` middleware. Moderator privileges are determined by the `role` column in the database, not by user ID or username.
