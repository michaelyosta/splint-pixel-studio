# Product Phase 5 Decisions

## Scope

Phase 5 prepares a controlled monetization/distribution surface. It does not launch production payments, set final prices, or make irreversible business decisions.

## DECISION: One showcase premium pack

EVIDENCE: Existing collection metadata and Phase 4 content-quality gate; current catalog is intentionally small and unassessed Pixelization routes are not auto-promoted.

ALTERNATIVES: Expand catalog quantity; sell boosters or hints; expose every existing collection as paid.

WHY CHOSEN: A coherent pack tests desire for a finished creative object rather than willingness to buy acceleration.

RISK: Human willingness-to-buy and artistic preference remain unmeasured.

VALIDATION DEBT: Premium pack appeal, price sensitivity, and Telegram presentation.

REVERSIBLE: Yes; pack is fixture/content metadata and disabled payment state.

## DECISION: Telegram Stars as a disabled-by-default adapter

EVIDENCE: Existing internal Stars ledger and `PAYMENTS_MODE` fail-closed gate; production XTR lifecycle was not previously represented.

ALTERNATIVES: Treat client invoice callback as success; reuse internal credits as real Stars; activate payment mode during development.

WHY CHOSEN: Server-authoritative XTR order/payment/entitlement state can be tested without financial side effects.

RISK: Telegram Bot API staging/device behavior remains external validation debt.

VALIDATION DEBT: Sandbox webhook, real pre-checkout/payment/refund delivery, reconciliation operations.

REVERSIBLE: Yes; adapter and fixtures remain inert unless explicit production configuration is present.

## DECISION: Artwork result is the distribution object

EVIDENCE: Existing completion/share hooks and deep-link helpers; no internal social feed is needed for initial distribution.

ALTERNATIVES: Build a feed/marketplace; share only Home; use acquisition prompts detached from a specific work.

WHY CHOSEN: Before/after/final artwork gives Telegram a concrete reason to open Splint.

RISK: Native share/story recipient and bot `startapp` behavior require Telegram validation.

VALIDATION DEBT: Android/iOS WebView and recipient re-entry.

REVERSIBLE: Yes.

## Explicitly deferred

No battle pass, internal currency, consumable boosters, energy, paid hints, subscriptions, marketplace, social feed, new Special Cells, real payment launch, or final price decision.
