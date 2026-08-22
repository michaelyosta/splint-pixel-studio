# Splint Closed Alpha Release Handoff

Operational handoff for the closed alpha release decision. Evidence-first:
every claim below was reproduced during this run unless explicitly marked as
debt.

## 1. Final branch

`codex/alpha-rc-1`

## 2. Exact SHA

See `CURRENT CANDIDATE SHA` in `docs/RELEASE_RUN_STATE.md` (single source of
truth; updated on every integration commit).

- Base RC under test: `618aec112a2d8c5e6d6fb4173f33945abc277c05`
- Final candidate: current HEAD of `codex/alpha-rc-1` (base RC + release-run
  commits listed in the run state file)

## 3. Base

`origin/main` = `68d751e1da35de3bfd92f6bec382f0af830ac502`. Verified during
this run: origin/main's **tree is content-identical** to merge-base
`140f1226f62dbbd220de2b255268564e9df8910d`; PR #14 contributed an empty merge.
The RC branch is strictly ahead: no rebase surprises, no duplicate patches.

## 4. PR

Open/prepare PR `codex/alpha-rc-1` → `main`. It represents the coherent final
RC state (112+ history summarized in `docs/ALPHA_RELEASE_NOTES.md`). Do not
merge without the owner decision at the bottom of this document.

## 5. CI

GitHub Actions `.github/workflows/ci.yml` covers install/typecheck-equivalent
(`server run check`), unit, server suite, PostgreSQL job (migrate + postgres
suite), build, lint, and Playwright E2E on PRs. CI status for the exact final
SHA must be checked on the pushed branch; this run additionally reproduced the
entire matrix locally in fresh environments (see §6–9, §19 evidence).

## 6. Fresh checkout

Verified: detached fresh worktree at the base RC SHA → `npm ci` (root+server)
→ full gates green. No dependence on any pre-existing local state.

## 7. Fresh DB

Empty Postgres 16 database → `npm --prefix server run migrate:postgres`
(28 applied / 0 skipped) → boot OK → PostgreSQL suite 99/99 PASS.

## 8. DB upgrade

Database at pre-RC schema (001–009) with representative rows across users,
coloring progress, artworks, posts, comments, stars operations/ledger,
collection ownerships → RC migrations applied (19 applied / 9 skipped) →
**all rows preserved exactly** (field-level comparison); added columns carry
safe defaults (`render_status='ready'`, `xp_total=0`, `level=1`); server boots
on the upgraded DB with health checks passing.

## 9. Staging-like result

Release build (`vite build`) served by `vite preview` + API in `NODE_ENV=staging`
on Postgres, driven with valid signed Telegram initData:
14/14 journey steps PASS — clean-user paint, returning-user resume,
creator upload→paint→reload persistence, deep-link context, private-artwork
isolation for other users, payment endpoints fail-closed (503 PAYMENTS_DISABLED),
premium pack purchase refused while payments are disabled.

## 10. Smoke journey coverage

- CLEAN USER: catalog → open artwork → manual painting → server-side progress.
- RETURNING USER: leave → cold reopen → same artwork/progress restored.
- CREATOR: create/upload → paint → reload → exact state preserved (private).
- SHARE: deep link opens correct artwork for a fresh identity.
- SPECIAL / TEST PAYMENT lifecycles: covered by the automated Chromium suite
  and Stars transaction tests (mock/sandbox only; no real Stars).
- PREMIUM: pack states render; purchase refused with payments disabled.

## 11. Configuration

Config matrix (all verified):

| Flag | DEV | TEST | STAGING-LIKE | PRODUCTION-LIKE |
|---|---|---|---|---|
| Dev auth (X-User-Id) | opt-in | allowed | **rejected (401)** | **boot-refused** |
| QA cohort override | gated (dev user allowlist) | allowed | inert | **boot-refused** |
| E2E seed hooks | off | test-only | absent | **boot-refused** |
| Diagnostics | opt-in | allowed | off | **boot-refused** |
| Special overrides | deterministic QA only | allowed | natural gameplay only | natural gameplay only |
| Payments mode | internal_credits default | mock/test harness | disabled default | disabled only (**telegram_stars throws**) |
| Demo seed | opt-in | allowed | opt-in | **boot-refused** |
| Storage | local | local/tmp | local or s3 | s3 required (HTTPS endpoint) |

