# iOS diagnostic deployment readiness — existing closed-alpha stack

Date: 2026-09-04  
Goal: `IOS_DEPLOYED_FOR_PHYSICAL_VALIDATION`  
Scope: deployment/readiness only; no physical Telegram classification and no
CSS change.

## Status

`IOS_DEPLOYMENT_READY_FOR_PHYSICAL_VALIDATION`

The diagnostic implementation and feature branch are ready. The durable
Cloudflare Pages preview itself is a lead action: the current branch alias is
not published and this worktree has no Cloudflare credentials. No new bot,
backend, Quick Tunnel, DNS record, or production deployment was created.

## SHA and PR

- Diagnostic source SHA: `4e729b50652e79af8ab58bb40552767afbed408e`
- Current pushed branch SHA: `b88d02828bd906ce3889936aaf41da63f8574f0f`
- Branch: `codex/telegram-ios-viewport-fix`
- Remote parity: local and `origin` both resolve to `b88d02828bd906ce3889936aaf41da63f8574f0f`
- PR-ready comparison: `https://github.com/michaelyosta/splint-pixel-studio/compare/main...codex/telegram-ios-viewport-fix?expand=1`
- Source diff from the diagnostic SHA is docs/scripts only; `src/main.jsx`,
  `src/diagnostics`, tests, and the route verifier are unchanged.

## Diagnostic implementation and activation

The mode is strictly query-gated:

```text
https://<diagnostic-preview>/?viewportDiagnostic=1
```

Optional static pages are `&viewportDiagnosticPage=1`, `2`, `3`, or `4`.
Without `viewportDiagnostic=1`, the ordinary UX does not mount the panel.

The existing panel exposes window/visual viewport values, Telegram bridge
viewport and safe-area fields, all ten `--tg-*` variables, HTML/root/frame/
container/screen/tab-bar rectangles, all three tab-button rectangles, computed
position/paint properties, overlap, and viewport hit-test evidence. It does not
read or render `initData`, identity, cookies, auth headers, tokens, or request
payloads.

## Targeted CI and local evidence

The following commands passed on the pushed branch with retries and quarantine
both zero:

```text
npm run verify:telegram-ios-diagnostic
  PASS · HTTPS · staticPages=4/4 · autoCycle=4/4 · secretMarkers=none
node --test test/viewportDiagnostic.test.js
  3/3 PASS
npm run build
  PASS
git diff --check
  PASS
```

The already-existing disposable Quick Tunnel remains reachable for short-lived
route checks at:

```text
https://relationship-sound-varieties-fax.trycloudflare.com/?viewportDiagnostic=1
```

Its `/api/health`, `/api/live`, and `/api/ready` endpoints returned HTTP 200.
This is not a new tunnel and is not a production deployment.

## Exact Cloudflare Pages auto-deploy path

Use the existing Pages project `splint-pixel-studio` and its Git integration:

```text
push/PR: codex/telegram-ios-viewport-fix
  -> Pages project: splint-pixel-studio
  -> build command: npm run build
  -> output directory: dist
  -> immutable URL: <deployment-hash>.splint-pixel-studio.pages.dev
  -> branch alias: codex-telegram-ios-viewport-fix.splint-pixel-studio.pages.dev
```

Cloudflare's current preview-deployment contract documents hash-based preview
URLs and lowercased, non-alphanumeric-to-hyphen branch aliases:
`https://developers.cloudflare.com/pages/configuration/preview-deployments/`.

The expected branch alias currently returns HTTP 404, so the Pages build has
not been observed from this worktree. `wrangler whoami` reports unauthenticated.
The lead must, in the existing Cloudflare dashboard, verify that preview branch
deployments are enabled for this repository/project, select or allow
`codex/telegram-ios-viewport-fix`, and copy the actual deployment-hash URL from
the resulting deployment. No production branch or custom domain should be
touched.

After the lead supplies the actual Pages preview URL, run the verifier against
that exact origin and use the same URL for the physical Mini App capture. Do
not infer a successful Pages deployment from the branch push alone.

## Existing bot and production impact

The production bot currently launches `showalove.ru`, whose served bundle does
not contain this diagnostic route. The production bot URL/configuration must
remain unchanged. Therefore an iPhone action through the existing bot can use
this diagnostic only after the lead supplies an already-approved non-production
Mini App launch path to the Pages preview; changing the production bot to do so
is out of scope.

Production impact: none. No production DNS, bot setting, Render service,
Neon database, R2 bucket, payments, content, or product IA was modified.

## Exact iPhone action after lead activation

Using the existing closed-alpha bot's approved Mini App launch path to the
Pages preview (not an ordinary Safari/Telegram browser URL):

1. Launch cold and capture a complete diagnostic cycle (pages 1–4).
2. Close and reopen the Mini App; capture pages 1–4 again.
3. Visit Catalog, Create, and Profile; capture layout/overlap pages.
4. Repeat in portrait and landscape, then return to portrait.
5. Background Telegram for five seconds, resume, and capture the final cycle.

Return only redacted allowlisted measurements and screenshots. Do not return
`initData`, identity, cookies, tokens, headers, request payloads, or personal
data. This action is the only remaining human/device step; no causal Telegram
classification is made before it.

## Risks and next action

Risks are limited to Pages integration state and the existing bot's permitted
launch path. The Quick Tunnel is ephemeral and cannot substitute for a durable
Pages deployment in the final evidence package.

Next action: lead enables/observes the existing Pages preview deployment,
records the immutable deployment-hash URL, runs the same route verifier against
that URL, and opens that preview through the existing bot on the physical
iPhone. Keep the diagnostic source frozen and make no CSS change until the
Telegram measurements are returned.

