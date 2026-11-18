# Rakhtkan Soccerstars variant

Branch: `rakhtkan-soccerstars-dev`.

The default build on this branch enables only the lobby, friends (same device or private invitation), online matchmaking with the existing bot fallback, the match, results, match statistics, and the combined shop/loadout. Welcome remains for guest identity. Profile, history list, standalone locker, AI setup, ranks, daily/level rewards, tutorial, settings and the admin UI are gated off; their code and server APIs are retained. `/locker` redirects to `/shop`.

Set `VITE_GAME_VARIANT=full` before starting Vite or building to restore the full UI. No database migration or deletion is required. Development screen previews remain available with `npm run dev:screens` and show the enabled screens.

## Friends

Select **Play with friends**, then **One device** or **Invite a friend**. Create a 12-character invitation code and copy it to the other player. The other player enters it under the same mode. The host polls for acceptance; both then join the same authoritative Nakama match. These are unranked matches with no entry fee, currency reward, XP or leaderboard writes.

The new Nakama RPCs are `friend_create`, `friend_join`, `friend_status`, and `friend_cancel`. They require authenticated sessions. Codes expire after ten minutes, allow only one guest, reject self-joins, and are cancelled when the host leaves the waiting screen. Join retries are idempotent. Concurrent joins are serialized and failed match creation does not consume the code. Status is private to the participants, cancellation is host-only, and code attempts are rate limited.

Deploy the updated Nakama plugin together with the web bundle for invitation play. It uses the existing single-node in-memory model of matchmaking; a server restart invalidates pending invitation codes. No TURN/voice server is required for game-state synchronization. The existing voice service, when configured, retains its own policies.

## Shop and equipment

Each cosmetic is locked, purchased, or active. Locked items can be purchased with the existing wallet flow; purchased items can be activated in the shop. Each category has one loadout field, so activating a new item replaces the previous selection. The match consumes those same team, ball, avatar, formation and trail fields. Server-connected activation is validated through `profile_update`; local-only paid items are not queued as server ownership. Currency packs are hidden in this variant.

## Checks

`pnpm --filter @flickkick/web test`, `pnpm --filter @flickkick/web typecheck`, `pnpm --filter @flickkick/web build`, and `go test -short ./...` from `server/nakama`. New tests cover invitation expiration, duplicate/concurrent joins, authorization, creation failure, unranked settlement, and cosmetic state transitions.

## Local invitation play and messages

Both `npm run dev:screens` and the regular Vite dev server provide a development-only invitation authority. Open the same local Vite URL in two different browsers (or separate browser contexts), create an invitation in one, and enter its code in the other. The Node dev server validates turns, simulates shots, and sends the same match state to both players. No Nakama, account rewards or voice server is used by this local path. Pending local sessions are lost on a Vite server restart. Production still uses the authenticated Nakama invitation RPCs.

Application errors, warnings, success and informational notifications share a dismissible popup queue. Existing toast callers use it too; duplicate pending messages are coalesced.

Run `npm run test:friends:local` for the two-browser journey (set `PLAYWRIGHT_CHANNEL=chrome` to use an installed Chrome). The test server starts on 5194 and stops when the run ends.