Production boot requires: `NODE_ENV=production`, `TELEGRAM_BOT_TOKEN`,
`DATABASE_URL`, `S3_ENDPOINT`(https)/`S3_BUCKET`/`S3_ACCESS_KEY_ID`/
`S3_SECRET_ACCESS_KEY`/`STORAGE_DRIVER=s3`, HTTPS `CORS_ORIGINS`, explicit
`TRUST_PROXY` list. Anything privileged set on top → boot abort.

## 12. Security

Independent red-team review: **0 blockers** for closed alpha, 0 for production.
Hardening backlog (non-blocking): warn/refuse when NODE_ENV is unset in
deployments; consider auth-gating `/metrics`; retention jobs for
`coloring_progress_batches` / `abuse_counters` / `message_request_dedup`.
Secrets scan of tracked files + full branch diff: clean. `.env.local` untracked.

## 13. Payments

`PAYMENTS_MODE=disabled` is the shipping posture. Entitlement can only originate
from server-confirmed events; the Telegram Stars webhook router is not mounted;
production boots refuse every alternative payment mode. One real defect found
and fixed during this run: the abuse-budget upsert failed on PostgreSQL
(SQLite-only test coverage had hidden it) — fixed with a qualified-reference
upsert plus a dedicated PostgreSQL regression test.

## 14. Creator

Upload/create → conversion → private template → painting → reload persistence
verified end-to-end against Postgres in staging-like rehearsal. Creator
templates are `visibility='private'` by design and are not served to other
users (verified negative case).

## 15. Rollback

Application rollback: redeploy previous revision tag/container. Database is the
constraint:

- Migrations are forward-only; there are no down migrations.
- 010–028 are additive (no destructive drops of existing data). Rolling back
  application code without DB rollback is safe for older code that does not
  reference new tables/columns **except**: 005/006-era checksummed schemas and
  any code expecting NOT NULL columns introduced by 010/015/017.
- Irreversible-by-design items: 026 append-only financial audit tables
  (payments/refunds) must never be dropped once orders exist; 017 tiled
  dimension limits cannot be re-tightened once >160 templates exist.
- Practical rollback = point deployment at a restored backup
  (`server/scripts/backup-postgres.mjs` / `restore-postgres.mjs`) + previous
  app revision, then verify /health /ready and rerun the smoke journey.
- Migration failure handling (verified live): a failing migration rolls back
  atomically and the service refuses to serve until the schema is consistent;
  retries resume from the last applied version.

## 16. Observability

Present: structured request logs (method/route/status/duration/user),
security-event logs, background-job logs, `/metrics` counters, render-outbox
error logs, boot logs including migration results. Gap (documented): the global
500 handler logs only an error class — add message-level detail before public
scale so Creator/payment failures are diagnosable from logs alone.

## 17. Performance

Build passes with the known single-chunk warning (~657 kB min / ~199 kB gzip).
No performance regression work was in scope. Tiled player lifecycle and
stroke engine have dedicated suites in the Chromium matrix.

## 18. Known limitations

See `docs/ALPHA_RELEASE_NOTES.md` §Known limitations (bundle chunking, error
log verbosity, rate-limit sizing, timing-sensitive visual specs).

## 19. Validation debt

Ledger: `docs/VALIDATION_DEBT.md`. Release-relevant split lives in
`docs/CLOSED_ALPHA_RELEASE_CHECKLIST.md` §Debt.

## 20. Closed-alpha blockers

None known. All machine-executable preparation completed; remaining gates are
physical-device and business decisions (below).

## 21. Exact required owner actions

1. Review this handoff + checklist + notes.
2. Provide closed-alpha infrastructure: host with `NODE_ENV=production`,
   managed Postgres, S3-compatible storage with HTTPS endpoint, Telegram bot
   token (stored as a secret, never committed), sized `RATE_LIMIT_MAX`,
   `CORS_ORIGINS=https://<miniapp-origin>`, `TRUST_PROXY=<proxy IPs>`.
3. Decide alpha cohort + invite list.
4. `APPROVE CLOSED ALPHA RELEASE` (merge PR + deploy), or request remediation.
