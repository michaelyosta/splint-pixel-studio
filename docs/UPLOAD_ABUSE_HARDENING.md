# Upload abuse hardening roadmap

Status: bounded Phase 5 safeguards implemented; deployment-scale controls remain
an explicit production roadmap. The current slice changes upload admission and
render retry behavior only within conservative, server-owned budgets.

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

Phase 5 additionally enforces a durable per-user create budget, a render-retry
budget, owner-scoped SHA-256 original keys, safe shared-object deletion,
bounded render-outbox claims/leases/retries, and deterministic canonical render
objects. These controls limit obvious cost amplification without pretending to
be a complete public anti-abuse platform. They do not yet provide deployment-
level quotas, device reputation, perceptual-hash moderation, or full cost
telemetry.

## Threats and prioritized controls

### P0 — per-account creation budget and endpoint backpressure

Status: **implemented in bounded form**. `/colorings/create` reserves a
durable actor-keyed window (default 10 shaped attempts per 10 minutes) before
expensive work; render retries have a separate default budget of 3 per hour.
The values are intentionally conservative pilot defaults and still require
operational tuning before public launch.

Remaining before public scale: extend the bounded limiter with active-template
count, daily create count, stored-original bytes, and outstanding render-job
quotas, plus deployment-wide backpressure and an operational kill switch.

Verifier: concurrent create integration tests prove 429/quota responses, no
orphan object is written on rejection, and ordinary progress traffic is not
charged to the upload budget.

### P0 — resource reservation and cleanup

Status: **partially implemented**. Input/file bounds, owner-scoped object
keys, safe deletion, bounded outbox claims, leases, and retry caps are live;
crash-recovery reservation sweeps and deployment-wide storage quotas remain
roadmap items.

Remaining before public scale: reserve estimated cells, original bytes, and one
render slot atomically before processing; expire abandoned reservations and
sweep orphaned originals. The current slice already bounds inputs, keys,
leases, retries, and deletion but does not claim a full reservation ledger.

Verifier: crash-after-upload and crash-before-DB-commit fixtures leave either
one recoverable reservation or a swept object, never unmetered storage.

### P1 — exact-content deduplication

Status: **implemented for owner-scoped original bytes**. SHA-256 keys prevent
the same owner from multiplying original objects; cross-owner perceptual
deduplication is intentionally deferred until privacy and false-positive
evidence exists.

The current slice computes SHA-256 over validated original bytes and reuses an
owner-scoped object when identical input is uploaded again. Remaining before
public scale: decide whether a canonical template digest or cross-owner opaque
blob reference is safe; do not expose whether another user owns the same image.

Verifier: repeated uploads do not multiply object bytes or render work, while
two owners cannot read one another's private metadata or infer ownership.

### P1 — format-complete image validation

Status: **partially implemented**. PNG receives structural/dimension checks;
JPEG/WebP and animation/decompression-bomb validation remain release debt.

PNG currently receives structural/dimension validation; JPEG/WebP only receive
container signatures. Decode every accepted format with a bounded image
decoder, enforce pixel/dimension/color-profile/frame limits before persistence,
strip metadata, and reject animated or decompression-bomb inputs.

Verifier: malformed, truncated, oversized-pixel, huge-EXIF, animated, and
decompression-bomb fixtures fail before object storage.

### P1 — bounded tiled complexity and job cost

Status: **roadmap**. The current 1200 path is tile-bounded and the render
outbox is capped, but a streaming cost admission model and global queue
backpressure are not claimed as complete.

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
