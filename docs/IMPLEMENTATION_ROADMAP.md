# FlickKick — Implementation Roadmap (Phase 1: Foundation Release)

All work is committed to `dev`. Each milestone requires lint + typecheck + tests + build to pass before its commit.

| #   | Milestone                                   | Content                                                                                                   | Done when                                                          | Status                        |
| --- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------- |
| M0  | Discovery & architecture                    | reference study, docs, physics PoC                                                                        | 5 docs + PoC with identical hashes in Node/Chromium/wazero         | **done**                      |
| M1  | Workspace                                   | pnpm monorepo, TS strict, ESLint/Prettier, Vitest, Vite app, physics build script, GitLab CI skeleton     | `pnpm check` green                                                 | **done**                      |
| M2  | Sim package                                 | `@flickkick/sim` wrapper, config, determinism tests (8+ scenarios, baseline hashes)                       | Vitest determinism suite green                                     | **done** (26 tests)           |
| M3  | Rules + local match                         | `@flickkick/rules` (state machine, validation, scoring), Phaser MatchScene, input, HUD, local 2P          | playable local 2-player match                                      | **done**                      |
| M4  | AI                                          | candidate generator, evaluator, profiles, level mapping, local vs-AI mode                                 | AI tests (validity, determinism, time budget, difficulty ordering) | **done** (47 rules/AI tests)  |
| M5  | App shell & UI kit                          | router, all F-screens, UI components, i18n en/fa RTL, settings applied                                    | every nav item reaches a working screen; e2e smoke                 | **done** (6 Playwright tests) |
| M6  | Nakama backend                              | docker compose (Postgres + Nakama), Go plugin build, auth (guest + email link), profile/storage           | client logs in against local Nakama                                | **done** (live E2E)           |
| M7  | Authoritative match                         | Go match handler with wazero sim, protocol v1, validation, reconnection, Go rules mirror + shared vectors | two browsers play an online match                                  | pending                       |
| M8  | Matchmaking + bot fallback                  | `mm_start`/`mm_cancel`, CAS ticket state, server AI in Go, 15 s fallback (configurable in dev)            | integration tests incl. race + cancel                              | pending                       |
| M9  | Progression & economy                       | ledger, wallet, XP/levels, rewards, daily reward, arenas entry/prize, history, leaderboard                | idempotency tests green                                            | pending                       |
| M10 | Shop & monetization boundaries              | catalog, purchases, inventory/equip, PaymentProvider/AdProvider sandboxes                                 | purchase e2e with virtual currency                                 | pending                       |
| M11 | QA & deployment                             | Playwright e2e for the 13 journeys, DEPLOYMENT.md, prod compose, health checks                            | full suite green                                                   | pending                       |
| M12 | Art & audio requirements                    | `docs/ART_ASSET_REQUIREMENTS.md` from the implemented screens                                             | document complete                                                  | pending                       |
| —   | **STOP: Phase 1 report, wait for approval** |                                                                                                           |                                                                    |                               |

## Notes (2026-10-28, M1–M5)

- Online-only screens (arena matchmaking, shop purchases, rewards, wallet, leaderboard) are implemented as UI with a truthful
  "online services not connected" state; their server behaviour lands in M6–M10.
- Local results only update the local practice record (no coins/XP), per the approved default.
- Default answers in use until the product owner replies: 15 s turn timer, 3 timeouts forfeit, 60-shot cap with sudden death,
  automatic bot fallback, no rewards offline, full rewards for online bot matches, coins + gems, no loot boxes/VIP/pass in Phase 1.
- The AI worker was verified in the dev server (E2E); the production bundle builds, but has not yet been exercised end-to-end.

## Notes (2026-10-28, stack change + M6)

- Physics switched to `@dimforge/rapier2d-deterministic` (product owner). JS and the Nakama Go plugin (wazero) run the same
  wasm; shared vectors pass in V8 and Go on windows/amd64 and linux/amd64.
- Match runtime moved onto a Koota ECS (product owner).
- M6: Nakama 3.41.0 + PostgreSQL 16 via Docker Compose; Go plugin (nakama-common v1.48.0) with idempotent player setup
  (starting wallet granted once, verified with 5 concurrent logins), `profile_get` / `profile_update` with server-side
  validation, guest device login, session restore/refresh, email linking and email sign-in for recovery.

## Notes (2026-10-28, M7–M8)

- Authoritative online matches on Nakama with Go rules/AI twins (rules vectors shared with TS) and Rapier in wazero.
- Matchmaking with a server-measured 15 s bot fallback; race-safe via MatchmakerOverride + one lock (500-iteration
  `-race` test). Bot matches are labelled everywhere (HUD, result, history).
- Entry fee/refund/result rewards written idempotently. Online history (`history_list`) and server rewards on the result
  screen.
- Verified live: Go suite on linux/amd64; 4 Nakama integration tests (human match + cheat rejections, bot fallback, cancel,
  eligibility); browser E2E for bot fallback and for two humans whose clients converge on identical state hashes.
- E2E now runs against the production bundle (`--mode e2e` adds only the read-only test hook).
- Server bot strength is capped because wazero must run interpreted inside the plugin (R-18). Product owner decided
  (2026-10-28) not to add a physics sidecar for now.

## Notes (2026-10-28, M11 deployment)

- Production stack for one Linux host: Caddy (automatic HTTPS, strict CSP, HSTS, caching, HTTP/3) serving the web build
  and proxying Nakama; PostgreSQL not exposed; console on loopback; resource limits, log rotation, scheduled `pg_dump`
  backups. `gen-secrets.sh` creates `.env.prod`. Guide: `docs/DEPLOYMENT.md`.
- Rehearsed locally over HTTPS: production smoke test (guest, local match, online bot match) with zero CSP violations and
  console errors; backup + restore verified.
- Fixed: Koota schema traits generate code with `new Function`, which the CSP blocks (blank page in production). All data
  traits now use the callback form; a regression test forbids code generation.
- Still open for M11: real-domain/Let's Encrypt deployment, arm64 host test, load test.
