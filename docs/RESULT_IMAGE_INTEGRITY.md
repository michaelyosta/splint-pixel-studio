# Result image integrity

Status: CANONICAL
Authority: Completed-artwork media and publication invariant.

Navigation: [INDEX.md](INDEX.md) · Current state: [CURRENT_STATE.md](CURRENT_STATE.md)
Related: [adr/ADR-002-canonical-artwork-and-media.md](adr/ADR-002-canonical-artwork-and-media.md) · [remediation/RENDER_OUTBOX_CHECKPOINT.md](remediation/RENDER_OUTBOX_CHECKPOINT.md)

## Contract

The server is authoritative for a completed artwork. It derives the canonical
PNG and thumbnail from the immutable template, palette, and server-verified
progress. Client-supplied `resultDataUrl` or preview bytes are never the source
of truth and are not persisted as the canonical artwork.

Progress is submitted as bounded actions. The server validates indexes, target
colours, ownership, and revision/concurrency rules; the retired full-map PUT
contract must not be restored. Completion and artwork identity are idempotent.

## Media lifecycle

```text
verified completion
→ durable artwork metadata + render_outbox job
→ canonical full image and thumbnail written to private/object storage
→ both writes confirmed
→ artwork/render job marked ready
→ publication/download allowed
```

`render_status` is not a cosmetic field. A pending, retry, failed, or dead
render is not publishable. Storage failure leaves durable database state and a
recoverable outbox job; the API returns a retryable error instead of claiming a
ready result. See the render-outbox contract for leases, bounded retries, and
manual recovery.

## Storage and access

Private creator originals use owner-scoped metadata and non-public storage
keys. Public artwork media is served only through the server media boundary
after the owner/public-post and `render_status=ready` checks. Storage
credentials, private keys, and raw source payloads never enter public DTOs,
logs, screenshots, or documentation.

## Evidence and limits

The relevant implementation is in
`server/services/canonical-renderer.js`,
`server/services/render-outbox.js`, and
`server/routes/colorings.js`; coverage is in the canonical-renderer,
render-outbox, API, and publication tests. This document records the intended
contract, not a production deployment claim. Current production state remains
in [CURRENT_STATE.md](CURRENT_STATE.md).

Do not weaken server authority to make a UI, E2E, or commerce flow pass. If a
render or storage defect is found, classify it as a defect/debt and preserve
the fail-closed publication boundary.
