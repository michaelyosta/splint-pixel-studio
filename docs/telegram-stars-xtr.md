# Telegram Stars (XTR) provider lifecycle

Status: CANONICAL
Authority: Detailed provider-shaped XTR lifecycle; production activation is a separate decision.

Navigation: [INDEX.md](INDEX.md) · Current state: [CURRENT_STATE.md](CURRENT_STATE.md)
Overview: [COMMERCE_CONTRACT.md](COMMERCE_CONTRACT.md)

The XTR path is isolated from the existing internal-credits ledger. The state machine lives in
`server/services/telegram-stars.js`. Production uses
`server/services/telegram-stars-bot-api.js`; the mock adapter remains test-only.
Migrations 026–031 create the durable order, event, payment, entitlement,
refund, reconciliation, support, purchase-gate, capture-inbox, uniqueness and
invoice-lease records.

`server/routes/telegram-stars.js` handles Telegram's root update shape,
including `pre_checkout_query`, `successful_payment`, and
`message.refunded_payment`. It requires the timing-safe Telegram secret-token
header. Production mounts it in a dedicated, bounded ingress outside the
general product rate-limit bucket. Authenticated Telegram updates bypass the
unauthenticated abuse bucket so a legitimate capture cannot be rejected by a
shared-IP limit.

## Activation boundary

The service factory still defaults to `enabled: false`. Production constructs
the real runtime only for `NODE_ENV=production` plus
`PAYMENTS_MODE=telegram_stars_controlled` and complete Bot API, webhook,
support and allowlist configuration. The environment remains controlled even
when the independent database gate is `public`; `PAYMENTS_MODE=telegram_stars`
and Test API environment values remain fail-closed.

The gate is read from the database for every config/order/invoice/pre-checkout
decision. `disabled` rejects all new purchases, `controlled` permits only the
configured users and products, and `public` permits every authenticated
Telegram user but still only configured products. Capture, refund, support,
order reads and reconciliation continue while the gate is disabled.

The product route that eventually creates an order must resolve the product and price on the server
from a catalog. The non-mock service requires a server product resolver and a server price resolver
(or a resolver that returns the price); unknown, unpublished, non-public, and non-premium products
are rejected. Request `amountXtr` is never used as a provider price. A client callback, client price,
image, or local entitlement flag is never accepted as proof of payment. The durable invoice payload
is an opaque `splint:xtr:v1:<order-id>` value and contains no secret or user message.

## State and authority

```text
invoice_pending -> invoice_issued -> checkout_pending -> paid
       |                 |                  |             |
       +-----------------+------------------+             +--> partially_refunded -> refunded
       |                                                        |
       +----------------------> cancelled ---------------------+
```

`pre_checkout_query` verifies the stored user, opaque invoice payload, currency `XTR`, and exact
server amount. It records the decision and answers Telegram. A repeated query/update replays the
same decision without a state change. A cancelled order rejects new pre-checkout approval.

`successful_payment` is the capture authority. Before projection it commits a
minimal immutable record keyed by `telegram_payment_charge_id` to the capture
inbox. It then verifies the order values and, in one transaction, records the
payment, moves the order to `paid`, and inserts exactly one entitlement.
Replays cannot create a second payment or entitlement. A capture that cannot be
projected disables new sales and remains recoverable/refundable rather than
being acknowledged without evidence.

Telegram numeric `update_id` values are normalized before they become durable event keys. A
non-consumable product has one active entitlement per user, and the unlock service projects active
XTR product ids into its canonical access facts. A second pre-checkout query for the same order is
rejected instead of approving two concurrent checkouts.

If the client times out and cancels after Telegram has captured the payment, a delayed
`successful_payment` is still accepted as provider truth. The order records
`paid_after_cancelled=true`, and the entitlement is granted once; this anomaly is visible to
reconciliation and support. A client cancellation never grants access by itself.

If a provider refund/reversal arrives before its capture update, the event is stored as a durable
pending tombstone. A later capture applies that refund in the same transaction and creates a
revoked (or partially refunded) entitlement, so reordered delivery cannot leave stale access.

## Refunds and support

Refunds are recorded against the immutable charge ID and an idempotent provider `refund_id`.
Provider refund requests first reserve their amount in `telegram_stars_refund_requests` while
holding the payment row lock, so two support retries cannot over-refund one remaining capture.
Partial refunds move the order to `partially_refunded` and keep the entitlement active. A full
refund moves it to `refunded` and revokes the entitlement. A refund larger than the uncaptured
remainder, a reused refund ID with different data, or a refund for another user is rejected.
`requestRefund` calls only the injected adapter and records the result; it cannot manufacture a
local refund when the provider call fails.

The Bot API has no refund idempotency parameter. `requestRefund` therefore uses
an atomic local claim: exactly one caller can invoke Telegram. An ambiguous
result is reconciled through `getStarTransactions` before any retry. Orphaned
captures use the explicit operator-only `refund-recovery` command, which has
the same claim/reconcile discipline and never bypasses the normal ledger for a
projected payment.

`buildTelegramStarsSupportContract()` exposes the `/paysupport` command, configured support and
refund contacts, and the accepted case fields. `openSupportCase` stores a bounded, idempotent case
without logging Telegram init data, bot tokens, or arbitrary raw update bodies.

## Reconciliation

`reconcile()` parses Telegram's documented `StarTransactions.transactions`
envelope, compares provider captures/refunds with local payments and the
capture inbox, and stores each run and issue. The production worker runs every
minute by default. Provider failure or any critical issue disables the purchase
gate automatically. Reconciliation never grants entitlement. Repeated runs are
read-only except for resolving a fully refunded orphan inbox row.

Operational commands (from the server directory):

```text
npm run telegram-stars:gate -- status
npm run telegram-stars:gate -- set disabled --reason=<incident>
npm run telegram-stars:gate -- set controlled --reason=<recovery>
npm run telegram-stars:gate -- set public --reason=<release> --confirm-public=TELEGRAM_STARS_PUBLIC
npm run telegram-stars:reconcile
```

Public activation is rejected if the reconciliation worker is explicitly
disabled. Full charge IDs and secrets belong only in the secure operator shell,
never routine logs or reports.

## Test coverage

The focused suites exercise server pricing, provider envelopes, one-shot and
deadline-bounded pre-checkout, duplicate/delayed/unknown captures, capture
recovery, reordered/native refunds, active-product and charge uniqueness,
invoice leases/TTL, refund races, gate CAS/kill-switch behavior, safe telemetry,
and reconciliation. PostgreSQL CI additionally runs two-connection gate and
refund races. These tests do not certify a real production charge/refund.

The legacy internal-credit collection purchase route cannot bypass the XTR
flow. Payout and marketplace settlement remain off. The historical pre-launch
owned production round-trip is consciously waived, not proven; the first real
user transaction is the production canary and must be observed through capture,
one entitlement, reopen state and reconciliation.
