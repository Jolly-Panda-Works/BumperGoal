# FlickKick — System Architecture

Status: 2026-10-28. Stack set by the product owner: React (UI), Phaser 3 (game), Koota ECS (game architecture), Nakama Go runtime (backend), `@dimforge/rapier2d-deterministic` (physics).

Legend: **[Verified]** = demonstrated in this repository · **[Decided]** = chosen and documented, reversible · **[Proposed]** = needs approval.

---

## 1. Overview

```
┌──────────────────────────── Browser (desktop / mobile) ───────────────────────────┐
│ React 18 + TypeScript (strict) + Vite + React Router                              │
│   ├─ App shell: screens, dialogs, i18n (en / fa-RTL), settings, shop, profile     │
│   ├─ services/: NakamaGateway (auth, RPC, socket), LocalProfileStore (offline)    │
│   └─ game/ (integration layer)  ──events──►  Phaser 3 MatchScene                  │
│        MatchController ◄──commands──         (rendering, input, VFX, audio)       │
│              │                                                                    │
│              ▼                                                                    │
│   @flickkick/sim (TS wrapper)  ──►  rapier2d-deterministic 0.21.0 (wasm)          │
│   @flickkick/rules (pure TS: turns, scoring, validation, AI, economy tables)      │
└───────────────────────────────────────────┬───────────────────────────────────────┘
                                            │ HTTPS (RPC) + WSS (realtime)
┌───────────────────────────────────────────▼───────────────────────────────────────┐
│ Nakama 3.x  (Go runtime plugin: backend.so)                                        │
│   ├─ Authoritative match handler "flickkick_1v1" (one per match)                   │
│   │     └─ wazero ──► the SAME Rapier wasm bytes as the browser                   │
│   ├─ Matchmaker hooks + 15 s bot-fallback supervisor                              │
│   ├─ Server AI (Go port of the AI evaluator, uses the same wasm for prediction)    │
│   ├─ RPCs: profile, economy (wallet ledger), shop, daily reward, history, settings │
│   └─ Leaderboards, storage objects, wallet ledger                                  │
└───────────────────────────────────────────┬───────────────────────────────────────┘
                                            │
                                     PostgreSQL 16
```

React owns every non-gameplay screen. Phaser owns only the match scene. The board is never built from React components.

## 2. Repository layout [Decided]

```
/apps/web                 React + Phaser client (Vite)
  src/app                 router, providers, layout
  src/screens             one folder per screen (see SCREEN_INVENTORY.md)
  src/ui                  reusable components (Button, Dialog, Card, CurrencyPill …)
  src/game                Phaser bootstrap, MatchScene, MatchController, input, VFX
  src/services            Nakama gateway, local store, audio, analytics
  src/i18n                en.json, fa.json, i18n runtime
/packages/sim             Rapier shot simulation (fresh world per shot, frames, state hash)
/packages/rules           pure TS: match state, rules, validation, AI, progression math
/packages/config          data files: economy, shop, rewards, levels, AI profiles, rules
/server/nakama            Go plugin: match handler, matchmaker, RPCs, AI, economy
/server/deploy            docker-compose, nakama config, Dockerfile
/docs                     specifications and guides
```

Package manager: pnpm workspaces. The Go plugin is built inside the official `heroiclabs/nakama-pluginbuilder` image whose tag matches the server image (required by Go plugins).

## 3. Physics: Rapier deterministic [Verified, decided by product owner 2026-10-28]

The product owner replaced Box2D 3.1 with **`@dimforge/rapier2d-deterministic`** (github.com/dimforge/rapier). The Box2D proof of concept and its C core were removed from the tree (still in git history, commit `308d11d`).

### 3.1 What runs where

| Side                                     | Code                                                                                                                                                                        | Wasm                                                                                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Browser page + AI Web Worker, Node tests | `packages/sim` drives the official Rapier JS API, loaded through `@dimforge/rapier2d-deterministic-compat` 0.21.0 (wasm embedded as base64, works without a bundler plugin) | byte-identical to `@dimforge/rapier2d-deterministic` 0.21.0 `rapier_wasm2d_bg.wasm`, sha256 `0570d5c8…155d` (checked by a test) |
| Nakama Go plugin                         | `server/nakama/sim` runs **the same wasm file** in wazero and replays the raw wasm-bindgen calls the JS API makes                                                           | the same file, embedded with `go:embed`; sha checked by a Go test                                                               |

