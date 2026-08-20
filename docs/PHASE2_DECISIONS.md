# Product Phase 2 Decision Log

## DECISION: constrain the session game to one spectacle and one discovery

**EVIDENCE:** The product audit found that Spark/Choice overlap, Fuse/Hazard
mostly create obvious confirmation gates, and Bomb is the only spatially distinct
alternative. Artifact is the only event with a credible discovery/ownership
fantasy. The Recovery handoff already hides Fuse, Hazard, Choice, and Bomb in the
core-only control.

**ALTERNATIVES:** keep all six events; use Spark + Bomb together; remove every
event until human playtest.

**WHY CHOSEN:** A bounded comparison can test anticipation without allowing
special mechanics to become the product. Limiting the event budget preserves the
manual reveal as the primary reward and keeps the fork reversible.

**RISK:** The selected spectacle may still be throughput in disguise, or the
Artifact may be visually too weak to justify its cost.

**VALIDATION DEBT:** VD-PHASE2-SPECIAL-001 and VD-CORE-FEEL-001.

**REVERSIBLE:** Yes. Cohort/variant gates keep production implementations and
control behavior available without requiring migrations.

## DECISION: use effort-aware eligibility instead of fixed event cadence

**EVIDENCE:** The audit requires a Special to earn its interruption cost. A
singleton, trivial, or already fragmented target cannot support a meaningful
event. Existing Smart guidance exposes connected-cell and target workload data
that can be used to derive bounded eligibility.

**ALTERNATIVES:** fixed every-N-target cadence; random event placement; always
offer an event when a special cell is encountered.

**WHY CHOSEN:** Effort-aware eligibility ties anticipation to player work and
prevents an event from interrupting a tiny target. The simulator will expose the
distribution before thresholds are locked.

**RISK:** Poorly calibrated workload estimates can make events too rare or too
frequent.

**VALIDATION DEBT:** VD-PHASE2-SPECIAL-001.

**REVERSIBLE:** Yes. Eligibility remains server/client gated and can fall back to
core-only control.

