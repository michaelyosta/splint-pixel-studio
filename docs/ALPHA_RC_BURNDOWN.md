# Alpha RC failure burn-down

Status at triage baseline: `87 PASS / 47 FAIL / 10 SKIP` across 144 Chromium
tests at `1bd14d76a9439c8903bf1dcd1e337c983dda5e8e`.

The release brief's older `102/31/10` result refers to a different suite
cardinality. The complete observed register is in
[`ALPHA_RC_FAILURE_TRIAGE.md`](ALPHA_RC_FAILURE_TRIAGE.md); this file is the
compact tracking view. No screenshot artifact is a closure verifier.

## Burn-down rules

- `OPEN` means a current-HEAD verifier is still required.
- `CONTRACT` means the verifier must be updated/archived because it asserts an
  intentionally changed product contract; no production fix is implied.
- `ISOLATED-PASS` means the failure passed alone but still needs a deterministic
  full-suite pass.
- `RELEASE-BLOCKER` is reserved for a reproduced user/data journey failure.
- A test is not closed by adding a skip unless its environment capability is
  genuinely absent and the reason is explicit.

## Register

| ID | Classification | Baseline status | Next verifier / action |
|---|---|---|---|
| RC-F001 | FLAKE / STABILIZATION | ISOLATED-PASS | Current `accessibility-1200` isolated run |
| RC-F002 | FLAKE / STABILIZATION | ISOLATED-PASS | Current accessibility group |
| RC-F003 | FLAKE / STABILIZATION | ISOLATED-PASS | Current creator-preview 390 run |
| RC-F004 | FLAKE / STABILIZATION | ISOLATED-PASS | Current creator-preview 430 run |
| RC-F005 | REAL REGRESSION | RELEASE-BLOCKER | Fix Creator→Gallery; `creator.spec.js --grep "Completion flow"` |
| RC-F006 | REAL REGRESSION | RELEASE-BLOCKER | Fix Creator→Gallery; delete-flow verifier |
| RC-F007 | REAL REGRESSION | RELEASE-BLOCKER | Fix persisted overview camera; migration verifier |
| RC-F008 | FLAKE / STABILIZATION | ISOLATED-PASS | Current guided-player full scenario |
| RC-F009 | FLAKE / STABILIZATION | ISOLATED-PASS | Current Phase 2 positive-event group |
| RC-F010 | FLAKE / STABILIZATION | ISOLATED-PASS | Current Bomb prototype verifier |
| RC-F011 | FLAKE / STABILIZATION | ISOLATED-PASS | Current manual Spark verifier |
| RC-F012 | FLAKE / STABILIZATION | OPEN | Current Bomb/artifact reload test |
| RC-F013 | FLAKE / STABILIZATION | OPEN | Current Artifact progress reload test |
| RC-F014 | INTENTIONALLY REMOVED BEHAVIOUR | CONTRACT | Archive old Bomb presentation assertion |
| RC-F015 | STALE TEST | CONTRACT | Assert actionable target, not forced initial Spark |
| RC-F016 | INTENTIONALLY REMOVED BEHAVIOUR | CONTRACT | Remove Choice from gameplay fixture |
| RC-F017 | INTENTIONALLY REMOVED BEHAVIOUR | CONTRACT | Remove Choice from evidence fixture |
| RC-F018 | STALE TEST | CONTRACT | Rebuild long journey around active kinds |
| RC-F019 | STALE TEST | CONTRACT | Verify `tiledPayload` import fix on current HEAD |
| RC-F020 | STALE TEST | CONTRACT | Verify continuation-contract visual audit patch |
| RC-F021 | FLAKE / STABILIZATION | ISOLATED-PASS | Current Special Cells group |
| RC-F022 | FLAKE / STABILIZATION | ISOLATED-PASS | Current legacy Spark claim |
| RC-F023 | FLAKE / STABILIZATION | ISOLATED-PASS | Current control cohort |
| RC-F024 | FLAKE / STABILIZATION | ISOLATED-PASS | Current last-cell suppression |
| RC-F025 | FLAKE / STABILIZATION | ISOLATED-PASS | Current Artifact reload |
| RC-F026 | INTENTIONALLY REMOVED BEHAVIOUR | CONTRACT | Five-kind glyph parity fixture |
| RC-F027 | INTENTIONALLY REMOVED BEHAVIOUR | CONTRACT | Five-kind tiled glyph fixture |
| RC-F028 | INTENTIONALLY REMOVED BEHAVIOUR | CONTRACT | Split five-kind claim/reload fixture |
| RC-F029 | INTENTIONALLY REMOVED BEHAVIOUR | CONTRACT | Split five-kind claim/reload fixture |
| RC-F030 | FLAKE / STABILIZATION | ISOLATED-PASS | Current full-suite onboarding readiness |
| RC-F031 | FLAKE / STABILIZATION | ISOLATED-PASS | Current stabilization group |
| RC-F032 | FLAKE / STABILIZATION | ISOLATED-PASS | Current stabilization group |
| RC-F033 | FLAKE / STABILIZATION | ISOLATED-PASS | Current stabilization group |
| RC-F034 | FLAKE / STABILIZATION | ISOLATED-PASS | Current stabilization group |
| RC-F035 | FLAKE / STABILIZATION | ISOLATED-PASS | Current stabilization group |
| RC-F036 | FLAKE / STABILIZATION | ISOLATED-PASS | Current stabilization group |
| RC-F037 | FLAKE / STABILIZATION | ISOLATED-PASS | Current stabilization group |
| RC-F038 | FLAKE / STABILIZATION | ISOLATED-PASS | Current stabilization group; deterministic settle |
| RC-F039 | FLAKE / STABILIZATION | ISOLATED-PASS | Current stabilization group |
| RC-F040 | FLAKE / STABILIZATION | ISOLATED-PASS | Current stabilization group |
| RC-F041 | FLAKE / STABILIZATION | ISOLATED-PASS | Current stabilization group |
| RC-F042 | FLAKE / STABILIZATION | ISOLATED-PASS | Current stabilization group |
| RC-F043 | FLAKE / STABILIZATION | OPEN | Isolate current low-zoom LOD transition |
| RC-F044 | FLAKE / STABILIZATION | OPEN / HIGH ATTENTION | Isolate offline journal replay; preserve data-integrity gate |
| RC-F045 | STALE TEST | CONTRACT | Replace obsolete slider value `18` |
| RC-F046 | STALE TEST | CONTRACT | Replace obsolete slider value `18` |
| RC-F047 | STALE TEST | CONTRACT | Update zone visual fixture's detail range |

## Counts

| Bucket | Count | Interpretation |
|---|---:|---|
| Reproduced release blockers | 3 | RC-F005–RC-F007; fixes require passing targeted verifiers |
| Open high-attention stabilization | 2 | RC-F043–RC-F044; not safe to skip |
| Isolated-pass stabilization candidates | 26 | Must pass current full suite deterministically |
| Contract/stale/removed test debt | 14 | Update or archive; do not restore removed product behavior |
| Environment-gated failures | 0 | No observed failure qualifies |

The count is intentionally the 47 observed failures, not the historical 31.
The final Alpha RC rerun should record both test count and result so the two
baselines cannot be conflated again.
