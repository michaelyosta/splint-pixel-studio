# Product simplification handoff

Status: local evidence is assembled. `PRODUCT_SIMPLIFICATION_READY` is **not**
declared.

Branch: `codex/product-simplification-showcase-profile`
Base: `71750de`
Scope: product IA simplification, contract migration, bounded local proof, and
handoff only. No deployment, merge, or production mutation is included.

## Product outcome

The primary information architecture is now exactly **Catalog / Create /
Profile**:

- Catalog is the cold-start and default discovery surface. It owns artwork-first
  discovery, curated Popular/New/Collections views, and collection deep links.
- Create is import-first. Upload prepares the recommended `512 × 512 / 16`
  colour preview; advanced controls start collapsed, manual drawing is no
  longer a primary hub action, and collection management is secondary owner
  management.
- Profile is the visual showcase and durable owner shelf for completed and
  created work. Public profile links remain content-first; opening, deletion,
  collection management, and owner publication remain available.
- Home, Feed/Community, Store, Achievements, visible recommendation/unlock
  journeys, and session-goal/XP/streak presentation are removed from the
  primary product surface. Their compatible server/security contracts remain
  dormant where required.
- Completion routes finished work to Profile or Catalog. The old publish-to-feed
  CTA and progression reward loop are intentionally absent; autosave and
  painting/persistence behavior remain.
- Premium entitlement is preserved as a neutral unavailable state. Telegram
  Stars and payment remain `OFF` / fail-closed.

The complete contract rationale and assertion mapping are in
`docs/PRODUCT_CONTRACT_MIGRATION.md`; the selected IA and profile direction are
in `docs/PRODUCT_SIMPLIFICATION_DESIGN.md`. No painting, persistence, upload,
authentication, authorization, storage, tiled rendering, or payment boundary
was intentionally weakened.

## Diagnostic shard map

`P/S/U` means passes / expected skips / unexpected. Counts marked `UNKNOWN`
were not present in the retained reporter artifacts and are intentionally not
reconstructed from inventory totals. `NONE` is the classification for a clean
PASS row.

| Shard | Result | Passes | Expected skips | Unexpected | Classification | Fix / reference |
|---:|---|---:|---:|---:|---|---|
| 1 | PASS | 3 | 3 | 0 | NONE | Catalog/accessibility evidence; `.last-run.json` |
| 2 | PASS | 4 | 5 | 0 | NONE | Input/visual evidence; `.last-run.json` |
| 3 | PASS | 11 | 4 | 0 | NONE | Accessibility/guided/stabilization evidence; `.last-run.json` |
| 4 | PASS | 12 | 3 | 0 | NONE | Creator/core-feel evidence; `.last-run.json` |
| 5 | PASS (rerun; initial RED retained) | 16 | 2 | 0 | HARNESS / RESOURCE PRESSURE | Initial canvas-readiness failure under five runtimes; rerun clean in `extended-shard-5-rerun/` |
| 6 | PASS | 11 | 7 | 0 | NONE | `extended-shard-6-run.log`; server metrics 0 errors |
| 7 | PASS | 14 | 4 | 0 | NONE | `extended-shard-7-run.log`; server metrics 0 errors |
| 8 | PASS | 17 | 1 | 0 | NONE | `extended-shard-8-run.log`; server metrics 0 errors |
| 9 | PASS | 15 | 3 | 0 | NONE | `extended-shard-9-run.log`; server metrics 0 errors |
| 10 | PASS | 17 | 4 | 0 | NONE | `extended-shard-10-run.log`; server metrics 0 errors |
| 11 | PASS (21 nominal) | UNKNOWN | UNKNOWN | 0 | NONE | `.last-run.json` and metrics are clean; exact P/S reporter split unavailable |
| 12 | PASS (21 nominal) | UNKNOWN | UNKNOWN | 0 | NONE | `.last-run.json` and metrics are clean; exact P/S reporter split unavailable |
| 13 | PASS (rerun; initial RED retained) | 17 | 4 | 0 | INTENTIONAL CONTRACT MIGRATION | Stale collections CTA documented and migrated; rerun clean |
| 14 | PASS | 17 | 4 | 0 | NONE | `.last-run.json`; server metrics 0 errors |
| 15 | PASS | 17 | 4 | 0 | NONE | `.last-run.json`; server metrics 0 errors |
| 16 | RED | 15 | 5 | 1 | HARNESS / RESOURCE PRESSURE | Zoom mismatch; fresh targeted Mobile Pixel proof `1/1` PASS |
| 17 | PASS (lower concurrency) | UNKNOWN | UNKNOWN | 0 | HARNESS / RESOURCE PRESSURE | Initial API startup pressure under five runtimes; completion rerun retained, exact P/S unavailable |
| 18 | RED | 16 | 2 | 3 | INTENTIONAL CONTRACT MIGRATION | Stale publish CTA across three projects; migration patch separate; targeted proof `1/1` |
| 19 | PASS | 19 | 2 | 0 | NONE | Local shard artifact; part of aggregate `111/15` |
| 20 | PASS | 17 | 4 | 0 | NONE | Local shard artifact; part of aggregate `111/15` |
| 21 | PASS | 19 | 2 | 0 | NONE | Local shard artifact; part of aggregate `111/15` |
| 22 | PASS | 19 | 2 | 0 | NONE | Local shard artifact; part of aggregate `111/15` |
| 23 | PASS | 20 | 1 | 0 | NONE | Local shard artifact; part of aggregate `111/15` |
| 24 | PASS | 17 | 4 | 0 | NONE | Local shard artifact; part of aggregate `111/15` |

