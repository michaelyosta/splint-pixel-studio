# Telegram iOS batch validation protocol

Status: CANONICAL
Authority: Owner-session batching policy for physical Telegram iOS evidence.

Navigation: [INDEX.md](INDEX.md) · Current state: [CURRENT_STATE.md](CURRENT_STATE.md)
Measurement instrument: [TELEGRAM_IOS_VIEWPORT_DIAGNOSTIC.md](TELEGRAM_IOS_VIEWPORT_DIAGNOSTIC.md)

## Problem this solves

Physical Telegram iOS validation currently runs as a serial gate: one
hypothesis, one owner call, one wait. The agent idles while the owner is
pinged per hypothesis (`backdrop-filter`, then stable viewport, then compact
nav). This protocol replaces serial pings with a single batched owner
session covering up to three hypotheses at once.

## Batching rules

1. Never request an owner session for a single hypothesis. Accumulate up to
   **3** falsifiable hypotheses (each with expected observable and what
   evidence would reject it) before asking for device time.
2. The owner session runs on exactly one frozen preview SHA and one iPhone
   (record model, iOS build, Telegram build, orientation, home-indicator
   state). No CSS or product changes during the session.
3. One session covers the full checklist below. Partial sessions are
   recorded as `INCOMPLETE`, never as `PASS`.
4. The project has owner access to a physical iPhone; the device is not to
   be described as unavailable. If the owner cannot run the batch this week,
   record `DEFERRED` with a date and keep working on autonomous
   prerequisites instead of polling.

## Single-session checklist

Run in order on the frozen preview, Telegram iOS cold launch first:

- [ ] `portrait-cold`: cold Mini App launch, first diagnostic auto-cycle
      (`viewportDiagnostic=1`, pages 1-4), before navigating away.
- [ ] `portrait-stable`: fresh cycle after expansion settles (values stable
      1+ second). Transcribe `window.inner`, `visualViewport`, Telegram
      `viewportHeight`/`viewportStableHeight`, safe-area insets, all ten
      `--tg-*` variables, rects for `html`, `#root`, `.telegram-frame`,
      `.app-container`, `.screen-content`, `.app-tab-bar`, computed
      positioning, overlap lines, `geometry` verdict, paint/hit lines.
- [ ] `landscape-stable`: rotate, wait for stable values, one full cycle.
- [ ] `portrait-resume`: back to portrait, background Telegram 5 seconds,
      resume without reload, stable values, one full cycle.
- [ ] Navigation pass: `Каталог` (cold-start surface) → `Создать`
      (import-first) → `Профиль` (showcase). Record per-tab: visible,
      tappable, correct content, no clipping behind the tab bar.
- [ ] Player smoke: open one artwork, one stroke paints, save/resume works.
- [ ] Media: screen recording of the full pass plus the four transcribed
      checkpoint cycles. Redacted screenshots/transcription kept outside
      Git with an agreed retention window.

## Redaction

Never record: account name, chat, user id, `initData`, cookies, tokens,
request payloads, payment data. If a bridge field is absent, retain
`unavailable`; do not infer it from another field.

## Classification

- `TELEGRAM_IOS_NAV_FIXED` requires successful cold, stable, rotation, and
  background/resume captures on that physical iPhone, plus the separate
  standalone/PWA regression. Local Chromium/WebKit, route preflight, or a
  Playwright iPhone profile can never satisfy this.
- One physical sample cannot confirm the blur hypothesis. Keep it
  `NOT CONFIRMED` unless a separately scoped visual experiment reproduces it.
- Record the result in a dated file under `docs/evidence/` and rewrite the
  Telegram/iOS section of `CURRENT_STATE.md`. The protocol itself never
  carries a result; a protocol is not a pass.

## What this protocol does NOT change

- [TELEGRAM_IOS_VIEWPORT_DIAGNOSTIC.md](TELEGRAM_IOS_VIEWPORT_DIAGNOSTIC.md)
  remains the measurement instrument. This document only batches its use.
- No CSS, lifecycle, auth, or production-configuration change follows from
  a batch pass alone.
