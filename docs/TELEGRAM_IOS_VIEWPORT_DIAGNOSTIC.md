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
   controls or scroll handling.

## Exact capture sequence

Capture a screenshot of the panel and transcribe only its numeric/position
fields at each checkpoint. Use names `portrait-cold`, `portrait-stable`,
`landscape-stable`, `portrait-resume`.

1. `portrait-cold`: screenshot after the first panel paint, before manually
   navigating away from the Mini App. Keep the initial `viewportChanged` update
   if it arrives during this step.
2. `portrait-stable`: after Telegram expansion settles, take the screenshot once
   the displayed values remain unchanged for at least 1 second.
3. Rotate the same device to landscape, wait for the displayed values to remain
   unchanged for at least 1 second, and capture `landscape-stable`.
4. Return to portrait, background Telegram for 5 seconds, resume the same Mini
   App, wait for stable displayed values, and capture `portrait-resume`.

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
- the three reported overlap lines.

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
