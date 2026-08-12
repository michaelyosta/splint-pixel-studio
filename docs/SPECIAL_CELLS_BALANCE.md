# Special Cells v1 — balance record

This is an engineering balance hypothesis, not proof of product success. The
simulator models the existing Smart Engine target route and server-derived
bounded effects; it does not model manual travel time, hesitation, or whether
the player enjoys an event.

## Production configuration

Fresh templates use deterministic stratified candidates and the existing
`progress/actions` contract. The current event family is:

- Spark — choose an existing Smart target;
- Bomb — choose a bounded spatial center;
- Fuse — resolve a bounded three-step chain;
- Choice — choose one of two existing server-derived intents;
- Artifact — collect a local 1/3 fragment goal;
- Hazard — one disjoint attention event per eligible artwork, with no progress
  deletion and a reward cap of 16 cells.

Placement density is selected by map size:

| map | density | expected candidates before tile cap |
|---|---:|---:|
| <= 8,192 cells | one candidate | 1 |
| small tiled / legacy > 8,192 | 1/600 | `ceil(total / 600)` |
| 500-class / medium | 1/150 | `ceil(total / 150)` |
| 1200-class | 1/175 (cap-bound) | `min(8,192, ceil(total / 175))` |

The raw generator count is not the same as persisted visible metadata: the
per-tile limit of eight removes candidates from dense maps. At the 1/175
1200 tier the generator is bounded by `SPECIAL_EVENT_MAX_CELLS` at 8,192 candidates;
the deterministic `template-mixed-1200` fixture retains 7,731 shared rows
after the per-tile cap. The simulator reports raw and capped quantities so
this cap is not mistaken for a missing event.

`SPECIAL_EVENT_MAX_CELLS` remains 8,192 and metadata is capped at eight records
per tile. Spark pity remains Spark-only at 6,000 cells. Spark completes one
entire server-selected Smart target, bounded to the planner's single-tile
12x12 actionable window (maximum 144 cells); Bomb, Fuse, and Choice retain the
shared 32-cell cap, and Hazard retains its 16-cell cap. Hazard is deliberately outside the
shared kind cycle so it does not flood large maps or alter Spark's mix.
Hazard is one guaranteed row, not a repeated cadence source. Its first
discovery is naturally late on 500/1200 maps; that is intentional for this v1
attention beat and is not counted as normal event cadence. It never contributes
assisted cells.

Artifact progress is derived from the number of deterministic Artifact markers
available on the template, capped at three. This keeps a 160-class legacy map
from showing an impossible 1/3 goal when its bounded placement contains only
two markers; tiled and legacy players render the same persisted progress after
reload.

## Cadence sweep

Command used for the canonical comparison:

```text
node server/scripts/diagnose-special-gameplay.mjs \
  --balance --sizes 160,500,1200 --seeds a,b,c \
  --densities 150,200,250,300,400 --max-plans 50000
```

The selected production tiers are 1/600 for 160-class compatibility maps,
1/150 for medium maps, and 1/175 for the cap-bound 1200 tier. The following
aggregate rows use the selected tier for each size and are averages over three
seeds.

| size | candidates | events | events/target | first event | gap p50/p90/p95/worst | assisted ratio |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 160 | 43 | 39.7 | 0.110 | 1 | 5 / 22 / 24 / 63 | 5.4% |
| 500 | 1,667 | 1,417.7 | 0.623 | 1 | 0 / 2 / 4 / 18 | 13.5% |
| 1200 | 8,192 | 6,912.7 | 0.567 | 1 | 0 / 3 / 4 / 45 | 10.9% |

The 1/150 medium and cap-bound 1/175 large tiers are intentionally denser than
the original 1/400 large-map hypothesis and the intermediate 1/200 trial. The
old 50% Spark mix produced 25.6% assisted progress on 500 and 22.4% on 1200
after Spark changed from 32 cells to the complete selected target. Generation
v4 changes type labels, not candidate density: Spark is about 16.7% of long-run
events. The new three-seed sweep keeps both 500 and 1200 p95 target gaps at four
while assisted progress returns below the 10–15% guardrail. Because
the 1200 generator is capped at 8,192, densities 150–175 produce the same
bounded candidate count there; 1/175 records that effective tier explicitly.
The small 160-class row remains a calm compatibility tier, not a hard claim
that every short map must hit the large-map p95 target.

