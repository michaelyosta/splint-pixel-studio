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

## Candidate full-matrix camera readiness evidence

The first candidate's required PR checks succeeded, while full dispatch run
36923276855 failed only extended shard 16 and the aggregate gate. Its long
special-cell journey measured a pointer point during idle/overview, before the
initial Director reached READY. The trace targeted Spark cell 2259 but sent a
valid ordinary paint for cell 12559 without a special action; increasing a
response timeout cannot repair that missing claim.

The verifier now waits for the initial READY state before mode/navigation,
checks free-exploration and reveal mode, and asserts that the real pointer
claim contains the exact selected cell. Minimap navigation and single-click
activation are retained; no test retries, sleeps or skip changes are added.
Focused Chromium and Pixel runs passed. A keyboard-navigation experiment did
not solve the pointer case and was discarded; it is not passing evidence.

The affected local shard also exposed a separate observer race in the classic
completed-colour verifier: it saw `focusingTarget`, but its subsequent disabled
assertion ran after `ready` resumed. A pre-armed composite DOM condition now
observes both existing invariants together; final readiness/target assertions
are retained. No animation duration or product code changes are involved.
The complete affected shard passed locally: sixteen passed, five existing
browser-specific skips, zero retries and zero failures.
