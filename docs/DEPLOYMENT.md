# FlickKick: Production Deployment (Linux)

Status: 2026-10-28. The production stack was **rehearsed end to end** on Docker's Linux engine with local HTTPS domains
(`localhost` / `api.localhost`, Caddy internal CA): build, start, health checks, HTTPS/WSS, security headers, the
production smoke test in a real browser, an on-demand backup and a verified restore.

**Not yet verified:** a real public domain with Let's Encrypt certificates, a physical Linux host (the rehearsal ran in
Docker Desktop's Linux VM), and `arm64` hardware (all images are published for `amd64` and `arm64`). Do these on the first
staging deployment.

## 1. What runs

```
Internet ──443/80──► web (Caddy 2.11)
                       ├─ https://WEB_DOMAIN   → static web client (production build)
                       └─ https://API_DOMAIN   → reverse proxy → nakama:7350 (HTTP API + WebSocket)
                                                   nakama (3.41.0 + FlickKick Go plugin)
                                                     └─ postgres:5432 (16.10)
                                                   backup (pg_dump on a schedule → ./backups)
Host loopback only: 127.0.0.1:7351 → Nakama admin console
```

| Service    | Image                                                            | Public ports                     | Data                                        |
| ---------- | ---------------------------------------------------------------- | -------------------------------- | ------------------------------------------- |
| `web`      | `flickkick/web` (built: Node 22.22 → Caddy 2.11.7)               | 80, 443/tcp, 443/udp (HTTP/3)    | `caddy_data` (certificates), `caddy_config` |
| `nakama`   | `flickkick/nakama` (built: pluginbuilder 3.41.0 → nakama 3.41.0) | none (console on 127.0.0.1:7351) | stateless                                   |
| `postgres` | `postgres:16.10-alpine`                                          | none                             | `pgdata`                                    |
| `backup`   | `postgres:16.10-alpine`                                          | none                             | `${BACKUP_DIR}` on the host                 |

Files: `server/deploy/docker-compose.prod.yml`, `Dockerfile`, `server/deploy/Caddyfile`,
`server/nakama/Dockerfile`, `server/nakama/flickkick.yml`, `server/deploy/.env.prod.example`, `server/deploy/gen-secrets.sh`.

## 2. Server requirements

| Item      | Minimum                                                                                                | Recommended at launch                     |
| --------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| OS        | Ubuntu 24.04 LTS or Debian 12, 64-bit                                                                  | same                                      |
| CPU / RAM | 2 vCPU / 4 GB                                                                                          | 4 vCPU / 8 GB (see §10 capacity)          |
| Disk      | 30 GB SSD                                                                                              | 60 GB SSD (database + 14 days of backups) |
| Software  | Docker Engine ≥ 27 with the Compose v2 plugin, `git`, `openssl`                                        | + unattended security updates             |
| DNS       | `A`/`AAAA` records for `WEB_DOMAIN` and `API_DOMAIN` pointing to the server **before** the first start |                                           |
| Firewall  | inbound 22/tcp (SSH), 80/tcp, 443/tcp, 443/udp; everything else closed                                 | restrict 22 to your IPs                   |

Install Docker on Ubuntu (official repository):

```bash
curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker "$USER"
```

## 3. First deployment

```bash
git clone https://gitlab.rastaar.quest/gamestudio/soccerstars.git flickkick && cd flickkick && git checkout main
```

```bash
./server/deploy/gen-secrets.sh
```

This writes `server/deploy/.env.prod` (mode 600) with fresh random secrets. Edit it and set the three domain values:

```bash
nano server/deploy/.env.prod
```

```bash
docker compose -f server/deploy/docker-compose.prod.yml --env-file server/deploy/.env.prod up -d --build
```

The first build takes a few minutes (Go plugin + web bundle). Caddy obtains certificates on the first HTTPS request,
which needs both DNS records and port 80 reachable.

### Verify

```bash
docker compose -f server/deploy/docker-compose.prod.yml --env-file server/deploy/.env.prod ps
```

All services should be `Up`, with `nakama`, `postgres` and `web` `(healthy)`.

```bash
curl -fsS https://API_DOMAIN/healthcheck
```

