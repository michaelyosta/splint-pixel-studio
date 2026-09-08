# Splint Pixel Studio

Splint Pixel Studio is a Telegram Mini App for painting, creating, collecting,
and discovering visual works. Painting is the primary action; the stable
product shell is `Каталог` / `Создать` / `Профиль`.

Project documentation:

- Operating contract: [AGENTS.md](AGENTS.md)
- Documentation map: [docs/INDEX.md](docs/INDEX.md)
- Current operational truth: [docs/CURRENT_STATE.md](docs/CURRENT_STATE.md)

## Local development

Requirements: Node.js 20 or newer and npm.

Install dependencies in the root and server directories:

```powershell
npm.cmd install
Set-Location server
npm.cmd install
Set-Location ..
```

Start the API in one terminal and the Vite client in another:

```powershell
npm.cmd run dev:api
npm.cmd run dev
```

Open `http://127.0.0.1:5173`. Local development uses the existing SQLite
fallback unless `DATABASE_URL` is configured. See [DEVELOPMENT.md](DEVELOPMENT.md)
for environment setup, ports, QA flags, and troubleshooting.

## Checks

```powershell
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run catalog:build
Set-Location server
npm.cmd run check
```

The authoritative CI workflow also runs the server suite, PostgreSQL checks,
storage checks, and the critical/extended Playwright topology described in
[docs/E2E_TEST_INVENTORY.md](docs/E2E_TEST_INVENTORY.md).

## Repository orientation

- `src/App.jsx` and `src/components/BottomNavigation.jsx` — application shell;
- `src/views/PlayerView.jsx` and `src/features/coloring/` — painting and tiled player;
- `src/components/CreateHub.jsx` and `src/views/CreatorView.jsx` — import-first creator;
- `src/views/ProfileView.jsx` — creator/collector showcase;
- `server/routes/colorings.js` — catalog, uploads, progress, and completion;
- `server/services/canonical-renderer.js` and `server/services/render-outbox.js` — server-authoritative result media;
- `server/db.js` and `server/migrations/` — SQLite/PostgreSQL persistence;
- `server/catalog-templates.json` — built-in catalog templates.

Production deployment, current blockers, content approval, and commerce
activation are deliberately not asserted here. Read the documentation map and
current-state document for those decisions. Real Telegram Stars, marketplace
purchases, and payouts are fail-closed until separately verified and approved.
