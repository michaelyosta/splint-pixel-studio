# Deployment runbook

Status: CANONICAL
Authority: Normal release and rollback procedure for the existing stack.

Navigation: [INDEX.md](INDEX.md) · Current state: [CURRENT_STATE.md](CURRENT_STATE.md)
Topology: [INFRASTRUCTURE_CONTRACT.md](INFRASTRUCTURE_CONTRACT.md)

This runbook describes the release boundary. It does not claim that a current
commit is deployed. Confirm live state with direct provider/deployment
evidence and update [CURRENT_STATE.md](CURRENT_STATE.md) separately.

The current primary public origin is `https://pixel.showalove.ru`. During the
migration fallback window, keep `https://showalove.ru` and
`https://www.showalove.ru` active until the new origin has passed the live
smoke checks and the owner approves any later redirect.

## Release gate

1. Start from a fresh feature branch/worktree and inspect `git status`.
2. Run focused checks for the changed domain, then the required local checks:
   `npm test`, `npm run lint`, `npm run build`, and the relevant server/E2E
   suites.
3. Push the branch and open a PR.
4. Require the configured CI dependency groups to be green. Do not bypass a
   failing gate, weaken an assertion, or hide a failure with quarantine.
5. Merge to `main` only after reviewing the deployment consequence.

## Deployment path

The existing production topology is:

```text
merge production branch
→ Cloudflare Pages frontend deployment
→ configured Render backend deployment
→ smoke verification against `https://pixel.showalove.ru` and the configured API
```

A feature-branch push is not a production deployment. Do not create parallel
Cloudflare, Render, Neon, R2, or Telegram environments without a concrete
safety/isolation requirement. Never put credentials or initData in commands,
logs, screenshots, or this document.

## Smoke verification

Use the provider's deployment receipt and the configured health endpoints
(`/live`, `/health`, and `/ready` where the ingress exposes them). Verify:

- frontend loads from the configured HTTPS origin;
- the primary origin is `https://pixel.showalove.ru`, while the legacy origins
  remain available during the fallback window;
- backend readiness reports database, object-storage, and configuration state;
- Telegram authentication is used in the real Mini App context;
- a bounded catalog/open/paint/save/resume path works;
- media publication remains unavailable until canonical rendering is ready;
- commerce remains disabled unless a separately approved activation decision
  and direct evidence exist.

Record the result as current evidence before changing current-state claims.

## Rollback

Prefer the hosting provider's previous known-good deployment or a reviewed
revert PR through the normal branch/CI path. Preserve database and object
history; do not reset production data or force-push `main`. If a migration or
media job requires recovery, follow [runbooks/BACKUP_RESTORE.md](runbooks/BACKUP_RESTORE.md)
and the render-outbox runbook before retrying.

## Boundaries

This repository documentation migration does not deploy, change production
configuration, enable Stars, publish content, or create environments.
