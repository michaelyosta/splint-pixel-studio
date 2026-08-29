# PRODUCT-PHASE-5 — Final Autonomous Handoff

Status: `SUCCESS_WITH_VALIDATION_DEBT`

This handoff closes the bounded Phase 5 scope. It prepares a controlled product,
distribution, and monetization surface without enabling production payments,
choosing a final price, or starting a new functional phase.

## 1. Premium pack prototype

One showcase pack, **«Ночная орбита»**, is coherent end to end as a product
preview. It contains two curated scenes (`color_premium_whale` and
`color_premium_dragon`), bounded preview metadata, artwork descriptions,
duration/complexity/quality labels, and preview/locked/owned/paid/unavailable
state handling. Catalog, premium preview, Store, Gallery, and artwork detail
use the same content contract. Entitlement is read from the server; a local
wish/save action never unlocks content. The default `PAYMENTS_MODE=disabled`
keeps the pack preview-only.

Reload and device restore use the server unlock snapshot. A stale local “saved
wish” or client callback cannot turn a locked pack into an owned pack.

## 2. Authoritative content metadata

`content-metadata.v1` is now the authoritative presentation contract wherever
the server can provide evidence. `/colorings`, artwork detail, `/colorings/mine`,
recommendations, Director, and `/meta/collections` carry the bounded metadata.
Catalog, Gallery, Home/Resume, premium preview, Store, player context, and
completion surfaces render it without silently reconstructing promises from
legacy dimensions or `est_minutes`.

Missing or mismatched schema is shown as `Метаданные не проверены`; mixed packs
explicitly say that sessions or complexity are mixed. Tiled work is labelled
segmented instead of receiving a misleading short-artwork promise. Regression
coverage includes client helpers, pack aggregation, server quality metadata,
Director/recommendations, and API projections.

## 3. Telegram Stars XTR architecture

The provider-shaped state machine lives in
`server/services/telegram-stars.js`. The mock adapter is the only shipped
provider. Migrations `026`, `027`, and `028` persist orders, provider events,
invoice leases, refund deduplication, and reconciliation facts. The webhook
factory is secret-token guarded but deliberately unmounted; the normal server
bootstrap does not expose it. `PAYMENTS_MODE=disabled` is the default and
production `telegram_stars` configuration fails closed until a release wires a
real provider.

The authoritative chain is:

```text
server product/price resolver
  → durable order + opaque payload
  → provider invoice
  → one-shot pre_checkout validation (XTR, amount, user, product)
  → Telegram successful_payment event
  → durable payment + entitlement transaction
  → canonical unlock projection
  → reload/device restore
  → reconciliation/support
```

The request amount is never used as a non-mock provider price. Product identity,
publication, visibility, premium status, and user ownership are server-owned.
Telegram numeric `update_id` values are normalized safely. The client invoice
callback is not payment authority, and the internal `stars_balance` ledger is
not treated as Telegram Stars.

## 4. Payment state machine and guarantees

Orders move through `invoice_pending → invoice_issued → checkout_pending → paid`,
with durable cancellation and `partially_refunded/refunded` outcomes. A second
distinct pre-checkout query cannot be approved for the same one-time order.
Same-event replays are idempotent. Delayed provider success after client close
is accepted as provider truth and marked as an anomaly. Wrong currency, amount,
product, user, payload, stale order, charge reuse, and immutable-charge changes
are rejected.

One active entitlement per user/product is enforced by the database and checked
transactionally. Active XTR entitlements are projected into the canonical unlock
facts used by direct-ID reads, collections, Gallery, and reload. A refund revokes
that access; it cannot leave a stale premium route open.

## 5. Adversarial findings and fixes

The independent payment red team reproduced ten real issues before the final
hardening pass, then a second review found additional refund, order, invoice,
and revoked-content paths. The integrated fixes cover numeric Telegram IDs,
client-price/product fallback, forged service callbacks if mounted incorrectly,
legacy-credit bypass, duplicate pre-checkout approval, refund-before-capture
loss, refund double-counting, disconnected unlock facts, duplicate one-time
orders, invoice issuance races, stale invoices, repurchase after refund,
revoked `/colorings/mine` exposure, refund crash-window replay, and optimistic
Store success. The fixes are covered by provider-contract, unlock, config,
HTTP, and Store tests.

