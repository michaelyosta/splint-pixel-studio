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

3. Launch with restart (stops any old instances first):
   ```
   .\launch-splint.bat -Restart local
   ```

4. Check status:
   ```
   .\launch-splint.bat status
   ```

The launcher will:
- Start the API on http://127.0.0.1:3001
- Start Vite on http://127.0.0.1:5173
- Open the browser automatically
- Use dev auth (X-User-Id: user_pixelhunter) to skip Telegram Mini Apps

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
- Authenticated endpoint status (`GET /colorings` with `X-User-Id`)
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

If `status` shows `401` for `/colorings`:
1. Check that `.env.local` contains `ALLOW_DEV_AUTH=true`
2. Restart the server: `.\launch-splint.bat -Restart local`
3. The API must be started via `npm run dev:api` or the launcher (both read
   `.env.local`)

## Error: EADDRINUSE (address already in use :::3001)

If the backend fails with `Error: listen EADDRINUSE: address already in use :::3001`:

1. Port 3001 is occupied by another process (usually a previous SPLINT instance)
2. The backend now displays a helpful message with resolution steps
3. Run: `.\launch-splint.bat -Restart local` to stop old processes and restart
4. Or check with: `.\launch-splint.bat status`

## Vite Tries to Open 5174

If Vite says `Port 5173 is in use, trying another one...`:

1. Vite is configured with `strictPort: true` in `vite.config.js`
2. If port 5173 is occupied, Vite will now fail with a clear error instead of silently switching
3. The Vite proxy expects API on port 3001, so switching ports would break the proxy
4. Run: `.\launch-splint.bat -Restart local` to free port 5173 and start correctly

## Telegram Mini Apps Authorization Required

If the browser shows `Telegram Mini Apps authorization required`:

1. Dev auth is disabled in `.env.local`
2. Set `ALLOW_DEV_AUTH=true` and `VITE_ALLOW_DEV_AUTH=true` in `.env.local`
3. Restart: `.\launch-splint.bat -Restart local`
4. This error only appears in production or when dev auth is not configured

## How to Safely Find and Stop a Process by PID

To find what is listening on a port:
```powershell
Get-NetTCPConnection -LocalPort 3001 -State Listen
```

This shows the OwningProcess (PID). To get details:
```powershell
Get-Process -Id <PID>
Get-CimInstance Win32_Process -Filter "ProcessId=<PID>" | Select-Object ProcessId, Name, CommandLine
```

To stop a specific process:
```powershell
taskkill /PID <PID> /T /F
```

Only use `taskkill /IM node.exe /F` as a last resort - it kills ALL Node.js processes on the system.

## Reading Log Files

Logs are written to `.logs/`:
- `api.log` — backend output (startup, errors, route handling)
- `vite.log` — Vite dev server output (compilation, HMR, requests)
- `cloudflared.log` — Cloudflare tunnel output (if running)

To tail the logs in real-time:
```powershell
Get-Content .logs\api.log -Wait -Tail 20
Get-Content .logs\vite.log -Wait -Tail 20
```

To view recent output:
```powershell
Get-Content .logs\api.log -Tail 20
Get-Content .logs\vite.log -Tail 20
```

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

## PowerShell Compatibility

The launcher (`scripts/start-splint.ps1`) is written for **Windows PowerShell 5.1**
(the version built into Windows 10/11) and is also compatible with PowerShell 7.
No PowerShell 7-only syntax (`??`, `?:`, `??=`, `&&`, `||`) is used.

`launch-splint.bat` automatically prefers `pwsh.exe` if it is available, but
falls back to the built-in `powershell.exe`. Manual PowerShell 7 installation
is optional, not required.

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
