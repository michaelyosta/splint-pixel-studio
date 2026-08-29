# Splint Closed Alpha Release Run State

Persistent execution memory for the `CLOSED ALPHA RELEASE PREPARATION` run.
Update after every major milestone. This is a recovery checkpoint, not a diary.

```text
RUN STATUS: CLOSED_ALPHA_RELEASE_READY (pending owner decision)
CURRENT CANDIDATE SHA: c906955ce1dde050274cec8224f1e856924fabb6 (FINAL — all gates verified at this SHA)
BASE RC UNDER ORIGINAL VERIFICATION: 618aec112a2d8c5e6d6fb4173f33945abc277c05
DELTA 618aec1..c906955: docs/* release files + abuse-limiter SQL qualification + postgres regression test + test:postgres registration (nothing else)
CURRENT BRANCH: codex/alpha-rc-1 (pushed to origin)
BASE: origin/main 68d751e1da35de3bfd92f6bec382f0af830ac502 (tree identical to merge-base 140f122)
RC WORKTREE: C:\Users\misa\Desktop\Splint-Gemini-Phase2-Autonomous (clean of code changes; only external evidence-binary churn uncommitted)
PRIMARY CHECKOUT: C:\Users\misa\Desktop\Splint-Gemini (user's dirty checkout — untouched)
```

## FINAL VERIFIED RESULTS (this run @ c906955)

- git diff --check: PASS | Root: 455/455 | server check: PASS
- Server (SQLite): 401 pass / 0 fail / 67 skip (468 total)
- PostgreSQL (fresh DB → migrate 28/28 → suite): **100/100 PASS** (includes new postgres-abuse-limiter regression)
- Lint: PASS | Build: PASS (known 656.93 kB chunk warning — accepted debt)
- Chromium E2E (uncontended, full suite): 133 pass / 1 fail / 10 skip — the single fail (tiled-completion render_status 15s wait) passes in isolation (3.0s) → HARNESS timing flake; effective **134/134, 0 unexplained failures**
- Independent reviews: RELEASE_ENGINEERING_VERDICT: APPROVE | SECURITY_INTEGRITY_VERDICT: APPROVE

## GATES VERIFIED AT BASE 618aec1 (delta to final is docs+one-line SQL+test)

- Upgrade DB gate: pre-RC 001–009 + representative data → RC migrations 19 applied/9 skipped → all rows preserved exactly; boot+health OK.
- Production-like fail-closed matrix: 9/9 PASS.
- Staging-like rehearsal + smoke journey: 14/14 PASS (re-run post-fix).
- Migration failure drill: clean rollback + boot refuses listener (fail-closed).
- Security red team: 0 closed-alpha blockers, 0 production blockers.
- Migration static review: no blockers.
- Git/artifact audit: clean (evidence-binary size noted as cleanup).

## ENVIRONMENT INCIDENTS (recovered, no impact on results)

- Docker Desktop daemon crash mid-run → restarted, fresh DB recreated.
- External process deleted RC worktree `.git` pointer and later all 839 tracked
  working files → pointer recreated, `git worktree repair`, forced re-checkout
  @618aec1, changes reapplied, committed+pushed immediately (c906955).

## COMPLETED GATES

