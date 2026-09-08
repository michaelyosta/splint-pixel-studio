# ADR-002: canonical artwork and private media

Status: CANONICAL
Authority: Stable artwork/media ownership and publication invariant.

Navigation: [../INDEX.md](../INDEX.md) · Current state: [../CURRENT_STATE.md](../CURRENT_STATE.md)

Decision recorded: 2026-08-02

The server derives the completed artwork from template cells and authoritative progress, encodes a deterministic PNG, stores immutable metadata, and publishes only a bounded media URL. Client-supplied `resultDataUrl` is ignored for truth and is not persisted as the artwork source.

Private originals use storage metadata and a non-public key. Public media is served through `/media/artworks/...` only after a public active post and `render_status=ready` are present. Object-storage credentials and private keys never enter feed DTOs.

If object storage is unavailable, the transaction remains durable but publication returns a retryable media error. This makes database state recoverable without claiming that an object was successfully uploaded.
