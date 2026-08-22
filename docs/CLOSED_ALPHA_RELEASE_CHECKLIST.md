# Splint Closed Alpha Release Checklist

Every PASS below points at machine-verifiable evidence produced during this
release run. Debt items list what remains and who owns it. No PASS is claimed
without evidence.

## Gates

- [x] **Candidate SHA fixed** — `codex/alpha-rc-1`, exact SHA recorded in
      `docs/RELEASE_RUN_STATE.md`; worktree clean; synced with origin.
- [x] **Git audit** — origin/main tree is content-identical to merge-base
      140f122 (PR #14 added an empty merge); RC = main + 112 commits, 0 behind;
      no patch-duplicate commits (`git cherry` clean); no generated outputs,
      logs, or scratch scripts tracked; migrations 001–028 strictly ordered in
      both dialects; secrets scan of full branch diff: clean.
- [x] **Full regression @ base SHA** — fresh worktree + fresh `npm ci`:
      root 455/455; server 401 pass / 65 skip; PostgreSQL 99/99 (fresh DB,
      CI-equivalent order); Chromium E2E 134 pass / 10 skip (3 timing flakes
      passed in isolation; uncontended final re-run recorded at final SHA);
      build PASS; lint PASS; `git diff --check` PASS.
- [x] **Fresh install rehearsal** — fresh checkout of exact SHA → npm ci →
      env validation → migrations → boot → /health /ready /live all OK.
- [x] **Fresh DB gate** — empty Postgres → migrate:postgres 28/28 → suite green.
- [x] **DB upgrade gate** — pre-RC schema (001–009) seeded with representative
      users/progress/artworks/posts/comments/stars rows → RC migrations
      (19 applied / 9 skipped) → every pre-existing row preserved exactly;
      new columns safe defaults; server boots on upgraded DB; health OK.
- [x] **Production-like fail-closed** — 9/9 boot matrix PASS: valid prod-like
      config boots with payments disabled; ALLOW_DEV_AUTH=true,
      PAYMENTS_MODE=internal_credits, PAYMENTS_MODE=telegram_stars, missing
      TELEGRAM_BOT_TOKEN, missing DATABASE_URL, SPECIAL_CELLS_QA_OVERRIDE,
      E2E_SEED_HOOKS, STORAGE_DRIVER=local in production each abort the boot
      before the HTTP listener starts.
- [x] **Staging-like deployment + smoke journey** — release build served by
      vite preview against Postgres with signed Telegram initData:
      14/14 journey steps PASS (clean user paint, returning-user resume,
      creator upload→paint→reload persistence, deep-link entry, private
      artwork isolation, payment endpoints fail-closed 503).
- [x] **Security review** — independent adversarial review: 0 blockers for
      closed alpha, 0 for production (hardening debt documented). Payment
      entitlement paths require server-confirmed events; client callbacks are
      never authoritative; Stars webhook router not mounted.
- [x] **Migration failure contract** — live drill: failing migration rolls back
      cleanly (no partial DDL, state row unchanged) and a boot with a pending
      failing migration never opens the listener. Recovery = fix file, re-run
      (resume-safe). Rollback of applied forward-only migrations = restore
      backup (documented in handoff).
- [x] **Rollback sequence documented** — see handoff §Rollback.

## Known non-blocking findings from this run

- HARNESS: cross-file test port ranges can collide (rare parallel-suite flake).
- HARNESS: some Special Cells visual specs are timing-sensitive under load.
- OPS: RATE_LIMIT_MAX=100/min per IP needs deliberate sizing for the alpha
  cohort (Telegram NAT); frontend loading gate has no visible failure surface
  on sustained 429s.
- OBSERVABILITY: global error handler logs error_class only; add message-level
  logging before public scale.

## Debt (must remain visible)

### Blocks public / production rollout

- Physical Telegram Android/iOS WebView validation (background/resume,
  safe-area, native share).
- Real Telegram Bot API Stars round-trip: sandbox invoice, pre-checkout,
  refund, crash recovery with real adapter, support drill, production
  credentials/IAM.
- Final price, legal/support policy, monitoring/alerting, deployment networking.
- Real-market retention/conversion/artistic-preference claims.

### Blocks nothing for closed alpha (tracked product validation)

- Human core-feel comparison and final Spark/Bomb preference decision
  (provisional baseline stays `spark_choice`).
- Final artistic Pixelization verdict; broad 1024/1200 promotion.
- Production S3/IAM scale controls and hostile-load cost telemetry.

[DEBT] Physical Telegram Android
[DEBT] Physical Telegram iOS
[DEBT] Real Stars round-trip (sandbox + production)
