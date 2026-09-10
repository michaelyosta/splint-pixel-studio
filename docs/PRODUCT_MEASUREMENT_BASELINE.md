# Product measurement baseline

Status: EXPERIMENTAL  
Authority: bounded measurement scope for the current Splint product.

The current product contract is the three-tab shell: `Каталог`, `Создать`,
and `Профиль`. This baseline does not restore Home, Feed, Gallery, Store,
Achievements, XP, streaks, session goals, or progression UI. Historical
roadmap events for those retired surfaces remain compatibility data only.

## Baseline questions

1. Can a user open a catalog item and reach the painting surface?
2. Does the first authored action lead to a durable completed work?
3. Does the completion handoff lead to Profile or back to Catalog?
4. Does a created or completed work remain available after reload?

## Existing evidence signals

The current code already records the useful player-flow signals without a
schema change, including `app_open`, `open_level`, `first_pixel`,
`artwork_completed`, `reward_shown`, `choice_selected`, `share_native`,
`download_result`, and `publish`. The server keeps the event allowlist and
payload bound; no event is allowed to grant ownership or change payment state.

The following historical roadmap events are intentionally not added to the
active product baseline because their surfaces are frozen or absent:

- `goal_completed`, `goal_abandoned`, and progression/session-goal events;
- Home recommendation/unlock-journey events;
- `session_natural_exit` and `session_interrupt_exit` until their delivery
  semantics are validated on real Telegram WebView lifecycle events.

## Review rule

Use this baseline for local and CI funnel checks only. Do not infer human
retention, enjoyment, Telegram-device parity, or commercial conversion from
the local `analytics_events` table. Those claims require fresh human/device
evidence and remain validation debt.

