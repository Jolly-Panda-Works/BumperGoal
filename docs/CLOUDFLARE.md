# Bumper Goal on Cloudflare Pages

Target: `https://bumpergoal.jollypanda.ir`.
Repository: `https://github.com/Jolly-Panda-Works/BumperGoal`, production branch `main`.

## What this deployment runs

Cloudflare Pages hosts the browser client, car models, fonts, art and sound. Practice versus AI,
tutorials and two players on one device run without a backend. Local profile and inventory stay
in that browser. Nakama multiplayer, matchmaking, shared accounts, invitations between devices,
server-owned rewards and rankings require a separately hosted Nakama/PostgreSQL backend.
The existing Go/Docker backend cannot be deployed as static Pages assets.

## Create the Pages project

1. Sign in at https://dash.cloudflare.com and select the account containing `jollypanda.ir`.
2. Open **Workers & Pages**, choose **Create application**, then **Pages** and **Connect to Git**
   (the label may appear as **Import an existing Git repository**).
3. Connect GitHub. Select **Jolly-Panda-Works** and authorize the Cloudflare GitHub application
   for **BumperGoal**. If the repository is absent, update the application's repository access
   in GitHub organization settings.
4. Select `Jolly-Panda-Works/BumperGoal` and use:

| Setting                | Value                         |
| ---------------------- | ----------------------------- |
| Project name           | `bumpergoal`                  |
| Production branch      | `main`                        |
| Framework preset       | `None`                        |
| Root directory         | repository root (leave blank) |
| Build command          | `pnpm run build:cloudflare`   |
| Build output directory | `apps/web/dist`               |

5. Add these plain build environment variables for **Production** and **Preview**:

| Variable            | Value     |
| ------------------- | --------- |
| `NODE_VERSION`      | `22.22.0` |
| `PNPM_VERSION`      | `10.28.0` |
| `VITE_GAME_VARIANT` | `full`    |

Leave automatic dependency installation enabled. Do not set `SKIP_DEPENDENCY_INSTALL`.
No API token or GitHub secret is needed for the native Git integration.
Initially leave `VITE_NAKAMA_HOST`, `VITE_NAKAMA_PORT`, `VITE_NAKAMA_SSL`,
`VITE_NAKAMA_SERVER_KEY` and `VITE_COMMS_URL` unset; do not use localhost in a public build.

6. Choose **Save and Deploy**. The build runs the Vite production build and
   `tools/check-cloudflare-build.mjs`, which validates Pages limits, SPA routing, font,
   menu artwork and all twelve car models. Wait for **Success**, then test the assigned
   `*.pages.dev` URL. Use the URL Cloudflare actually assigns if the name is unavailable.

## Attach the custom domain

1. In the Pages project open **Custom domains → Set up a custom domain**.
2. Enter `bumpergoal.jollypanda.ir` and continue.
3. Since the parent zone already uses Cloudflare nameservers, accept the proposed DNS record
   if Cloudflare offers to create it. Otherwise, after associating the hostname with the Pages
   project, add this record in **jollypanda.ir → DNS → Records**:

| Field        | Value                                                           |
| ------------ | --------------------------------------------------------------- |
| Type         | `CNAME`                                                         |
| Name         | `bumpergoal`                                                    |
| Target       | the assigned Pages hostname, for example `bumpergoal.pages.dev` |
| Proxy status | `Proxied`                                                       |
| TTL          | `Auto`                                                          |

4. Wait for the Pages custom domain and HTTPS certificate to show **Active**.
   Open `https://bumpergoal.jollypanda.ir`. Hostnames are case-insensitive.
   Associate the hostname with Pages first; a DNS record alone is insufficient.

## Verify and update

- Open the custom domain on desktop and mobile. Confirm menu art, font and equipped car load.
- Open `/shop` directly and refresh it. It must load through the SPA fallback.
- Start a practice match and a same-device match. Check car models, sound and shot controls.
- Each subsequent push to `main` triggers an automatic production deployment.
- If the build fails, share the error section of its build log, not credentials.

## Enable online play later

Use the Docker/Nakama deployment in `docs/DEPLOYMENT.md` on a server. An example API hostname
is `api.bumpergoal.jollypanda.ir`, pointing to that server, with valid HTTPS and WebSocket support.
Once healthy, set these Pages production build variables and redeploy:

```text
VITE_NAKAMA_HOST=api.bumpergoal.jollypanda.ir
VITE_NAKAMA_PORT=443
VITE_NAKAMA_SSL=true
VITE_NAKAMA_SERVER_KEY=<the public Nakama client key from that server>
```

The client key is public by design. Database passwords, session/refresh signing keys, admin
passwords and the Nakama HTTP key belong only on the backend, never in `VITE_*` variables.

## Prepared repository files

- `.node-version`: pinned Node version.
- `wrangler.jsonc`: Pages project and output directory (no Worker entry point).
- `package.json`: `build:cloudflare` production build and deployment checks.
- `apps/web/public/_redirects`: direct-route SPA fallback, copied into `dist`.
- `tools/check-cloudflare-build.mjs`: asset and platform-limit verification.

Official documentation:

- https://developers.cloudflare.com/pages/get-started/git-integration/
- https://developers.cloudflare.com/pages/configuration/build-image/
- https://developers.cloudflare.com/pages/configuration/custom-domains/
- https://developers.cloudflare.com/pages/platform/limits/
