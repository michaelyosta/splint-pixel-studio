# Public-alpha remediation baseline

Date: 2026-08-02  
Original branch: `agent/complete-mvp-patch`  
Original HEAD: `140f122` (`docs: map project and deployment readiness`)

## State before this independent review

The working copy already contained remediation work and user changes. The review preserved them and created an external binary patch/status snapshot before editing. The pre-existing ambiguous files were not silently reverted.

The historical pre-review report stated 200 root tests, 215 server tests with 55 skipped, 110/4 E2E, and 34 syntax-checked files. Those numbers were stale and were re-run rather than accepted. Current evidence is recorded in [FINAL_REPORT.md](FINAL_REPORT.md).

## Classification

- Remediation candidates: server-authoritative completion, progress journal, media/feed safeguards, abuse controls, migrations 010-014, operational scripts, CI, and related tests/docs.
- Pre-existing or ambiguous user changes: `server/index.js`, `src/lib/imageCrop.js`, and `src/lib/pixelColoring.js`. They were preserved and are listed in the final handoff if not staged.
- Runtime/generated data: local SQLite database, `node_modules`, build output, Playwright artifacts, logs, uploads, and backup output. These are ignored or intentionally excluded.
- Sensitive material: environment files and credential-shaped values are examples/placeholders only; no confirmed live secret was added to the release candidate.

## Original review limits

SQLite is a development/test backend. PostgreSQL is the production target. Docker, production credentials, real Telegram WebView, cloud object storage, and a restore environment were not available for the local review. None of those gates may be described as runtime-verified.

## Canonical sources

The provided adjudicated audit remains the specification in [ADJUDICATED_AUDIT_2026-08-02.md](../ADJUDICATED_AUDIT_2026-08-02.md). Current implementation evidence and claim-level statuses are in [FINAL_REPORT.md](FINAL_REPORT.md); the old baseline must not override that report.

