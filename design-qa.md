# Design QA

Final result: **blocked for full online end-to-end acceptance; portrait UI checks passed**.

Reference: the supplied sculpted soccer lobby and subsequent annotated portrait screenshots. Later user directions override the original landscape reference: compact portrait canvas, three adjacent mode cards, shared wallet/profile header and five-item bottom navigation.

## Evidence

- `docs/ux/screens/01-home-before.png`: original baseline.
- `docs/ux/screens/13-home-final-en.png`: centered logo, visible pitch, daily reward and compact three-card row.
- `docs/ux/screens/09-portrait-pitch.png`: portrait board and input verification from the gameplay pass.
- `docs/ux/screens/16-local-final.png`: stacked players, distinct selected teams and full-width start.
- `docs/ux/screens/17-ranks-final.png`: compact profile summary, full-width tabs and highlighted player row.
- `docs/ux/screens/18-shop-final.png`: fixed categories, separate subtab color, aligned owned cards and soft scroll edges.
- `docs/ux/reference-comparison.png`: reference and portrait adaptation reviewed together.
- Other numbered screenshots are intermediate design iterations, not acceptance references.

## Checks

- No horizontal document overflow at 393×852. AI setup has main scrollHeight equal to clientHeight (720px).
- Native image proportions preserved. Arena imagery crops proportionally with object-fit rather than stretching.
- Header/footer shared across routes; Home always at the right of navigation.
- Shop title/tabs stay fixed; items scroll, reset with categories, and animate. Owned and equipped items have separate visual states.
- Team rows scroll by mouse drag, touch and wheel. Manual drag moved the first row to scrollLeft 144px (472px content, 328px viewport), without changing the selected team. Selecting Forest disabled Forest for the other player.
- Arena drag settles within one pixel of the next card and restores mandatory snapping. Large image, title with league icon, fee/prize, goals and bottom action fit the portrait card.
- Arabic changes the document to lang=ar and dir=rtl without horizontal overflow. English and Persian remain available.
- Reduced-motion preferences disable route/tab/reward animations.
- Server compilation and unit tests pass; a concurrent identity reservation test verifies a single stable forward/reverse mapping for 24 requests.

## Remaining acceptance limits

- Docker Engine is unavailable, so live Nakama/database tests, multi-client rankings, unique-name collision against the running service and real online level-up presentation still need an operational local server.
- The embedded browser does not expose fullscreen support. Fullscreen/portrait are configured for installed PWA and supported browsers, but the host can deny the request.
- Updated browser E2E sources were not run through the Playwright CLI; manual browser checks and unit tests were used.

No known P0–P2 portrait layout defects remain in the checked screens. Online environment limitations above prevent claiming full end-to-end acceptance.

## History, statistics and fixed panel headings — 2026-11-01

- Shared `PanelScreen` puts heading/Back outside the independently scrolling body. At 342×601, history heading remained at y=66 and body began at y=126 after scrolling. Settings retained the same heading position after 726px of body scrolling. List content cannot paint above the title. Dialog headings/actions also remain outside their scroll body.
- History uses date/result badge, player avatars and names beside the central colored score, then match metadata. Each record links to detailed statistics. Legacy records use the current player avatar/name fallback and leave unavailable historical statistics unknown.
- Real completed-shot observation records shots, scoring shots, own goals, timeouts, average power, simulation motion duration and elapsed match time without changing rules/physics. Shot share is explicitly labelled; possession/passes are not invented. Server history detail reads only the authenticated owner's record.
- An isolated local browser profile completed a real shot and forfeited the match: 1 shot, 91% power, 5.6s motion. The persisted statistics page was checked after reload. User profile data was not changed by this test.
- Daily claim persists a teal/checkmarked Received tile and disabled claim action; seven-day cycle boundary is tested.
- Evidence: `docs/ux/screens/19-history-fixed-title.png`, `20-match-stats.png`, `21-daily-claimed.png`.
- TypeScript, ESLint, production build, 21 web tests and Go server root tests passed. Owner-scoped detail access and invalid-shot exclusion are covered. Live online acceptance limits above still apply.

## Formations — 2026-11-01

- Added 20 distinct five-disc layouts: 3 free and 17 coin purchases (400–2,800). Locker has an owned-only formation tab and a unique active selection. Shop has a formation category. SVG portrait half-pitches preserve proportions and use the same source coordinates as kickoff.
- Manual browser check: Diamond remained equipped after reload; restored Balanced afterwards. At 393×852 all five shop tabs were present, 20 cards rendered, and no horizontal document overflow occurred.
- Tests validate layout bounds, non-overlapping discs, distinct layouts, exact free/paid counts, independent opponents, ownership and a single local currency deduction on repeated purchase. Server tests check owner-scoped entitlement and independent kickoff layouts. Online purchase uses the existing atomic ledger/wallet transaction; live Nakama acceptance remains unavailable as described above.
- Evidence: `docs/ux/screens/22-locker-formations.png`, `23-shop-formations.png`.

