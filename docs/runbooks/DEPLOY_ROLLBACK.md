# Deploy and rollback runbook

## Release gate

```bash
npm ci
npm --prefix server ci
npm test
npm --prefix server test:sqlite
npm run lint
npm run build
npm --prefix server run check
```

Production requires PostgreSQL and explicit S3 configuration. Set `PAYMENTS_MODE=disabled` for public alpha.

## Deploy

1. Confirm backup and restore-rehearsal evidence.
2. Apply migrations once with `npm --prefix server run migrate:postgres`.
3. Deploy the API and the matching `dist/` artifact.
4. Check `/health`, `/ready`, structured logs and `/metrics`.
5. Execute Telegram auth, progress save/reload, completion, media, publish/feed and moderation smoke checks.

## Rollback

Rollback the application artifact only when it is schema-compatible. There are no automatic down migrations. For data corruption, stop writes and restore into a separate recovery database/bucket; never overwrite the active target before the incident owner confirms the backup and recovery checks.
