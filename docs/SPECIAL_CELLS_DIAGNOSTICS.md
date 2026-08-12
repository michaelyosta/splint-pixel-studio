# Special Cells QA Override and Server Diagnostics Contract

Status: server-side contract for development and staging QA. It does not
change production cohort assignment or the frozen event set/balance, and the
override never applies to every dev/staging user. User-facing special-cell
onboarding and hints coordinate through the normal treatment cohort field
(`specials_experiment_group`) only and never require the diagnostics payload.

## Manual QA override

`SPECIAL_CELLS_COHORT` is a development/test-only manual override. It is read
only by the QA helpers in `server/services/tiled-specials.js` and is never
persisted into the experiment assignment.

Allowed values:

- `SPECIALS_TREATMENT` (canonical treatment)
- `SPECIALS_CONTROL` (canonical control)
- `SPARK_TREATMENT` and `SPARK_CONTROL` (legacy aliases, still accepted)

The override is applied only when all of these hold:

- `ALLOW_DEV_AUTH=true`
- `NODE_ENV` is exactly `development` or `test` (a missing or typoed value is
  deliberately inert)
- `SPECIAL_CELLS_QA_OVERRIDE=true`
- `SPECIAL_CELLS_QA_USER_ID` contains the current authenticated dev user id
  (comma-separated values are accepted for a narrow QA allowlist)
- `SPECIAL_CELLS_COHORT` is one of the allowed values below

Leave `SPECIAL_CELLS_COHORT` empty for the unchanged deterministic
assignment. Invalid or unknown values are ignored and fall back to the
deterministic assignment. Non-allowlisted users in dev/test, unknown users,
and production always use the deterministic assignment regardless of the
value. `SPECIAL_CELLS_QA_OVERRIDE` and `SPECIAL_CELLS_DIAGNOSTICS` are
rejected by the production startup validator.

The override changes only which cohort is exercised for manual QA. It does
not change coordinate generation, event mix, densities, effect caps, pity
bookkeeping, or any other gameplay constant.

Use a disposable frontend dev identity for manual QA so the allowlisted user
is never a real Telegram account: set `VITE_ALLOW_DEV_AUTH=true` and a fresh
`VITE_DEV_USER_ID` in `.env.local`, then set `SPECIAL_CELLS_QA_USER_ID` to the
same value on the server. The client diagnostics HUD reports `cohort_override`
only when the server sees the matching `SPECIAL_CELLS_QA_USER_ID`.

## Server diagnostics payload

`special_diagnostics` is opt-in. It is included in coloring progress responses
and progress-action replays only when `SPECIAL_CELLS_DIAGNOSTICS=true` plus the
dev/test QA environment above are active; ordinary development, staging, and
production responses omit the object entirely. The contract is additive: new
QA-only fields may be added later, but existing fields are stable.

```json
{
  "cohort": "treatment",
  "cohort_override": false,
  "generation_version": 4,
  "placement_version": 4,
  "template_id": "template-id",
  "template_width": 160,
  "template_height": 160,
  "storage_mode": "legacy",
  "total_candidates": 5,
  "special_count": 5,
  "counts_by_kind": {
    "spark": 5,
    "bomb": 0,
    "fuse": 0,
    "choice": 0,
    "artifact": 0,
    "hazard": 0
  },
  "counts_by_status": {
    "unseen": 5,
    "offered": 0,
    "consumed": 0,
    "skipped": 0
  },
  "completed_cells": 0,
  "total_cells": 25600,
  "completed": false,
  "completed_at": null,
  "active_special_id": null,
  "pity_due": true,
  "cells_to_next_pity_boundary": 6000,
  "recent": []
}
```

Field contract:

- `cohort`: the actual cohort used for this user/template (`treatment` or
  `control`), after applying any dev-only override.
- `cohort_override`: whether a dev/test `SPECIAL_CELLS_COHORT` override is
  actually being applied for this process. Always `false` in production.
- `generation_version` and `placement_version`: placement generation
  persisted for the template.
