# Post-recovery deploy smoke (2026-09-22)

Status: HISTORICAL
Role: EVIDENCE (dated deployment smoke record).
Authority: Historical material only. For current state see
[CURRENT_STATE.md](../CURRENT_STATE.md).

## Scope

Recovery release `5a829a7` (merge of PR #47 into `main`, head `4c0b439`).
Cloudflare Pages deployed the frontend from `main`; Render deployed
`splint-api`. Migration `033` (admin merchandising, order price backfill before
the immutable-order guard) ran as part of the server deployment.

This record contains no `initData`, tokens, cookies, or account data.

## Checked directly

| Check | Result |
| --- | --- |
| `https://pixel.showalove.ru/` | `200`, serves the app shell |
| Deployed bundle | `assets/index-Dwy-QySo.js` (628 449 bytes) |
| Bundle contains `Открыть в Telegram` | yes (browser handoff) |
| Bundle contains `meta/analytics/batch` | yes (batched telemetry transport) |
| Bundle contains `Войти через Telegram` / `/auth/telegram/start` | no (browser OIDC entry point removed) |
| Deployed CSS contains `flex: 1 1 0` | yes (equal thirds for the three primary buttons) |
| `https://splint-api.onrender.com/ready` | `200` `{"ready":true,"checks":{"database":"ok","object_storage":"ok","configuration":"ok"}}` after migration `033` |
| `GET /colorings` without credentials | `401` (fail-closed) |
| Telegram host with pending `initData` (WebKit 390x844) | no auth wall, three navigation buttons at x 12/134/256 with width 122 |
| Plain browser (WebKit 390x844) | handoff page, no navigation bar (unchanged behaviour) |

The navigation measurement reproduces the pre-release defect: the production
build at `7688461` measured three buttons of 73 px with roughly 49 px gaps
(the five-tab `width: 20%` rule on a three-tab bar). The release build measures
122 px buttons filling the 372 px bar.

## CI evidence

PR #47 head `4c0b439`: `33/33` checks success — `verify`, `postgres`,
`storage-s3-contract`, four `e2e-critical` lanes, 24 `e2e` shards, the `e2e`
gate, and Cloudflare Pages. `mergeable_state: clean`.

## Not covered here

- Physical Telegram iOS runtime behaviour remains `UNKNOWN`; see
  [TELEGRAM_IOS_VIEWPORT_DIAGNOSTIC.md](../TELEGRAM_IOS_VIEWPORT_DIAGNOSTIC.md)
  for the bounded physical protocol and PR #48 for the restored
  `?viewportDiagnostic=1` panel.
- No Telegram Stars transaction, refund, or payout was performed or activated.
