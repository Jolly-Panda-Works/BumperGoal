# FlickKick — Product Specification

Status: Phase 0 draft, 2026-10-28. Items marked **[Q-n]** wait for a product-owner answer (listed at the end). Every value here is provisional and lives in `packages/config/*.json`, not in code.

## 1. Identity

- Name: **FlickKick**. Original logo, palette, typography and art. No assets, names or text are taken from the reference.
- Proposed art direction (for approval with the asset document): bold flat-vector "arcade tabletop" look, a night-stadium palette (deep navy #0E1630, pitch greens, accent electric lime #C6FF3D and coral #FF5A5F), rounded geometric display font (Latin: "Baloo 2" or "Rubik"; Persian: "Vazirmatn"), discs as thick bottle-cap tokens with a team emblem.
- Opponent bot brand: **FlickBot** (always labelled "BOT", with a robot avatar frame).

## 2. Core gameplay rules (provisional, configurable)

| Rule             | Default                                                                              | Basis                                              |
| ---------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------- |
| Discs per team   | 5                                                                                    | verified in reference                              |
| Ball             | 1                                                                                    | verified                                           |
| Win condition    | first to **2 goals**                                                                 | verified (banner + arena card)                     |
| Turn             | one shot per turn, alternating                                                       | verified                                           |
| Turn timer       | 15 s; on expiry the turn passes                                                      | **[Q-2]** (timer not verifiable in frames)         |
| Timeout forfeit  | 3 consecutive timeouts → lose                                                        | proposed                                           |
| Kickoff          | coin toss for first kickoff; after a goal the conceding side kicks off               | partially observed                                 |
| Reset after goal | all bodies return to formation positions                                             | verified                                           |
| Own goal         | counts for the opponent                                                              | proposed (standard football)                       |
| Max match length | none in rule; safety cap 60 shots → higher score wins, tie → sudden-death next goal  | proposed **[Q-2]**                                 |
| Shot limits      | power 0–1 maps to impulse 0–`maxImpulse` (9.0); a disc may be shot only by its owner | proposed                                           |
| Formations       | one default formation in Phase 1 (2-2-1); data-driven so more can come later         | reference has a formation feature; editor deferred |

## 3. Input

- Mouse/touch: press on own disc → drag **away from the shot direction** (slingshot, as observed) → release to shoot. Drag length → power (capped), with a clear power ring + arrow + a short dotted guide line (no full trajectory prediction).
- Cancel by releasing inside the disc radius. Invalid presses (opponent disc, not your turn) flash red and show a tooltip.
- Fine-aim option for mobile (second finger rotates the aim), from Settings → "precision aim".
- Input is locked while `SIMULATING` and when not your turn.

## 4. Modes

| Mode                         | Network                          | Rewards                                         | Notes                             |
| ---------------------------- | -------------------------------- | ----------------------------------------------- | --------------------------------- |
| Online (arena)               | Nakama, authoritative            | coins (pot), XP, stats, leaderboard             | 15 s → bot fallback               |
| Online bot fallback          | Nakama, authoritative, server AI | same as online, recorded `opponentType: bot`    | **[Q-5]** full or reduced rewards |
| vs AI (local)                | none needed                      | **none online** (local practice stats only)     | **[Q-4]**                         |
| Local 2-player (same device) | none                             | none                                            | in the reference store text       |
| Tutorial                     | none                             | one-time coin gift (server-granted when online) |                                   |

## 5. Bot fallback UX (proposed default, **[Q-3]**)

0–15 s: "Searching for an opponent…" with a timer. At 15 s (server-measured) the opponent card flips to the FlickBot avatar with the label "No player found — you'll play against FlickBot" and the match starts automatically after a 2 s countdown, with a cancel button still active during those 2 s.

## 6. AI difficulty by level

Interpolated from `ai-profiles.json`:

| Player level | Profile | Candidates | Aim error (σ°) | Power error (σ%) | Defensive weight | Bank shots                               | Think time |
| ------------ | ------- | ---------- | -------------- | ---------------- | ---------------- | ---------------------------------------- | ---------- |
| 1–3          | Rookie  | 12         | 9°             | 18%              | 0.1              | no                                       | 1.2 s      |
| 4–8          | Amateur | 30         | 5°             | 10%              | 0.4              | no                                       | 1.5 s      |
| 9–15         | Pro     | 70         | 2.5°           | 6%               | 0.7              | yes                                      | 1.8 s      |
| 16+          | Elite   | 140        | 1°             | 3%               | 1.0              | yes + 2-step look-ahead on ball position | 2.0 s      |

Each step is a measurable behavioural difference (search breadth, accuracy, defence term, shot types). Tests assert, for example, that Elite's goal rate over 200 seeded test states is higher than Rookie's.

## 7. Progression

- XP per online match: win 100, loss 30, +20 per goal scored, ×(arena multiplier). Bot matches: same **[Q-5]**. Local: 0.
- Level thresholds: `xp(L) = round(100 × L^1.5)` cumulative, cap 50 for Phase 1.
- Level-up rewards: coins (`100 × L`), every 5 levels a cosmetic. Arena unlocks by level.
- Stats: played, won, lost, goals for/against, win streak, best streak.

## 8. Economy

- **Coins** (soft): earned from matches, daily rewards, level-ups; spent on arena entry fees and cosmetics.
- **Gems** (premium): from level-up milestones and (future) real-money packs; spent on premium cosmetics. **[Q-6]**
- New player: 500 coins, 10 gems.
- Arenas (entry → prize, min level): Park 50→95 (L1), City 200→380 (L3), Coast 500→950 (L6), Capital 1500→2850 (L10), Legends 5000→9500 (L16); prize = 2 × entry × (1 − houseCut). The house keeps ~5% as a coin sink. Bot matches use the same pot, but the house pays the bot's half. **[Q-1]**
- Daily reward: 7-day cycle (50, 75, 100, 150, 200, 250, 5 gems). A missed day resets the cycle. Server time UTC.
- Shop items: team skins (disc colours/emblems), ball skins, arena themes, avatars/frames. Prices in coins or gems.
- Insufficient funds → dialog with "Get coins" → Rewards screen.
- All balance changes go to an auditable ledger (reason, delta, balance, idempotency key, timestamp).

## 9. Monetization (Phase 1 = integration boundaries + sandbox)

Verified in the reference: optional purchases including random items, weekly VIP subscription, interstitial ads between matches ("any purchase removes them"), rewarded free coins, time-limited offers, season pass.

Proposed for FlickKick Phase 1:

| Feature                           | Phase 1 state                                                                                                                                 |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Gem/coin packs (real money)       | catalog + `PaymentProvider` interface + **SandboxProvider** (marked TEST, dev only). No live payments until a provider is approved **[Q-7]**. |
| Starter offer (one-time)          | implemented on top of the payment boundary, sandbox only                                                                                      |
| Rewarded ad (+coins, 3/day cap)   | `AdProvider` interface + sandbox that shows a fake 5 s "TEST AD" panel; server grants via ledger with a daily cap                             |
| Interstitial ads                  | flag `ads.interstitial.enabled=false` by default                                                                                              |
| "No ads" after any purchase       | flag on the profile, honoured by the ad boundary                                                                                              |
| Random-content packs / loot boxes | **not proposed** (regulatory risk) **[Q-6]**                                                                                                  |
| VIP subscription, season pass     | not in Phase 1; architecture leaves room **[Q-6]**                                                                                            |

## 10. Accounts **[Q-8]**

Proposed: guest login with a Nakama device ID (random UUID stored in the browser) → optional link of email + password (Nakama email auth) for recovery and multi-device play. An unlinked guest whose browser storage is cleared loses the account. The UI warns about this on the profile. Display names are unique, 3–16 characters, filtered. Logout of a guest requires confirming the loss risk.

## 11. Localisation

English and Persian (RTL) from day one, plus localised numerals in fa.

## 12. Open questions

Listed in the Phase 0 report (asked in Persian). Q-1 arena stake economy, Q-2 turn timer & safety cap, Q-3 bot UX, Q-4 offline rewards, Q-5 bot-match rewards, Q-6 premium currency / loot boxes / VIP / pass scope, Q-7 payment & ad providers and target market, Q-8 account policy, Q-9 Nakama Go runtime approval, Q-10 hosting.
