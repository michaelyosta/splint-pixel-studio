# Special Cells loop log

This log records the autonomous engineering loop. A green verifier proves a
contract; it does not prove that the event is fun.

## 1. Gate Zero foundation — PASS

The 1200x1200 treatment path was verified end to end:

`delivery -> initial target -> Spark discovery -> claim/use -> bounded effect
-> Smart Engine resume -> reload/offline journal recovery`.

The active-offer barrier and terminal 409 recovery prevent ordinary guidance
from bypassing an unresolved event. Spark remains server-authoritative; it now
resolves the complete persisted Smart target, bounded to 12x12 / 144 cells.

## 2. Small-map compatibility — PASS

The 28x28 legacy treatment fixture reconstructs one deterministic Spark,
including exact-index discovery, replay idempotency, claim/use/skip, control
isolation, and last-cell completion. Pity is not used as the small-map
guarantee.

## 3. Multi-kind vertical slices — PASS

The existing progress/actions endpoint now carries five distinct interactive
roles without a new endpoint or inventory:

- Spark: Smart target decision;
- Bomb: server-derived spatial effect with persisted center;
- Fuse: fixed three-step ring chain, total cap 32;
- Choice: explicit Smart-zone/local-burst decision;
- Artifact: server-persisted 1/3 fragment progress.

Hazard is a sixth role: deterministic, disjoint, attention-based, with a
small non-destructive miss penalty and a reward cap of 16. It is reachable in
both tiled and larger legacy maps; the 28x28 legacy fixture deliberately stays
Spark-only.

## 4. Adversarial server pass — PASS

Focused and full server tests cover:

- exact-color server derivation;
- revision/CAS and one active offer;
- idempotent replay and changed-body replay rejection;
- concurrent devices, stale revisions, and duplicate use;
- reload recovery for Bomb/Fuse/Artifact/Hazard;
- final-cell claim and final Fuse/Hazard resolution;
- control cohort and forged-action rejection.

Current result is recorded in the QA-readiness checkpoint below: the newest
confirmed runs are 345 root client tests, 352 server tests with 65
environment-skipped, and a 93/100 lint budget. Older 34/340 aggregates are
superseded.

## 5. Cadence correction — PASS

The first mixed simulator pass showed that the old large-map 1/400 tier left a
long target-gap tail. A deterministic multi-seed sweep compared 1/150, 1/200,
1/250, 1/300, and 1/400. The selected production tier is now 1/150 for
500-class and cap-bound 1/175 for 1200-class maps; 160-class compatibility
remains at 1/600.

Three-seed aggregate at the selected production tiers:

| size | first event | p95 target gap | assisted ratio | event mix |
|---:|---:|---:|---:|---|
| 160 | 1 | 24 | 5.4% | all six roles, Hazard separate |
| 500 | 1 | 4 | 13.5% | Spark/Bomb/Fuse/Choice/Artifact + Hazard |
| 1200 | 1 | 4 | 10.9% | Spark/Bomb/Fuse/Choice/Artifact + Hazard |

The selected medium/large rows meet the approximate p95 <=4 target in this
three-seed simulator run; assisted progress remains below 15%. Their
event/target averages are 0.623 and 0.567, so the route sees a meaningful
event roughly every 1.6–1.8 targets in the approximation. Candidate count and
event presentation remain separate: the director/active-offer barrier still
determines what the player must resolve.

## 6. Visual/performance pass — PASS with external human gate remaining

Special lookup remains post-stroke and absent from the Stroke Engine V2
pointermove path. Existing tile cache/LOD tests remain green. New responsive
E2E asserts special-offer containment at 360px and 412px, and at 430px with
`prefers-reduced-motion: reduce`. The 1200 journey stores offer screenshots for
Spark, Bomb, Fuse, Hazard, and Choice plus Artifact completion.

The Hazard resolution is selected while offline, remains an unresolved offer
without a local effect, then replays and commits after reconnect; the ordinary
offline journal journey remains covered separately.

The build passes. On the newest confirmed run the lint-warning budget was
93/100; the exact number moves with the dirty tree and should be re-measured
with each run. Telegram WebView emits only expected unsupported haptic/back-button
warnings in the local browser harness. The 28x28 legacy fixture
remains Spark-only; larger legacy maps use mixed placement plus Hazard and
render discovery/offer UI through the legacy session. Client claim detection
also applies to reveal-mode strokes because it only checks committed changes
against the marker target color. Special marker screen radius is clamped to
4-10 px with a 4 px minimum in `specialMarker.js`, verified by
`test/specialMarker.test.js`.

