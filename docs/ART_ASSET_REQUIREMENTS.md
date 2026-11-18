# FlickKick: 2D Art and Audio Asset Requirements

Status: Phase 1 deliverable, 2026-10-28. Built from the screens and the match scene **as implemented** (sizes come from the
code, not estimates). Every visual in the current build is a **placeholder** drawn in code (Phaser graphics, CSS or inline
SVG). This document lists what replaces each one.

- Machine-readable source: [`docs/art/asset-manifest.json`](art/asset-manifest.json). The tables in §4 and §5 are generated
  from it with `pnpm art:doc`; edit the JSON, not the tables.
- Each asset has a unique ID (e.g. `PCS-DISC`). Use the ID in file names, tasks and review comments.
- "Category defaults" apply to every asset in that category. A row overrides only what it states.

## 1. Art direction (proposal for approval)

FlickKick is an **original** turn-based tabletop soccer game. The genre convention (top-down pitch, round player discs,
a ball, flick to shoot) is shared with many games. The look must be FlickKick's own: **do not reference, trace or imitate the
artwork, logos, characters or UI of any existing game**, including the one studied during discovery.

| Element                                                 | Direction                                                                                                                                      |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Mood                                                    | Floodlit night-stadium arcade: energetic, clean, readable on a phone                                                                           |
| Rendering                                               | Flat-vector with soft volume (gentle bevel + one specular highlight), no photorealism, no heavy textures                                       |
| View                                                    | Strict top-down orthographic for everything on the board                                                                                       |
| Light                                                   | From the top-left at 45°; soft contact shadows to the bottom-right (+4, +6 px at 1x)                                                           |
| Palette (UI tokens in `apps/web/src/styles/tokens.css`) | Navy `#0e1630` / `#18234a` / `#22305e`, text `#f4f7ff`, muted `#a9b4d6`, lime accent `#c6ff3d`, coral `#ff5a5f`, sky `#4cc9f0`, gold `#ffc83d` |
| Pitch greens (placeholder)                              | `#1f7a3e` / `#26914a` stripes, lines `#eaf7ee`                                                                                                 |
| Team colours                                            | Data-driven, in `packages/config/data/cosmetics.json` (e.g. Volt `#c6ff3d` on `#0e1630`, Coral `#ff5a5f` on `#ffffff`)                         |
| Typography                                              | UI fonts are live text (Rubik for Latin, Vazirmatn for Persian). Art never contains UI text, except marketing images (§4F)                     |
| Characters                                              | Friendly, rounded, sporty animal avatars and a clearly robotic FlickBot                                                                        |
| Accessibility                                           | Teams, tiers and states never differ by colour alone (shape/emblem/text too). Check in greyscale and with a deuteranopia filter                |

## 2. Board geometry and scale (from the code)

The match is drawn on a fixed **logical canvas of 1280 × 720 game px**, scaled to fit the screen (`Phaser.Scale.FIT`).
Physics units map to pixels at **1 unit = 66 game px** (`apps/web/src/game/theme.ts`).

| Element            | Physics     | Game px at 1x         | Position (top-left)            |
| ------------------ | ----------- | --------------------- | ------------------------------ |
| Canvas             |             | 1280 × 720            | 0, 0                           |
| Pitch (playable)   | 15 × 9 u    | 990 × 594             | 145, 63                        |
| Frame (outer)      |             | 1026 × 630, radius 22 | 127, 45                        |
| Goal pocket (each) | 1.0 × 2.6 u | 66 × 172              | left 79, 274 · right 1135, 274 |
| Team banners       |             | 12 × 594              | left 45, 63 · right 1223, 63   |
| Centre circle      | r 1.3 u     | r 85.8                | centred 640, 360               |
| Penalty box        | 2.2 × 4.8 u | 145 × 317             | against each goal line         |
| Goal box           | 0.9 × 3.2 u | 59 × 211              | against each goal line         |
| Disc               | r 0.42 u    | Ø 55.4                |                                |
| Ball               | r 0.22 u    | Ø 29.0                |                                |

**Draw order** (Phaser depth): background & pitch 0 → goals/net 1 → shadows & turn rings 9 → discs 10 → ball 11 → impact
effects 15 → aim indicator 20 → confetti 30 → React HUD overlay (score, players, banners) above the canvas.

**Why @2x and @3x.** Measured display scale of the board: phone landscape (DPR 3) ≈ 1.1, tablet (DPR 2) ≈ 1.8,
1080p desktop ≈ 1.3, 4K desktop ≈ 3. Export every raster at **@2x** (default) and **@3x** (high-DPI). Author masters as
vectors, or at **4x** for raster painting.

### Technical dependencies (engineering, not art)

| ID       | Needed for                   | Work                                                                                                                                   |
| -------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **TD-1** | All board art at @2x/@3x     | The Phaser canvas currently renders at 1280 × 720 and is upscaled; it must render at the device pixel ratio and load @2x/@3x textures. |
| **TD-2** | Arena themes other than park | The match scene must load the theme of the arena being played (the arena already carries a `theme` field in `arenas.json`).            |
| **TD-3** | Every raster asset           | An asset loader + texture atlases replace the procedural drawing in `MatchScene` and the inline SVG in `ui/`.                          |

## 3. Priorities

- **P0**: replaces the placeholders that define the look of the Foundation Release (one complete arena, two teams, one ball,
  icons, avatars, logo, app icon).
- **P1**: needed for the first polished public release (all teams/balls/arenas, effects, illustrations, thumbnails, rank
  badges, share image, remaining audio).
- **P2**: optional polish and future expansion.

### P0 checklist

- [ ] BRD-BG (park) · BRD-PITCH (park) · BRD-FRAME (park) · BRD-GOAL
- [ ] PCS-DISC (team_volt, team_coral) · PCS-BALL (ball_classic)
- [ ] UI-ICON-NAV (5) · UI-ICON-ACTION (16) · UI-CURRENCY (coin, gem) · UI-EMBLEM (bolt, star)
- [ ] UI-AVATAR (fox, owl, bot) · UI-LOGO (wordmark, mark) · MKT-ICON (6 files)
- [ ] Audio P0: SFX-TAP, SFX-KICK, SFX-HIT, SFX-WALL, SFX-GOAL, SFX-WHISTLE, SFX-WIN, SFX-LOSE, SFX-ERROR
- [ ] Engineering: TD-1, TD-3

### P1 checklist