The long-run v4 cycle is approximately Spark 16.7%, Bomb 43.3%, Fuse 13.3%,
Choice 20%, Artifact 6.7%. The first/early candidate remains Spark. Hazard is reported separately and is one event per
eligible artwork, so its share is near zero on large maps but it is still
guaranteed to be reachable. It has zero assisted cells.

## Safety gates

- first event: no later than the first two simulated Smart Engine targets;
- medium/large p95 gap: approximately four targets or less;
- assisted progress: <=15% on long simulated sessions;
- no unresolved-offer bypass: guidance and ordinary painting are blocked by
  `SPECIAL_ACTIVE_OFFER` until the matching action commits;
- all effects are derived from stored template/progress state, never from a
  client-provided changed-cell list;
- Spark use resolves the persisted claim-time target option; a later or forged
  camera center cannot move the effect;
- replay, stale revision, concurrent resolution, reload, and last-cell
  completion preserve one-way special state;
- an offline special resolution is journaled without a client-side effect and
  is validated/applied after reconnect;
- control receives no special metadata, offer, or UI;
- normal pointermove remains free of special-cell lookup; discovery is checked
  after a committed stroke. Client claim detection checks that a committed
  change equals the marker target color and is not restricted to classic mode;
  reveal-mode strokes can therefore also trigger a claim in the current
  implementation.

## Evidence

- root client suite: 345 pass, 0 fail (newest confirmed run);
- server review suite: 352 pass, 65 environment-skipped, 0 fail; the earlier
  "34 focused special/config" and "329 server / 65 skipped" aggregates are
  superseded;
- lint: 93/100 warning budget on the newest confirmed run;
- special marker screen radius is clamped to 4-10 px with a 4 px minimum in
  `specialMarker.js`, verified by `test/specialMarker.test.js`;
- deterministic `seed-cohort-template` E2E fixture is used by seven E2E specs;
- 1200 Chromium multi-event journey: Spark → Bomb → Fuse → Hazard → Choice →
  three Artifact fragments → reload/offline/reconnect → persistent 3/3 state;
- responsive special-offer checks: 360px and 412px, plus 430px with reduced
  motion; bounds and button containment are asserted;
- production build passes; lint stays within the existing 100-warning budget.

The remaining product gate is human feel in Telegram WebView. Numeric cadence
does not by itself prove that Special Cells make painting more enjoyable.

## QA-readiness checkpoint

This checkpoint records automated evidence only, including focused Chromium
and mobile-emulation E2E runs. Physical Telegram Android/iOS
treatment/control runs remain pending; browser automation is not presented as
proof of physical WebView behavior.

The real 1024 and 1200 owner templates received different deterministic
assignments: 1024 was treatment and 1200 was control. The missing event in
the manual 1200 session was therefore correct control behavior, not a density
failure. A separate visual defect then hid a treatment target at row zero
under the in-canvas guide HUD; Smart camera framing now keeps edge targets
between 58px top/bottom safe insets. The earlier zero-row materialization gap
was also fixed and remains covered, but it was not the root cause of this
specific owner observation.

QA override activation requires the exact dev/test environment plus an
explicit allowlisted `SPECIAL_CELLS_QA_USER_ID`; server diagnostics are
opt-in with `SPECIAL_CELLS_DIAGNOSTICS=true` and omitted from ordinary
production responses/replays/actions. No balance constant or derived effect
changed for this checkpoint.

Current verification: client 345/345; server review 352 pass / 65
environment-skipped / 0 fail; lint 93/100; production build passes;
benchmark-stroke quick run stays within the recorded 100/250-cell and
cross-tile contracts (tiled 100-cell total 6.48ms, 250-cell total 15.41ms,
cross-tile 13.57ms). Earlier 340/34 aggregates are superseded by these newer
confirmed runs.
