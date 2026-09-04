# Physical Safari layout evidence — 2026-09-04

This is a bounded analysis of the attached physical iPhone Safari screenshot.
It is not Telegram Mini App WebView evidence and does not justify a Telegram
causal classification or a CSS change.

## Terminal result

- Goal: `TELEGRAM IOS PHYSICAL VALIDATION — ANALYZE PHYSICAL SAFARI EVIDENCE`
- Status: `PHYSICAL_SAFARI_EVIDENCE_RECORDED`
- Classification: `PHYSICAL_SAFARI_LAYOUT_EVIDENCE`
- Telegram status: `NEEDS_TELEGRAM_WEBVIEW_CAPTURE`
- Worktree: `codex/telegram-ios-viewport-fix`
- Diagnostic source SHA: `4e729b50652e79af8ab58bb40552767afbed408e`
- Latest bounded handoff commit: `671d7cc`
- Shared Quick Tunnel: `https://relationship-sound-varieties-fax.trycloudflare.com/?viewportDiagnostic=1`

## Evidence artifact

Attachment reviewed:

```text
C:\Users\misa\.codex\codex-remote-attachments\01a06231-95d1-7b61-b874-e7156fdabc54\5CF54FF0-4454-47E7-B0E6-CD70758D525E\1-Вставленное-изображение-1.jpg
```

SHA-256:

```text
283672DFE12C183F5B75077C541EBC67B56D03B014F549EDD88366420A6CED26
```

The screenshot visibly contains ordinary iPhone browser chrome, the
`trycloudflare.com` address, and the diagnostic panel on `page 1/4 · viewport`.
The lower browser toolbar is visible over the lower screen region while the
app's bottom navigation is at that same lower edge. This is sufficient to
record a physical Safari layout/occlusion observation, but it does not identify
whether the app navigation is clipped, composited behind browser chrome, or
painted invisibly.

## Measurements transcribed from the screenshot

| Field | Value |
| --- | ---: |
| `window.innerWidth` | `393.00` |
| `window.innerHeight` | `637.00` |
| `devicePixelRatio` | `3.00` |
| `visualViewport.width` | `393.00` |
| `visualViewport.height` | `637.00` |
| `visualViewport.offsetLeft` | `0.00` |
| `visualViewport.offsetTop` | `0.00` |
| `visualViewport.pageLeft` | `0.00` |
| `visualViewport.pageTop` | `0.00` |
| `visualViewport.scale` | `1.00` |

The screenshot does not expose Telegram bridge values, safe-area CSS values,
DOM rectangles, computed styles, hit targets, orientation metadata, iOS build,
Telegram build, or lifecycle state. It is only page 1/4.

## Instrumentation audit

No instrumentation change was needed. The existing query-gated diagnostic
already exposes, on pages 2–4:

- Telegram `viewportHeight`/`viewportStableHeight` and safe/content-safe insets;
- all ten `--tg-*` viewport/safe-area CSS variables;
- `html`, `#root`, `.telegram-frame`, `.app-container`, `.screen-content`, and
  `.app-tab-bar` rectangles;
- all three tab-button rectangles, computed paint/visibility properties, and
  hit-test targets;
- positioning, overlap, and deterministic geometry classification.

The panel is enabled only by `viewportDiagnostic=1`, has no auth payload or
cookie access, and is not a production-path change.

## Focused validation

- Shared Quick Tunnel diagnostic route: HTTP `200`.
- `/api/health`, `/api/live`, `/api/ready`: HTTP `200`.
- `npm run verify:telegram-ios-diagnostic`: `PASS`, static pages `4/4`,
  auto-cycle `4/4`, secret markers `none`, `retries=0`, `quarantine=0`.
- `node --test test/viewportDiagnostic.test.js`: `3/3 PASS`.
- `npm run build`: `PASS`.

These are route/build checks only. They do not promote Safari evidence to
Telegram evidence.

## Decision and next action

Keep `PHYSICAL_SAFARI_LAYOUT_EVIDENCE` as the exact classification for this
artifact. Do not issue a CSS fix and do not classify a Telegram viewport,
parent-clipping, compositor, color-rendering, or layout defect from it.

The next bounded action is a real Telegram Mini App launch from the dedicated
test bot on the same physical iPhone, retaining pages 1–4 for cold launch,
reopen, Catalog/Create/Profile, rotation, and background/resume. Until that
capture exists, Telegram remains `NEEDS_TELEGRAM_WEBVIEW_CAPTURE`.