The webhook remains intentionally unmounted, so a client cannot reach the
service in the current release. This is a release boundary, not a claim that a
real Telegram webhook has been certified.

## 6. Refund, support, and reconciliation

Refunds use immutable `telegram_payment_charge_id` and durable provider
`refund_id`/idempotency keys. Partial refunds keep access active; full refunds
revoke it. A refund received before capture is stored as a tombstone and applied
when capture arrives, preventing reordered delivery from granting access.
Concurrent support retries reserve the remaining amount under the payment row
lock. Support cases are bounded and idempotent. Reconciliation compares provider
captures with local payments and records missing, duplicate, mismatched,
payload, and submitted/failed refund-recovery facts without auto-granting
access. Polling a real provider's refund status remains an operations follow-up
because no real adapter is mounted.

## 7. Store UX

The bounded Store presents free, owned, paid-showcase, loading, error/retry,
invoice-opened, pending-confirmation, cancelled, failed, restored, and refunded
checkout states through a pure reducer. Progression-locked content remains in
the neutral locked/unavailable unlock view; malformed/private/unpublished rows
are filtered rather than shown as dead-end cards. A paid card shows its Stars
price and explicitly says payments are disabled in the current environment.

The Store only considers a purchase successful when the adapter reports a
server-confirmed entitlement. `success: true` from a client callback alone is
insufficient. The application currently passes `paymentsMode="disabled"` and
does not expose an order/invoice endpoint; this is deliberate fail-closed
behavior. Browser evidence covers locked/disabled/deep-link UX and pure state
transitions, while provider-contract tests cover order→payment→entitlement.
After reload, the server unlock snapshot restores ownership.

## 8. Telegram distribution

Artwork result is the share object. Completion links carry the specific artwork
and optional pack; pack links open the relevant Store pack rather than generic
Home. Telegram share, Web Share, and copy-link fallbacks are bounded and keep
identifiers only. Before/after/transformation hooks remain compatible with the
existing completion architecture. Native Android/iOS recipient re-entry and
story/media behavior are validation debt, not simulated as proven.

## 9. Abuse and scale safeguards

Implemented P0/P1 safeguards are intentionally small:

- 15 MiB JSON/request ceiling, 14M-character source guard, and 10 MiB decoded
  private-original cap;
- durable per-user create budget (default 10 shaped attempts per 10 minutes);
- separate render-retry budget (default 3 per hour);
- owner-scoped SHA-256 original keys and safe shared-object deletion;
- idempotent render-outbox claims, max 16 jobs per worker call, six retry
  attempts, bounded leases, and deterministic canonical object keys.

Deployment-level connection/object-store quotas, device reputation, multi-region
traffic shaping, and full cost telemetry remain explicit operational follow-up,
not an overbuilt anti-abuse platform in this slice.

## 10. Pixelization status

The safe default remains `classic`. `paintable-v1` is not globally promoted.
The current evidence permits only exact artwork/resolution routes for
`illustration-paint-brush @ 192×192` and `landscape-utah-dunes @ 512×512`.
The other 12/14 paired comparisons remain `classic + human-review`.

Measured evidence: 512 paintable reduced structural effort in all seven cases,
median `-51.1%`, but edge recall declined in five; 192 median effort improved
`-17.9%` but two candidates became materially harder (`+40.6%` and `+22.4%`
more taps). 1024/1200 are explicitly limited rather than upscaled. A local 512
quality pass was approximately 818 ms and 114.8 MB RSS; this is not a physical
iPhone performance claim. Artistic preference, number readability, edge-detail
trade-offs, and device feel remain open debt.

## 11. Verification matrix

| Area | Evidence |
| --- | --- |
| Root unit/integration | `npm test`: **453/453 pass** |
| Server suite | `server npm test`: **396 pass, 0 fail, 65 skipped** (461 total; PostgreSQL/S3 environment skips) |
| XTR provider contract | **22/22 pass** |
| Canonical unlock / HTTP | **47/47 combined HTTP/unlock/Stars pass** |
| Store reducer/pack model | targeted client/store tests pass; browser Store remains disabled-by-default |
| Upload/render abuse | **20/20 pass** targeted; full server suite also pass |
| Migration regression | **51 pass, 0 fail, 26 skipped** |
| Phase 2/Recovery/Unlock Chromium E2E | **13/13 pass** after metadata/payment hardening |
| 1200 tiled accessibility E2E | **1/1 pass** after making the indexed creator flow deterministic |
| Pixelization recommendation | **5/5 pass**; memory benchmark pass with explicit 1200 limit |
| Build | `npm run build` pass; 656.10 kB main chunk warning remains |
| Lint | pass; existing warning budget **94/100** |
| Diff hygiene | `git diff --check` pass |

