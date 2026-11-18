# Portrait match, result and local online simulation

## Match and result

The match viewport adapts to the available board slot, with a minimum world height derived from the actual goal art dimensions. Both goal nets remain fully visible behind the original goal lines; physics, collision shapes, formations and shot calculations are unchanged. At 342 x 601, the board slot is 342 x 537; the fitted canvas is approximately 328 x 537, retaining only small side margins to preserve both complete nets.

The drag hint is removed. A turn notice appears centrally for 1.4 seconds, with no pointer interception or reserved layout row. Result is a standalone full-viewport route: ribbon, score, rewards, stats, Home and Play again fit without scrolling. Zero local rewards remain visible. The practice explanation is removed. The ribbon text is constrained to the blue band and ignores zero-size interim layouts.

Two-player results now honor the recorded winner rather than always displaying Victory. Equal goals do not imply a rules-level draw: quitting, disconnecting or repeated timeouts still produce a winner. A short ending reason explains these equal-score outcomes. No draw mechanic was introduced.

## Online simulation in local development

When running the Vite development build without a connected Nakama session, arenas and matchmaking work locally. Search lasts 10 seconds, followed by the existing opponent/entry animation. The bot level equals the player level and its AI profile comes from `profileForLevel`.

Entry fee is charged at actual match initialization, once per match ID. Cancellation before entry costs nothing. Winner prize, win/loss/per-goal XP, arena multiplier and level rewards use the shared online formulas. Wallet, XP and settlement receipts share one device inventory write; duplicate callbacks cannot pay twice. The profile mirrors this persisted progression and queues level-up receipts. Detailed online-category history remains available for these local simulations.

This path is development-only. Its progression is stored on the current device and never writes authoritative production account currency. A connected Nakama session continues to use server matchmaking and server settlement. Production bot fallback defaults to 10 seconds; legacy environment values above 10000ms cannot postpone it beyond that deadline.

## Shop and locker

Coin and gem header controls link directly to their corresponding pack subtab. Wallet UI was removed; the legacy route redirects to coin packs. Trail locker cards use compact fixed rows with their action contained inside the border.

## Verification

- 342 x 601 layout inspection: all result controls fit and both goal nets are visible.
- Independent `localhost` QA account: search completed into a real AI match; entry 50 deducted once; a timed-out loss awarded 30 XP, 0 prize; complete statistics/history opened successfully.
- Search cancellation preserved the QA balance at 450 coins.
- Coin and gem header links selected their corresponding pack tabs.
- Unit coverage: charged-entry requirement, insufficient balance, duplicate charges/settlements, online reward formula parity, progress restoration and camera goal bounds. Server regression caps fallback at 10 seconds.
- User's existing 127.0.0.1 profile/inventory was not used for the rewarded QA match.

Screenshots: 41-full-result.png, 42-visible-goals.png, 43-local-online-rewards.png, 44-victory-fit.png in `docs/ux/screens/`.
