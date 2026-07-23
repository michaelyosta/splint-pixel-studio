# SPLINT Development Guide

## First Run

1. Install dependencies:
   ```
   npm install
   npm --prefix server install
   ```

2. Create your local environment file:
   ```
   Copy-Item .env.example .env.local
   ```

3. Edit `.env.local` and enable dev auth:
   ```
   ALLOW_DEV_AUTH=true
   VITE_ALLOW_DEV_AUTH=true
   SEED_DEMO_DATA=true
   ```

4. Launch:
   ```
   .\launch-splint.bat local
   ```

## Available Modes

### `local`
Starts the API backend (127.0.0.1:3001) and Vite dev server (127.0.0.1:5173).
Opens the browser automatically. No Docker required.

### `lan`
Same as `local` but Vite binds to `0.0.0.0` so phones/tablets on the same
Wi-Fi network can connect. Displays the LAN URL.

The script will NOT open Windows Firewall automatically. To allow manually:
```
netsh advfirewall firewall add rule name="Splint Vite" dir=in action=allow protocol=TCP localport=5173
```

### `tailscale`
Requires Tailscale to be installed and connected. Gets the device's Tailscale
DNS name, configures `tailscale serve` for HTTPS access, and restricts Vite's
`allowedHosts` to only the exact Tailscale hostname. Displays the public URL.

### `cloudflare`
Starts a Cloudflare Quick Tunnel for public access. **This is a security risk
if dev auth is enabled.** Before starting, the script checks whether
`ALLOW_DEV_AUTH` or `VITE_ALLOW_DEV_AUTH` is `true` and refuses to start
unless you explicitly pass `-UnsafePublicDevAuth`:

```
.\launch-splint.bat cloudflare -UnsafePublicDevAuth
```

Vite's `allowedHosts` is restricted to only the exact Cloudflare hostname.

### `full`
Runs `docker compose up -d`, waits for PostgreSQL and MinIO health checks,
then starts backend and frontend. Uses `DATABASE_URL` from `.env.local`.

### `status`
Shows:
- API PID and Vite PID (if managed by the launcher)
- `/health` status
- Authenticated endpoint status (`GET /api/colorings` with `X-User-Id`)
- Active Tailscale Serve URL
- Active Cloudflare URL
- Log file locations

### `stop`
Stops only processes that were started by the launcher (tracked via PID files
in `.run/`). Does NOT kill other `node.exe` or `cloudflared.exe` processes.

### `-Restart`
Can be added before any mode to stop existing launcher-managed processes first:
```
.\launch-splint.bat -Restart local
```

## Diagnosing 401 on Authenticated Endpoints

If `status` shows `401` for `/api/colorings`:
1. Check that `.env.local` contains `ALLOW_DEV_AUTH=true`
2. Restart the server: `.\launch-splint.bat -Restart local`
3. The API must be started via `npm run dev:api` or the launcher (both read
   `.env.local`)

## Diagnosing Occupied Port

If the launcher detects port 3001 or 5173 is occupied by an unknown process,
it will show the PID and command line. It will NOT kill it automatically.
Either:
- Stop that process manually
- Use `-Restart` if it was started by the launcher
- Check with `.\launch-splint.bat status`

## Log Files

All logs are written to `.logs/`:
- `api.log` — backend output and errors
- `vite.log` — Vite dev server output
- `cloudflared.log` — Cloudflare tunnel output

Both `.logs/` and `.run/` (PID files) are in `.gitignore`.

## Node.js Version

Requires Node.js >= 20.6 (for `--env-file` support). The launcher checks this
automatically on startup.

## Environment File

`.env.local` is the single source of truth for local development. It is
loaded by:
- `npm run dev:api` → `node --env-file=../.env.local --watch index.js`
- The PowerShell launcher passes variables to child processes

`VITE_*` variables are bundled into the client at build time. They must
never contain secrets or tokens.

## Production Safety

The server (`server/index.js`) enforces:
- `ALLOW_DEV_AUTH` cannot be `true` in production
- `SEED_DEMO_DATA` cannot be `true` in production
- `TELEGRAM_BOT_TOKEN` is required in production

## Security

- `server.allowedHosts` is NOT set to `true` in Vite config
- Only specific hosts are allowed: `localhost`, `127.0.0.1`, plus any
  tunnel hostnames set by the launcher via `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS`
- API port 3001 is never exposed through tunnels directly; only the Vite
  dev server (port 5173) with its proxy is exposed