The repaired full Chromium legacy matrix completed at **102 passed, 31 failed,
10 skipped** in 29.8 minutes. The failures are concentrated in the pre-existing
Special Cells, stabilization, creator-preview, and visual-capture suites (for
example old 0..3 creator range assumptions and out-of-scope Special-event
fixtures); they are not evidence of a Phase 5 payment/entitlement failure.
Phase 5 targeted E2E is the release-relevant gate and is rerun after the final
metadata/payment changes. This does not change the payment or product release
boundary.

## 12. Performance and security evidence

Stroke/tile hot paths, bounded tile reads, offline/reload behavior, server
revision/idempotency, and 1200 representation tests remain green. Visual and
payment effects do not run in the core input hot path. Build output retains the
pre-existing single-chunk warning; no new unbounded grid/DOM path was added.

Security is fail-closed for production payments: no Bot API adapter, real
invoice sender, refund client, mounted webhook, or public payment mode exists
in this checkpoint. The mock state machine is server-authoritative and
adversarially covered, but it is not evidence of a real Telegram provider SLA.

## 13. Git and remote state

Integration branch: `codex/product-phase-2-autonomous`.

The dirty primary checkout `C:\Users\misa\Desktop\Splint-Gemini` was not
modified. The Phase 5 work was integrated as logical commits on the isolated
branch, including premium pack, Store/share, content metadata, abuse guards,
XTR, security hardening, migration expectations, and E2E contract repairs. The
branch is pushed only as a feature checkpoint; `main` is not merged or changed.

The final handoff commit and remote SHA are recorded after the last verification
run. Generated legacy E2E screenshots are not included in the feature
checkpoint.

## 14. What remains deliberately off

No production Stars charges, final price, subscriptions, internal currency,
energy, boosters, paid hints, battle pass, daily pressure, marketplace, social
feed, new Special Cells, Bomb promotion, or global Pixelization switch was
enabled. `spark_choice` remains the provisional Phase 2 baseline; `spark_auto`
remains the challenger; Bomb is not promoted.

## 15. Validation debt

See [`VALIDATION_DEBT.md`](./VALIDATION_DEBT.md). Open debt is limited to:

- human appeal/willingness-to-buy and price sensitivity for the one showcase;
- real Telegram Bot API sandbox, physical Android/iOS WebView, recipient re-entry,
  native share/story behavior, refund SLA, and support operations;
- a browser-integrated Store→order→invoice→poll path (the current app is
  intentionally disabled-by-default; the server/provider contract is tested
  independently);
- real retention/return behavior and 8–12 player perceived authorship;
- artistic/device verdict for Pixelization and 1024/1200 content;
- hostile public traffic, cost telemetry, deployment quotas, legal, and launch
  operations;
- the 31 out-of-scope failures in the legacy full Chromium matrix (102 passed,
  10 skipped) remain a separate stabilization backlog.

None of these is a blocker for the disabled-by-default local/agent slice. They
do block public monetization claims and irreversible production activation.

## 16. Owner-only decisions

The owner is needed only for real-world decisions Codex cannot safely make:

1. choose a production price and approve a business/payment launch;
2. provide/approve Telegram Bot API sandbox and operational support ownership;
3. run physical Telegram Android/iOS and human artwork/retention validation;
4. approve the artistic Pixelization route and public content set;
5. approve legal, refund policy, monitoring, and production rollout.

All reproducible route, reload, payment-state, entitlement, abuse, build, and
E2E checks have already been run by Codex or are included in the verification
matrix.

## 17. Terminal decision

`SUCCESS_WITH_VALIDATION_DEBT`

Phase 5 is complete for the work that can be proven locally and by independent
agent review. No PRODUCT-PHASE-6 work is started automatically.
