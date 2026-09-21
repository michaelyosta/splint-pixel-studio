# Responsive web and unified Telegram identity

Status: CANONICAL
Authority: Cross-platform layout, host capability boundary, and browser
Telegram identity readiness.

Navigation: [INDEX.md](INDEX.md) · [authentication.md](authentication.md) · [INFRASTRUCTURE_CONTRACT.md](INFRASTRUCTURE_CONTRACT.md)

## Product shell

The product remains one application with exactly three primary destinations:
`Каталог`, `Создать`, and `Профиль`. The layout is responsive to viewport size;
platform capabilities are selected separately by `src/lib/platform.js`.

The responsive targets are 360, 390, 430, 768, 1024, 1280, and 1440+ CSS
pixels. Phone-sized Telegram viewports keep the compact navigation treatment;
tablet and desktop browsers use the available width for catalog grids,
creator preview/control layout, profile showcase grids, and the player canvas
with a side control panel for tiled sessions.

## Platform adapter

`src/lib/platform.js` is the UI capability boundary. It exposes whether the
host is Telegram or an ordinary browser, Telegram platform family, viewport
and safe-area data, and optional haptic, lifecycle, share, and payment
capabilities. Browser fallbacks are no-ops or native Web APIs; UI code does not
assume that a Telegram bridge exists.

The Telegram host stub used by automated tests is not physical-device proof.
Physical Telegram iOS validation remains a separate manual checkpoint.

## Browser login

Standalone browsers show the explicit `Войти через Telegram` action. The owner
and catalog API surface remains protected until a server-issued session is
present. No anonymous persistent Splint user is created.

The server flow is:

```text
GET /auth/telegram/start
→ server-generated state + nonce + PKCE S256 verifier
→ browser-bound short-lived HttpOnly state cookie
→ Telegram OIDC Authorization Code flow
→ server-side code exchange and signed id_token validation
→ canonical Telegram id lookup/create
→ opaque Secure HttpOnly SameSite=Lax session + CSRF token
```

The verifier checks the exact configured issuer, audience, expiry, issued-at,
nonce, signature, and signed numeric Telegram profile `id`. It never links an
account using a username, display name, photo, `sub`, localStorage value, or a
frontend user id. The canonical application identity is the existing
`users.telegram_id`, with the stable local row id `tg_<telegram_id>` for new
accounts. Legacy rows are repaired by `telegram_id` before a new row is
considered.

Browser login is feature-gated. It is not production-active unless all server
configuration is supplied and Telegram BotFather Allowed URLs contain the
exact application origin and callback URI.

Required server configuration when activating the flow:

```text
TELEGRAM_OIDC_CLIENT_ID=<bot id from Telegram Login>
TELEGRAM_OIDC_CLIENT_SECRET=<server-only secret>
TELEGRAM_OIDC_REDIRECT_URI=https://<exact-app-origin>/api/auth/telegram/callback
BROWSER_AUTH_ORIGIN=https://<exact-app-origin>
```

`TELEGRAM_OIDC_CLIENT_SECRET` must never be exposed to Vite, the browser,
logs, documentation, or commits. Production startup rejects partial or
non-HTTPS browser-auth configuration. Production must continue to use the
existing Cloudflare Pages / Render / Neon topology.

## Verification markers

The implementation is considered ready for the following release checks only
after the corresponding evidence is collected:

- `RESPONSIVE_WEB_READY` — responsive browser matrix is green;
- `TELEGRAM_BROWSER_AUTH_READY` — OIDC/state/PKCE/session tests are green;
- `CROSS_DEVICE_IDENTITY_PROVEN` — Mini App and browser login resolve to the
  same verified Telegram user;
- `CROSS_PLATFORM_COMMERCE_CONTRACT_READY` — commerce remains disabled and
  fail-closed across both hosts;
- `RESPONSIVE_WEB_AND_TELEGRAM_IDENTITY_READY` — all required checks and
  manual release gates are complete.

## Security review

`AUTH_SECURITY_REVIEW_PASS`

Implementation review covers server-only client secret handling, exact issuer
and audience checks, RS256/JWKS signature verification, expiry/iat/nonce,
single-use browser-bound state, PKCE S256, opaque hashed sessions, Secure
HttpOnly cookies, CSRF checks, logout revocation, and Telegram-id-only account
linking. This marker does not mean that production configuration or physical
iOS validation has been completed.