## Purchase confirmation — 2026-11-01

All shop Buy actions now open a localized confirmation dialog with the exact item preview, name and price. Packs also require explicit confirmation of their grant. Cancel, Close and Escape do not change inventory. Purchase execution is guarded against repeated confirmation and dismissal while pending; failed purchases keep the dialog open. Manual check: Ocean showed 400 coins; cancelling restored focus to Buy and retained 850 coins / 10 gems. Evidence: `docs/ux/screens/24-purchase-confirmation.png`. TypeScript, lint, 23 web tests and production build passed.

## Matchmaking showdown — 2026-11-01

- Loading cycles roster portraits and placeholder names until the server supplies the assigned opponent. The loading reel is decorative/aria-hidden; live status text describes the real phase. Confirmed name/avatar/level, arena, fee and prize come from participant-scoped `mm_preview`, without joining or charging.
- Confirmed entry amounts appear below both players; 16 staggered coin particles travel to the prize pool before the existing join flow. Rejoining a started match skips the collection animation. Reduced motion disables cycling and particle effects.
- Back/Cancel and route unmount stop the ticket and server search, including assignment-in-flight races. A matched but unstarted game can be aborted by its participant; an already started game cannot be cancelled through this endpoint. No extra wallet deduction was added.
- Temporary local presentation fixture (removed after review) verified the actual component at 342×601: no document horizontal overflow, card scrollHeight/clientHeight both 300px in searching and found states. Names/portraits changed during loading; found state froze the chosen opponent and displayed both 50-coin fees, 95 prize, and 16 particle elements. Screenshots `25-matchmaking-search-preview.png` and `26-matchmaking-found-preview.png` are presentation previews, not proof of a live online match.
- Server tests cover participant-only preview, no lifecycle change on preview, cancellation before start, preservation of started matches and cancellation while a bot match is being created. Live two-client Nakama acceptance remains blocked by the Docker environment described above.

## Paid disc trails — 2026-11-01

- Added ten paid trails (seven coin / three gem) with ribbon, twin, dashed and spark patterns. No free entitlement/default equip exists. Shop uses the purchase-confirmation flow; locker lists owned trails and allows disabling the cosmetic. Six main shop tabs fit in two fixed rows.
- Phaser draws bounded, tapered per-disc history behind the sprites at depth 8; length follows actual rendered speed, with no writes to simulation/rules. Buffers clear when playback stops or the scene is disposed, and reject idle/teleport/long-gap samples. Reduced motion disables trails. Both online participants' trail IDs are entitlement-validated on match creation and sent in state sync.
- Local gameplay fixture used the real controller, Rapier simulation and MatchScene; a normal shot visibly showed the selected trail. The fixture was removed and did not record matches or change the user's inventory. Screenshot `27-disc-trail-gameplay-preview.png` is labelled as a gameplay preview.
- Browser checked ten shop cards at 393×852 without horizontal document overflow; locker displayed No trail equipped and no owned items. Evidence: `28-trails-shop.png`, `29-trails-locker-empty.png`.
- Tests check ten paid-only items, empty default loadout, scoped server entitlements, duplicate local purchase protection, speed-dependent length, taper, idle removal and reset/teleport behavior. Live online purchase/sync still needs the operational Nakama environment noted above.

## Fixed team attributes — 2026-11-01

- All teams have distinct fixed Force/Time/Aim triples, with no upgrade UI or mutable player stat levels. Force sets maximum impulse, Time sets turn duration, Aim changes forward guide range without introducing aiming randomness. Local and authoritative human/bot shot paths use the team's cap; HUD timers use the matching team duration. Base collision physics remain unchanged.
- Team cards occupy the full catalog width, with disc, name, three accessible segmented meters and price/action. Locker and purchase confirmation also show the attributes. At 393×852 the first card measured 355×200px, there was no horizontal document overflow, and values matched the catalog: Volt 8/6/4 with 15s; Coral 6/7/5 with 16s. Confirming Ocean showed 5/5/8 with 14s; the dialog was cancelled without purchase. Evidence: `docs/ux/screens/30-team-attributes-shop.png`.
- Tests verify distinct valid stats for every team, force limits, overpowered-shot rejection, independent turn durations, Aim range, legacy fallback, and timeout boundaries/forfeit behavior. Core rule vectors and AI tests retain their unchanged default-config path. Live two-client online acceptance still needs the operational Nakama environment described above.
