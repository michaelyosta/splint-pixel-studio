# Telegram iOS viewport diagnostic protocol (preview only)

This protocol is for one bounded physical measurement pass. It does not change
CSS, Telegram lifecycle behavior, authentication, production configuration, or
the visual blur hypothesis. Use a preview/staging origin only.

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
3. Rotate the same device to landscape, wait for the displayed values to remain
   unchanged for at least 1 second, and capture one complete cycle as
   `landscape-stable`.
4. Return to portrait, background Telegram for 5 seconds, resume the same Mini
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

## Classification rules

- Compare Telegram JS viewport values with the corresponding CSS variables;
  record parity/delta per checkpoint. A missing bridge value is a validation
  blocker, not a zero.
- `#root` and `.telegram-frame` should remain inside the visual viewport. A tab
  bar bottom beyond the frame bottom is a clipping signal.
- `.screen-content` × `.app-tab-bar` overlap is expected from the absolute tab
  bar; record its rectangle and area before deciding whether content is hidden.
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
- One physical sample cannot confirm the blur hypothesis. Keep it
  `NOT CONFIRMED` unless a separately scoped visual experiment reproduces it.

## Next bounded experiment

Run this protocol on exactly one iPhone and one frozen preview SHA, with no CSS
or product changes. Compare only `portrait-stable` with `portrait-resume`; the
single variable is the Telegram background/resume lifecycle. If frame/tab
clipping appears only after resume, classify it as a lifecycle/viewport
measurement issue and collect one fresh repeated pass. If geometry remains
inside the frame and only rendering looks blurred, leave the blur hypothesis
unconfirmed and open a separate visual investigation. No production or CSS
fix follows from this pass alone.
