# iOS diagnostic delivery — ready for physical Telegram validation

Date: 2026-09-04  
Status: `IOS_READY_FOR_PHYSICAL_VALIDATION`  
Worktree: `codex/telegram-ios-viewport-fix`  
Diagnostic SHA: `4e729b50652e79af8ab58bb40552767afbed408e`

This is a delivery handoff only. No physical measurements, causal defect
classification, CSS fix, production deployment, BotFather production change,
or payment action is claimed.

## Shared preview delivery

The current shared disposable preview is an accountless Cloudflare Quick
Tunnel serving the exact diagnostic worktree:

| Field | Value |
| --- | --- |
| Preview URL | `https://relationship-sound-varieties-fax.trycloudflare.com/?viewportDiagnostic=1` |
| Deployment id | `quick-tunnel:relationship-sound-varieties-fax.trycloudflare.com` |
| Created | `2026-09-04T00:53:16Z` |
| Local time | `2026-09-04T05:53:16+05:00` |
| Source SHA | `4e729b50652e79af8ab58bb40552767afbed408e` |
| Pages project | `splint-pixel-studio` remains unchanged |
| Production origin/bot/DNS | unchanged |

The tunnel is ephemeral and must remain running during the human capture.
It is an allowed test-only delivery path, not a production or durable staging
deployment. The Pages feature branch was pushed as
`codex/telegram-ios-viewport-fix`, but its Pages alias is not currently
reachable; no Pages credentials are available to force a direct upload.

## Reachability evidence

Checked at `2026-09-04T06:04:24+05:00`:

| URL | HTTP | Result |
| --- | ---: | --- |
| Preview `/api/health` | 200 | `status=ok` |
| Preview `/api/live` | 200 | `status=alive` |
| Preview `/api/ready` | 200 | database/object storage/configuration all `ok` (disposable development API) |
| Preview diagnostic route | 200 | static pages `4/4`, auto-cycle `4/4`, secret markers `none` |
| Existing Render `https://splint-api.onrender.com/health` | 200 | existing service health baseline |
| Existing Render `/live` and `/ready` | 200 | existing service health baseline |

The preview API is a disposable local SQLite process behind the tunnel, with
`PAYMENTS_MODE=disabled`, no production database, no production storage, and
no production credentials. The existing Render service was read-only health
checked; it was not reconfigured or used for writes. Commerce should consume
this same preview URL rather than creating a second Telegram setup.

## Test-bot configuration

Use a dedicated Telegram Test Server account and a bot created in that
environment. Do not use the production bot or open the preview as an ordinary
Telegram browser URL.

1. On iOS Telegram, open Settings, tap the Settings icon ten times, choose
   Accounts, then Log in to another account and choose Test.
2. In that Test Server account, open `@BotFather`, send `/newbot`, and
   create a dedicated test bot. Keep its token outside Git, chat, screenshots,
   logs, and shell history.
3. Configure the bot's Main Mini App in `@BotFather`:
   `/mybots` → select the test bot → Bot Settings → Configure Mini App /
   Enable Mini App → set the URL to the preview URL above.
4. Configure a test-only menu button either with `@BotFather` → `/setmenubutton`
   → select the bot → button text → the same preview URL, or with the
   fail-closed helper below.
5. The Main Mini App/profile Launch app path and the menu-button path both count
   as a Telegram Mini App launch. A pasted URL in Safari, Chrome, or Telegram's
   ordinary browser does not count.

The one-shot helper reads the test token from process environment only,
verifies the expected bot identity with `getMe`, rejects production hosts,
uses `/test/` Bot API methods when requested, and never prints or writes the
token:

```powershell
$env:SPLINT_TELEGRAM_TEST_SERVER = 'true'
$env:SPLINT_TEST_MINI_APP_URL = 'https://relationship-sound-varieties-fax.trycloudflare.com/?viewportDiagnostic=1'
$env:SPLINT_EXPECTED_TEST_BOT_USERNAME = '@your_dedicated_test_bot'
$env:SPLINT_TEST_BOT_CONFIRM = 'I_UNDERSTAND_TEST_BOT_ONLY'
# Supply SPLINT_TELEGRAM_TEST_BOT_TOKEN from the local secret manager for this
# process only; do not paste it into chat, Git, or this document.
node scripts/configure-telegram-test-mini-app.mjs
Remove-Item Env:SPLINT_TELEGRAM_TEST_BOT_TOKEN,Env:SPLINT_TELEGRAM_TEST_SERVER,Env:SPLINT_TEST_MINI_APP_URL,Env:SPLINT_EXPECTED_TEST_BOT_USERNAME,Env:SPLINT_TEST_BOT_CONFIRM -ErrorAction SilentlyContinue
```

For the isolated Telegram Test Server, the Bot API endpoint is
`https://api.telegram.org/bot<token>/test/METHOD_NAME`. The helper only
configures the default menu button; Main Mini App configuration remains the
explicit BotFather step.

## One-page iPhone action

After the dedicated test bot opens the preview, perform this exact sequence on
the same physical iPhone:

1. Launch the Mini App cold from the test bot's Main Mini App/profile button or
   menu button. Confirm the diagnostic panel is visible and capture one full
   four-page cycle.
2. Close the Mini App and reopen it from the same test bot. Capture the cycle
   again.
3. Tap each in-app item: Catalog, Create, Profile. Capture the visible bottom
   navigation and the panel's `layout`/`overlap` pages.
4. Repeat once in portrait, once in landscape, then return to portrait; wait
   for stable values before each capture.
5. Background Telegram for five seconds, resume the same Mini App without
   changing the query, and capture the final cycle.

Return only redacted screenshots/transcription containing the allowlisted
diagnostic values: `innerHeight`, `visualViewport`, Telegram viewport and
safe-area fields, key rects, computed layout/paint fields, overlap lines, and
`geometry`/paint/hit lines. Also return iPhone model, iOS build, Telegram
build, orientation, and home-indicator state. Do not return `initData`,
identity, auth headers, cookies, tokens, request payloads, or personal data.

## Current classification and next action

`HUMAN_DEVICE_VALIDATION_REQUIRED` — no physical measurement or causal
classification has been made yet. The human action above is the only remaining
validation step for this handoff. After redacted captures arrive, classify
exactly one physical cause and consider at most one bounded preview-only fix.
Do not merge or deploy production from this handoff.
