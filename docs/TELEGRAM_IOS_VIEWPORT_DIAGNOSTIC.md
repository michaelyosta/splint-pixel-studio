# Telegram iOS viewport diagnostic protocol (preview only)

Status: CANONICAL
Authority: Bounded physical Telegram iOS diagnostic protocol.

Navigation: [INDEX.md](INDEX.md) · Current state: [CURRENT_STATE.md](CURRENT_STATE.md)

This protocol is for one bounded physical measurement pass. It records viewport,
layout, and computed-paint evidence without changing Telegram lifecycle
behavior, authentication, or production configuration. Use a preview/staging
origin only.

## Preconditions

1. Record the tested commit SHA, iPhone model, iOS build, Telegram app build,
   orientation, and whether the device has a home indicator. Do not record an
   account name, chat, user id, `initData`, cookies, tokens, or request payloads.
2. Open the preview with the opt-in query parameter:
   `https://<preview-origin>/?viewportDiagnostic=1`
3. Start from a cold Mini App launch in Telegram. Keep the diagnostic panel
   visible. The panel is `pointer-events: none`; it must not alter the app's
   controls or scroll handling. By default it cycles through four pages in a
   fixed order (`viewport`, `telegram`, `layout`, `overlap`) every 1800 ms.
   Each page is short enough to fit in one screenshot, so no panel scrolling is
   required or possible.

For a static page before starting a run, append one of these values:
`&viewportDiagnosticPage=1`, `2`, `3`, `4` (or the names above). The static
selection is useful for a single field group, but changing it reloads the Mini
App; use the default auto-cycle for the lifecycle sequence below.

## Route preflight

Before handing a preview URL to the device owner, verify the opt-in route from
the same frozen preview origin. This check is browser-only and never claims
Telegram or iOS evidence:

```powershell
$env:TELEGRAM_IOS_DIAGNOSTIC_URL = 'https://<preview-origin>/?viewportDiagnostic=1'
npm run verify:telegram-ios-diagnostic
```

The verifier accepts only the preview root with `viewportDiagnostic=1` and an
optional `viewportDiagnosticPage` key. It checks HTTP 200, all four static page
headers, the four-page auto-cycle, and the absence of secret markers in the
panel. It emits only a safe summary (`PASS`/`FAIL`, protocol, page counts,
`retries=0`, and `quarantine=0`); it never prints the URL, page text, network
payloads, Telegram bridge data, or browser storage. Use a loopback HTTP URL only
for a local preview; staging/device validation must use HTTPS.

## Exact capture sequence

Capture one complete auto-cycle (pages 1 through 4, about 7.2 seconds) and
transcribe only its numeric/position fields at each checkpoint. The page header
contains `page N/4`, which makes omissions detectable. Use names
`portrait-cold`, `portrait-stable`, `landscape-stable`, `portrait-resume`.

1. `portrait-cold`: capture the first complete cycle after the first panel
   paint, before manually navigating away from the Mini App. Keep any initial
   `viewportChanged` updates as part of this cold snapshot.
2. `portrait-stable`: after Telegram expansion settles, start a fresh cycle
   once the displayed values remain unchanged for at least 1 second.
3. With the viewport held stable in portrait, select `Каталог → Создать →
   Профиль → Каталог`. After returning to Catalog, wait 10 seconds for content
   loading to settle. Record whether the nav foreground remains painted and
   tappable at every step; do not resize or background the app during this
   sequence.
4. Rotate the same device to landscape, wait for the displayed values to remain
   unchanged for at least 1 second, and capture one complete cycle as
   `landscape-stable`.
5. Return to portrait, background Telegram for 5 seconds, resume the same Mini
   App without reloading or changing the query, wait for stable displayed
   values, and capture one complete cycle as `portrait-resume`.

For every checkpoint retain these lines from the panel:

- `window.inner` (including `innerHeight` and `devicePixelRatio`);
- all `visualViewport` values (`width`, `height`, offsets, page offsets,
  `scale`);
- Telegram `viewportHeight`, `viewportStableHeight`, `safeAreaInsets`, and
  `contentSafeAreaInsets` when the bridge exposes them;
- all ten `--tg-*` viewport/safe/content-safe CSS variables;
- rects for `html`, `#root`, `.telegram-frame`, `.app-container`,
  `.screen-content`, and `.app-tab-bar`;
