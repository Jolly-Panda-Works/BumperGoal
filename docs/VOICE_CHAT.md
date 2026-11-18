# Voice chat in online matches

Status: 2026-11-07. Players of a ranked online match can talk to each other. Voice runs on comms "game rooms"
(comms spec `010-game-rooms`): comms owns the room, the tokens and the LiveKit media server. FlickKick only says who
may join and when the room ends. Persian version: [`fa/VOICE_CHAT.md`](fa/VOICE_CHAT.md).

## How it works

```
Nakama match start (both players joined, ranked)
  └─ POST comms /v1/server/game-rooms {match_id, players:[{id: Nakama user id, name}], video:false}   (async)
Client, after the first STATE_SYNC of the match
  └─ RPC voice_token {matchId} ─► Nakama asks the match (MatchSignal "voice"): caller is a player, ranked, started, not ended
                                  └─ POST comms …/players/{user}/token   (opens the room first if it is missing or closed)
     ◄─ {enabled:true, token}  or  {enabled:false}
  └─ lazy import services/voiceRoom.ts (@comms/sdk/game + livekit-client) → room.join(token)
Match end (finalize, forfeit, disconnect forfeit, abort, cleanup, MatchTerminate)
  └─ POST comms …/close   (once per match, async)
comms webhook game_room.player_reported
  └─ POST Nakama /v2/rpc/voice_webhook?http_key=…&unwrap → HMAC check → storage voice_reports → /admin "Voice reports"
```

- Server code: `server/nakama/voice.go` (comms client, room hooks, `voice_token`, `voice_webhook`,
  `admin_voice_reports`). Hooks are called from `match.go` (`start`, `abort`, `cleanup`, `MatchSignal`) and
  `results.go` (`finalize`).
- Web code: `apps/web/src/services/voice.ts` (session state, no SDK at runtime), `voiceChat.ts` (the app instance),
  `voiceRoom.ts` (SDK + LiveKit, loaded only when a token arrives), `ui/VoiceControls.tsx`, `ui/VoicePeerDialog.tsx`,
  and the HUD in `screens/Match.tsx`.

## Decisions

| Topic                 | Decision                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which matches         | Ranked human vs human only. Bot matches answer `{enabled:false}`.                                                                                                                                                                                                                                                                                                               |
| Room id / player ids  | The Nakama match id and the Nakama user ids. Names are the display names (control characters removed, 100 chars).                                                                                                                                                                                                                                                               |
| When the room opens   | At match start, in a goroutine so the 10 Hz match loop never waits. `voice_token` also opens it if that failed or the room is gone, because comms create is idempotent.                                                                                                                                                                                                         |
| Token delivery        | RPC `voice_token`, called by the client after it joined the match and again on every rejoin (one-use tokens, 10 min). Authorization goes through `MatchSignal`, so only the match's own state decides. Limit: 6 tokens per player per minute.                                                                                                                                   |
| When the room closes  | Every end path calls `closeVoice()`, which runs once per match. Closing a closed room counts as success.                                                                                                                                                                                                                                                                        |
| Voice is optional     | No `COMMS_URL`/`COMMS_SERVER_KEY`: voice is off, logged once at start. comms down: matches play as before, the player sees no mic button and no error; the server logs `voice_unavailable` once per outage and `voice_recovered` when it works again. The comms key is never logged.                                                                                            |
| Timeouts              | 5 s per comms request, 10 s per room operation.                                                                                                                                                                                                                                                                                                                                 |
| Mic                   | Starts off. The browser permission prompt appears only when the player taps the mic. A blocked permission shows a toast and a red mic.                                                                                                                                                                                                                                          |
| Silence / report      | Tap the opponent's avatar: "Silence" (local only, SDK `silence`) and a report with a reason (spam, abuse, cheating, other). One report per opponent per match.                                                                                                                                                                                                                  |
| Server mute / removal | `mutedByServer` shows a disabled mic and a toast; `removed` and `closed` hide the controls. A dropped media connection rejoins up to 2 times with a fresh token.                                                                                                                                                                                                                |
| Audio playback        | Since SDK 0.3.0 the SDK plays remote audio itself (one hidden `<div data-comms-game-audio>` with an `<audio>` per player; silence mutes it), so `voiceRoom.ts` only maps the SDK API. When autoplay is blocked the SDK sets `audioBlocked`; the match shows a "Tap to hear your opponent" pill under the HUD and the first tap anywhere (or the mic tap) calls `resumeAudio()`. |
| Reports storage       | Nakama storage, collection `voice_reports`, system user, no client read or write. Key = reversed time, so the admin list is newest first (100 shown).                                                                                                                                                                                                                           |
| Webhook endpoint      | Nakama HTTP RPC with `http_key` and `unwrap`, the plugin's only incoming HTTP path. The `Comms-Signature` header (`t=…,v1=…`, HMAC-SHA256 of `t.body`, any `v1` may match during secret rotation) is checked with `COMMS_WEBHOOK_SECRET`, 5 min tolerance. Calls with a player session are refused. Other event types are only logged.                                          |
| Setting               | `voiceChat` in settings (default on), in the Audio card. Turning it off during a match leaves the room.                                                                                                                                                                                                                                                                         |
| SDK delivery          | Same as the ws app: a packed tarball `apps/web/vendor/comms-sdk-0.3.0.tgz` (`npm pack` of `comms/sdk/packages/sdk` built from comms `dev`), referenced as `file:./vendor/…`, plus `livekit-client` 2.23.0. To update: build the SDK in comms, `npm pack --pack-destination apps/web/vendor`, point `apps/web/package.json` at the new file, `pnpm install`.                     |
| Bundle                | The SDK (15 kB) and LiveKit (570 kB) are separate chunks loaded only when voice starts. The first-load chunk grows by about 12 kB raw / 3.5 kB gzip (voice state, HUD controls, strings in three languages). The repo has no bundle budget file.                                                                                                                                |

