# Infrastructure contract

Status: CANONICAL
Authority: Stable infrastructure topology and release path.

Navigation: [INDEX.md](INDEX.md) · Current state: [CURRENT_STATE.md](CURRENT_STATE.md)

## Existing stack

Splint uses the existing controlled closed-alpha stack:

| Boundary | Service | Stable role |
| --- | --- | --- |
| Frontend | Cloudflare Pages, project `splint-pixel-studio` | Serves the Vite frontend |
| Public domain | `pixel.showalove.ru` | Primary public Mini App domain |
| Backend | Render, service `splint-api` | Runs the Node/Express API |
| Database | Neon PostgreSQL | Production relational persistence |
| Object storage | Cloudflare R2, bucket `splint-originals` | Private originals and canonical media |
| Telegram | Existing production bot | Launches the Mini App and supplies initData |

Browser Telegram Login uses the same frontend/backend topology. The backend
owns the OIDC client secret, callback, token validation, session cookie, and
CSRF checks. No second auth service, bot, database, or storage project is
permitted for this capability.

During the pixel-subdomain migration window, `showalove.ru` and
`www.showalove.ru` remain attached to the same Pages project and active as
fallback origins. Unrelated hostnames such as `crm-pilot.showalove.ru`,
`pos-pilot.showalove.ru`, and `maps.showalove.ru` are separate services and
must not be changed as part of this migration.

These names are stable topology, not proof that the services are currently
deployed or healthy. Current deployment status is in
[CURRENT_STATE.md](CURRENT_STATE.md); absent direct evidence it is `UNKNOWN`.

Do not create a second Cloudflare project, Render service, Neon project, R2
bucket, Telegram bot, or full staging environment unless a concrete safety or
isolation requirement proves it necessary.

## Release path

```text
fresh feature branch/worktree
→ focused local checks
→ push and PR
→ required CI GREEN
→ merge main
→ configured automatic deployment
→ smoke verification
```

A feature-branch push is not a production deployment. A merge to the
production branch may trigger real deployment. Do not force-push `main`, bypass
required CI, or manually mutate production when the configured path works.

## Production boundaries

Production configuration must use Telegram authentication, PostgreSQL, S3/R2
storage, exact HTTPS CORS origins, and explicit trusted proxy IPs/CIDRs. Dev
auth, E2E seed hooks, demo seeding, QA overrides, and secrets must not enter
production. See [authentication.md](authentication.md),
[PUBLIC_ALPHA_SECURITY_MATRIX.md](PUBLIC_ALPHA_SECURITY_MATRIX.md), and
[deployment-runbook.md](deployment-runbook.md).

If browser login is activated, `BROWSER_AUTH_ORIGIN` must be one of the exact
HTTPS CORS origins and `TELEGRAM_OIDC_REDIRECT_URI` must be an exact callback
under that origin. BotFather Allowed URLs must contain the same origin and
callback. Missing browser OIDC configuration leaves the browser login feature
disabled; it does not create fallback anonymous accounts.

Credentials, tokens, cookies, initData, private media keys, and authorization
headers never belong in documentation, logs, artifacts, bundles, commits, or
PR descriptions.

## Operational references

- [database-operations.md](database-operations.md) — database operations;
- [runbooks/BACKUP_RESTORE.md](runbooks/BACKUP_RESTORE.md) — backup/restore;
- [runbooks/DEPLOY_ROLLBACK.md](runbooks/DEPLOY_ROLLBACK.md) — release/rollback;
- [remediation/RENDER_OUTBOX_CHECKPOINT.md](remediation/RENDER_OUTBOX_CHECKPOINT.md) — durable canonical media jobs.