- [ ] Arena themes city, coast, capital, legends: BRD-BG, BRD-PITCH, BRD-FRAME, UI-ARENA (all 5) · BRD-NET · BRD-BANNER (needs TD-2)
- [ ] PCS-DISC (ocean, sunset, royal, forest) · PCS-BALL (neon, gold) · PCS-SHADOW · PCS-RING
- [ ] UI-EMBLEM (wave, sun, crown, leaf) · UI-AVATAR (bear, tiger) · UI-MODE (3) · UI-STATE (5)
- [ ] FX-IMPACT · FX-GOAL · HUD-BANNER · HUD-VS · HUD-UNKNOWN · HUD-LEVELUP · HUD-COACH (3)
- [ ] THB-TEAM (6) · THB-BALL (3) · THB-PACK (4) · THB-REWARD (4) · THB-RANK (5) · MKT-OG (en, fa)
- [ ] Audio P1: SFX-COIN, SFX-MATCHFOUND, SFX-TICK, SFX-LEVELUP, MUS-MENU

### P2 checklist

- [ ] PCS-AIM · FX-TRAIL · FX-NET · HUD-RESULT · UI-FRAME · UI-SPINNER · MKT-PROMO
- [ ] Audio P2: SFX-PURCHASE, MUS-MATCH

### Deliberately not listed

These have no screen and no approved plan, so no assets are requested: achievements, season/battle pass, random-content
packs (loot boxes), VIP subscription, friends/gifts, minigames and events. UI chrome (buttons, panels, dialogs, toggles,
tabs, progress bars, the turn timer ring) is **drawn by CSS** with the design tokens and needs no raster assets. If textured
panels are wanted later, they would be 9-slice SVGs (corner caps 24 px at 1x) and can be added as a P2 category.

## 4. Visual asset inventory

<!-- GENERATED:ASSETS:START -->

### A. Game board

**Category defaults** (apply to every asset below unless the row says otherwise):

- Format: WebP (lossy q90) for opaque surfaces; PNG-32 for parts with transparency
- Transparency: No (opaque) unless stated
- Animation: None
- Nine-slice / tiling: None
- States: Default
- Layer / draw order: Phaser depth 0 (below rings, discs, ball)
- Exports: @2x and @3x
- Naming: `fk_board_<name>_<variant>@<scale>.<ext>`
- Folder: `apps/web/public/assets/board/`
- Production notes: Top-down orthographic view, no perspective. Lighting from the top-left at 45°, soft. Keep the playable area readable: markings must stay ≥ 60% contrast against the grass at 1x.
- Acceptance: Matches the stated pixel size exactly; aligns with the physics geometry in packages/config/data/physics.json (1 unit = 66 game px); no baked-in UI text.

| ID             | Asset                                                | Purpose & usage                                                                                                                                                                                                   | Screen / scene            | Qty & variants                                                                                                                       | Size at 1x (logical px)                                                                 | Aspect  | Specifics (format · alpha · anim · slicing · states · layer)                                                       | Priority                 | Placeholder today                                          | Depends on                          | Notes & extra acceptance                                                                                                                                                                                                                               |
| -------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------ | ---------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **BRD-BG**     | Stadium background                                   | Fills the whole board canvas behind the pitch (stands, floodlit night stadium, crowd silhouettes). Letterbox areas on wide screens show the page background, so the edges should fade to the page colour #0b1226. | F-07 Match, F-03 Tutorial | 1 per arena theme — park, city, coast, capital, legends                                                                              | 1280×720                                                                                | 16:9    | category defaults                                                                                                  | P0 (park) / P1 (other 4) | Placeholder: flat colour #0b1226 (MatchScene.drawPitch)    | TD-1, TD-2 (themes other than park) | Keep the central 1190×630 area calm (the pitch covers it). Edges carry the theme identity. Acceptance: Edge pixels within ±6 of #0b1226 so the letterbox seam is invisible.                                                                            |
| **BRD-PITCH**  | Pitch surface with markings                          | Playable grass surface: stripes plus all markings (touchlines, halfway line, centre circle r=85.8, centre spot r=4, penalty boxes 145×317, goal boxes 59×211).                                                    | F-07 Match, F-03 Tutorial | 1 per arena theme — park (grass), city (rooftop turf), coast (sand-edge turf), capital (premium stadium grass), legends (night/gold) | 990×594 (15 × 9 units), placed at x 145, y 63                                           | 5:3     | category defaults                                                                                                  | P0 (park) / P1 (other 4) | Placeholder: procedural stripes + white lines              | TD-1, TD-2                          | Marking geometry must match exactly (it is drawn in code today; see MatchScene.drawPitch). Lines 3 px at 1x, colour close to #eaf7ee at 85% opacity. Acceptance: Overlaying the procedural placeholder at 50% shows no line misalignment > 1 px at 1x. |
| **BRD-FRAME**  | Pitch frame / boards                                 | Raised rounded border around the pitch (the walls the discs bounce off).                                                                                                                                          | F-07 Match                | 1 per arena theme — park, city, coast, capital, legends                                                                              | 1026×630 at x 127, y 45; corner radius 22; inner edge = pitch edge                      | ≈1.63:1 | format: PNG-32 · transparency: Yes (transparent centre) · slicing: 9-slice: corners 40×40 at 1x, stretchable edges | P0 (park) / P1 (other 4) | Placeholder: navy rounded rectangle with 3 px edge         | BRD-PITCH                           | The inner edge is the physical wall: art must not intrude into the pitch area (discs touch it). Acceptance: Transparent hole is exactly 990×594 at 1x.                                                                                                 |
| **BRD-GOAL**   | Goal (posts, crossbar seen from above, pocket floor) | Goal pocket behind each goal line. One asset, mirrored for the right side.                                                                                                                                        | F-07 Match                | 1 (mirrored in code) — Default; optional per arena theme                                                                             | 66×172 pocket + 8 px post bleed → 80×184 file at 1x; left pocket at x 79–145, y 274–446 | ≈0.43:1 | format: PNG-32 · transparency: Yes · layer: Phaser depth 1 (above pitch, below discs)                              | P0                       | Placeholder: dark rectangle + 9 px net grid + white stroke | BRD-NET                             | Opening faces right in the source file; posts sit exactly on the pitch edge.                                                                                                                                                                           |
| **BRD-NET**    | Goal net texture                                     | Tileable net mesh inside the goal pocket; used by the goal ripple effect (FX-NET).                                                                                                                                | F-07 Match                | 1                                                                                                                                    | Tile 32×32                                                                              | 1:1     | format: PNG-32 · transparency: Yes · slicing: Seamless tile                                                        | P1                       | Placeholder: 1 px grid lines                               | None                                | Tiles without visible seams at 1x, 2x, 3x.                                                                                                                                                                                                             |
| **BRD-BANNER** | Team side banners                                    | Vertical team-colour panels outside each goal; tinted at runtime with the team primary colour.                                                                                                                    | F-07 Match                | 1 (tinted per team)                                                                                                                  | 12×594 at x 45 (left) and x 1223 (right)                                                | ≈1:50   | format: PNG-32, greyscale (white = full tint) · transparency: Yes · slicing: 3-slice vertical (caps 12 px)         | P1                       | Placeholder: tinted rounded rectangle                      | None                                | Greyscale so one file serves all teams via tint.                                                                                                                                                                                                       |