- npm 0.21.0 = Rust `rapier2d` 0.36.0 + `enhanced-determinism` (no SIMD), parry2d 0.31.1, nalgebra 0.35.0. Verified from the crate paths embedded in the wasm and the `bindings/typescript` build template at tag `v0.36.0`.
- The npm wasm imports 29 JS glue functions. The Go side implements only what the physics path needs: a fake JS heap for the borrowed `Float32Array` scratch buffer (`new_with_length`, `set_index`, `length`, `drop_ref`), and `globalThis.performance.now()` returning 0 (it only feeds Rapier's internal timers). Any other import panics, which would reveal a divergent call path.
- Nakama's TypeScript runtime (goja) has no WebAssembly, so it cannot host Rapier. The Go runtime is used (approved).

### 3.2 Evidence [Verified 2026-10-28]

`packages/sim/test/scenarios.json` (8 scenarios, including a 6-shot 5v5 formation) → `vectors.json` generated in V8.

- Node 22 (V8): vectors reproduce; 10 repetitions identical.
- Chromium (Playwright E2E, page + worker): matches play through Rapier.
- **Go 1.27.3 + wazero, windows/amd64**: all outcomes, tick counts and hashes identical, 3 repetitions.
- **Go 1.27.1 + wazero, linux/amd64, inside `heroiclabs/nakama-pluginbuilder:3.41.0`**: identical.
- Cost: a 5v5 formation shot (~320 steps) takes ~6.5 ms in wazero. AI decision in V8: Rookie 131 ms, Amateur 129 ms, Pro 270 ms, Elite 503 ms.
- Not yet verified: Firefox, Safari/iOS, Android Chrome, linux/arm64.

### 3.3 Simulation contract (`SIM_VERSION = 3`)

- Rapier's default fixed step (1/60 s, default solver iterations), independent of rendering. The renderer plays back recorded frames.
- **Fresh world per shot**, built in a fixed order (walls body + 16 segments: walls with 45° corner cuts and goal pockets, then bodies in index order, each with one ball collider), so no warm-start state crosses turns.
- Bodies: dynamic, rotations locked, sleeping disabled, CCD on the ball only, friction 0, restitution per config (Rapier's default _average_ combine rule).
- Terminal conditions after each step: goal (ball centre beyond the goal line inside the mouth), then settled (all speeds < `stopSpeed`, slow bodies snapped to zero via `setLinvel`), then timeout (`maxStepsPerShot` = 1200), then invalid (NaN / out of bounds; input is validated before touching the engine).
- Any change to the call order or arguments in `packages/sim/src/index.ts` must be mirrored in `server/nakama/sim/sim.go`. The shared vectors fail otherwise.

### 3.4 Online shot flow

1. The client sends `SHOT {matchId, seq, discIndex, ix, iy}` (f32 impulse; no positions).
2. The server validates turn, seq, ownership, finiteness and magnitude, then simulates in wazero.
3. The server broadcasts the result state + hash. The client replays the same shot locally for animation and snaps to the server state if hashes ever differ.

## 4. Match model [Decided; rules provisional]

```ts
MatchState {
  protocolVersion: 1; simVersion: 1;
  matchId; mode: 'online' | 'online_bot' | 'local_ai' | 'local_pvp';
  players: [{ userId|botId, displayName, level, teamId, side: 'L'|'R', isBot }];
  phase: 'KICKOFF' | 'AWAIT_SHOT' | 'SIMULATING' | 'GOAL' | 'ENDED' | 'ABORTED';
  turn: { index, side, seq, deadlineMs };
  bodies: [{ id, kind: 'disc'|'ball', side?, x, y }];   // f32 values
  score: { L, R }; goalsToWin; shotCount; consecutiveTimeouts: { L, R };
  rngSeed;                                              // AI + coin toss only
  stateHash;
}
```

Rules live in `packages/rules` (TS) and are mirrored in Go. Both run against shared JSON test vectors to guarantee identical decisions. Rule parameters are configurable (`packages/config/rules.json`): discs per team, goals to win, turn time, timeout forfeit count, kickoff formation.

## 5. Multiplayer and matchmaking [Implemented, M7–M8]

### 5.1 Authoritative match (`server/nakama/match.go`, module `flickkick_1v1`)

- Tick rate 10 Hz. One wazero Rapier instance per match (plus one for the server bot).
- Protocol v1 (JSON): `1 SHOT` (c→s `{seq, discIndex, ix, iy}`), `2 SHOT_RESOLVED` (s→c: resolved shot, rules events, full state, `turnMs`, `turnStartMs`), `3 STATE_SYNC` (s→c on join, rejoin and after a rejection), `4 ENDED` (s→each player: result + that player's rewards), `5 REJECT` (s→sender), `6 FORFEIT` (c→s).
- Every shot is validated server-side: match phase, turn window, turn owner, `seq` (stale/replayed rejected), disc ownership, finiteness, and impulse magnitude. The server then simulates, applies the Go rules twin and broadcasts. All rejections are logged with a reason.
- The next turn opens only after the clients' playback (`ticks/60 s` + 2 s after a goal), then the 15 s turn timer runs. Timeouts and forfeits use the same rules as offline play.
- Disconnect: 30 s grace, then `forfeit_disconnect`. Rejoin returns a `STATE_SYNC`. A match that does not start within 20 s is aborted with no charge.
- Client (`OnlineMatchController`): predicts its own shot with the same wasm, replays opponent/bot shots locally from the identical pre-state (checked by hash), and always adopts the server state after playback. A hash mismatch is reported and corrected.

### 5.2 Matchmaking with server-measured bot fallback (`server/nakama/matchmaking.go`)

1. RPC `mm_start {arena}` validates level and coins, registers a _search_ and arms a server timer (`MM_BOT_TIMEOUT_MS`, default 15000).
2. The client adds a Nakama matchmaker ticket tagged with `searchId` (`+properties.arena:<id>`, 2 players).
3. A **MatchmakerOverride** and the timer share one lock. A pair is formed only if both searches are still `searching` (and belong to the ticket owners). The timer assigns a bot only to a search that is still `searching`. Each search ends in exactly one match (race test with 500 iterations under `-race`).
4. Human pair → `MatchmakerMatched` creates the match. Timer → bot match + notification `101` to the client. `mm_status` recovers a missed notification and `mm_cancel` cancels.
5. Searches live in memory. Nakama OSS is single-node, so this is the whole registry; a server restart drops open searches and clients retry.

### 5.3 Economy at match boundaries (`server/nakama/results.go`)

- Entry fee is debited when the match **starts** (all players joined), with refund on abort. A cancelled search or a no-show costs nothing.
- Result per player: XP (`matchXp`), level-up rewards, prize (2 × entry − 5 %), stats and history, written once. Every currency change is an idempotency record in `ledger` (created with storage version `*`) in the same `MultiUpdate` as the wallet change.

### 5.4 Server physics mode: wazero interpreter

wazero's **compiler** mode crashes inside a Go plugin (verified in Nakama 3.41.0: SIGSEGV jumping to `0x100000000`, most likely because Go's plugin/dynamic-link build mode reserves a register that the generated code uses). The plugin therefore uses the **interpreter**. Results are bit-identical (all vectors pass); it is only slower: a 5v5 formation shot takes 208 ms (compiler: 7.8 ms). The authoritative per-turn simulation is affordable. Full-strength server bots are not (Elite ≈ 15 s per decision), so server bot search is capped by `AI_SERVER_MAX_SIMULATIONS` (default 12). Level still changes aim error, power error and defensive weighting. Restoring full Pro/Elite search would need a physics sidecar; the product owner decided against it for now (TECHNICAL_RISKS R-18).

## 6. AI [Decided]

`AIController → ShotCandidateGenerator → PhysicsPredictionAdapter (Rapier) → ShotEvaluator → DifficultyProfile → AIActionValidator`.

- Candidates: for each own disc, direct shots toward the ball, aimed so the ball travels toward the goal, plus bank shots off walls and clearance shots. Count and power steps bounded by the profile.
- Each candidate is simulated with the real wasm on a copy of the state (this is legal: it is the same information a human sees; no hidden future input). The score weighs goal scored, ball progress toward the goal, own-goal risk, defensive coverage of the own goal mouth, and score/match situation.
- Execution noise: aim error (degrees) and power error (%) sampled from a seeded PRNG, so the same state + seed gives the same decision.
- Budget: max candidates × steps capped (e.g. hard ≈ 160 simulations ≈ 300 ms server CPU). It runs in the match loop with a deadline and falls back to the best-so-far.
- Level → profile mapping in `packages/config/ai-profiles.json`, interpolated by player level (§ PRODUCT_SPEC 6).
- The local AI runs in TS in the browser. The server AI runs in Go with the same profile file and the same wasm. Both submit through the same validator as human shots.

## 7. Data ownership [Decided]

| Data                                                      | Owner                                       | Storage                                                            |
| --------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------ |
| Audio, language, graphics, aim sensitivity, accessibility | client preference                           | localStorage + mirrored to Nakama storage (`settings`) when online |
| Display name, avatar, selected team/ball                  | user-editable, server-validated (ownership) | Nakama account + storage `profile`                                 |
| XP, level, stats, match history                           | **server** (online)                         | storage `progress`, `history` (server-write only)                  |
| Coins / gems balances                                     | **server**                                  | Nakama wallet + ledger                                             |
| Inventory                                                 | **server**                                  | storage `inventory` (server-write only)                            |
| Match state                                               | **authoritative match handler**             | memory; result persisted at end                                    |
| Offline local profile                                     | client                                      | IndexedDB, separate from the online profile; no online rewards     |

All server-owned storage objects use `permission_write = 0` (server only).

## 8. Economy integrity [Decided]

- Every currency change goes through one Go function, `ledger.Apply(userId, deltas, reason, idempotencyKey)`. It records an idempotency key in storage and calls `WalletUpdate` within one storage write batch, using `version` CAS to retry on conflict.
- Purchases: the client sends `{itemId, idempotencyKey}` only. The price comes from server config. It is rejected if already owned, has insufficient funds, or the key was already used (that returns the original result).
- Real-money purchases and rewarded ads go through the provider interfaces `PaymentProvider` / `AdProvider`, with a `SandboxProvider` in dev. The sandbox grants are clearly labelled "TEST" and disabled in production builds.

## 9. Game architecture: Koota ECS + Phaser + React [Implemented]

The match runtime is an ECS built with **Koota 0.6.6** (`apps/web/src/game/ecs`).

| Layer                                         | Owns                                                                                                                                                                                                                                           | Reads / writes                                                                                                                               |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `MatchController` (rules system)              | turn flow, timers, AI scheduling, validation via `@flickkick/rules`, physics via `@flickkick/sim`                                                                                                                                              | writes world traits `MatchTrait` (canonical serializable `MatchState`), `HudTrait`, `EventsTrait`, `PlaybackTrait`                           |
| ECS systems (`systems.ts`, pure, unit-tested) | `playbackSystem` (recorded Rapier frames → `Position`, impact detection), `syncTargetsSystem` (`MatchTrait` → `Target`), `easeSystem` (`Position` → `Target`, respects `HoldTrait`), `highlightSystem` (`Highlighted` tag on the side to move) | entity traits `BodyRef`, `IsDisc`/`IsBall`, `Team`, `Position`, `Target`, `Highlighted`, `Aiming`, `View`                                    |
| Phaser `MatchScene`                           | rendering and pointer input only                                                                                                                                                                                                               | runs the systems each frame; renders from `Position`/`Highlighted`; input adds/updates the `Aiming` trait and calls `controller.requestShot` |
| React HUD (`screens/Match.tsx`)               | score, players, timer, banners, pause                                                                                                                                                                                                          | `useTrait(world, MatchTrait / HudTrait)` from `koota/react` inside a `WorldProvider`                                                         |

- One Koota world per match, created by the controller and destroyed on dispose. `GameHost` creates and destroys the `Phaser.Game` with the React component lifecycle, deferring destruction until Phaser has booted (React StrictMode).
- The canonical `MatchState` stays plain data so it can be validated, hashed and sent by Nakama. The ECS is the client runtime projection, not the network format. The Nakama Go server runs the same rules on `MatchState` directly (Koota is a JS library).
- Transient effects (sounds, confetti, camera shake) come from the controller's event bus.

## 10. Localisation [Decided]

`i18next` + `react-i18next` with `en.json` and `fa.json`. `<html dir>` switches to `rtl` for fa. CSS uses logical properties (`margin-inline-start`). The pitch never mirrors (left/right are game sides). Only the HUD layout mirrors. Phaser texts read from the same i18n instance. Persian font: Vazirmatn (OFL). Digits are localised with `Intl.NumberFormat('fa-IR')`.

## 11. Security notes

- No secrets in the client. The Nakama server key used by the client is the public "client key", and production values come from env.
- The client stores only Nakama session tokens (auth/refresh), never passwords. Tokens are in memory + localStorage `session` (standard for Nakama web; see TECHNICAL_RISKS R-8).
- All match messages have a schema (op code + JSON validated in Go). Unknown op codes are dropped and logged.
- Structured JSON logging for match lifecycle (`match_created`, `shot_rejected`, `match_ended`, `bot_fallback`), never including tokens.

## 12. Environments

- `docker compose up` → postgres + nakama (with the plugin built in a multi-stage Dockerfile). Web: `pnpm dev`.
- Env vars are documented in `docs/DEPLOYMENT.md` (Phase 1 deliverable).
- CI (GitHub Actions, once the remote exists): lint, typecheck, unit tests, physics determinism (Node + Go/wazero must produce identical hashes), web build, plugin build.
