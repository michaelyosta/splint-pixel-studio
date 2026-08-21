# Splint Alpha RC 1 handoff

Status: **ALPHA_RC_READY**

This is a consolidation/release-candidate handoff, not a new product phase.
Product Phases 0–5 remain provisionally complete; no Phase 6 work was started
in this cycle. The candidate is a disabled-payment, production-shaped build
whose local correctness, reproducibility, and security gates are green.

## 1. Build identity and Git boundary

| Item | Value |
|---|---|
| Integration branch | `codex/product-phase-2-autonomous` |
| Candidate before release docs | `8242b87` (`test: repair accessibility evidence creator verifier`) |
| Alpha RC branch | `codex/alpha-rc-1` (created at the final handoff commit) |
| Base | Long-lived integration line; no automatic merge/rebase with `origin/main` |
| Primary checkout | `C:\Users\misa\Desktop\Splint-Gemini`, dirty and intentionally untouched |
| Payments | `PAYMENTS_MODE=disabled`; no real Stars charge |
| Migrations | `001`–`028` |

The exact final branch SHA and remote SHA are printed in the release message
and can be rechecked with:

```powershell
git rev-parse codex/alpha-rc-1
git ls-remote origin refs/heads/codex/alpha-rc-1
```

No historical Phase branch was blindly cherry-picked. The integration graph,
duplicate review, and preserved worktrees are documented in
[`ALPHA_RC_GIT_CONSOLIDATION.md`](ALPHA_RC_GIT_CONSOLIDATION.md).

## 2. Regression closure

