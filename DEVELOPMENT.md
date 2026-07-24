# SPLINT Development Guide

## First Run

1. Install dependencies:
   ```
   npm install
   npm --prefix server install
   ```

2. Create and configure your local environment file:
   ```
   copy .env.example .env.local
   notepad .env.local
   ```
   Enable dev auth and demo data in `.env.local`:
   ```
   ALLOW_DEV_AUTH=true
   VITE_ALLOW_DEV_AUTH=true
   SEED_DEMO_DATA=true
   ```

3. Start the API in the first terminal:
   ```
   npm run dev:api
   ```

4. Start the frontend in the second terminal:
   ```
   npm run dev
   ```

5. Open:
   ```
   http://127.0.0.1:5173
   ```

## Health Check

```
API health:  http://127.0.0.1:3001/health
Frontend:    http://127.0.0.1:5173
```

## Ports

Frontend: `127.0.0.1:5173` (Vite)
Backend: `127.0.0.1:3001` (Express API)

Vite uses `strictPort`. If port 5173 is occupied, `npm run dev` will exit with a clear error instead of silently switching to another port. The same applies to the API on port 3001 — it will exit with `EADDRINUSE`.

## Error: EADDRINUSE (address already in use)

If the backend fails with `Error: listen EADDRINUSE: address already in use :::3001`:

1. Port 3001 is occupied by another process
2. Find it: `Get-NetTCPConnection -LocalPort 3001 -State Listen`
3. Kill it: `taskkill /PID <pid> /T /F`
4. Then restart: `npm run dev:api`

## Vite Port Conflict

If Vite says `Port 5173 is in use, trying another one...`:

Vite is configured with `strictPort: true`. It will exit with an error instead of switching ports.

## Telegram Mini Apps Authorization Required

If the browser shows `Telegram Mini Apps authorization required`:

1. Dev auth is disabled in `.env.local`
2. Set `ALLOW_DEV_AUTH=true` and `VITE_ALLOW_DEV_AUTH=true` in `.env.local`
3. Restart: `npm run dev:api` and `npm run dev`
4. This error only appears in production or when dev auth is not configured

## E2E Tests

```
npm run test:e2e
```

Playwright automatically starts the Vite dev server and a temporary API instance with:

- An isolated SQLite database (current migrations, clean seed)
- An isolated local filesystem media storage driver (`STORAGE_DRIVER=local`)
- No MinIO/S3 requirement for the main E2E run

This setup is only for testing — regular development uses `npm run dev:api` + `npm run dev` in two terminals.

## Node.js Version

Requires Node.js >= 20.6 (for `--env-file` support).

## Environment File

`.env.local` is the single source of truth for local development. It is
loaded by:
- `npm run dev:api` → `node --env-file=../.env.local --watch index.js`

Do not set `NODE_ENV` in `.env.local`. Vite selects development mode for
`npm run dev` and production mode for `npm run build`.

`VITE_*` variables are bundled into the client at build time. They must
never contain secrets or tokens.

## Production Safety

The server (`server/index.js`) enforces:
- `ALLOW_DEV_AUTH` cannot be `true` in production
- `SEED_DEMO_DATA` cannot be `true` in production
- `TELEGRAM_BOT_TOKEN` is required in production

## Security

- `server.allowedHosts` is NOT set to `true` in Vite config
- Only specific hosts are allowed: `localhost`, `127.0.0.1`
- API port 3001 is never exposed through tunnels directly; only the Vite
  dev server (port 5173) with its proxy is exposed
