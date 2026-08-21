# Upload and render abuse guardrails

The creator endpoint accepts browser-converted image payloads, so it is protected at both the request edge and the durable user boundary:

- `express.json` remains capped at 15 MiB globally; source images are rejected before decoding when the data URL exceeds 14,000,000 characters, and decoded private originals remain capped at 10 MiB.
- `POST /colorings/create` consumes the durable `abuse_counters` budget `colorings:create` after shape validation. The default is 10 successful-shaped attempts per 10 minutes per authenticated user. Override with `CREATE_UPLOAD_LIMIT` and `CREATE_UPLOAD_WINDOW_MS` when operating a different product tier.
- Private originals use an owner-scoped SHA-256 key. Re-uploading identical bytes reuses the object, and deletion removes it only after the final template reference disappears. A failed template transaction cleans up an unreferenced object.
- `POST /colorings/:id/render/retry` has a separate default budget of 3 resets per hour (`RENDER_RETRY_LIMIT`, `RENDER_RETRY_WINDOW_MS`). This keeps manual recovery from reopening render attempts indefinitely.
- Render outbox claims are hard-clamped to 16 jobs per worker call and retry budgets are clamped to six attempts. Leases and the unique `artwork_id` key still provide cross-worker claim and enqueue idempotency; canonical object keys are deterministic, so retries do not create new objects.

These controls intentionally do not replace deployment-level connection limits, object-store quotas, or account/device reputation. Those are operational follow-ups for a multi-region or unauthenticated upload surface.
