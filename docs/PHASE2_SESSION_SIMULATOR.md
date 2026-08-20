# Phase 2 session simulator

`scripts/phase2-session-simulator.mjs` is a bounded, deterministic qualitative
harness for the Phase 2 session slice. It does not drive React, mutate a
database, or claim that the simulated flow is fun. Its purpose is to make the
session contract inspectable before real-player telemetry exists.

## What it measures

For each 30-second, 3-minute and 15-minute window, the harness reports:

- manual strokes/cells versus Spark-assisted cells;
- time to first manual action and first fragment reveal;
- fragment reveal frequency and reveal intervals;
- Spark/Artifact event frequency;
- interruption count and a small interaction-cost budget (taps, modal
  interruptions, pauses, camera changes, cognitive switches);
- camera transitions;
- explicit natural stop opportunities, ownership pauses and post-choice idle
  periods.

An event timeline is returned with `--json`, so a reviewer can inspect exactly
which action produced each reveal. `source: "player"` and
`source: "assisted"` are intentionally separate; a reveal count alone must not
be treated as evidence of authorship.

## Run it

From the repository root:

```text
node scripts/phase2-session-simulator.mjs
node scripts/phase2-session-simulator.mjs --scenario 3m --variant treatment
node scripts/phase2-session-simulator.mjs --json --seed 17
```

The default command prints both control and treatment for all three windows.
The simulator is deterministic for a given scenario, variant and seed.

## Model boundaries

The default workload is a small reference fixture (`contour`, `cluster`,
`accent`, `edge`, `shape`, `texture`). Its effort fields are deliberately
explicit so they can later be replaced by observed Smart Director target
distributions:

- connected-cell effort;
- expected manual strokes;
- fragmentation/context switching;
- predicted manual time;
- camera displacement.

The default treatment first completes a player-authored target before any
assisted spectacle is eligible. Spark then requires a minimum prior target
count, an elapsed-session window, a cooldown and an effort-aware candidate;
Artifact uses a separate cooldown and candidate cadence. These are simulator
defaults, not production balance thresholds. Pass a custom `workload` or
`policy` to `simulateSession()` when comparing a telemetry-backed profile.

## Reading the output

The model is useful for finding pacing contradictions, not for choosing a
winner by a single number. In particular:

- a treatment can have more reveals while also paying more interruption cost;
- a high assisted-cell share may mean Spark is doing throughput work rather
  than creating a player-authored reveal beat;
- a `stop_point` is an available pause, not a claim that a person actually
  stopped; `ownershipPauses` are reported separately because a post-Spark
  pause and a natural stop offer can happen at the same reveal;
- browser/E2E completion and this simulator remain Level 1 evidence. Human
  enjoyment, physical Telegram WebView behaviour and retention stay in
  validation debt.

## Verification

```text
node --test test/phase2-session-simulator.test.js
```

The tests cover determinism, 30s/3m/15m start-to-reveal-to-stop invariants,
control/treatment separation, Spark/Artifact lifecycle cost, and policy/workload
injection.
