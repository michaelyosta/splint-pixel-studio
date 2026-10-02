# Deploy, monitoring and recovery runbook

Status: CANONICAL
Authority: Release, incident and rollback procedure for the existing stack.
Navigation: [../INDEX.md](../INDEX.md) · Live facts: [../CURRENT_STATE.md](../CURRENT_STATE.md)
Backup contract: [BACKUP_RESTORE.md](BACKUP_RESTORE.md)

## Release

Use a clean isolated branch, relevant local checks and configured required CI.
Merge through a reviewed PR without bypass; verify exact frontend/backend receipts
and fresh smoke. Reuse existing Pages, Render, Neon, R2 and Telegram resources.
Confirm backup coverage before risky persistence work. Migrations are forward-only.
Current commerce decisions belong in CURRENT_STATE; do not change purchases,
refunds, ownership or payouts to complete a release test. Accept owner-reported
phone and payment results as that evidence class; do not require another transaction.

## Health and monitoring

Render Health Check Path is /ready (database, object storage and configuration).
/health and /live alone demonstrate a running process. Always-on compute is a
separate owner billing decision; periodic requests are not a hosting workaround.

Operations monitoring checks frontend, bounded same-origin assets, expected API
binding, /live, /health, strict production /ready and metrics. Anonymous GETs only;
bounded headers/body timeout, no hidden retries, no credentials or response bodies
in reports. Query strings and private identifiers are excluded.

Schedule: hourly at minute 17 UTC. Manual dispatch supports live, hermetic self-test
and alert-drill. Run the labelled synthetic alert-drill on a non-production ref;
it intentionally fails without application traffic, testing owner notifications
without adding a failed check to the production deployment.

Green proves these probes at that moment, not an SLA or every authenticated journey.
Actions minutes use the existing account budget. Failure notifications depend on
owner GitHub preferences. Provider deploy alerts are separate from uptime alerts;
record delivery separately from merely selecting a notification preference.

## Respond to alerts

1. Open Actions → Operations monitoring → failed run summary immediately.
2. Review each reason. One explicit live dispatch may clarify a transient failure;
   do not keep retrying or dismiss a partial failure.
3. If still red, inspect Render splint-api and Pages splint-pixel-studio: deploy
   state, safe error classes, readiness and dependency health.
4. For payment divergence use the existing operator purchase kill switch after
   classifying the incident; preserve capture/refund/reconciliation and ledger.
5. For corruption follow BACKUP_RESTORE. Preserve source state, restore separately
   and verify before an approved traffic cutover.

Test notifications synthetically, never by stopping production. Never publish raw
logs with credentials, initData, charge ids or user payloads.

## User support and rollback

Existing Premium support/refund contacts and operator panel remain authoritative.
The operator reviews support cases against server-confirmed payments/entitlements
and uses the supported refund flow. Do not ask users for credentials, initData or
private payment payloads. Separate ordinary UX reports from save/access/payment
incidents; improvements can continue without reopening finished acceptance gates.

Rollback via provider known-good deployment or reviewed revert PR with normal CI.
Verify schema compatibility; data restoration uses separate recovery targets.
No forced main rewrite, production reset or deletion of progress/ownership/ledger.
Record dated incident evidence and rewrite obsolete CURRENT_STATE facts.
