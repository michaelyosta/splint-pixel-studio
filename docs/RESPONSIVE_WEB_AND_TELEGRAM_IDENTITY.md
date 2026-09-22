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

## Browser → Mini App handoff

Standalone browsers are a responsive product shell, not a separate production
authentication channel. When no valid session exists they show
`Открыть в Telegram`, linking to the existing production bot
`@splint_pixel_studio_bot`. The user opens the bot's configured `Open`
menu button and authenticates inside the Mini App through signed `initData`.

The browser handoff must not call `/auth/telegram/start`, advertise browser
OIDC, mint anonymous users, or create a second identity. Existing OIDC/PKCE
server code is dormant and feature-gated; reactivation requires a separate
production task with configuration and live cross-device verification.

A Telegram host is never shown this page. When the Telegram bridge resolves its
init params after the first render, the host keeps the application shell, its
header, and its three-tab navigation, and the data surfaces show their own
loading/error states until signed `initData` is available. Platform metadata
never authorizes a request; the server stays authoritative.

## Verification markers

The implementation is considered ready for the following release checks only
after the corresponding evidence is collected:

- `RESPONSIVE_WEB_READY` — responsive browser matrix is green;
- `TELEGRAM_MINI_APP_HANDOFF_READY` — standalone browser opens the existing
  production bot and does not invoke the dormant browser OIDC endpoint;
- `CROSS_DEVICE_IDENTITY_PROVEN` remains deferred until any future standalone
  browser login is deliberately reactivated and verified;
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