Expected output: `{}`. Then open `https://WEB_DOMAIN`, enter as a guest, and check that the green server dot and the
500-coin wallet appear. From any machine with the repository, run the browser smoke test against the deployment:

```bash
E2E_BASE_URL=https://WEB_DOMAIN npx playwright test
```

It logs in, plays a local match, finds an online match (bot fallback after 15 s), and fails on any CSP violation or
console error.

## 4. Environment variables (`server/deploy/.env.prod`)

| Variable                     | Secret      | Default                                    | Purpose                                                                                                                            |
| ---------------------------- | ----------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `WEB_DOMAIN`                 | no          | —                                          | Domain of the web client (`play.example.com`)                                                                                      |
| `API_DOMAIN`                 | no          | —                                          | Domain of the Nakama API/WebSocket (`api.play.example.com`); baked into the web build                                              |
| `ACME_EMAIL`                 | no          | —                                          | Contact for Let's Encrypt                                                                                                          |
| `POSTGRES_PASSWORD`          | **yes**     | generated                                  | Database password                                                                                                                  |
| `NAKAMA_SERVER_KEY`          | no (public) | generated                                  | Client key; baked into the web build. Changing it requires rebuilding `web`                                                        |
| `NAKAMA_SESSION_KEY`         | **yes**     | generated                                  | Session token signing. Rotating it logs every player out                                                                           |
| `NAKAMA_REFRESH_KEY`         | **yes**     | generated                                  | Refresh token signing. Rotating it forces every player to log in again; unlinked guests keep their account only on the same device |
| `NAKAMA_HTTP_KEY`            | **yes**     | generated                                  | Server-to-server runtime HTTP key (not used by clients)                                                                            |
| `NAKAMA_CONSOLE_PASSWORD`    | **yes**     | generated                                  | Admin console password (user `admin`)                                                                                              |
| `NAKAMA_CONSOLE_SIGNING_KEY` | **yes**     | generated                                  | Admin console session signing                                                                                                      |
| `ADMIN_USERNAME`             | no          | `admin`                                    | Sign-in name for the balance panel at `/admin` (section 5a). Empty disables the panel                                              |
| `ADMIN_PASSWORD`             | **yes**     | generated                                  | Balance panel password, 12+ characters. Server-side only; never put it in a `VITE_*` variable. Empty disables the panel            |
| `COMMS_URL`                  | no          | empty                                      | comms address as seen from Nakama (voice chat, `docs/VOICE_CHAT.md`). Empty disables voice                                         |
| `COMMS_SERVER_KEY`           | **yes**     | empty                                      | comms app server API key. Nakama only; never in a `VITE_*` variable                                                                |
| `COMMS_WEBHOOK_SECRET`       | **yes**     | empty                                      | Secret of the comms webhook endpoint for voice reports; empty refuses the webhook                                                  |
| `COMMS_PUBLIC_URL`           | no          | empty                                      | comms address for browsers; baked into the web build as `VITE_COMMS_URL`. Empty builds a client without voice                      |
| `VOICE_CONNECT_SRC`          | no          | empty                                      | Extra CSP `connect-src` origins for voice: comms and its LiveKit server (`https://comms.example.com wss://media.example.com`)      |
| `MM_BOT_TIMEOUT_MS`          | no          | 15000                                      | Matchmaking bot fallback                                                                                                           |
| `AI_SERVER_MAX_SIMULATIONS`  | no          | 12                                         | Server bot search budget (see TECHNICAL_RISKS R-18)                                                                                |
| `RELEASE_TAG`                | no          | latest                                     | Image tag for `flickkick/web` and `flickkick/nakama` (use the git tag of the release)                                              |
| `NAKAMA_CPUS`                | no          | 2                                          | CPU limit of the Nakama container                                                                                                  |
| `BACKUP_DIR`                 | no          | `./backups` (relative to `server/deploy/`) | Host folder for database dumps                                                                                                     |
| `BACKUP_INTERVAL_SECONDS`    | no          | 86400                                      | Time between backups                                                                                                               |
| `BACKUP_RETENTION_DAYS`      | no          | 14                                         | Older dumps are deleted                                                                                                            |

