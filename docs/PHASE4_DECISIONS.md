# Product Phase 4 Decisions

## DECISION: Collection-first return surface

EVIDENCE: Gallery shelf separates the next unfinished beat from completed collection; Collections adds bounded progress; focused gallery tests pass.

ALTERNATIVES: Keep catalog-first home; add XP/streak return pressure.

WHY CHOSEN: The artwork and owned result are the natural return objects; meta pressure is explicitly out of scope.

RISK: Human appeal and repeat-return lift remain unmeasured.

VALIDATION DEBT: VD-PHASE4-GALLERY-001.

REVERSIBLE: Yes; pure helpers and view ordering are bounded.

## DECISION: Honest content metadata gate

EVIDENCE: 6 current artworks, 0 exact Pixelization routes; deterministic duration/complexity audit and 7 focused tests pass.

ALTERNATIVES: Auto-promote preview dimensions; hide uncertainty; expand catalog quantity.

WHY CHOSEN: A small trustworthy catalog protects the painting loop better than broad low-confidence content.

RISK: Slower content expansion until editorial evidence exists.

VALIDATION DEBT: VD-PHASE4-CONTENT-001.

REVERSIBLE: Yes; advisory metadata and audit output do not alter converter behavior.

## DECISION: Resume the next reveal beat

EVIDENCE: Revision-safe nextBeat persistence, explicit Home promise, save-point exit, focused tests 7/7.

ALTERNATIVES: Resume generic artwork; resume catalog; add daily reminders.

WHY CHOSEN: It preserves player-authored continuity without coercive retention systems.

RISK: Telegram WebView lifecycle and copy comprehension need physical-device evidence.

VALIDATION DEBT: VD-PHASE4-RESUME-001.

REVERSIBLE: Yes; snapshot fields are bounded and fail-safe.

## DECISION: Gate long-form sessions

EVIDENCE: Pacing harness validates 30s/3m/15m; 15m treatment is eligible only with segmented closures, player-authored beats, and max gap <=210s.

ALTERNATIVES: Promote 1200x1200 as default; use raw percentage progress only.

WHY CHOSEN: Duration alone is not pacing; emotional closure is the acceptance criterion.

RISK: Fixture segmentation is not yet editorial production metadata.

VALIDATION DEBT: VD-PHASE4-LONGFORM-001.

REVERSIBLE: Yes; pilot eligibility is metadata-gated.

## Explicitly deferred

No new Special Cells, no Bomb promotion, no Stars/payments, no XP/streak/daily pressure, no marketplace/feed, and no production Pixelization auto-promotion.