## Setup

1. In comms: create an app for the game with the web origin(s) in its allowed origins, and a server key:
   `comms apps create --name FlickKick --issuer flickkick --origin https://play.example.com` (prints the app and its
   first API key).
2. Create a webhook endpoint with that key (the answer holds the secret once):

   ```bash
   curl -X POST "$COMMS/v1/server/webhooks" -H "Authorization: Bearer $COMMS_SERVER_KEY" -H 'Content-Type: application/json' \
     -d '{"url":"https://api.play.example.com/v2/rpc/voice_webhook?http_key=<NAKAMA_HTTP_KEY>&unwrap","event_types":["game_room.player_reported"]}'
   ```

3. Set the variables below and rebuild `web` (the comms URL is baked into the bundle).

| Variable                              | Where                    | Purpose                                                                                                  |
| ------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------- |
| `COMMS_URL`                           | Nakama (`--runtime.env`) | How Nakama reaches comms, e.g. `http://comms:4410` or `https://comms.example.com`                        |
| `COMMS_SERVER_KEY`                    | Nakama, secret           | comms app server API key                                                                                 |
| `COMMS_WEBHOOK_SECRET`                | Nakama, secret           | Secret of the webhook endpoint (`whsec_…`); empty refuses all webhooks                                   |
| `COMMS_PUBLIC_URL` → `VITE_COMMS_URL` | web build                | comms address for browsers; empty builds a client without voice                                          |
| `VOICE_CONNECT_SRC`                   | web (Caddy CSP)          | Extra `connect-src` origins: comms and LiveKit, e.g. `https://comms.example.com wss://media.example.com` |

The Caddy files now send `Permissions-Policy: microphone=(self)`; without it the browser refuses the microphone.

## Tests

- Go (`server/nakama/voice_test.go`, fake comms over `httptest`): client calls and error text, configuration, room
  opened at start and closed once on forfeit, disconnect forfeit, abort, cleanup and terminate; bot and unconfigured
  matches touch nothing; comms down logs once; `voice_token` refuses strangers, unknown and ended matches; mint
  limit; signature checks; webhook storage and the admin list.
- Go live (`voice_live_test.go`): `COMMS_LIVE_URL` + `COMMS_LIVE_SERVER_KEY` run the real comms lifecycle.
- Web (`test/voice.test.ts`, `test/voiceControls.test.tsx`): session states, mic permission, server mute, silence,
  report once, close/remove, rejoin, stop races, blocked playback and resume; mic button, badge and tap-to-hear notice
  rendering.
- E2E (`apps/web/e2e/voice-match.spec.ts`): two phone browsers matched in a real ranked match on Nakama with real comms
  and LiveKit. Needs `E2E_COMMS_URL`, `E2E_COMMS_SERVER_KEY`, optional `E2E_ADMIN_USERNAME`/`E2E_ADMIN_PASSWORD`,
  `E2E_FAKE_AUDIO` (a looping WAV, so LiveKit detects speech) and `E2E_CHROMIUM_PATH`; skipped without them.
