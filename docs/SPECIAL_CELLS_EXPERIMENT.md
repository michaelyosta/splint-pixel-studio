# Special Cells v0 — gameplay experiment

Status: ready for controlled human gameplay testing; not a claim of product
success. The experiment tests whether events inside the Canvas make ordinary
painting more engaging without turning it into a menu-driven progression
system.

## Current event set

| Event | Moment-to-moment decision | Bounded server result |
|---|---|---|
| Spark | choose one of two existing Smart Engine targets or skip | complete persisted Smart target, max 12x12 / 144 cells |
| Bomb | accept the discovered center or nudge it before applying | exact-color cells in radius, max 32 |
| Fuse | disarm the visible short chain now | exact neighboring cells, max 32, no progress loss |
| Choice | choose Smart zone or local burst | one of two existing server-derived intents, max 32 |
| Artifact | notice and collect a rare fragment | local bounded fragment goal (`min(3, available markers)`); no external collection menu |
| Hazard | notice the marker and disarm or deliberately skip | exact-color reward <=16; miss is temporary and deletes 0 progress |

There is no inventory, Jammer, timer penalty, combo multiplier, new currency,
or separate special-cell endpoint. All events use the existing progress/actions
transport, revision/CAS, idempotency, offline journal, and server-side color
validation. A special action selected offline is journaled without applying a
local effect and is server-validated once connectivity returns; analytics
delivery remains best-effort.

An unresolved offer owns the next decision: ordinary Smart Engine guidance,
canvas strokes, and queued ordinary tiled entries are held until the matching
use/skip/disarm action is resolved. This is a flow-safety barrier, not a new
screen or gameplay system. The server returns `409 SPECIAL_ACTIVE_OFFER` for
ordinary guidance or progress while the offer is open; the client cancels
stale auto-advance and the tiled journal hoists only the matching resolution
action ahead of ordinary queued entries.

## Cadence hypothesis

Fresh tiled maps use deterministic stratified coordinates and the following
event-candidate densities:

- small tiled: 1/600;
- medium tiled: 1/150;
- 1200-class tiled: 1/175 (bounded by the 8,192 candidate cap);
- tiny compatibility maps: one candidate, preserving the early-event rule.

The 1200-class choice was changed from 1/400 to a cap-bound 1/175 tier after the multi-kind
simulator showed a long-tail gap above the V1 cadence target at 1/400 and the
intermediate 1/200 trial. The three-seed bounded 1/175 aggregate is approximately p95
gap 4 targets and 10.9% assisted progress. This remains a product-feel
hypothesis, not a hidden success claim.

The long-run deterministic v4 kind cycle is approximately Spark 16.7%, Bomb
43.3%, Fuse 13.3%, Choice 20%, Artifact 6.7%. Spark was reduced from the old
50% type share only after its effect became a full target; candidate/event
cadence itself was not reduced. Hazard is a separate guaranteed disjoint
row rather than a pattern slot; the first event remains Spark-compatible.

## Minimal measurement set

The client sends four canonical events for both legacy and tiled transports:

- `special_cell_discovered` — server-confirmed discovery and kind;
- `powerup_received` — an offer was issued;
- `powerup_used` — a bounded effect was applied;
- `special_action_selected` — use, skip, disarm, or choice selection.

The older `special_cell_claimed`, `special_targets_presented`, and
`special_applied` events remain as compatibility telemetry for existing
dashboards; the experiment counts only the four canonical events above.

`session_continued_after_special` remains the primary treatment behavioral
measure. Control has no special event by design, so its comparator is the
existing session-level continuation/natural-exit rate over the same session
window; it must be reported separately from event-resolution rates. No
analytics event is used to grant progress or change gameplay state.

## Decision gates

**Success:** treatment shows a sustained continuation improvement over control
(target: at least +8 percentage points), at least 70% of discovered actionable
events are resolved rather than abandoned, median action resolution is under
10 seconds, and no increase appears in save conflicts, duplicate effects, or
wrong-color progress.

**Inconclusive:** fewer than 20 treatment sessions contain a discovered event,
control/treatment exposure is materially unbalanced, or event delivery is
missing from more than 10% of server-confirmed discoveries.

**Failure:** continuation is flat or worse than control, users routinely ignore
or exit after events, or the event path increases input/save errors. Do not add
another mechanic in response; remove or simplify the failing event first.

The simulator's pity metric is Spark-only, as is production guidance. Mixed
event candidates do not silently extend or reset the Spark pity counter.

For legacy offline full-grid retries, the journal stores the confirmed
`baseFilled` snapshot used to create the batch. A CAS conflict performs a
three-way per-cell merge: local-only changes are retained, a newer server cell
wins when both sides changed it, and old records without a baseline fall back
to the server snapshot rather than stale-overwriting it.

## Evidence currently available

- Gate Zero: 1200x1200 treatment, 390px viewport, INITIAL_TARGET -> Spark ->
  claim -> two Smart targets -> bounded effect -> automatic ordinary target.
- Bomb: Chromium and Mobile Pixel E2E pass.
- Long journey: Chromium resolves Spark, Bomb, Fuse, Hazard, Choice, and three
  Artifact fragments on a tiled Canvas, then reloads and recovers 3/3 state.
- Responsive special-offer E2E: 360px, 412px, and 430px reduced-motion bounds.
- Offline ordinary-progress verifier: Chromium paints offline, reloads online,
  replays the durable batch, and confirms the resident tile cache agrees with
  server progress; special actions remain online-authoritative.
- Root client suite: 299/299 passing.
- Full server suite: 329 passing / 65 environment-skipped; targeted guidance,
  simulator, queue, and multi-kind integration suites also pass.
- Build and lint pass; lint remains within the existing warning budget.
- Adversarial regressions cover active-offer guidance/queue blocking and
  three-way legacy offline conflict merge without stale overwrite.

## Server delivery rollback boundary

Special-cell delivery is forward-only and does not require a destructive
rollback migration. Migrations 023-025 are idempotent for their own
application: 023 creates the special-cell tables only if absent, 024 and 025
rewrite the kind CHECK constraint to widen the allowed set, and the SQLite
variants preserve existing rows and progress while widening the constraint.
If the feature must be disabled, disable the delivery logic/QA flags at the
application layer and leave the migration history untouched. Applied
migration files must never be edited after they ship; the migration runner
verifies checksums and treats modified applied migrations as fatal.

## Human gate still required

Automated evidence proves delivery, bounds, persistence, retry reconciliation,
and flow. It cannot
decide whether cap-bound 1/175 on a 1200-class image feels calm, whether Fuse/Hazard feel
like fair attention checks, or whether the six silhouettes are visually distinct
at 360–430px. The owner should run treatment/control sessions in Telegram
WebView before changing cadence or adding any new event type.
