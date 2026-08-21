# Alpha RC reproducibility evidence

Status: PASS WITH EXPLICIT ENVIRONMENT CAVEATS  
Audit date: 2026-08-21  
Repository: `michaelyosta/splint-pixel-studio`  

This report records a clean-checkout boot and database rehearsal. It is an
engineering reproducibility result, not proof of production Telegram, S3, or
physical-device behavior.

## Evidence snapshots

Two isolated worktrees were used; the primary dirty checkout and the shared
integration checkout were not modified.

| Scope | Revision | Result |
| --- | --- | --- |
| clean install/start/E2E smoke | `57ae86cb81d6c9a4bbe3df9418612ded260d7764` | PASS |
| PostgreSQL suite after harness fix | `3b1bafb36d55480d25dbaac99ecc9b3e1c8c7020` plus this branch's test changes | PASS |
| current integration candidate observed during audit | `1bd14d76a9439c8903bf1dcd1e337c983dda5e8e` | local branch, not merged to `main` |

The clean-install snapshot predates the latest stabilization commits. The
database evidence was rerun on the current security-hardened base before this
report was committed.

## Clean checkout procedure

Runtime used by the audit: Node `v24.19.0`, npm `11.17.0`. The repository
declares server Node `>=20`; CI/release should use the documented Node 22
runtime for parity.

Commands run from a disposable checkout:

```text
npm ci --ignore-scripts
npm ci --prefix server --ignore-scripts
npm test
npm --prefix server test
npm run build
npm run lint
git diff --check
```

Results:

* root tests: **453 pass, 0 fail**;
* server tests: **396 pass, 0 fail, 65 skipped** (provider-specific PostgreSQL/S3
  cases are capability-gated when their services are absent);
* root and server dependency installs: exit 0;
* build: PASS (1,876 modules; existing main chunk warning, approximately
  656.10 kB / 198.23 kB gzip);
* lint: PASS (94 warnings against the configured 100-warning budget);
* `git diff --check`: PASS.

The root install reported two development-dependency audit findings. The
production dependency audit (`npm audit --omit=dev`) reported zero findings
for both root and server installs.

## Fresh SQLite boot

Using a new temporary SQLite path:

```text
SQLITE_DB_PATH=<new-temp-db> npm --prefix server run migrate
SQLITE_DB_PATH=<same-db> npm --prefix server run migrate
```

Results: first run **28 applied / 0 skipped**; second run **0 applied / 28
skipped**; database created successfully (approximately 806,912 bytes in the
rehearsal).

With a new database and `ALLOW_DEV_AUTH=true`, `SEED_DEMO_DATA=true`,
`PAYMENTS_MODE=disabled`, the server started on a disposable port and returned:

* `/health`: `{"status":"ok"}`;
* `/ready`: `{"ready":true,"checks":{"database":"ok","object_storage":"ok","configuration":"development"}}`;
* `/live`: `{"status":"alive"}`;
* authenticated `/colorings`: six seeded records.

The process exited cleanly after the smoke check. No existing database was
used for this rehearsal.

## Fresh PostgreSQL migrations and suite

A disposable PostgreSQL container was used; it was not a project or production
database. On a clean schema:

```text
npm --prefix server run migrate:postgres
npm --prefix server run migrate:postgres
npm --prefix server run test:postgres
```

Migration result: **28 applied / 0 skipped**, then **0 applied / 28 skipped**;
`schema_migrations` contained versions `001` through `028`; the schema had 56
public tables.

After the test-harness correction, the standard PostgreSQL suite finished with:

* **99 pass, 0 fail, 0 skipped**;
* duration approximately **135,460 ms**;
* the runner uses `--test-concurrency=1` because these tests intentionally share
  one PostgreSQL schema and each file owns reset/fixture state.

The reset regression specifically verifies that `telegram_stars_orders` and
`telegram_stars_entitlements` do not survive the helper's drop operation.
The fixture cleanup also removes `daily_challenge_progress` and
`daily_challenges` before deleting a template, respecting the production FK.

The former stale-daily verifier attempted to insert an orphan
`missing_stale_template`. That is incompatible with the shipped
`daily_challenges_template_id_fkey`; it now creates a valid hidden assignment
and verifies repair to a valid eligible template.

## Chromium smoke

With the default E2E ports occupied by another local process, the smoke was
rerun on explicitly free disposable ports:

```text
E2E_WEB_PORT=5290 E2E_API_PORT=3312 VITE_ALLOW_DEV_AUTH=true \
  npm run test:e2e -- --project=chromium \
  e2e/phase2-manual-first-reveal.spec.js
```

Result: **1 passed**. A port collision is an environment prerequisite, not a
product failure; release automation must reserve or dynamically allocate its
ports.

## Hidden dependencies and explicit limits

* A fresh checkout needs both root and `server` dependency installs; this is
  reflected in the deployment runbook.
* PostgreSQL test coverage requires `DATABASE_URL` and a disposable PostgreSQL
  service. Without it, 65 provider-specific server tests are intentionally
  skipped by capability gates.
* S3/object-storage tests require their provider credentials/service and were
  not treated as locally proven by the SQLite smoke.
* Payment mode was explicitly disabled. No Bot API credential, production Stars
  charge, or entitlement event was used.
* The clean run used development auth only for local smoke. It is not evidence
  that development auth is safe or available in production-like configuration;
  the release security/configuration checks own that gate.
* Node 24 was the available local runtime; release parity should use the
  repository's documented Node 22 CI runtime.

## Reproduction checklist for an Alpha RC operator

1. Checkout the exact candidate SHA and verify `git status` is clean.
2. Install root and server dependencies with `npm ci --ignore-scripts` and
   `npm ci --prefix server --ignore-scripts`.
3. Validate required environment values; keep `PAYMENTS_MODE=disabled` unless a
   separate release decision enables a provider.
4. Apply SQLite or PostgreSQL migrations from a new database.
5. Seed only in an explicitly non-production environment.
6. Run health/readiness, root/server tests, build, lint, and the E2E smoke.
7. Record service-specific skips (PostgreSQL/S3/Telegram) rather than treating
   them as silent coverage.

## Remaining validation debt

This report does not prove physical Telegram WebView behavior, real iOS/Android
input, production Stars round-trip/refund, production S3/IAM, deployment
networking, legal/support operations, or user retention. Those remain explicit
validation debt and release/business gates, not reasons to hide the successful
clean local reproduction.