### B. Gameplay objects

**Category defaults** (apply to every asset below unless the row says otherwise):

- Format: PNG-32 (packed into a texture atlas, see §6)
- Transparency: Yes
- Animation: None
- Nine-slice / tiling: None
- States: Default
- Layer / draw order: Discs depth 10, ball depth 11, shadows below discs
- Exports: @2x and @3x
- Naming: `fk_piece_<name>_<variant>@<scale>.png`
- Folder: `apps/web/public/assets/pieces/`
- Production notes: Seen exactly from above. Bodies do not rotate in play (rotation is locked in physics), so do not rely on rotation to read as spin. Keep a 2 px transparent margin.
- Acceptance: Circle diameter matches the physics radius exactly (disc 0.42 u, ball 0.22 u); reads clearly at 1x on both grass colours.

| ID             | Asset               | Purpose & usage                                                                                | Screen / scene                                                   | Qty & variants                                                                                                                     | Size at 1x (logical px)                                    | Aspect | Specifics (format · alpha · anim · slicing · states · layer)                                                                                                                                                | Priority                              | Placeholder today                                                  | Depends on                     | Notes & extra acceptance                                                                                                                                                                                                                                                                 |
| -------------- | ------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PCS-DISC**   | Team disc           | Player piece. Bottle-cap / tabletop counter with a team emblem in the centre.                  | F-07 Match, F-03 Tutorial, shop/locker thumbnails (via THB-TEAM) | 6 teams — team_volt, team_coral, team_ocean, team_sunset, team_royal, team_forest (colours in packages/config/data/cosmetics.json) | 56×56 (diameter 55.4)                                      | 1:1    | category defaults                                                                                                                                                                                           | P0 (volt, coral) / P1 (other 4)       | Placeholder: procedural circles + emblem (MatchScene.makeTextures) | UI-EMBLEM (same emblem shapes) | Outer ring = team secondary colour, face = primary, emblem = secondary. Add a subtle bevel/specular so discs read as objects. Acceptance: Opaque circle edge within 1 px of 55.4 px at 1x; the two default teams (volt vs coral) stay distinguishable in greyscale and for deuteranopia. |
| **PCS-BALL**   | Ball                | The ball.                                                                                      | F-07 Match, F-03 Tutorial, boot spinner, shop/locker             | 3 skins — ball_classic, ball_neon, ball_gold                                                                                       | 30×30 (diameter 29.0)                                      | 1:1    | category defaults                                                                                                                                                                                           | P0 (classic) / P1 (neon, gold)        | Placeholder: white circle + pentagons                              | None                           | Readable against every pitch theme at 1x; never confusable with a disc.                                                                                                                                                                                                                  |
| **PCS-SHADOW** | Contact shadows     | Soft shadow under each disc and the ball, offset +4,+6.                                        | F-07 Match                                                       | 2 — disc (58×44), ball (31×24)                                                                                                     | 58×44 and 31×24                                            | ≈1.3:1 | layer: Below discs (depth 9)                                                                                                                                                                                | P1                                    | Placeholder: black ellipse 28% opacity                             | None                           | Black with alpha only (no colour), so it works on every pitch.                                                                                                                                                                                                                           |
| **PCS-RING**   | Turn highlight ring | Glow ring around every disc of the side to move (pulses).                                      | F-07 Match                                                       | 1 (tinted: lime for my turn, white 35% for opponent)                                                                               | 76×76 (ring radius 33.7, stroke 4–5)                       | 1:1    | format: PNG-32, white (tinted at runtime) · animation: Pulse handled in code (alpha 0.55–0.9, 1.4 s); optional 8-frame glow sheet · states: Mine, opponent, high-contrast (thicker stroke) · layer: Depth 9 | P1                                    | Placeholder: stroked circle                                        | None                           |                                                                                                                                                                                                                                                                                          |
| **PCS-AIM**    | Aim indicator set   | While dragging: power ring around the disc, direction arrow (shaft + head), dotted guide line. | F-07 Match, F-03 Tutorial                                        | 4 parts — power ring (88×88), arrow head (32×28), arrow shaft (8 px wide, 3-slice), guide dot (10×4)                               | See variants; arrow length is 30–180 px depending on power | Mixed  | format: PNG-32, white (tinted lime → coral by power at runtime) · slicing: Arrow shaft: 3-slice horizontal · layer: Depth 20                                                                                | P2 (procedural version is acceptable) | Placeholder: procedural strokes                                    | None                           |                                                                                                                                                                                                                                                                                          |

### B2. Effects

**Category defaults** (apply to every asset below unless the row says otherwise):

- Format: PNG-32 sprite sheet (horizontal strip) + JSON frame data
- Transparency: Yes
- Animation: Frame animation, 30 fps unless stated
- Nine-slice / tiling: None
- States: Default
- Layer / draw order: Depth 15 (above pieces), confetti depth 30
- Exports: @2x and @3x
- Naming: `fk_fx_<name>@<scale>.png + .json`
- Folder: `apps/web/public/assets/fx/`
- Production notes: Effects are disabled when Settings → Reduce motion is on, and with Graphics: Battery saver. Never put essential information only in an effect.
- Acceptance: Plays correctly at 30 fps; total sheet ≤ 512 KB at @2x; readable on all pitch themes.

