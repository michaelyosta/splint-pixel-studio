# Pixel subdomain migration evidence

Status: `PIXEL_SUBDOMAIN_MIGRATED`
Date: 2026-09-08
Scope: Move the public Telegram Mini App origin to `pixel.showalove.ru` while
preserving the existing stack and the legacy fallback domains.

## Direct evidence

- Repository inventory found no runtime hardcoded reference to
  `showalove.ru`. The frontend API base remains environment-driven, and the
  Telegram deep-link helper derives its origin from `window.location.origin`.
- Cloudflare Pages project `splint-pixel-studio` exists and its production
  deployment was `main` at SHA `afb33ff`. Custom domains showed
  `pixel.showalove.ru`, `showalove.ru`, and `www.showalove.ru` as active with
  SSL enabled.
- Cloudflare DNS showed `pixel.showalove.ru` as a proxied CNAME to
  `splint-pixel-studio.pages.dev`. The unrelated tunnel and worker records were
  not changed.
- HTTPS probes returned HTTP 200 for all three public origins:
  `pixel.showalove.ru`, `showalove.ru`, and `www.showalove.ru`.
- Render API `/health` and `/ready` returned HTTP 200. `/ready` reported
  database, object-storage, and configuration checks as `ok`.
- API CORS allowed `https://pixel.showalove.ru` and `https://showalove.ru`
  exactly with credentials and rejected `https://evil.example`; no wildcard
  origin was present. The `OPTIONS /colorings` preflight for the pixel origin
  also returned the expected CORS headers.
- R2 CORS was not required. The client reaches media through the API `/media`
  route; originals in `splint-originals` remain private.
- BotFather showed the existing production bot `@splint_pixel_studio_bot`
  with an active Menu Button named `Open` targeting
  `https://pixel.showalove.ru`.
- A fresh Telegram Web launch from the production bot opened the Mini App at
  the pixel origin. The app loaded the catalog and the navigation smoke passed
  through `Каталог`, `Создать`, `Профиль`, and back to `Каталог`.

No Telegram initData, tokens, cookies, authorization headers, or other
credentials are included in this record.

## Change boundaries

- Frontend product/source behavior: unchanged.
- Commerce configuration: unchanged and still fail-closed.
- Database schema/data: unchanged.
- R2 bucket/configuration: unchanged.
- Cloudflare DNS/Pages: observed and verified; unrelated records preserved.
- Telegram Menu Button: verified as already targeting the requested new origin.

## Rollback readiness

`showalove.ru` and `www.showalove.ru` remain active fallback origins with TLS,
and the API continues to allow the legacy origin. A rollback can therefore
restore the Telegram Menu Button URL to `https://showalove.ru` without a code,
database, commerce, or storage rollback. Do not remove the legacy domains until
the owner approves the end of the fallback window.

## Terminal

`PIXEL_SUBDOMAIN_MIGRATED`