The release brief's historical Chromium result was `102 PASS / 31 FAIL / 10
SKIP`. The expanded triage run observed `87/47/10` because the suite had grown
to 144 tests. After journey, creator, camera, request-readiness,
onboarding/serial-load, low-zoom, offline-journal, stale-contract, and
accessibility-verifier fixes, the final current-HEAD gate is:

```text
Chromium full suite:       134 passed / 0 failed / 10 explicit skips
Accessibility/session:       9 passed / 0 failed (flags enabled)
```

The ten skips are explicit capability gates (evidence captures without their
opt-in environment flags and the desktop exclusion of a physical-touch-only
scenario). No product failure was converted into a skip. The per-scenario
register and closure classification are in
[`ALPHA_RC_FAILURE_TRIAGE.md`](ALPHA_RC_FAILURE_TRIAGE.md) and
[`ALPHA_RC_BURNDOWN.md`](ALPHA_RC_BURNDOWN.md).

## 3. Verification matrix

| Gate | Result |
|---|---|
| Root tests | **455 pass / 0 fail** |
| Server tests | **401 pass / 0 fail / 65 capability skips** |
| PostgreSQL | **99 pass / 0 fail / 0 skip**; fresh schema, serial shared-DB harness |
| Fresh migrations | **28 applied / 0 skipped**, then **0 applied / 28 skipped** |
| Build | PASS; 1,876 modules; main chunk 656.93 kB (existing >500 kB warning) |
| Lint | PASS; 99 warnings within configured 100-warning budget |
| `git diff --check` | PASS |
| Full Chromium | **134/0/10** |
| Evidence captures | **9/9** |

The detailed clean-start and database rehearsal is in
[`ALPHA_RC_REPRODUCIBILITY.md`](ALPHA_RC_REPRODUCIBILITY.md). The disposable
PostgreSQL container used for verification was removed after the run.

## 4. Product journey coverage

The candidate covers the complete bounded journey through targeted E2E,
integration, and state-machine verifiers rather than one fragile mega-test:

```text
clean user → Home → manual first reveal → Smart Director → close/resume
→ Gallery/collection → Creator upload → preview/detail selection → save
→ generated artwork → tiled paint/resume → Spark/Artifact bounded paths
→ showcase premium pack locked/owned states → mocked XTR order/payment/
entitlement/reload → artwork/pack deep-link/share construction
```

The core/manual-first slice remains Canvas-first and player-authored. `spark_choice`
is the provisional baseline; `spark_auto` is query-gated challenger; Bomb is
not promoted. Choice/Fuse/Hazard remain excluded from the active product path.
Gallery, Resume, Catalog, Creator, content metadata, Store, entitlement, and
share/deep-link contracts are covered by the full Chromium and server suites.

## 5. Database and data integrity

Fresh SQLite and disposable PostgreSQL both apply all 28 migrations and replay
idempotently. The PostgreSQL reset helper now drops all migration and
`telegram_stars_*` tables and has FK-safe daily-challenge cleanup; the suite
passes with serialized shared-schema execution. Server-authoritative progress,
revision handling, entitlement idempotency, refund tombstones, and creator
save/reload paths remain covered. No data-loss or migration blocker remains in
the local evidence.

## 6. Security and configuration

[`ALPHA_RC_SECURITY_CONFIG.md`](ALPHA_RC_SECURITY_CONFIG.md) records the
red-team findings and fixes. The release posture is:

- production-like environments fail closed unless explicitly configured;
- `PAYMENTS_MODE=disabled` is the only production-safe mode in this RC;
- client invoice callbacks and `stars_balance` cannot grant entitlement;
- provider identity, currency, amount, product, user, replay, refund, and
  idempotency checks are server-authoritative in the mocked XTR adapter;
- E2E hooks, dev auth, QA overrides, special diagnostics, and internal credit
  routes are environment/allowlist gated;
- upload size, dimensions, MIME/signature, per-user budgets, render retries,
  ownership, and content-addressed originals are bounded;
- no live token, payment secret, private key, Telegram initData, or credential
  dump is committed.

Real Bot API delivery, deployment IAM, distributed rate limiting, and hostile
public-load telemetry are not claimed as locally proven.

## 7. Config and startup

For a local Alpha RC rehearsal, use a fresh database and keep payment disabled:

```powershell
npm ci --ignore-scripts
npm ci --prefix server --ignore-scripts
$env:PAYMENTS_MODE = 'disabled'
npm --prefix server run migrate
npm test
npm run test:server
npm run build
npm run lint
```

For PostgreSQL, set a disposable `DATABASE_URL`, run
`npm --prefix server run migrate:postgres` twice, then
`npm --prefix server run test:postgres`. For browser verification, reserve
free E2E ports and run:

```powershell
$env:E2E_WEB_PORT='5910'; $env:E2E_API_PORT='3930'; $env:VITE_ALLOW_DEV_AUTH='true'
npm run test:e2e -- --project=chromium
```

Production-like configuration must use Telegram auth, no dev/QA flags, and
payments disabled. Missing critical environment values must fail fast or
disable the optional capability; it must not silently enable a local ledger.

## 8. Performance and accessibility

The full Chromium run completed in approximately 38.6 minutes under serial
browser load; the evidence subset completed in 1.7 minutes. The tiled manifest
guard prevents first-input `MANIFEST_NOT_LOADED` errors, while pointermove,
tile bounds, camera, offline journal, and reload paths remain bounded. Build
size has an existing warning but no new correctness failure. Accessibility,
reduced-motion, 360/390/430 responsive, keyboard, modal, and explicit preview
selection evidence passed; physical iOS/Telegram behavior remains debt.

## 9. Validation debt

See [`VALIDATION_DEBT.md`](VALIDATION_DEBT.md). Before public/production
rollout, an owner still needs real Telegram device/provider, price/legal,
deployment/IAM, operations/support, and market/retention evidence. These are
not blockers for this reproducible Alpha RC. Final Pixelization art direction
and human core-feel/Spark preference also remain provisional.

## 10. Intentionally disabled or deferred

No production Stars charges, final pricing, marketplace, social feed, battle
pass, XP/streak/daily pressure, new Special Cells, broad 1024/1200 premium
promotion, or Phase 6 feature expansion is enabled by this handoff.

## 11. Release decision boundary

`codex/alpha-rc-1` is a coherent, correct, reproducible, testable candidate.
The owner/release process may now decide whether to run real-device/provider
validation, prepare a PR to the intended base, and eventually enable a public
deployment. No merge to `main`, production payment activation, or public launch
was performed automatically.
