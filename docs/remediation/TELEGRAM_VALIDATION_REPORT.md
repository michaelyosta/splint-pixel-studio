# Telegram WebView validation report

Date: 2026-08-03  
Branch: `release/public-alpha-rc1`  
Initial HEAD: `7246358dd4fc958f8780ff24a7f8c1b617979e79`  
Final HEAD: `7246358dd4fc958f8780ff24a7f8c1b617979e79`  
New commits: none  
Verdict: `telegram_rc_partially_verified`  
Operational subtype: `operational_rc_verified_except_telegram`

## Scope and topology

- Frontend/API smoke used an ephemeral HTTPS Cloudflare Quick Tunnel to the local frontend ingress; the temporary hostname is intentionally omitted from Git.
- The public surface exposed only the frontend and its `/api` proxy path. PostgreSQL, MinIO, and administrative endpoints were not published.
- Local backend smoke used SQLite/local storage and development auth. This is not a production-like Telegram authentication environment.
- Docker Desktop was unavailable, so disposable PostgreSQL/MinIO staging was blocked and no production data or credentials were used.

## Authentication

| Case | Result | Evidence |
|---|---|---|
| Missing auth | PASS — local negative case | Protected request returned 401. |
| Altered hash | PASS — automated | Server auth suite. |
| Expired `auth_date` | PASS — automated | Server auth suite. |
| Future-skewed `auth_date` | PASS — automated | Server auth suite. |
| Real Telegram launch/initData | BLOCKED | The browser session was not Telegram; `window.Telegram?.WebApp` and `initData` were absent, and the UI showed `LOCAL`. |

No full initData, token, credentials, cookies, auth headers, personal identifiers, or messages are included in this report.

## HTTPS and browser smoke

- Frontend over HTTPS: PASS.
- `/api/live`: 200.
- `/api/ready`: 200 with local database/object storage checks.
- Browser catalog load: PASS.
- 32×32 player canvas: PASS; one active cell was painted through a real pointer click.
- Reload restoration: PASS; the acknowledged progress remained present after reload and reopening the artwork.
- Root `/live` and `/ready` exact production ingress routing: not claimed; the temporary Vite ingress serves the SPA at those paths rather than exposing the API health JSON there.

## Device and lifecycle matrix

| Platform | Device/OS | Telegram version | Result | Remaining risk |
|---|---|---|---|---|
| Android Telegram stable | Physical device unavailable | unavailable | `needs_device_validation` | Real launch, initData, lifecycle, network recovery, and 160×160 need validation. |
| iOS Telegram stable | Physical device unavailable | unavailable | `needs_device_validation` | Real launch, initData, lifecycle, network recovery, and 160×160 need validation. |
| Telegram Desktop | Not in scope for this pass | unavailable | `needs_device_validation` | Validate only if included in the release support scope. |
| Playwright Mobile iPhone | Emulated profile | n/a | Automated evidence only | Not a physical Telegram WebView. |
| Playwright Mobile Pixel | Emulated profile | n/a | Automated evidence only | Not a physical Telegram WebView. |

Background/foreground, pagehide, reload after active save, offline replay, network timeout, connection reset, account switch, and durable journal recovery remain blocked for real Telegram WebView validation.

## Canvas, completion, and social coverage

- Automated E2E covered creator/player flows, mobile emulation, and the 160×160 creator scenario. The 160×160 test passed in the full run.
- The full E2E run reported `109 passed, 4 skipped, 1 failed` out of 114. The failure was Mobile iPhone stabilization case 13b; isolated rerun passed `1/1` in 8.8 seconds. No source fix was made because the failure was not reproduced.
- Local browser smoke covered 32×32 only. Real 64×64, 120×120, and 160×160 Telegram device performance remains unverified.
- Canonical completion/publication/media integrity and social behavior remain covered by existing local/automated tests and prior disposable evidence; they are not reclassified as real Telegram device evidence by this pass.
- Real Telegram Stars remain disabled. No invoice or payment flow was invoked.

## Regression evidence

| Suite | Result |
|---|---|
| `npm ci` | PASS; 0 vulnerabilities |
| `npm --prefix server ci` | PASS; 0 vulnerabilities |
| `npm test` | 201 passed, 0 failed |
| `npm --prefix server run check` | 44 files passed |
| `npm --prefix server test` | 223 total: 167 passed, 56 skipped, 0 failed |
| `npm --prefix server run test:postgres` | 94 total: 40 passed, 54 skipped, 0 failed without PostgreSQL |
| `npm run lint` | exit 0; 89 warnings, 0 errors |
| `npm run build` | PASS |
| `npm run test:e2e` | 109 passed, 4 skipped, 1 full-run failure; targeted failure rerun 1 passed |
| S3 integration | 2 skipped because MinIO/Docker was unavailable |

## Defects and fixes

No confirmed Telegram WebView defect was reproduced. No application source file was changed and no fix commit was created. The single full-suite Mobile iPhone failure is recorded as a follow-up/flaky-run observation and was not promoted to a release blocker after the isolated pass.

## Remaining release blockers

1. Real HTTPS launch from Telegram with backend validation of real `initData`.
2. Physical Android Telegram stable main flow.
3. Physical iOS Telegram stable main flow, or an explicit owner decision to leave iOS `needs_device_validation`.
4. Real Telegram background/foreground, pagehide, reload, offline replay, and durable progress recovery.
5. Disposable PostgreSQL and MinIO evidence after Docker Desktop is available.
6. Final ingress verification for exact `/live`, `/ready`, CORS, proxy headers, trusted proxy, and production configuration.

No push, tag, pull request, deployment, BotFather URL change, production credential change, or Telegram Stars change was performed.
