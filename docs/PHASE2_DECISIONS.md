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

## DECISION: transport the session-game gate through the real guidance request

**EVIDENCE:** The server-side `sessionGame` guard initially existed only in the
service call. The browser client did not serialize it into `/guidance`, so the
first-target Spark pity path could still be selected in the actual app even
though the isolated service test passed. The new client query test and manual
pointer E2E verify `session_game=1` end to end.

**ALTERNATIVES:** rely on the URL-only experiment flag; gate only in the client;
remove the first-target pity logic globally.

**WHY CHOSEN:** The flag is explicit, bounded to the session experiment, and
keeps legacy production guidance compatible. The client also suppresses early
Special claims until the first guided fragment is manually completed.

**RISK:** A reload before the first reveal intentionally keeps the first-minute
gate conservative and may delay a rare event by one additional fragment.

**VALIDATION DEBT:** VD-CORE-FEEL-001, VD-TELEGRAM-WEBVIEW-001.

**REVERSIBLE:** Yes.

## DECISION: add a bounded Canvas-first reveal ceremony before locking the event winner

**EVIDENCE:** The Phase 2 slice now proves the manual fragment transition and
the independent visual review found that event cards can compete with the
artwork. A pure helper, reduced-motion fallback, fresh Chromium assertion, and
417-test root suite keep the ceremony bounded and input-safe.

**ALTERNATIVES:** add more particles/HUD; wait for a Special winner first;
build a full completion/progression ceremony.

**WHY CHOSEN:** The ceremony increases the payoff of the action already made by
the player without adding a new economy, camera steal, backend contract, or
event family. It is a reversible Phase 3 visual slice, not a claim that the
effect is emotionally proven.

**RISK:** The frame/copy may still read as a system overlay, and the positive
event score remains split between agency-safe Choice and visually stronger
Automatic Spark.

**VALIDATION DEBT:** VD-PHASE3-VISUAL-001 and VD-PHASE2-P1-001.

**REVERSIBLE:** Yes. Remove the overlay or tune its CSS without touching the
authoritative painting contract.

## DECISION: preload the persisted event tile before rendering a recovered offer

**EVIDENCE:** Browser review showed an offer over `Загружаем фрагмент поля…` or
an overview. A recovered Spark/Bomb offer now loads one bounded target tile and
switches to work LOD before the panel is visible. Chromium Spark/Bomb/manual E2E
all pass with the panel over a loaded Canvas.

**ALTERNATIVES:** render the offer immediately; force a camera teleport; block
the event until a full viewport is loaded.

**WHY CHOSEN:** One target tile removes the blank-state contradiction without
adding full-grid work or stealing the camera.

**RISK:** A very small viewport may still need the normal tile loader to fetch
neighbouring context.

**VALIDATION DEBT:** VD-TELEGRAM-WEBVIEW-001.

**REVERSIBLE:** Yes.

## DECISION: keep Spark choice as the provisional Phase 2 event baseline

**EVIDENCE:** Independent scorecard: Spark choice agency 7/10, auto 4/10,
Bomb 6/10. Auto has the lowest interaction cost but the highest risk of making
the player a passenger; Bomb has clearer spatial causality but an unproven
meaningful aim decision.

**ALTERNATIVES:** ship Spark auto as default; ship Bomb as the sole event; keep
all candidate variants simultaneously in one cohort.

**WHY CHOSEN:** Choice preserves player intent while the two alternatives stay
available as isolated, reversible comparison knobs.

**RISK:** The two current Spark targets can still be visually too similar; a
human comparison may reject the baseline.

**VALIDATION DEBT:** VD-PHASE2-SPECIAL-001.

**REVERSIBLE:** Yes.