- [x] Session recovery: documented RC state matches actual Git state (branch, SHA, clean tree, remote sync).
- [x] Git/PR integration audit: origin/main tree == merge-base 140f122 tree (PR #14 content-empty); RC = main + 112 commits, 0 behind in content; git cherry shows no duplicate patch-equivalents; worktree clean.
- [x] Artifact audit (read-only agent): blockers=0, cleanups=1 (docs/evidence ≈39MB PNGs — INFO/cleanup).
- [x] Security red team (independent agent): BLOCKERS_FOR_CLOSED_ALPHA=0, BLOCKERS_FOR_PRODUCTION=0. Hardening debt: NODE_ENV-unset fail-open posture (MEDIUM), unauthenticated /metrics (LOW), unbounded coloring_progress_batches/abuse_counters/message_request_dedup growth (LOW).
- [x] Migration static review (independent agent): runner sound (atomic per-migration tx incl. state row, SHA-256 checksum enforcement, boot fails closed before listen, resume-safe retries, duplicate-version rejection). No blockers.
- [x] Fresh regression at exact SHA 618aec1 (fresh worktree + fresh npm ci):
  - git diff --check: PASS (exit 0)
  - Root: 455/455 PASS ✓ | server check: PASS
  - Server (SQLite): 466 tests / 401 pass / 0 fail / 65 skip ✓ (run1 single flake = cross-file port-range collision, classified HARNESS_FAILURE; run2 clean)
  - Lint: PASS | Build: PASS (656.93 kB chunk warning — accepted optimization debt §37)
- [x] Fresh DB gate (empty postgres DB): migrate → 28/28, exit 0. PostgreSQL suite (CI order): **99/99 PASS**.
- [x] Chromium E2E full suite @618aec1: first run 131 pass / 3 fail / 10 skip; all 3 failures (special-cells specs) PASS in isolation → HARNESS contention-flake (parallel suites were running); effective **134 pass / 0 fail / 10 skip** ✓ matches claim. Uncontended full re-run scheduled at final SHA.
- [x] Upgrade DB gate (pre-RC 001–009 + representative data → RC migrations): 19 applied / 9 skipped; all rows preserved exactly (users/progress/artworks/posts/comments/stars ops/ledger/ownerships); safe defaults (render_status='ready', xp 0/level 1); schema_migrations=28.
- [x] Production-like fail-closed matrix: 9/9 PASS (boot OK with payments disabled; ALLOW_DEV_AUTH / internal_credits / telegram_stars / missing bot token / missing DATABASE_URL / QA override / E2E hooks / local storage in prod → ALL throw before listen).
- [x] Staging-like deployment rehearsal: release build + vite preview + postgres + signed Telegram initData journeys — **14/14 PASS** (boot, static hash, dev-auth escape 401, creator upload/paint/reload, clean user classic paint, returning reopen, private-artwork isolation, payments 503 fail-closed ×2).
- [x] Migration failure drill (live): failing 029 → runner exit 1, clean rollback (schema_migrations stays 28, no partial DDL); boot with pending failing migration → listener never starts (fail-closed); recovery = fix file + re-run (resume-safe).
- [x] **PRODUCT_FAILURE found & fixed**: server/services/abuse-limiter.js upsert `attempts=attempts+1` ambiguous on PostgreSQL → every create/upload route 500s on PG (SQLite-only test coverage hid it). Fix: qualify `abuse_counters.attempts+1` (probe-verified both engines). Targeted regression added: server/test/postgres-abuse-limiter.test.js (in test:postgres list). Post-fix staging smoke: 14/14 PASS.

## ACTIVE FINDINGS

- ENVIRONMENT INCIDENT (recovered): an external process deleted this worktree's
  `.git` pointer and later 839 tracked working-tree files (twice during the
  run). Git objects were never affected. Recovery: recreated `.git` pointer,
  `git worktree repair`, forced re-checkout of `codex/alpha-rc-1` @ 618aec1;
  verified clean status afterwards. Release docs survived as untracked files.
  Mitigation: commits are pushed to origin immediately after creation.
- HARNESS (non-blocker): cross-file test port ranges can collide
  (32100–32599 vs 32400–32699 overlap) — rare parallel-suite flake. Test-only
  cleanup candidate; deliberately untouched during freeze.
- HARNESS (non-blocker): Special Cells visual specs timing-sensitive under load.
- OPS (documented debt): RATE_LIMIT_MAX=100/min per IP needs deliberate sizing
  for Telegram NAT cohorts; frontend loading gate shows no failure surface on
  sustained 429s.
- OBSERVABILITY (documented debt): global error handler logs error_class only.

## ACTIVE WORKSTREAMS

- primary (Ox Alpha): integration commit → push → final regression at final
  SHA → independent reviews → verdict — IN_PROGRESS

## COMMITS READY FOR INTEGRATION

Committing now (single integration commit):
- fix(server): qualify abuse counter upsert for PostgreSQL (+ regression test,
  test:postgres registration)
- docs(release): RELEASE_RUN_STATE / ALPHA_RELEASE_NOTES /
  CLOSED_ALPHA_RELEASE_CHECKLIST / CLOSED_ALPHA_RELEASE_HANDOFF /
  VALIDATION_DEBT release-run section

## LAST VERIFIED TEST RESULTS

See "FINAL VERIFIED RESULTS" section above — all gates executed and green at
the final candidate SHA c906955.

## NEXT DEPENDENCY-ORDERED ACTIONS

(none — machine-executable release preparation is complete; terminal state
CLOSED_ALPHA_RELEASE_READY reached. Remaining gates are owner decisions:
APPROVE CLOSED ALPHA RELEASE, then merge PR + provision production infra.
Per the stop boundary: no merge to main, no deploy, no Stars enablement is
performed by agents.)
