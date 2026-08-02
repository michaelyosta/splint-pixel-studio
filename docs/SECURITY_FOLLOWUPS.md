# Security follow-ups

This index supersedes stale follow-up references. Historical evidence remains in [AUDIT_FINDINGS.md](AUDIT_FINDINGS.md); current adjudication is in [ADJUDICATED_AUDIT_2026-08-02.md](ADJUDICATED_AUDIT_2026-08-02.md), and implementation status/exit criteria are in [remediation/IMPLEMENTATION_PLAN.md](remediation/IMPLEMENTATION_PLAN.md).

## 2026-08-02 RC verification snapshot

The current local evidence is code/test verified, not production verified: `npm test` is 201/201; server tests are 163 passed, 56 skipped, 0 failed; E2E is 110 passed with 4 expected skips; lint is 89 warnings within the 100-warning budget; root and server dependency audits report 0 vulnerabilities. The 54 PostgreSQL and 2 S3/MinIO skips remain environment validation gates.

## Current status

- `resolved`: server-authoritative completion, canonical media metadata, transactional likes/comments, message idempotency/CAS, profile refresh and bounded feed DTOs are implemented and locally test-covered.
- `partially_resolved`: canonical retry recovery has no durable render outbox; cloud object-storage lifecycle, multi-instance staging calibration, large-grid performance and full moderation operations still need external evidence.
- `needs_environment_validation`: PostgreSQL, S3/IAM, Telegram WebView, HTTPS proxy, backups/restore and production monitoring.
- `strategic_decision_required`: enabling real Telegram Stars and choosing the product/payment support owner.

## Required follow-up evidence

1. Run the release-candidate workflow against a disposable PostgreSQL service.
2. Run S3/MinIO media write/read/delete and inventory checks.
3. Execute Telegram initData/auth, pagehide recovery and public publish smoke tests in the real target WebView.
4. Exercise backup restore and payment-disabled kill-switch before any public rollout.
