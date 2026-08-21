# Phase 4 — Natural resume slice

Status: **bounded implementation / validation debt remains**.

## Problem

The existing resume state already stored camera and Smart Target data, but the
return surface did not explain what the player would do next. A Phase 2 pause
also returned to the catalogue, which made a saved unfinished artwork feel
like an abandoned task rather than a deliberate stopping point.

## Decision

- Keep the server authoritative for progress and Smart Guidance.
- Persist a small `nextBeat` descriptor alongside the existing Smart Target:
  kind, bounded tile/target reference, color, and estimated cell count.
- Home prefers the actual unfinished artwork pointed to by the resume pointer
  and describes it as a next visual fragment, not as XP, a streak, or a daily
  obligation.
- Phase 2's stop action is now `Сохранить точку`; it returns to Home, flushes
  the existing save queues, and leaves the next beat available to Continue.
- Record short (under 90s), medium (90s–under 10m), and long (10m+) session buckets
  only for measurement. The bucket is not a reward or pressure mechanic.

## Evidence

- Resume snapshots remain revision-checked and backwards-compatible.
- The descriptor carries no full-grid arrays and does not change pointermove,
  tile cache, or server progress contracts.
- Focused tests cover the three duration windows, bounded descriptor copy, and
  missing-target honesty.

## Validation debt

Real Telegram background/resume and player comprehension still require device
and human evidence. This slice is reversible and does not block the remaining
Phase 4 content/gallery work.