| ID            | Asset            | Purpose & usage                                                        | Screen / scene | Qty & variants                                                                                                               | Size at 1x (logical px)                  | Aspect  | Specifics (format · alpha · anim · slicing · states · layer) | Priority | Placeholder today                                        | Depends on        | Notes & extra acceptance |
| ------------- | ---------------- | ---------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------- | ------------------------------------------------------------ | -------- | -------------------------------------------------------- | ----------------- | ------------------------ |
| **FX-IMPACT** | Collision spark  | Short burst where two pieces collide or a piece hits a wall.           | F-07 Match     | 2 — piece-piece, piece-wall                                                                                                  | 48×48 per frame, 6 frames                | 1:1     | category defaults                                            | P1       | Placeholder: white circle scaling ×3 and fading (220 ms) | None              |                          |
| **FX-TRAIL**  | Ball trail       | Fading trail behind a fast ball.                                       | F-07 Match     | 1                                                                                                                            | 16×16 soft dot (repeated along the path) | 1:1     | animation: None (code fades and scales)                      | P2       | Placeholder: white dots 35% → 0%                         | None              |                          |
| **FX-GOAL**   | Goal celebration | Confetti pieces in the scoring team's colours plus a goal-mouth flash. | F-07 Match     | 4 — 3 confetti shapes (8×14 rectangle, 10×10 circle, 12×12 star; white, tinted at runtime), 1 goal flash (240×240, 8 frames) | As variants                              | Mixed   | category defaults                                            | P1       | Placeholder: tinted rectangles                           | None              |                          |
| **FX-NET**    | Net ripple       | Net bulges when the ball enters the goal.                              | F-07 Match     | 1                                                                                                                            | 80×184 per frame, 10 frames              | ≈0.43:1 | category defaults                                            | P2       | Not implemented                                          | BRD-GOAL, BRD-NET |                          |

### C1. Match HUD and match feedback

**Category defaults** (apply to every asset below unless the row says otherwise):

- Format: SVG (preferred) or PNG-32 @2x/@3x
- Transparency: Yes
- Animation: CSS (in code)
- Nine-slice / tiling: None
- States: Default
- Layer / draw order: React overlay above the canvas
- Exports: SVG; PNG fallbacks @2x/@3x if raster
- Naming: `fk_hud_<name>.<ext>`
- Folder: `apps/web/src/assets/hud/`
- Production notes: Text is never baked into images (the game ships in English and Persian/RTL). Banners are frames around live text.
- Acceptance: Works in LTR and RTL; no text in the image; legible at 375 px wide phones.

| ID              | Asset                          | Purpose & usage                                                                                  | Screen / scene              | Qty & variants                                                                | Size at 1x (logical px)        | Aspect | Specifics (format · alpha · anim · slicing · states · layer)                    | Priority | Placeholder today               | Depends on | Notes & extra acceptance                                                                                              |
| --------------- | ------------------------------ | ------------------------------------------------------------------------------------------------ | --------------------------- | ----------------------------------------------------------------------------- | ------------------------------ | ------ | ------------------------------------------------------------------------------- | -------- | ------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------- |
| **HUD-BANNER**  | Match banner frames            | Frame behind the GOAL!/own-goal, sudden-death, 'score 2 goals to win' and reconnecting messages. | F-07 Match                  | 2 — goal (energetic, lime), info (calm, navy)                                 | Fluid: 280–960 × 64–180 CSS px | Fluid  | slicing: 9-slice (SVG with stretchable middle, or CSS border-image: 48 px caps) | P1       | Placeholder: CSS rounded panel  | None       |                                                                                                                       |
| **HUD-VS**      | VS emblem                      | Centre emblem between the two player cards while matchmaking.                                    | F-06 Matchmaking            | 1                                                                             | 96×64                          | 3:2    | category defaults                                                               | P1       | Placeholder: text 'VS'          | None       | Must work without the letters (the letters stay as live text for localisation) or use language-neutral shapes.        |
| **HUD-UNKNOWN** | Searching-opponent placeholder | Opponent slot while searching (pulses).                                                          | F-06 Matchmaking            | 1                                                                             | 72×72                          | 1:1    | category defaults                                                               | P1       | Placeholder: '?' on a tile      | None       |                                                                                                                       |
| **HUD-LEVELUP** | Level-up badge and burst       | Shown on the result screen when the server reports a new level.                                  | F-09 Result                 | 2 — badge (120×120, level number stays live text), burst (240×240, 12 frames) | As variants                    | 1:1    | animation: Burst: 12 frames @ 24 fps                                            | P1       | Placeholder: gold text line     | None       |                                                                                                                       |
| **HUD-RESULT**  | Victory / defeat headers       | Decorative header art behind the live 'Victory!' / 'Defeat' text.                                | F-09 Result                 | 2 — victory, defeat                                                           | 560×140                        | 4:1    | category defaults                                                               | P2       | Placeholder: coloured text only | None       |                                                                                                                       |
| **HUD-COACH**   | Tutorial illustrations         | One illustration per tutorial step: press a glowing disc, drag back, release to shoot.           | F-03 Tutorial (coach panel) | 3 — step1-press, step2-drag, step3-release                                    | 240×160                        | 3:2    | format: SVG or PNG-32 @2x/@3x                                                   | P1       | Placeholder: text only          | None       | Show a hand/finger and a mouse cursor variant, or a neutral pointer. Directions must not depend on reading direction. |

### C2. UI and navigation

**Category defaults** (apply to every asset below unless the row says otherwise):

