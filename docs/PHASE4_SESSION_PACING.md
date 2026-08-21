# Product Phase 4 — session pacing and controlled long-form pilot

Status: **machine/agent-ready as a bounded pilot gate; human enjoyment remains validation debt**.

This note covers one narrow Phase 4 question: can an artwork give a player a
finished reveal beat in a 30-second visit, a meaningful layer in a 3-minute
session, and a segmented long-form path in 15 minutes? It does not add a
runtime timer, a quest, a streak, a currency, a Special Cell, or a new
progression system.

## Evidence harness

`node scripts/phase4-session-pacing.mjs` evaluates the existing deterministic
Phase 2 event trace. It keeps manual and assisted reveals separate, maps
fragment reveals to a bounded artwork profile, and reports:

- closed reveal segments and whether their closure was player-authored;
- time between segment closures (a long unresolved tail is a failure);
- natural stop points and the next segment/target promised on resume;
- a controlled 15-minute pilot gate.

The artwork profile is an internal fixture only. Its seven beats are:

`Arrival → Build → Compose → Signature → Depth → Resolve → Detail`.

The first beat deliberately contains one target so the shortest visit can end
with a complete visual beat. The later ranges are evenly bounded against the
current reference workload; they are not production thresholds for every
artwork. Real content metadata must replace them before a public rollout.

## Machine results

Reference command:

```text
node scripts/phase4-session-pacing.mjs
```

| Window | Variant | First beat | Closed beats | Player-authored closures | Max closure gap | Resume promises | Long-form gate |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| 30s | control | 17.5s | 1/7 | 1 | — | 1/1 | not applicable |
| 30s | treatment | 17.5s | 1/7 | 1 | — | 1/1 | not applicable |
| 3m | control | 17.5s | 3/7 | 3 | 101.2s | 3/3 | not applicable |
| 3m | treatment | 17.5s | 3/7 | 3 | 85.7s | 2/2 | not applicable |
| 15m | control | 17.5s | 6/7 | 6 | 190.4s | 11/11 non-final | eligible |
| 15m | treatment | 17.5s | 7/7 | 6 | 192.2s | 10/10 non-final | eligible |

The pilot gate is intentionally explicit:

- at least four segments closed;
- at least four player-authored segment closures;
- no more than one assisted closure;
- no closure gap over 210 seconds (one three-minute session plus a bounded
  settle/resume margin);
- first beat within 30 seconds;
- every non-final stop point resolves to a concrete next target and segment.

The final treatment `stop_point` may point at the simulator's out-of-profile
probe after the last target. That is treated as a final closure, not as a
missing resume promise. A product implementation must use real artwork bounds
instead of this probe.

## What this proves and does not prove

It proves that the current reference workload can be represented as a bounded
sequence of authored closure beats without requiring a daily obligation or a
new meta reward. It also exposes when a candidate artwork leaves a long
unresolved tail or when a stop point cannot name a concrete next beat.

It does **not** prove that the segments look emotionally distinct, that a
player notices the transformation, or that a player wants to return. Those
remain human/device validation debt. The evaluator is a content/session QA
gate, not a retention metric.

## Product implications

1. **30 seconds:** the first beat is the minimum acceptable return promise.
   The user can stop after a completed reveal rather than leaving mid-task.
2. **3 minutes:** three closed beats are enough to demonstrate movement through
   the picture, but not enough to justify a long-form claim.
3. **15 minutes:** long-form is acceptable only for artwork metadata that passes
   the segmentation gate. A large pixel grid with one generic progress bar is
   not a controlled long-form pilot.
4. **Resume:** each non-final stop needs a named next segment/target. A generic
   `Continue` without a visual next beat fails the harness.
5. **Specials:** this harness does not add or rebalance them. Treatment still
   uses the existing provisional `spark_choice` baseline; the gate counts an
   assisted closure as a cost, not as extra authored progress.

## Verification

```text
node --test test/phase4-session-pacing.test.js
```

The focused suite covers determinism, 30-second closure, 3-minute resume
promises, positive and negative long-form gates, and the absence of meta/event
noise in the pacing layer.