- `template_id`, `template_width`, `template_height`, `storage_mode`:
  immutable template identity and layout used to interpret the diagnostics.
- `total_candidates` and `special_count`: total special markers persisted for
  the template.
- `counts_by_kind`: aggregate marker counts per frozen kind (`spark`, `bomb`,
  `fuse`, `choice`, `artifact`, `hazard`). It is a QA aggregate, never a list
  of positions.
- `counts_by_status`: aggregate per-user progress counts for `unseen`,
  `offered`, `consumed`, and `skipped`.
- `completed_cells`, `total_cells`, `completed`, `completed_at`: server-known
  completion state for the current progress row.
- `active_special_id`: id of the user's newest open offer, or `null`.
- `pity_due`: whether the next deterministic Spark pity offer is due
  (always `false` for the control cohort).
- `cells_to_next_pity_boundary`: completed cells remaining until the next
  pity boundary.
- `recent`: bounded, newest-first per-user status history for special markers
  (`special_id`, `kind`, `status`, `updated_at`). It contains no positions,
  offer tokens, option ids, or effect payloads.

## No-leak guarantees

The diagnostics contract intentionally exposes no gameplay secrets:

- No special cell positions, tile coordinates, local indices, or effect
  payloads.
- No offer tokens, option ids, or derived change lists.
- `counts_by_kind` is an aggregate only and never identifies which markers are
  where.
- `recent` exposes only the user's own status history and never includes
  position or token data.
- Control cohort diagnostics still return aggregate counts and pity
  bookkeeping, but `pity_due` is always `false`, the special tile payload is
  empty, `special_offer` is `null`, and forged special actions are rejected
  with `404 SPECIAL_COHORT_CONTROL`.

## Client diagnostics HUD

`src/features/coloring/SpecialCellsDevHud.jsx` renders an opt-in development
HUD/state dump on top of the coloring surface. It is invisible in production
and by default in development; enable it with
`VITE_SHOW_SPECIAL_CELLS_DIAGNOSTICS=true` (or the existing
`VITE_SHOW_COLORING_DIAGNOSTICS=true`) in `.env.local`. During local
development only, `?specialDiagnostics=1` on the Vite URL toggles the same HUD
without rebuilding; the query never changes cohort assignment, which remains
server-env authoritative. Set `SPECIAL_CELLS_DIAGNOSTICS=true` in the same
QA environment to receive the server payload; without it the HUD degrades
honestly to client-visible state and reports server fields as absent. The HUD combines the server payload above with
client-visible tile metadata, the current guidance target,
discovered/active-offer state, recent targets, pity, the last recorded special
error, and Telegram WebApp capability. It never changes gameplay or save
state; it only reads state and can copy a JSON dump to the clipboard.
The HUD explicitly distinguishes server candidate counts from the bounded
metadata actually loaded into the client, and shows current target special
counts/types even when they are zero. Telegram diagnostics include vertical
swipe API support, whether protection is currently applied, the observable
previous/current swipe state, version/platform, and fullscreen/expanded/viewport
fields when the WebView exposes them. The offer is represented only as a
boolean `has_token`; token values, marker ids, indices, tile coordinates,
option ids, chain/effect payloads, and derived target coordinates are never
included in the HUD, dump, or analytics. Marker coordinates exist transiently
inside the client only to compute resident-cache and current-target aggregate
counts, then are stripped before the public snapshot is produced.

## Verification

- Unit: `server/test/tiled-specials.test.js` covers canonical/legacy aliases,
  exact dev/test environment gating, allowlisted/non-allowlisted users,
  production inertness, stable diagnostics keys, and production rejection of
  the QA flags. `server/test/config.test.js` verifies the production startup
  validator rejects `SPECIAL_CELLS_QA_OVERRIDE` and
  `SPECIAL_CELLS_DIAGNOSTICS`.
- Integration: `server/test/tiled-specials.integration.test.js` starts real
  API processes with `SPECIALS_TREATMENT`/`SPECIALS_CONTROL`, verifies
  allowlisted override gating, diagnostics omission without the explicit flag,
  control metadata isolation, and forged-action rejection.