Keep a copy of `.env.prod` in a password manager. Without it, the database password and sessions can't be recovered.

## 5. Admin console

The console is never public. Open an SSH tunnel and browse locally:

```bash
ssh -L 7351:127.0.0.1:7351 user@SERVER
```

Then open http://127.0.0.1:7351 (user `admin`, password `NAKAMA_CONSOLE_PASSWORD`).

## 5a. Balance panel (`/admin`)

`https://WEB_DOMAIN/admin` edits game balance at runtime, without a rebuild or restart: shop prices, currency
pack grants, daily rewards, starting balance, tutorial and ad rewards, arena entry fees, house cut and XP
multipliers, XP and level rewards, match rules (goals to win, turn time, timeouts, max shots, kickoff
formation, dragged on a pitch), physics (disc and ball mass, damping, bounce, shot power, goal size), team attributes and AI
difficulty, and the board theme of each arena. Catalog pages list items on the left and edit the selected one
on the right; ticking several items compares them side by side. The physics page runs the game's own
simulation with the live and the edited values and replays both. Each team's disc art can be replaced by uploading an image (cropped to a circle, stored
as a small WebP inside the overrides).

- **Sign-in.** `ADMIN_USERNAME` / `ADMIN_PASSWORD` are passed to Nakama as `--runtime.env` and checked
  server-side only. The panel is off while either is empty or the password is shorter than 12 characters
  (the Nakama log warns). Ten failed sign-ins within a minute lock sign-in for a minute. A sign-in lasts
  12 hours; changing the password ends every panel session. Keep the password to letters and digits
  (`gen-secrets.sh` generates hex), since it is passed through the shell in the compose file.
- **Storage.** Saves are stored as overrides on top of the built-in values in `packages/config/data`
  (Nakama storage `admin/balance`, owned by the system user and unreadable by players). Every save is
  validated, gets a new revision and an audit entry (`admin_audit`, the panel shows the last 20). Two
  open panels can't overwrite each other: the second save is rejected until it reloads.
- **When changes apply.** Purchases, pack claims, daily rewards, matchmaking and new matches use a save
  immediately. A match already in progress finishes with the values it started with. Clients pick up the
  new values the next time they fetch their profile (after any purchase, reward or match) and keep them for
  offline play. Wallets, owned items and levels are never changed retroactively. The starting balance only
  affects new accounts. Making a paid item free gives it to everyone; making it paid again takes it from
  players who never bought it.
- **Arenas and art.** New arenas can be added (id, names, fees, unlock level, XP multiplier, base theme).
  Each arena's look is uploaded per part: cover card, stadium background, pitch turf, stadium frame
  (nine-slice, with its border widths) and goals; parts without an upload use the base theme. AI levels
  can get a new portrait. Uploaded images go to Nakama storage (`admin_asset/<sha256>`, at most about
  360 KB each after the panel compresses them) and players download each image once (`asset_get`) and
  keep it in the browser cache.
- **Languages.** The Languages page adds a language to the game (code, native name, text direction,
  number locale) and translates every game text next to a reference language; JSON import and export
  help with external translators. A language stays hidden from players until "Visible to players" is on.
  Translations are stored in Nakama (`admin/languages` index plus one `admin_language/<code>` object
  each); players download them once per change and keep them for offline play. Untranslated texts fall
  back to English. The built-in English, Persian and Arabic ship with the client and are read-only here.
- **Panel language.** The panel itself is in English, Persian or Arabic (Settings page, per browser).
- **Not editable.** Ids, names, colours and the catalog structure (adding or removing items), the pitch
  size, discs per team and cosmetic defaults. These need a code change.
- **After a release.** If a release removes an item that has an override, the server skips that override
  (logged as stale) and the panel lists it for removal. **Reset all** returns to the built-in values.

## 5b. Voice chat (comms game rooms)

Optional. With `COMMS_URL` and `COMMS_SERVER_KEY` set, every ranked match gets a comms audio room; players join it with
a token from the `voice_token` RPC. Steps (details and decisions in [`VOICE_CHAT.md`](VOICE_CHAT.md)):