The initial RED signals remain visible in the record: shard 5 was a readiness
race and its rerun was `16/2`; shard 13 was the stale collections contract and
its rerun was `17/4`. Shard 16 remains a full-shard `15/5/1` resource-sensitive
zoom failure despite the fresh targeted Pixel `1/1`; shard 18 remains
`16/2/3` until the separate intentional migration is verified.

The exact local evidence totals cover 300 cases: **249 pass / 47 expected skip /
4 unexpected**. Shards 1–4, 11–12, 14–15, and 17 retain unknown outcome splits
where reporter output is absent or incomplete. The manifest records the
corrected topology as 150 logical tests / 450 project cases with zero
missing, stale, duplicate, or unmatched inventory entries and fingerprint
`34859ccbe80a535b67a076386314f27c87592238921c0832eca99dcae4bb5bce`; this is
topology evidence, not a substitute for outcome counts.

## Local gates

All local gates recorded for this handoff are now GREEN. This does not make the
diagnostic local wave an authoritative extended matrix.

| Gate | Evidence-backed result | Boundary |
|---|---|---|
| Unit | `460/460` PASS | Local proof complete |
| Server | `402` PASS + `67` expected skips | Local proof complete |
| Build | PASS | Local proof complete |
| Release-critical E2E | `66/66` PASS across `26/14/13/13`; retries `0`; quarantine `0` | Local critical gate complete |
| Lint | PASS; warning budget `100/100`; exit `0` | Local corrective gate complete |
| Inventory | PASS; `150` logical / `450` project cases; missing `0`, stale `0`, duplicates `0`, unmatched `0` | Manifest fingerprint `34859ccbe80a535b67a076386314f27c87592238921c0832eca99dcae4bb5bce` |
| Contract audit | PASS; gaps `0`; suspicious `0`; preservation `NO/NO` | See migration/design docs |

Additional focused evidence:

- Owner preview defect is fixed: server test `1/1` and 390px E2E `1/1`.
- `/today` is bounded with `LIMIT 8`; focused server test `1/1`.
- Premium requirement is restored: unit `10/10`, E2E `1/1`, unauthorized response
  `403`, and Stars remain OFF/fail-closed.
- Session-goal evidence at 360px is `1/1`; retired goal state does not return
  through the legacy control query.
- The initial visual blocker is resolved with 15 retained screenshots across
  360px, 390px, and 430px (`docs/evidence/product-simplification-2026-09-01/`).
- DOM size and `/today` payloads are bounded. Full-list management/profile
  endpoints remain performance debt because a silent cap could hide user data;
  no silent cap is claimed as a completed solution.

## Evidence index

- Product decisions: `docs/PRODUCT_SIMPLIFICATION_DESIGN.md`.
- Contract replacement and assertion map:
  `docs/PRODUCT_CONTRACT_MIGRATION.md`.
- Corrected shard topology and inventory fingerprint:
  `docs/E2E_SHARD_LOAD_MANIFEST.json`.
- Local visual proof: `docs/evidence/product-simplification-2026-09-01/`.
- Local shard status, metrics, failure contexts, and retained line logs:
  `test-results/extended-shard-*` and `test-results/extended-shard-*-run.log`.
- New/updated focused contracts include
  `test/primary-ia-contract.test.js`,
  `server/test/colorings-today-limit.test.js`, and
  `e2e/product-simplification-evidence.spec.js`.

## Pending terminal blockers

This handoff intentionally does not close release readiness. The remaining
terminal steps are:

1. Review the final diff, then commit and push the intended branch.
2. Run one authoritative GitHub matrix at the final pushed SHA, including the
   extended gate; the local diagnostic wave is not authoritative extended
   GREEN.
3. Obtain two independent final reviews: Product Simplicity Review and Product
   Integrity Review; both must explicitly review contract preservation `NO/NO`.

There is no second local extended matrix claimed here. No production deployment,
merge, payment activation, or Stars enablement is implied.

## Handoff recommendation

Keep this branch and its evidence intact, complete the three terminal blockers,
then reassess `PRODUCT_SIMPLIFICATION_READY` from the exact pushed SHA. If the
full-shard contract migration for shard 18 or the resource-sensitive shard 16
still fails, classify and resolve those gates before any merge or deployment.