## Current state

### Full-target Spark and manual-QA correction — PASS

The real 1024 and 1200 templates were not on the same experiment path: the
1024 owner/template hash assigned treatment, while the 1200 hash assigned
control. Candidate placement and tiled metadata were present; the QA session
silently exercised the intended control behavior. The allowlisted development
identity now uses the existing dev/test-only treatment override, with server
diagnostics enabled. `npm run qa:specials -- --template <id> --expect treatment`
is a fail-closed live preflight; the real 1200 template reports treatment,
override on, generation v4, and 7,727 persisted candidates.

Spark consumes the exact target option persisted with the claim-time offer and
fills every remaining correct-color cell in that single-tile 12x12 window. The
ordinary client batch cap stays 64; the internal Spark ceiling is 144;
Bomb/Fuse/Choice stay 32 and Hazard 16. A forged camera cannot retarget Spark.

The first simulator run with the old 50% Spark mix failed the assisted-progress
guardrail (25.6% on 500, 22.4% on 1200). Generation v4 preserves candidate
density and the guaranteed early Spark but reduces long-run Spark share to
about 16.7%. The resulting assisted ratios are 13.5% and 10.9%, with p95 event
gap still four targets. Untouched v3 templates rebuild once; templates with any
special progress retain their existing rows and kinds.

Local implementation and automated adversarial gates are complete for
Gameplay v1. The next action is human treatment/control gameplay in Telegram
WebView. Do not add another Special Cell type, inventory, combo, or currency
before that product observation is recorded.

## 7. QA-readiness checkpoint вЂ” code/automation gates green, physical Telegram pending

### Gate Zero

The 1200x1200 path is green end to end in the automated/root environment:
delivery, initial target, special discovery, claim/use, bounded effect, Smart
Engine resume, reload/offline journal recovery, and final-cell completion.
This is not physical Telegram evidence.

### Actual 1200 manual root causes

The live owner templates were on different deterministic paths: 1024 was
treatment, while 1200 was control. The 1200 manual session therefore had no
Special UI by design. A fail-closed `qa:specials` preflight now requires the
allowlisted dev/test treatment override and verifies non-zero persisted
candidates before manual feature QA begins.

After treatment was forced, a second concrete visual defect appeared: the
early Spark target started at row zero and its glyph was hidden behind the
in-canvas guide HUD. The Smart camera planner now reserves 58px above and
below the working channel; browser evidence shows the same target visible
after framing. The earlier zero-row shared-generation fix remains valid and
covered, but was not the cause of this real owner/template mismatch.

### QA override and diagnostics gates

The manual QA override is now an explicit per-user dev/test gate:

- `ALLOW_DEV_AUTH=true`;
- `NODE_ENV` exactly `development` or `test`;
- `SPECIAL_CELLS_QA_OVERRIDE=true`;
- `SPECIAL_CELLS_QA_USER_ID` matches the current authenticated dev user;
- `SPECIAL_CELLS_COHORT` is a supported treatment/control alias.

Server diagnostics are opt-in with `SPECIAL_CELLS_DIAGNOSTICS=true` plus the
same environment gate and are omitted from ordinary production responses,
replays, and actions. The production startup validator rejects both QA flags.
Onboarding coordinates through the normal `specials_experiment_group` field
only, never through diagnostics.

### Balance and effects

Candidate density, pity, per-tile metadata cap, and event family did not change
for the delivery fix. Spark subsequently changed by explicit product decision:
it now consumes the complete persisted Smart target (max 12x12 / 144), while
Bomb/Fuse/Choice remain capped at 32 and Hazard at 16. All effects remain
server-derived and server-authoritative.

### Verification counts

- Server review suite: 352 pass, 65 environment-skipped, 0 fail.
- Client root suite: 345/345 pass.
- Lint: 93/100 on the newest confirmed run; production build passes.
- Benchmark numbers from the code-only performance audit (`node
  scripts/benchmark-stroke.mjs --quick`): tiled 100-cell event p50 0.7Вµs,
  total 6.48ms; tiled 250-cell event p50 1.6Вµs, total 15.41ms; legacy
  proportional 100-cell event p50 0.8Вµs, total 0.87ms; cross-tile 80 events
  total 13.57ms. These cover the existing 100/250-cell and cross-tile
  contracts.

### Physical device status

Physical Telegram Android and iOS treatment/control runs remain pending. The
Luna/browser evidence gates are not claimed until their results land; this
checkpoint records code, root-server, unit, build, and benchmark evidence
only.