1. In comms, create an app whose allowed origins include `https://WEB_DOMAIN`, and copy its server key into
   `COMMS_SERVER_KEY`.
2. Create a comms webhook endpoint for `game_room.player_reported` with the URL
   `https://API_DOMAIN/v2/rpc/voice_webhook?http_key=<NAKAMA_HTTP_KEY>&unwrap`; put its secret in `COMMS_WEBHOOK_SECRET`.
3. Set `COMMS_PUBLIC_URL` and `VOICE_CONNECT_SRC`, then rebuild and restart `web` and `nakama`.

The Caddy files allow the microphone for the game's own origin (`Permissions-Policy: microphone=(self)`). If comms is
down, matches play without voice; Nakama logs `voice_unavailable` once per outage. Reports show at `/admin` → Voice
reports.

## 6. Releases, updates and rollback

Releases come from `main` (promoted from `dev` → `stage` → `main`). On the server:

```bash
git fetch --tags && git checkout v0.3.0
```

```bash
RELEASE_TAG=v0.3.0 docker compose -f server/deploy/docker-compose.prod.yml --env-file server/deploy/.env.prod up -d --build
```

- `nakama` restarts in a few seconds. **Matches in progress are lost** (match state lives in memory), and players see a
  reconnect. Deploy at quiet hours.
- Database migrations run automatically at every Nakama start (`nakama migrate up`). FlickKick's own data are storage
  objects with versioned shapes; no SQL migrations are needed.
- **Rollback:** check out the previous tag and run the same command with its `RELEASE_TAG`. Images of earlier tags stay
  on the host until pruned. Restore a backup (§7) only if a release damaged data.
- The physics wasm is pinned (`SIM_VERSION`); client and server always come from the same commit, so never deploy only
  one of `web` and `nakama` from a different commit.

## 7. Backups and restore

The `backup` service writes `nakama-<UTC timestamp>.dump` (PostgreSQL custom format) every `BACKUP_INTERVAL_SECONDS`
into `BACKUP_DIR` and deletes dumps older than `BACKUP_RETENTION_DAYS`. **Copy them off the server** (e.g. nightly
`rsync`/`rclone` to object storage). A backup on the same disk doesn't survive losing that disk.

On-demand backup:

```bash
docker compose -f server/deploy/docker-compose.prod.yml --env-file server/deploy/.env.prod run --rm --entrypoint sh backup -c 'pg_dump -h postgres -U nakama -d nakama -Fc -f /backups/nakama-manual.dump'
```

**Restore** (verified during the rehearsal). Test first into a scratch database:

```bash
docker compose -f server/deploy/docker-compose.prod.yml --env-file server/deploy/.env.prod exec postgres createdb -U nakama restore_check
```

```bash
docker compose -f server/deploy/docker-compose.prod.yml --env-file server/deploy/.env.prod run --rm --entrypoint pg_restore backup -h postgres -U nakama -d restore_check --no-owner /backups/nakama-YYYYMMDDTHHMMSSZ.dump
```

To replace the live database: stop the game, restore into `nakama` with `--clean --if-exists`, then start again:

```bash
docker compose -f server/deploy/docker-compose.prod.yml --env-file server/deploy/.env.prod stop web nakama
```

```bash
docker compose -f server/deploy/docker-compose.prod.yml --env-file server/deploy/.env.prod run --rm --entrypoint pg_restore backup -h postgres -U nakama -d nakama --clean --if-exists --no-owner /backups/nakama-YYYYMMDDTHHMMSSZ.dump
```

```bash
docker compose -f server/deploy/docker-compose.prod.yml --env-file server/deploy/.env.prod up -d
```

## 8. Logs and monitoring

```bash
docker compose -f server/deploy/docker-compose.prod.yml --env-file server/deploy/.env.prod logs -f --tail 200 nakama
```

- Logs are JSON, rotated by Docker (20 MB × 5 files per service).
- FlickKick events to watch: `match_created`, `match_started`, `match_ended`, `shot_rejected` (with reason),
  `mm_search_started`, `mm_pairs_accepted`, `mm_bot_fallback`, `mm_human_match`, `entry_fee_failed`,
  `result_record_failed` (should never appear), `player_left` / `player_rejoined` / `disconnect_forfeit`.
