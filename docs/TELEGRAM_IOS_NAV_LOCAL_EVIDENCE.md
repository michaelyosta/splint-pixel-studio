# Telegram iOS navigation — local evidence (not physical proof)

Run date: 2026-09-03. Worktree: `codex/telegram-ios-viewport-fix`.
The tested source was the clean frozen worktree HEAD at the time of this run:
`83fb7e3` (`diag: classify iOS nav geometry paint and hit`).

## Scope

This is a disposable local preview with SQLite/local media and
`PAYMENTS_MODE=disabled`. It exercises the same React/CSS bundle in Chromium
and Playwright WebKit. Playwright WebKit is an emulation/control check; it is
not Telegram iOS and does not close the physical-device gate.

## Results

- Node 22 diagnostic unit tests: `3/3 PASS`.
- Node 22 full unit suite on the same frozen source: `463/463 PASS`.
- Vite production build: `PASS`.
- Existing lint warning budget: `100/100` (no new warning budget available).
- `git diff --check`: `PASS`.
- One custom browser pass, Chromium + WebKit, `retries=0`, one worker:
  `PASS`.
- Each browser saw exactly three visible nav buttons and successfully opened
  `Каталог`, `Создать`, and `Профиль`.
- Portrait 390×844: nav buttons had non-zero rectangles with bottom at about
  `833`, inside the 844px frame.
- Landscape 844×390: nav buttons had height `66` and bottom at about `378`,
  inside the frame.
- After synthetic `pagehide`/`pageshow` and return to portrait, all three
  buttons remained visible with bottom at about `833`.
- Diagnostic paint sample: `.app-tab-bar` was `display=flex`,
  `visibility=visible`, `opacity=1`, `filter=none`; all three nav items had
  `display=flex`, `visibility=visible`, `opacity=1`.
- Diagnostic hit sample: `button.active`,
  `button.app-tab-bar__create`, and `button` respectively.
- Deterministic diagnostic classification: `NO_GEOMETRY_PAINT_HIT_FAILURE`,
  with `frameWithinVisual=yes`, `tabBarWithinFrame=yes`,
  `paintInvisible=none`, and `hitUnavailable=none` in both browsers.
- Chromium `bfcache-lifecycle.spec.js` on a dedicated E2E SQLite/API runtime:
  `4/4 PASS`, `retries=0`, covering legacy and tiled pagehide/pageshow plus
  the mocked Telegram bridge lifecycle. The earlier attempt against the
  regular disposable preview was rejected at fixture setup because that
  runtime intentionally has no E2E seed hook; it was not product evidence.
- Synthetic standalone regression in Chromium and WebKit: `2/2 PASS`,
  `retries=0`, with the Telegram bridge request blocked and
  `navigator.standalone=true` plus `(display-mode: standalone)` emulated.
  All three nav buttons remained visible in portrait and landscape and opened
  `Каталог`, `Создать`, and `Профиль`. This is a browser/PWA contract check,
  not proof from Safari Home Screen or Telegram iOS.
- The Telegram WebApp bridge script was present in the WebKit run and reported
  numeric `viewportHeight=844` and `viewportStableHeight=844`. Its root CSS
  variables were exposed as the literal `100vh`, not numeric pixel values. The
  local WebKit frame still measured 844px, but this is a concrete parity
  question for physical iOS rather than proof that `100vh` is safe there.

The local evidence therefore does not reproduce the reported physical Telegram
iOS disappearance. It also does not establish that the current `backdrop`
value (`blur(14px)`) is causal. The earlier opaque/no-backdrop preview
experiment (`da8fd81`) remains a non-fix because it did not have a passing
physical Telegram validation.

## Current verdict

`TELEGRAM_IOS_NAV_FIXED` is **NOT CLAIMED**. No product CSS or Telegram
lifecycle change follows from this local run.

The remaining required evidence is one real iPhone in a real Telegram Mini App
opened from a dedicated staging/test bot: cold launch, reopen, Catalog/Create/
Profile, portrait → landscape → portrait after a 5-second background/resume,
plus standalone/PWA regression. Retain the four diagnostic pages and the
`paint`/`hit` lines from [the physical protocol](TELEGRAM_IOS_VIEWPORT_DIAGNOSTIC.md).