- computed positioning for `#root`, `.telegram-frame`, and `.app-tab-bar`;
- the three reported overlap lines;
- the `geometry` classification line (`verdict`, frame/tab-bar containment,
  paint-invisible indexes, and hit-unavailable indexes);
- the `paint .app-tab-bar`, `paint nav[1..3]`, and `hit nav[1..3]` lines on
  the overlap page. These are computed paint values and hit-test target names,
  not user content.

If a bridge field is absent, retain `unavailable`; do not infer it from another
field. Do not paste the full page URL if it contains anything beyond the
diagnostic query parameter.

If the route preflight fails, stop before opening Telegram. A successful
preflight establishes only that the diagnostic panel is reachable on the
reviewed preview; it does not establish a Telegram WebView, iOS, safe-area,
lifecycle, or navigation fix.

## Physical gate prerequisites

The final pass requires every prerequisite below. This protocol does not own a
current pass result; record that result in dated evidence and
`CURRENT_STATE.md`. A missing prerequisite is not a test failure and must not
be worked around with an emulator:

| Prerequisite | Required evidence | Current handoff state |
|---|---|---|
| Physical iPhone running Telegram iOS | Model, iOS build, Telegram build, and home-indicator state | `REQUIRED` — owner validation |
| Dedicated staging/test bot | Bot opens the reviewed HTTPS preview; production bot/origin is out of scope | `REQUIRED` |
| Disposable staging backend/account | Authenticated launch and test data isolated from production; no payment activation | `REQUIRED` |
| Capture owner and retention location | Redacted screenshots/transcription kept outside Git with an agreed retention window | `REQUIRED` |

Only after the first three rows are available may the owner run the exact
capture sequence below. `TELEGRAM_IOS_NAV_FIXED` requires successful cold,
stable, rotation, and background/resume captures on that physical iPhone, plus
the separate standalone/PWA regression. Local Chromium/WebKit, route preflight,
or a Playwright iPhone profile can never satisfy those rows.

## Classification rules

- Compare Telegram JS viewport values with the corresponding CSS variables;
  record parity/delta per checkpoint. A missing bridge value is a validation
  blocker, not a zero. A reported stable height of `0` or `1` is an invalid
  measurement to investigate, not a usable shell size.
- `#root` and `.telegram-frame` should remain inside the visual viewport. A tab
  bar bottom beyond the frame bottom is a clipping signal.
- `.app-tab-bar` is in normal layout flow; overlap with `.screen-content` is
  unexpected and should be recorded as a geometry finding.
- If a nav item has a non-zero rectangle and a `hit nav[...]` target but its
  paint line reports `visibility=hidden`, `opacity=0`, an unexpected
  `display`, or a non-`none` transform/filter, classify it as a paint/style
  finding rather than a viewport clipping finding. A `none`/`unavailable`
  hit target with a valid rectangle is a separate hit-testing finding.
- Treat `geometry.verdict` as a deterministic triage aid, not a fix claim:
  `CLIPPING_CANDIDATE` means a positive frame/tab-bar rectangle is outside its
  measured container; `PAINT_CANDIDATE` means one of the three nav items is
  computed invisible; `HIT_TEST_CANDIDATE` means a visible-geometry item has
  no actionable hit target; `NO_GEOMETRY_PAINT_HIT_FAILURE` means all three
  checks are positive for the captured sample; and `INSUFFICIENT_GEOMETRY`
  means the sample cannot support a classification.
- A changed `visualViewport` offset/height with stable frame geometry indicates
  a viewport-state transition to investigate. It does not establish a CSS root
  cause.
- Computed paint and hit-test checks cannot prove that pixels were actually
  rasterized. If the bar looks blank but its buttons remain tappable, record
  that mismatch as physical paint evidence even if the computed-style verdict
  is otherwise clear.

## Next bounded experiment

Run this protocol on exactly one iPhone and one frozen preview SHA. Compare
`portrait-cold`, `portrait-stable`, the route sequence, and `portrait-resume`.
If Telegram reports an invalid stable height, compare it with the corresponding
CSS variable and shell rect; if geometry is valid but the bar still looks blank
while tappable, classify that as a paint/compositing mismatch for separate
investigation. This pass alone does not authorize or prove a production fix.