- External uptime checks: `https://API_DOMAIN/healthcheck` (expects `{}`) and `https://WEB_DOMAIN/` (200).

## 9. Security checklist

- [ ] `.env.prod` is mode 600, not in git, and backed up in a password manager.
- [ ] Only 22/80/443 open; SSH key-only; console reachable only through an SSH tunnel.
- [ ] HTTPS everywhere: HTTP redirects to HTTPS (308) and HSTS is on.
- [ ] Strict CSP is on: no `unsafe-eval`; `wasm-unsafe-eval` only for Rapier; `connect-src` only the API domain. A
      regression test (`apps/web/test/ecs-csp.test.ts`) guards the ECS against code generation, and the production smoke
      test fails on any CSP violation.
- [ ] Database and Nakama ports are not published.
- [ ] OS security updates enabled (`unattended-upgrades`); `docker compose pull` for base image updates at each release.
- [ ] Backups copied off-host and a restore tested at least monthly.
- [ ] Payments and ads stay in sandbox until a provider is approved (no real money flows exist in this build).

## 10. Capacity (estimate from measured benchmarks)

Inside the Nakama plugin, the physics runs in wazero's interpreter (TECHNICAL_RISKS R-18): about **0.2 s CPU per
authoritative shot** (5v5 formation). A server bot decision costs about **2.4 s CPU** (12 predictions).

| Match type     | CPU per turn (≈ 20 s wall time) | Rough concurrent matches per vCPU |
| -------------- | ------------------------------- | --------------------------------- |
| Human vs human | ≈ 0.2 s                         | ~60–80                            |
| Human vs bot   | ≈ 0.2 s + 2.4 s on bot turns    | ~6–10                             |

These are planning estimates, not load-test results. Run a load test before launch. Raise `NAKAMA_CPUS` with the
host size. Nakama OSS is single-node (matchmaking searches are kept in memory; TECHNICAL_RISKS R-19).

## 11. Local production rehearsal

The same stack can run on a workstation with Docker. Caddy issues locally trusted certificates for `localhost` names:

1. Run `./server/deploy/gen-secrets.sh`, then set `WEB_DOMAIN=localhost`, `API_DOMAIN=api.localhost` and any
   `ACME_EMAIL` in `server/deploy/.env.prod`.
2. Stop the dev stack (it also uses port 7351):
   `docker compose -f server/deploy/docker-compose.yml --env-file server/deploy/.env down`
3. `docker compose -f server/deploy/docker-compose.prod.yml --env-file server/deploy/.env.prod up -d --build`
4. `E2E_BASE_URL=https://localhost npx playwright test` (Chromium resolves `*.localhost` to the loopback address).

On Windows Git Bash, prefix commands that pass container paths (e.g. `/backups/...`) with `MSYS_NO_PATHCONV=1`.

## 12. Troubleshooting

| Symptom                                                   | Likely cause                                                                 | Fix                                                                                                                        |
| --------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Browser certificate error / Caddy logs `challenge failed` | DNS not pointing at the server yet, or port 80 blocked                       | Fix DNS/firewall, then `docker compose … restart web`. Avoid repeated restarts: Let's Encrypt rate-limits failures         |
| Game loads but the server dot stays red                   | `API_DOMAIN` or `NAKAMA_SERVER_KEY` changed after the web image was built    | Rebuild: `… up -d --build web`                                                                                             |
| Page stays blank; console shows a CSP error               | A dependency started using `eval`/`new Function`, or a new origin is used    | Run `pnpm --filter @flickkick/web test` (CSP regression test) and the smoke test; adjust code, not the CSP, where possible |
| `nakama` restarts in a loop                               | Wrong `POSTGRES_PASSWORD` for an existing volume, or plugin/version mismatch | `… logs nakama`; the password of an existing `pgdata` volume can't be changed through `.env.prod`                          |
| `plugin was built with a different version of package …`  | Plugin and server images differ                                              | Never change the Nakama tag without the matching pluginbuilder tag (both are pinned to 3.41.0)                             |
| WebSocket fails behind a CDN/proxy                        | The proxy doesn't pass WebSocket upgrades                                    | Enable WebSockets on the CDN (e.g. Cloudflare: WebSockets on) or bypass it for `API_DOMAIN`                                |
| Bots never appear                                         | `MM_BOT_TIMEOUT_MS` misconfigured, or Nakama logs `bot_match_create_failed`  | Check `.env.prod` and the logs                                                                                             |
| Server bots feel weak                                     | Expected: capped search (R-18)                                               | Optional physics sidecar (declined for now), or raise `AI_SERVER_MAX_SIMULATIONS` if CPU allows                            |

