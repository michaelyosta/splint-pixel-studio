# Phase 4 gallery / collection-first slice

Status: **PROVISIONAL — bounded UI slice, validation debt open**

## Decision

The return surface is now organized around the player's own shelf:

`open app → see the next unfinished reveal beat → continue or stop → revisit completed results → browse a thematic collection`

Completed artwork is presented as the primary collection object. The gallery
does not expose XP, streaks, goals, currencies, payments, or a social feed.
Existing backend endpoints and progression infrastructure remain untouched.

## What changed

- `/gallery` separates a single actionable `Следующий beat` from the completed
  result shelf and lower-priority unfinished works.
- Completed works are labeled `Готовый результат` and grouped under `Моя
  коллекция`; active work remains available without competing with the result
  shelf.
- Gallery and collection pages link directly to one another and offer a quiet
  catalog exit instead of a forced engagement loop.
- Duration is bucketed (`до 3 мин`, `3–5 мин`, `5–10 мин`, `10+ мин`) so the
  catalog does not imply false precision. Complexity is labeled from existing
  difficulty/size metadata with a conservative fallback.
- Collection cards merge server completion counts with the currently loaded
  `/colorings/mine` items and sort an unfinished collection ahead of a new or
  completed one.
- Resume copy names the next reveal beat without fabricating a region title,
  countdown, or promise of an exact completion time that the current API does
  not provide.

## Why this is bounded

No schema, route, save contract, painting interaction, Smart Director,
Special Cell, XP, streak, payment, feed, or content-generation behavior was
changed. The slice derives all display state from existing payloads and can be
removed or restyled without a migration.

## Evidence

- `test/galleryProgression.test.js`: 6 focused tests pass.
- `git diff --check`: expected to remain clean after integration.
- Full visual preference, physical Telegram safe-area behavior, and whether a
  completed result creates a real return impulse remain human validation debt.

## Validation debt

- The current `/colorings/mine` payload exposes the source preview rather than
  a guaranteed rendered completed-result URL. The collection object is
  therefore structurally primary, but final result-media quality still needs
  a content/device review.
- A real user may prefer a completed result first, or may need a single active
  resume card first. The implementation chooses active-first only in the
  actionable resume module and completed-first in the shelf, keeping that fork
  reversible.
- Duration and complexity labels are conservative presentation labels, not a
  measured session-duration model.
