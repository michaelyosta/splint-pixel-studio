# Authentication

Status: CANONICAL
Authority: Authentication, development-auth, and role boundary.

Navigation: [INDEX.md](INDEX.md) · Current state: [CURRENT_STATE.md](CURRENT_STATE.md)

## Overview

Splint's supported production authentication path is the Telegram Mini App:

1. **Telegram Mini App** — production mode using Telegram's initData HMAC verification.
2. **Standalone browser handoff** — unauthenticated browser visitors are sent
   to the existing production bot and open the Mini App there; no browser-only
   account is created.
3. **Browser OIDC code** — retained as dormant, feature-gated implementation
   for future work, but not surfaced by the current product UI.
4. **Dev-auth** — development-only mode using `X-User-Id` header.

## Production

```
NODE_ENV=production
TELEGRAM_BOT_TOKEN=...
ALLOW_DEV_AUTH=false
```

- `ALLOW_DEV_AUTH` must never be enabled in production. The server will refuse to start if `NODE_ENV=production` and `ALLOW_DEV_AUTH=true`.
- `TELEGRAM_BOT_TOKEN` is mandatory in production. The server will refuse to start without it.
- The Telegram SDK (`telegram-web-app.js`) must be loaded in the Mini App context. It provides `initData` which is sent as the `X-Telegram-Init-Data` header.
- Standalone browser authentication is not part of the current production
  path. The UI links to `@splint_pixel_studio_bot`; the user enters through
  the Mini App and receives signed `initData`.
- Dormant OIDC/session code remains fail-closed if explicitly configured for
  future work, but production does not require OIDC credentials while this
  handoff policy is active.

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

1. Inside the Telegram Mini App, the client sends non-empty
   `window.Telegram.WebApp.initData` as `X-Telegram-Init-Data`; the server
   verifies the HMAC and resolves the canonical Telegram account.
2. In an ordinary browser without an existing valid server session, Splint
   shows `Открыть в Telegram` and links to
   `https://t.me/splint_pixel_studio_bot`. The user opens the bot and presses
   its configured `Open` menu button to launch the Mini App.
3. The standalone browser UI does not call `/auth/telegram/start` and does
   not create an anonymous or browser-only persistent account.
4. Dev-auth remains available only under the explicit local development flags.

## Unified Telegram account identity

Mini App initData uses the verified numeric Telegram user identifier. If the
dormant browser OIDC path is reactivated in a future release, it must continue
to use the same identifier. `ensureTelegramUser()` first searches `users.telegram_id`, then
the canonical `tg_<id>` row, and refreshes only Telegram-owned profile fields.
Username, display name, avatar, OIDC `sub`, and client headers cannot link two
accounts. The OIDC provider contract and endpoint values are maintained by
[Telegram Login](https://core.telegram.org/bots/telegram-login); production
configuration must still be checked against the exact BotFather Allowed URLs.

## Roles

Users have one of three roles stored in the `role` column:

- `user` — default role, basic access
- `moderator` — can access moderation panel, ban users, hide content
- `admin` — full access (same as moderator, reserved for future)

Rights are enforced by the `requireRole()` middleware. Moderator privileges are determined by the `role` column in the database, not by user ID or username.