## 13. CI/CD

`.gitlab-ci.yml` runs lint, formatting, the asset-document check, type checks, unit tests, the production build and the Go
tests (inside the matching pluginbuilder image). It needs a GitLab Runner with the Docker executor. Deployment stays a
manual, reviewed step (§6). An automatic deploy job would need an SSH deploy key and the server address as protected CI
variables, which the product owner has to provide.

## Root Docker entry points and Dokploy

`Dockerfile` is the canonical web image (build context: repository root). It uses the
workspace lockfile, pnpm 10.28.0, the existing pinned Node/Caddy versions, and exported
runtime art. Source masters, local environment files and backups are excluded from the
build context.

The root `docker-compose.yml` extends the existing production services; it does not
introduce a second database or different game backend. Generate secrets with the existing
script, edit the domains, and run from the repository root:

```bash
sh server/deploy/gen-secrets.sh
docker compose --env-file server/deploy/.env.prod config --quiet
docker compose --env-file server/deploy/.env.prod up -d --build
```

The standalone target publishes 80/443 and Caddy owns TLS. The older explicit command
using `-f server/deploy/docker-compose.prod.yml` still works. Relative `BACKUP_DIR` values
are resolved against the selected base Compose file's directory; use an absolute path
when switching between these entry points to retain the same backup location. Keep the
same project name (`flickkick-prod`) to retain the existing named database/TLS volumes.

For **Dokploy**, create a Compose service with Compose Path `./docker-compose.yml`. Its
default command takes one file, so set the custom command (Advanced) to add the override,
replacing `<app-name>` with the service's app name:

```bash
compose -p <app-name> -f ./docker-compose.yml -f ./docker-compose.dokploy.yml up -d --build --remove-orphans
```

PostgreSQL is not part of the Dokploy stack: create a Dokploy **PostgreSQL** database
service first and point Nakama at it. Set `DB_HOST` to its internal host (the database
service's app name), `DB_PORT` to its internal port (5432), `DB_NAME` and `DB_USER` to its
database name and user, and `POSTGRES_PASSWORD` to its password. Use a password of
letters and digits only, as it is placed in a connection URL. Nakama and the backup job
join the external `dokploy-network` to reach it; the bundled `postgres` service only
starts with the `bundled-db` profile.

Configure all other variables from `.env.prod.example` in the platform environment,
including the generated keys/passwords; `BACKUP_DIR` is ignored here, as backups go to the
named `backups` volume. Copy them off the server. Build arguments receive the public
client key and API domain; Vite settings are baked into the image, so rebuild after
changing them. `NPM_REGISTRY` can optionally select your npm mirror.

To validate the merged configuration locally:

```bash
docker compose --env-file server/deploy/.env.prod \
  -f docker-compose.yml -f docker-compose.dokploy.yml config --quiet
```

Route **both** WEB_DOMAIN and API_DOMAIN to service `web`, container port **80**, with
HTTPS enabled in Dokploy. The override selects the `dokploy` image target, removes host
port bindings, and uses an HTTP-only Caddy edge. Its API-host route proxies Nakama HTTP
and WebSocket traffic through the private `flickkick-nakama` alias, so another stack's
`nakama` on Dokploy's shared network cannot answer; its other route serves the SPA. Do
not expose PostgreSQL or Nakama
ports through public platform domains. The admin console has no host binding in this
mode; use a private operational connection if needed. `/healthz` is the HTTP edge probe.

Unlike the sample Blocksy project, FlickKick uses Nakama and PostgreSQL, not SpacetimeDB,
a module publisher or coturn. Production builds exclude development-only XP simulation
and the local-data deletion control.
