# Audit remediation baseline and verification

Status: HISTORICAL
Date: 2026-10-02 (Asia/Qyzylorda)
Current operational truth: [../CURRENT_STATE.md](../CURRENT_STATE.md).

## Baseline

The audit pinned main to `73eadb327dbdc1e6f93c64f7493a6031496ef6e6`.
[Push CI](https://github.com/michaelyosta/splint-pixel-studio/actions/runs/36830798533)
and [scheduled CI](https://github.com/michaelyosta/splint-pixel-studio/actions/runs/36834004063)
both failed the responsive Spark manual-panel assertion in extended shard 24;
the other thirty jobs succeeded. The existing one-tap contract intentionally
retires that panel; this is a missing test migration, not proof of a P0 outage.

The owner-authorized Chrome / Telegram Web session opened the production Mini
App and followed Catalog → Create → Profile → Catalog. It showed nine shelves,
sixteen collections, 321 works, 173 free and 148 premium. Dreamcore Idols
advertised twenty Premium works but rendered its first twelve cards with free
access metadata and no Premium badge. No owner progress, payment or DB state
was changed by that inspection.

Public JS/CSS matched the baseline build byte-for-byte:

- JS SHA-256: `ab8ffeddf76e15e915652a15839375280124b08340730171b7ce6dde41ddbb8c`.
- CSS SHA-256: `5550d2d35d82dab5099eaebe7d5eba40c7618162bc87097a03c76f8bde14a45c`.
- Backend health/readiness: HTTP 200, database/object-storage/configuration ok.
- Untrusted dev-user header: HTTP 401; unrelated origin received no ACAO.

## Reproduced defects and repair boundaries

1. Quota rejection left an offline stroke only in memory while the HUD promised
   a local save. The repair reports failed durability, keeps a retryable queue,
   warns against closure, and clears the warning on durable/server recovery.
   It preserves journal keys and action/revision/idempotency semantics.
2. A server-owned but unstarted Premium work opened the six-example showcase
   instead of the chosen player. Both card paths now consult server ownership;
   progress or a payment intent cannot authorize Premium. Locked prefetches
   are avoided; the server read gate is unchanged.
3. Collection browse returned `access_type` without the `access` field used by
   Catalog. Its DTO now matches both fields, excludes maps/private original
   keys and reports tiled cell count from dimensions. Browse still grants no
   ownership; a non-owner's actual read remains HTTP 403.
4. Responsive Spark evidence required retired manual controls. It now verifies
   automatic use of the exact claimed token and server default, bounded changes
   and visible effect, reduced motion, and persistence/guidance after reload.

The four regression journeys are registered in critical pre-merge selection.
Extended topology remains twenty-four shards; existing measured durations and
assignments are preserved, new groups use the explicit 30000ms minimum weight.
The refreshed nominal inventory is 158 logical tests / 474 project cases.

## Verification policy

Use Node 22.23.2 / npm 10.9.8. Test databases and media stores are disposable;
the Premium owner E2E uses only the development internal-credit ledger. Real
Stars purchases, refunds, gate flips, uploads to production, migrations and
ownership mutations are outside this remediation.

Run the root unit suite, lint/build, server syntax/unit/integration suite,
catalog ownership and quota/replay journeys, migrated responsive Spark evidence,
and shard preflight. Obtain the required CI groups and full extended matrix
on the candidate before merge. Retries remain zero; do not skip or weaken an
assertion to make the release gate green.

This source records the baseline and repaired contracts, not an unperformed
production release. Future receipts and smoke must identify their exact SHA.
Physical Telegram iOS and real payment/refund evidence remain separate.
