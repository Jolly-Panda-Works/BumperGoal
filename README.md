# Bumper Goal

Turn-based, physics-based car soccer for desktop and mobile browsers, with online multiplayer (Nakama) and AI opponents. Cars replace the player pieces; the football remains.

Bumper Goal uses the supplied RetroCartoonCarsPack1 models. Each team has matching cars, with larger sprites and speed/acceleration-sensitive tire tracks. See [the Bumper Goal notes](docs/BUMPER_GOAL.md).

## Branches

| Branch  | Purpose                             |
| ------- | ----------------------------------- |
| `dev`   | All development commits land here.  |
| `stage` | Promoted from `dev` for staging/QA. |
| `main`  | Production releases only.           |

## Run locally

Requirements: Node.js ≥ 22.22, pnpm 10.

```bash
pnpm install
```

```bash
pnpm dev
```

Open http://localhost:5173. Local play (vs AI, 2 players on one device, tutorial) works without any server.

## Run the Nakama backend (online play)

Requirements: Docker. The plugin is built inside `heroiclabs/nakama-pluginbuilder:3.41.0` (matching Nakama 3.41.0).

```bash
cp server/deploy/.env.example server/deploy/.env
```

Edit `server/deploy/.env` (long random secrets), then copy `NAKAMA_SERVER_KEY` into `apps/web/.env.local` as
`VITE_NAKAMA_SERVER_KEY` (see `apps/web/.env.example`), and start the stack:

```bash
pnpm server:up
```

Nakama API: http://127.0.0.1:7350, admin console: http://127.0.0.1:7351 (user `admin`, password from `.env`).
Without the server the game still runs; online screens say so.

## Production deployment

The root `Dockerfile` builds the web client with pnpm and serves it with Caddy.
The root `docker-compose.yml` runs web, Nakama, PostgreSQL and automatic backups.

```bash
sh server/deploy/gen-secrets.sh
# Edit server/deploy/.env.prod: WEB_DOMAIN, API_DOMAIN, ACME_EMAIL.
docker compose --env-file server/deploy/.env.prod up -d --build
```

For Dokploy, use both `docker-compose.yml` and `docker-compose.dokploy.yml` through a custom
command (see `docs/DEPLOYMENT.md`); route both
public domains to the `web` service on port **80**, with HTTPS managed by Dokploy.
Set the variables from `server/deploy/.env.prod.example` in Dokploy's environment.
No SpacetimeDB is needed. In-match voice chat is optional and uses comms game rooms (see `docs/VOICE_CHAT.md`).

Linux server with Docker: HTTPS (Caddy), web client, Nakama, PostgreSQL and automatic backups. See
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Quality checks

```bash
pnpm check
```

Lint, typecheck, unit tests (sim determinism, rules + Go vectors, AI, ECS, controllers) and the production build.

```bash
pnpm test:server
```

Go tests (rules/physics vectors, AI, matchmaking race) inside the Nakama pluginbuilder image.

```bash
pnpm test:integration
```

Live tests against the local Nakama stack (`pnpm server:up` first): matchmaking, bot fallback, cheat rejections, rewards.

```bash
pnpm test:e2e
```

Playwright against the production bundle (first time: `npx playwright install chromium`). Online journeys are skipped,
not faked, when Nakama is not running.

## Physics

Rapier deterministic (`@dimforge/rapier2d-deterministic` 0.21.0). The browser uses the official JS API, and the Nakama Go
plugin runs the same wasm in wazero (`server/nakama/sim`). Both sides are checked against `packages/sim/test/vectors.json`:

```bash
pnpm --filter @flickkick/sim test
```

```bash
docker run --rm -v "$PWD:/repo" -w /repo/server/nakama --entrypoint go heroiclabs/nakama-pluginbuilder:3.41.0 test ./sim/
```

## Layout

- `apps/web`: React shell + Phaser match scene
- `packages/sim`: wasm wrapper, `packages/rules`: rules, progression, AI, `packages/config`: data files
- `server/nakama`: Nakama Go plugin (Rapier via wazero)
- `docs`: specification, architecture, risks, roadmap

## Local screen browser

Run `npm run dev:screens` and open http://127.0.0.1:5174/dev. If port 5174 is occupied, Vite selects the next free port; use the URL printed in the terminal. Dependencies are managed with `pnpm install --frozen-lockfile`, not `npm install` (using `npm run` to launch a script is fine). The gallery links to every game screen and includes persistent previews for victory, defeat, online rewards, matchmaking and level up. Use the floating «صفحه‌ها» link to return, and the language selector to check Persian, English and Arabic.

This development-only mode disables Nakama connections and fullscreen, uses a separate `screens.*` local-storage namespace, and seeds sample profile, wallet, match and history data on reload. Online-only screens show their offline state; the admin panel still requires a real backend and credentials. Production builds do not expose the gallery.