- Format: SVG (24×24 viewBox, 2 px stroke, round caps/joins, currentColor)
- Transparency: Yes
- Animation: None
- Nine-slice / tiling: None
- States: Default (colour comes from CSS: muted #a9b4d6, active #c6ff3d, text #f4f7ff)
- Layer / draw order: React UI
- Exports: SVG only
- Naming: `fk_icon_<name>.svg`
- Folder: `apps/web/src/assets/icons/`
- Production notes: One consistent family: same stroke weight, corner radius and optical size. No emoji. Icons that imply direction (back) are mirrored by CSS in RTL, so draw them for LTR.
- Acceptance: Uses currentColor only; pixel-crisp at 14, 16, 18, 22 and 40 px; passes SVGO without visual change.

| ID                 | Asset                               | Purpose & usage                                                                      | Screen / scene                                                                            | Qty & variants                                                                                                                                                            | Size at 1x (logical px)                                                    | Aspect       | Specifics (format · alpha · anim · slicing · states · layer)         | Priority                              | Placeholder today                                   | Depends on                   | Notes & extra acceptance                                                                                                                                                                                    |
| ------------------ | ----------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **UI-ICON-NAV**    | Navigation icons                    | Bottom navigation (mobile) / side rail (desktop).                                    | All shell screens                                                                         | 5 — home, shop, ranks (trophy), profile (user), settings (gear)                                                                                                           | 22×22                                                                      | 1:1          | states: Inactive (muted), active (lime)                              | P0                                    | Placeholder: simple strokes in ui/icons.tsx         | None                         |                                                                                                                                                                                                             |
| **UI-ICON-ACTION** | Action and status icons             | Buttons, headers, states and badges.                                                 | All                                                                                       | 16 — back, close, play, pause, check, lock, robot (bot badge), users (2 players), globe (online), history, gift (rewards), wallet, info, offline, school (tutorial), bolt | 14–40 (mostly 22)                                                          | 1:1          | category defaults                                                    | P0                                    | Placeholder: simple strokes in ui/icons.tsx         | None                         |                                                                                                                                                                                                             |
| **UI-CURRENCY**    | Currency icons                      | Coins (soft currency) and gems (premium currency) in pills, prices and rewards.      | Top bar, shop, rewards, arenas, result, history                                           | 2 — coin, gem                                                                                                                                                             | 16 and 20                                                                  | 1:1          | format: SVG, full colour (not currentColor)                          | P0                                    | Placeholder: simple coloured SVG                    | None                         | Recognisable at 16 px; coin and gem differ in shape, not only colour.                                                                                                                                       |
| **UI-EMBLEM**      | Team emblems                        | Emblem shapes used on discs (PCS-DISC) and team swatches.                            | Match, locker, shop, play setup                                                           | 6 — bolt, star, wave, sun, crown, leaf                                                                                                                                    | 24 inside a 56 disc; 32–56 swatches                                        | 1:1          | format: SVG, single colour (filled)                                  | P0 (bolt, star) / P1 (other 4)        | Placeholder: basic polygons                         | None                         |                                                                                                                                                                                                             |
| **UI-AVATAR**      | Player avatars                      | Profile picture in the top bar, HUD, result, matchmaking and profile.                | Shell, F-06, F-07, F-09, F-10, F-14                                                       | 5 — avatar_fox, avatar_owl, avatar_bear, avatar_tiger, bot (FlickBot)                                                                                                     | 34, 44, 48, 56, 64, 72, 84 (square, 12–14 px corner radius applied by CSS) | 1:1          | format: SVG (preferred) or PNG-32 256×256                            | P0 (fox, owl, bot) / P1 (bear, tiger) | Placeholder: geometric faces in ui/components.tsx   | None                         | Original characters, friendly sporty style. The bot must read as a robot at 34 px (players must always know they face a bot). Acceptance: Readable at 34 px; full-bleed square (frame comes from UI-FRAME). |
| **UI-FRAME**       | Avatar frames                       | Ring/frame around avatars: level frame (own profile) and bot frame.                  | F-06, F-09, F-10                                                                          | 2 — level, bot                                                                                                                                                            | Avatar size + 6 (e.g. 90×90 for the 84 avatar)                             | 1:1          | slicing: 9-slice (12 px corners) so one frame fits every avatar size | P2                                    | Placeholder: CSS box-shadow ring                    | None                         |                                                                                                                                                                                                             |
| **UI-LOGO**        | FlickKick logo                      | Wordmark in the top bar and large on boot/welcome; compact mark for small spaces.    | F-01 Boot, F-02 Welcome, shell top bar                                                    | 2 — wordmark (horizontal), mark (square)                                                                                                                                  | Wordmark 112×28 (top bar) to 260×64 (boot); mark 64×64                     | ≈4:1 and 1:1 | format: SVG (outlined text), full colour + single-colour version     | P0                                    | Placeholder: live text 'Flick' + italic lime 'Kick' | None                         | The name stays Latin in both languages. Must not resemble any existing football game's logo. Acceptance: Legible at 24 px height; works on #0e1630 and on white.                                            |
| **UI-SPINNER**     | Loading indicator                   | Bouncing ball shown while loading physics, joining matches and searching.            | F-01, F-06, F-07, lists                                                                   | 1                                                                                                                                                                         | 36×36                                                                      | 1:1          | format: SVG (motion stays in CSS)                                    | P2                                    | Placeholder: CSS radial-gradient ball               | None                         |                                                                                                                                                                                                             |
| **UI-MODE**        | Home mode-card illustrations        | Illustrations for the three home cards: Play online, Play vs AI, 2 players 1 device. | F-04 Home                                                                                 | 3 — online, ai, local                                                                                                                                                     | 160×120 inside a ≥220×150 card                                             | 4:3          | format: SVG or PNG-32 @2x/@3x                                        | P1                                    | Placeholder: gradient card + line icon              | None                         |                                                                                                                                                                                                             |
| **UI-ARENA**       | Arena card art                      | Header art for each arena in arena selection.                                        | F-05 Arena select                                                                         | 5 — park, city, coast, capital, legends                                                                                                                                   | 320×120 (card width fluid 220–360)                                         | 8:3          | format: WebP @2x/@3x · transparency: No                              | P1                                    | Placeholder: coloured top border                    | BRD-BG (same theme language) |                                                                                                                                                                                                             |
| **UI-STATE**       | Empty and error state illustrations | Replace the generic 72 px icon in empty/error/offline states.                        | History (empty), wallet (empty), not found, server not connected / offline, generic error | 5 — empty-history, empty-wallet, not-found, offline-server, error                                                                                                         | 160×128                                                                    | 5:4          | format: SVG or PNG-32 @2x/@3x                                        | P1                                    | Placeholder: line icon in a circle                  | None                         | Friendly, low-detail; no text inside.                                                                                                                                                                       |

### D. Cosmetics, shop and progression

**Category defaults** (apply to every asset below unless the row says otherwise):

- Format: PNG-32 @2x/@3x (or SVG)
- Transparency: Yes
- Animation: None
- Nine-slice / tiling: None
- States: Default; owned/equipped/locked are drawn by CSS
- Layer / draw order: React UI
- Exports: @2x and @3x
- Naming: `fk_thumb_<item-id>@<scale>.png`
- Folder: `apps/web/public/assets/thumbs/`
- Production notes: Thumbnails are shown on a navy card (#18234a). Centre the subject with 8% padding. One consistent light direction across all thumbnails.
- Acceptance: Item is recognisable at 56 px; consistent padding and lighting across the set.

| ID             | Asset                                  | Purpose & usage                                                                               | Screen / scene                          | Qty & variants                                                                                | Size at 1x (logical px)               | Aspect | Specifics (format · alpha · anim · slicing · states · layer) | Priority | Placeholder today                       | Depends on                                             | Notes & extra acceptance                                |
| -------------- | -------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------- | ------ | ------------------------------------------------------------ | -------- | --------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------- |
| **THB-TEAM**   | Team thumbnails                        | Team (disc skin) items in shop and locker.                                                    | F-13 Shop, F-14 Locker, F-08 Play vs AI | 6 — team_volt, team_coral, team_ocean, team_sunset, team_royal, team_forest                   | 56×56 (cards) – 96×96 (future detail) | 1:1    | category defaults                                            | P1       | Placeholder: CSS swatch                 | PCS-DISC (a 3/4 view render of the same disc is ideal) |                                                         |
| **THB-BALL**   | Ball thumbnails                        | Ball skin items.                                                                              | F-13 Shop, F-14 Locker                  | 3 — ball_classic, ball_neon, ball_gold                                                        | 48×48 – 96×96                         | 1:1    | category defaults                                            | P1       | Placeholder: CSS circle                 | PCS-BALL                                               |                                                         |
| **THB-PACK**   | Currency pack art                      | Coin/gem packs in the shop's Coins & gems tab (sandbox until a payment provider is approved). | F-13 Shop                               | 4 — pack_coins_s (pouch), pack_coins_m (chest), pack_gems_s (handful), starter_offer (bundle) | 96×96                                 | 1:1    | category defaults                                            | P1       | Placeholder: text + price tags          | UI-CURRENCY                                            |                                                         |
| **THB-REWARD** | Reward piles                           | Daily-reward tiles (days 1–7), rewarded-ad bonus and level rewards.                           | F-15 Rewards                            | 4 — coins-small, coins-medium, coins-large, gems                                              | 64×64                                 | 1:1    | category defaults                                            | P1       | Placeholder: currency icon + number     | UI-CURRENCY                                            |                                                         |
| **THB-RANK**   | Rank badges (planned, M9 leaderboards) | Tier badges next to leaderboard entries and on the profile.                                   | F-12 Leaderboard, F-10 Profile          | 5 — bronze, silver, gold, platinum, legend                                                    | 32×32 (rows) and 64×64 (profile)      | 1:1    | format: SVG                                                  | P1       | Not implemented (feature planned in M9) | None                                                   | Tier is also shown as live text, never by colour alone. |

### F. App icon, web and store assets

**Category defaults** (apply to every asset below unless the row says otherwise):

- Format: PNG-32 (icons), JPEG/WebP (share image)
- Transparency: Icons: no for maskable/apple; favicon SVG may be transparent
- Animation: None
- Nine-slice / tiling: None
- States: Default
- Layer / draw order: n/a
- Exports: Exact sizes listed
- Naming: `As listed (fixed names expected by browsers)`
- Folder: `apps/web/public/`
- Production notes: The deployment target is the web (desktop + mobile browsers, installable PWA). No native store listing is planned in Phase 1.
- Acceptance: Exact pixel sizes; maskable icon keeps the mark inside the central 80% safe zone; passes Lighthouse PWA icon checks.

| ID            | Asset                               | Purpose & usage                                              | Screen / scene | Qty & variants                                                                                                                                                          | Size at 1x (logical px) | Aspect | Specifics (format · alpha · anim · slicing · states · layer) | Priority | Placeholder today                                  | Depends on                                      | Notes & extra acceptance                                      |
| ------------- | ----------------------------------- | ------------------------------------------------------------ | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------ | ------------------------------------------------------------ | -------- | -------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------- |
| **MKT-ICON**  | App icon set                        | Browser tab, home-screen and PWA install icons.              | Browser / OS   | 6 files — favicon.svg, favicon-32.png (32×32), apple-touch-icon.png (180×180), icon-192.png, icon-512.png, icon-maskable-512.png                                        | As variants             | 1:1    | category defaults                                            | P0       | Placeholder: public/favicon.svg (lime ring + bolt) | UI-LOGO (mark)                                  |                                                               |
| **MKT-OG**    | Social sharing image                | Open Graph / Twitter card image when the game URL is shared. | Link previews  | 1 (+1 Persian variant) — en, fa                                                                                                                                         | 1200×630                | 1.91:1 | format: JPEG q85 (< 300 KB)                                  | P1       | Not implemented                                    | None                                            | Text allowed here (this is marketing, one file per language). |
| **MKT-PROMO** | Promotional banners and screenshots | Website/social promotion and any future store listing.       | Marketing      | 4 banners + 6 screenshots — banners 1920×1080, 1080×1080, 1080×1920, 1200×300; screenshots captured from the final build (desktop 1920×1080, phone 2340×1080 landscape) | As variants             | Mixed  | format: PNG / JPEG                                           | P2       | Not implemented                                    | All P0/P1 art (screenshots must show final art) |                                                               |

<!-- 40 visual assets -->

<!-- GENERATED:ASSETS:END -->

## 5. Audio inventory (separate production category)

Audio is wired today to synthesised placeholders in `apps/web/src/services/audio.ts`. Each final file replaces one
`audio.play('<id>')` call. Volume, mute and music/SFX levels come from Settings.

- Format: OGG Opus 96 kbps **and** MP3 128 kbps fallback (Safari), 48 kHz.
- Loudness: SFX peaks ≤ −3 dBFS, short and dry (no long reverb tails); music −16 LUFS integrated with seamless loop points.
- Naming: `fk_sfx_<name>_<variant>.ogg|mp3`, `fk_music_<name>.ogg|mp3` in `apps/web/public/assets/audio/`.
- Variations matter: collisions fire many times per shot, so provide velocity layers and round-robin takes to avoid
  machine-gunning.

<!-- GENERATED:AUDIO:START -->

| ID                 | Sound                           | Trigger in the game                                             | Duration               | Variants                                          | Priority | Placeholder today      |
| ------------------ | ------------------------------- | --------------------------------------------------------------- | ---------------------- | ------------------------------------------------- | -------- | ---------------------- |
| **SFX-TAP**        | UI tap / disc pick-up           | audio.play('tap'): pressing an own disc; volume slider preview  | ≤ 80 ms                | 1                                                 | P0       | Synth 660 Hz blip      |
| **SFX-KICK**       | Disc flick (shot)               | audio.play('kick', power): shot released                        | ≤ 200 ms               | 3 intensities (soft/medium/hard), picked by power | P0       | Synth thump 180→70 Hz  |
| **SFX-HIT**        | Disc–disc / disc–ball collision | audio.play('hit', strength) from impact detection               | ≤ 120 ms               | 4 velocity layers × 2 round-robin                 | P0       | Synth square click     |
| **SFX-WALL**       | Piece hits the boards           | audio.play('wall', strength)                                    | ≤ 150 ms               | 3 velocity layers                                 | P0       | Synth low knock        |
| **SFX-GOAL**       | Goal                            | audio.play('goal'): goal event                                  | 1.5–2.5 s              | 1 (+ optional crowd layer)                        | P0       | Synth arpeggio         |
| **SFX-WHISTLE**    | Final whistle                   | audio.play('whistle'): match ended                              | 0.6–1.0 s              | 1                                                 | P0       | Synth sine sweep       |
| **SFX-WIN**        | Victory sting                   | audio.play('win'): result screen (win)                          | 1.5–3 s                | 1                                                 | P0       | Synth arpeggio         |
| **SFX-LOSE**       | Defeat sting                    | audio.play('lose'): result screen (loss)                        | 1.5–3 s                | 1                                                 | P0       | Synth descending tones |
| **SFX-ERROR**      | Invalid action / timeout        | audio.play('error'): opponent disc pressed, turn timed out      | ≤ 200 ms               | 1                                                 | P0       | Synth buzz             |
| **SFX-COIN**       | Coins awarded                   | audio.play('coin'): rewards (wired in M9)                       | ≤ 400 ms               | 1                                                 | P1       | Synth two-note chime   |
| **SFX-MATCHFOUND** | Opponent found                  | Matchmaking: opponent or bot assigned (to be wired)             | ≤ 800 ms               | human, bot                                        | P1       | Not implemented        |
| **SFX-TICK**       | Turn timer warning              | Last 5 s of a turn (to be wired)                                | ≤ 100 ms               | 1                                                 | P1       | Not implemented        |
| **SFX-LEVELUP**    | Level up                        | Result screen when the server reports a new level (to be wired) | 1–2 s                  | 1                                                 | P1       | Not implemented        |
| **SFX-PURCHASE**   | Purchase confirmed              | Shop purchase success (M10)                                     | ≤ 800 ms               | 1                                                 | P2       | Not implemented        |
| **MUS-MENU**       | Menu music loop                 | audio.startMusic(): menus                                       | 60–120 s seamless loop | 1                                                 | P1       | Synth 8-note loop      |
| **MUS-MATCH**      | Match ambience (crowd bed)      | During matches, under SFX (to be wired)                         | 60 s seamless loop     | 1 per arena theme (P2)                            | P2       | Not implemented        |

<!-- GENERATED:AUDIO:END -->

## 6. Folder structure, naming and export settings

```
art-source/                 masters, ball textures, sound sources; in git via Git LFS (run `git lfs install` once before cloning)
apps/web/public/assets/
  board/<theme>/            BRD-* (one folder per arena theme: park, city, coast, capital, legends)
  pieces/                   PCS-* (disc per team, ball per skin, shadows, rings)
  fx/                       FX-* sprite sheets + JSON frame data
  thumbs/                   THB-*
  audio/                    SFX-*, MUS-*
  atlases/                  generated texture atlases (do not edit by hand)
apps/web/src/assets/
  icons/                    UI-ICON-*, UI-CURRENCY (SVG, imported by React)
  avatars/ emblems/ illustrations/ hud/ logo/
apps/web/public/            MKT-ICON files, og image
```

**Naming:** lowercase, `fk_<category>_<name>[_<variant>][@2x|@3x].<ext>`; the variant equals the id in config where one
exists (e.g. `fk_piece_disc_team_coral@2x.png`, `fk_board_pitch_park@3x.webp`, `fk_icon_settings.svg`).

**Export settings**

| Type          | Settings                                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| SVG           | Outlined text, no embedded raster, `viewBox` set, no fixed `width`/`height`, icons use `currentColor`, optimised with SVGO (keep `viewBox`) |
| PNG-32        | sRGB, straight (non-premultiplied) alpha, no matte; check for dark/light halos on both grass and navy                                       |
| WebP          | Lossy q90 for opaque surfaces (pitch, backgrounds, arena cards); lossless for anything with hard edges + alpha                              |
| Sprite sheets | Horizontal strips, equal frame size, 2 px padding between frames; frame list in JSON                                                        |
| Atlases       | Packed per scene (match atlas, UI atlas), max 2048 × 2048 for mobile GPUs, 2 px extrude to avoid bleeding                                   |
| Size budget   | Match atlas ≤ 1.5 MB @2x; each arena theme ≤ 600 KB @2x (WebP); total first-load art ≤ 3 MB                                                 |

## 7. Validation checklist (per delivery)

- [ ] File name, folder and ID follow §6; one file per variant and scale.
- [ ] Exact pixel size at 1x/@2x/@3x as listed; aspect ratio unchanged.
- [ ] Board art aligns with the geometry in §2 (overlay on a screenshot of the placeholder build at 1x: ≤ 1 px off).
- [ ] Transparency where required, with no halos on light or dark backgrounds.
- [ ] No text inside non-marketing art; directional art works mirrored for RTL where the row says so.
- [ ] Readable at the smallest display size (icons 14–16 px, avatars 34 px, discs 56 px).
- [ ] Teams and tiers distinguishable in greyscale and with a deuteranopia simulation.
- [ ] Original work: no traced, sampled or look-alike elements from other games; source files and licences recorded.
- [ ] Animation sheets play at the stated fps without popping; effects remain optional (reduced motion).
- [ ] Size budgets in §6 respected; SVGs pass SVGO without visual change.
- [ ] Audio: loudness and peak targets met, loops seamless, both OGG and MP3 provided.

## 8. Guidance for AI-assisted generation

Use one shared style block for every prompt so the set stays consistent, then add the asset-specific line from §4.

> **Style block:** original flat-vector game art for a mobile tabletop soccer game called FlickKick, strict top-down
> orthographic view, clean shapes with soft bevel and a single specular highlight, light from the top-left, floodlit night
> stadium mood, palette navy #0e1630, lime #c6ff3d, coral #ff5a5f, sky #4cc9f0, gold #ffc83d, crisp edges, no text, no
> watermark, transparent background where specified.

- **Negative prompt:** perspective, 3D render, photorealism, text, letters, logos, brand names, watermark, existing game
  characters or UI, busy texture, drop shadow on a transparent background (shadows are separate assets).
- Generate at ≥ 4x the 1x size, then downscale. Fix edges by hand: generators rarely produce clean alpha or exact circles.
- Geometry-critical assets (pitch markings, frame, goals, disc/ball circles) must be corrected to the exact measurements
  in §2. Use the generator for texture and style, not for layout.
- Keep the seed, prompt and model version per asset in `art-source/` so variants can be regenerated consistently.
- Run the §7 checklist on generated assets exactly as on hand-made ones.

## 9. Delivery status and integration

The first generated set (masters in `art-source/masters`, not in git) is exported with `pnpm art:export`
(`tools/export-art.mjs`, sharp). It writes WebP files to `apps/web/public/assets/` and
`apps/web/src/game/artManifest.json` (sizes, frame 9-slice insets, goal alignment), which `apps/web/src/game/art.ts`
reads. Every lookup has a fallback: a missing or failing file shows the procedural placeholder, so the game never breaks
on art.

| Area              | In use                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Board (per theme) | Background, turf, frame (sliced into 8 pieces around the pitch; renderer independent), goal                                                                              |
| Pieces            | Disc per team, ball per skin (match, shop, locker, setup swatches)                                                                                                       |
| Avatars           | Four player avatars and the bot avatar (HUD, header, matchmaking, result, profile)                                                                                       |
| UI                | Coin and gem icons, home mode cards, arena cards, empty/error/offline/404 illustrations                                                                                  |
| Thumbnails        | Currency packs (shop), daily reward tiles                                                                                                                                |
| HUD and screens   | Wordmark (top bar, loading, welcome), goal and info banner plates, tutorial coach steps, victory/defeat ribbons, level-up badge, VS and unknown-player art (matchmaking) |
| Ranks             | Five rank badges = arena tiers (Park → Bronze … Legends → Legend) on arena cards and the profile                                                                         |
| Promo             | Welcome key art (landscape, square or portrait by screen), home banner (wide), install screenshots in the web app manifest, `og-en.jpg` link preview                     |
| Ball              | Rolling sprite sheets (24 frames, one turn) from the flat ball textures in `art-source/ball-textures`, plus a fixed lighting overlay                                     |
| Still procedural  | Pitch markings, corner cuts (coloured from the frame), aim arrow, rings, shadows, match effects; HUD and navigation icons                                                |

**Rendering:** the board keeps its 1280 × 720 layout in game px and renders at 2x through a camera zoom (1x on the low
graphics setting), so board art is exported at 2 texture px per game px. Input maps the pointer through the camera.

**National and club teams** (delivered 2026-10-29): all 18 national and 67 club discs are registered in the catalog. Corrected v2 masters are preferred by the exporter for France, Colombia, Italy and Switzerland. Club emblem accuracy still needs review before public release. Clubs remain controlled by features.clubTeams.enabled.

**Character roster:** 30 animal and 30 human portraits are registered as avatar_animal_* and avatar_human_* with 600-coin prices, bilingual names and 256px WebP runtime art. Canonical exporter inputs are in art-source/masters; the original review gallery remains in art-source/character-roster. Existing prices and defaults are preserved.

Shop setup guide: [SHOP_ITEMS_GUIDE.md](fa/SHOP_ITEMS_GUIDE.md).

**Not used in the app:** `og-fa.jpg` is exported but link-preview crawlers read only the static page, which is English;
it is ready for a Persian landing page or store listing. `tools/export-art-codex.mjs` (with `production-manifest.json`)
is an alternative export written with Codex; the game does not use its output.

**Known deviations in this set**

- **Goal:** the master is almost square, while the pocket is 66 × 172 game px. The exporter squeezes it horizontally to
  fit the pocket. The whole goal sits behind the goal line, posts on the line (both sides, mirrored). It reads correctly at play size but is distorted; regenerate at
  about 80 × 184 proportions (net box opening to the right) for the next delivery.
- **Frames:** the generated frame holes are about 1.9–2.0 : 1 while the pitch is 1.667 : 1. The slicing maps the hole
  exactly onto the pitch, so the borders keep their thickness, but long straight edges are stretched.
- **Turf:** has no markings by design; markings stay procedural so they always match the physics.
- **Size budget:** the full export is about 2.6 MB for all five themes; the first match loads only one theme.
- **Team banners** (placeholder side strips in team colours) are no longer drawn when the frame art is present.

**App icons:** `pnpm icons:export` (`tools/export-icons.mjs`) writes `icon-192.png`, `icon-512.png`,
`icon-maskable-512.png` (art in the safe zone) and `apple-touch-icon.png` from `fk_logo_mark`, used by
`manifest.webmanifest`.

**Sounds:** `pnpm audio:export` (`tools/export-audio.mjs`, ffmpeg) trims, normalises and encodes the chosen sources in
`art-source/audio/raw` (not in git) to mono MP3 in `apps/web/public/assets/audio` (about 230 KB in total). Sources are
the team's purchased packs in the shared Drive folder "Sound and SFX":

| Game sound          | Source file                                                         | Use                             |
| ------------------- | ------------------------------------------------------------------- | ------------------------------- |
| `kick`              | `good_hit_1.wav`                                                    | every shot                      |
| `hit` / `wall`      | `hit_bump_1.wav` / `hit_bump_3.wav`                                 | disc collisions / wall hits     |
| `ball`              | `Hit 1.mp3` (first 0.55 s)                                          | ball hit by a disc              |
| `swoosh` + `impact` | `SFX_Movement_Swoosh_Fast_1.wav`, `Dramatic Impact.mp3` (1.3–3.1 s) | power shots (≥ 75 % power)      |
| `goal` + `wow`      | `Winning01.wav`, `Wow01.wav`                                        | goal                            |
| `oh`                | `Oh01.wav`                                                          | near miss beside the goal mouth |
| `win` / `lose`      | `Win01.wav` / `Lose01.wav`                                          | result screen                   |

**Music** (`apps/web/public/assets/music`, stereo MP3, streamed rather than decoded so phones keep memory low; about 6.9 MB
in total, each track loads only when its screen opens):

| Track        | Source (team-provided)                               | Where                                                    |
| ------------ | ---------------------------------------------------- | -------------------------------------------------------- |
| `menu`       | `menu background.mp3`                                | home, shop, profile, settings and other menus (loop)     |
| `league`     | `leaugh menu music.mp3`                              | arena choice, matchmaking, leaderboard (loop)            |
| `intro`      | `stadium-intro-logo.mp3`                             | walk-on at the start of every match (once)               |
| `match`      | `fatbunny-soccer-493566.mp3` (Pixabay)               | during play, under the crowd, from the first shot (loop) |
| `kickoff`    | `in-match.mp3`                                       | restart jingle after each goal                           |
| `highlights` | `soundsurfer-soccer-highlights-266225.mp3` (Pixabay) | result screen, after the win/lose jingle (loop)          |

Tracks crossfade between screens and pause while the app is in the background. The two Pixabay tracks are under the
Pixabay Content License (free for use in games, no attribution required); keep the download pages on record.

The packs contain **no stadium crowd recordings**, so the crowd is procedural (shaped noise that swells on shots, near
misses and goals). A recorded crowd loop and a referee whistle (also synthesised now) are the main audio gaps; drop them
into `art-source/audio/raw` and add them to `tools/export-audio.mjs`.
