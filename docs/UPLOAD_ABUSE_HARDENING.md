# Upload abuse hardening roadmap

Status: future production plan. This pass does not change upload behavior.

## Current controls

- creation requires an authenticated user;
- the global limiter defaults to 100 requests per IP per minute;
- JSON bodies are limited to 15 MB;
- artwork grids are bounded to 1200x1200 and palettes to 32 colors;
- previews are PNG data URLs limited to 300 KB;
- originals accept PNG/JPEG/WebP, are decoded server-side, and are capped at
  10 MB; PNG dimensions are also bounded to 4096x4096 / 16.7M pixels;
- original objects are private and owner-scoped; generated public media uses
  server-owned keys;
- public legacy templates pass the component/checkerboard/merge-cost budget;
- render jobs already have an outbox instead of relying only on the request.

These controls limit one request, but they do not limit cumulative storage,
duplicate content, account farms, or repeated expensive tiled generation.

## Threats and prioritized controls

### P0 — per-account creation budget and endpoint backpressure

Add a dedicated limiter for `/colorings/create`, keyed by authenticated user
and secondarily by IP. Start with a conservative rolling quota plus a small
burst allowance. Before storing the original or opening the template
transaction, reject when the account exceeds active-template count, daily
create count, stored-original bytes, or outstanding render jobs.

Verifier: concurrent create integration tests prove 429/quota responses, no
orphan object is written on rejection, and ordinary progress traffic is not
charged to the upload budget.

### P0 — resource reservation and cleanup

Reserve estimated cells, original bytes, and one render slot atomically before
processing. Mark the reservation complete only after template and object keys
commit. Expire abandoned reservations and sweep orphaned originals. Deletion
must decrement/account bytes idempotently.

Verifier: crash-after-upload and crash-before-DB-commit fixtures leave either
one recoverable reservation or a swept object, never unmetered storage.

### P1 — exact-content deduplication

Compute SHA-256 over validated original bytes and a canonical template digest
over dimensions, palette, and cell/tile payload. Reuse an owner-scoped object
when identical input is uploaded again; across owners, store only a shared
opaque blob reference if privacy and deletion semantics are explicit. Do not
expose whether another user owns the same image.

Verifier: repeated uploads do not multiply object bytes or render work, while
two owners cannot read one another's private metadata or infer ownership.

### P1 — format-complete image validation

PNG currently receives structural/dimension validation; JPEG/WebP only receive
container signatures. Decode every accepted format with a bounded image
decoder, enforce pixel/dimension/color-profile/frame limits before persistence,
strip metadata, and reject animated or decompression-bomb inputs.

Verifier: malformed, truncated, oversized-pixel, huge-EXIF, animated, and
decompression-bomb fixtures fail before object storage.

### P1 — bounded tiled complexity and job cost

Apply a streaming/tile-aware complexity budget to tiled maps instead of
building a 1.44M-cell full array. Price a job by cells, colors, estimated
components/windows, and render output pixels. Admission and worker queues must
use that cost, with per-user outstanding-cost limits and global backpressure.

Verifier: adversarial 1200 checkerboards stay bounded in memory/time and are
rejected or queued without starving normal paintings.

### P2 — near-duplicate and spam response

Add a perceptual hash only after exact dedup metrics show meaningful abuse.
Use it for moderation/rate escalation, not silent cross-user replacement.
Require stronger account age/Telegram trust or manual review when upload
velocity, duplicates, reports, or render cost cross thresholds.

Verifier: a labeled near-duplicate corpus measures false positives before any
automatic block is enabled.

### P2 — lifecycle and monitoring

Define lifecycle rules for deleted/private originals, abandoned drafts,
generated previews, and failed render artifacts. Monitor creates/user/day,
bytes stored, dedup ratio, rejected cost, queue age, worker time, orphan sweep,
and top users/IPs without logging original image data.

## Rollout order

1. Instrument counters without enforcement.
2. Add per-user create/outstanding-job quotas in report-only mode.
3. Enforce P0 reservations and endpoint backpressure with a kill switch.
4. Add exact SHA-256 dedup and orphan sweeps.
5. Harden JPEG/WebP decode and tiled complexity admission.
6. Consider perceptual hashing only from observed abuse data.

Owner decisions required before implementation: quota values, retention
periods, whether blobs may deduplicate across owners, and the appeal/moderation
policy. No Special Cells gameplay rule depends on this roadmap.
