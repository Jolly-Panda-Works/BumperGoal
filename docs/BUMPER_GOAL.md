# Bumper Goal

Independent car-themed variant of FlickKick. Cars replace player pieces; the football and turn-based rules remain.

## 3D arena

The React game host mounts a full-viewport Three.js WebGL 2 scene with a fixed oblique perspective camera. The score HUD floats over the arena instead of taking a separate row. Vivid green checkerboard grass, electric-blue canals and roofs, bright red team accents, gold trim, and low-poly trees provide the cartoon tournament style. Neutral white lighting and direct sRGB output preserve saturated colors; higher render resolution and anisotropic filtering keep field markings and textures crisp. Imported cars use toon materials. Static scenery is batched by material to reduce draw calls on phones. The camera presents a horizontal pitch on desktop and a vertical pitch on phones, fits the complete arena, and reverses the board for online players on the opposite side. Cars use the supplied 3D meshes, the ball rolls as a sphere, and both goals have raised frames and mesh nets. Lighting and shadows show their height above the grass.

The original deterministic 2D physics and server protocol remain unchanged. Pointer rays intersect the pitch plane before conversion into shot coordinates, so slingshot aiming matches the perspective view. Colored rings show the active team. Speed- and acceleration-sensitive twin tire tracks fade over 12 seconds. After a non-final goal, the kickoff restores every car position and heading, resets ball rotation and aiming, and clears tire tracks after the goal pause. Existing circular collision shapes are retained. The goals sit at ±8.7 units, 1.2 units farther back at each end; the 17.4-unit pitch provides extra space behind the original car formations. The physics geometry, server configuration and shared determinism vectors use these same dimensions.

## Complete game sections

The full game is enabled by default. Main navigation exposes Home, Shop, League, Assets and Profile. League shows real level progress, arena unlocks, entry fees and prizes, plus links to rankings, level rewards and match history. Global competition uses the existing game server; local development retains the existing bot league simulation.

Shop handles purchases. Assets lists only owned/free teams, balls, avatars, formations and trails, with persistent equipment selection. Profile, settings, rewards and history use the existing profile and server integrations. `VITE_GAME_VARIANT=rakhtkan` is an opt-in legacy compact mode.

On desktop, menus use a wide layout with a side navigation rail. On phones they use portrait layouts and bottom navigation. The installed-app manifest allows either orientation; phones request portrait lock when the browser supports it.

## Car assets

Red Cicada cars form the left team; matching police Cruisers form the right team. The Carrier is also included as an exported asset. Source FBX meshes and texture atlases are in `art-source/cars/`. The Unity materials are rebuilt as browser PBR materials using their diffuse texture atlases. The web models use embedded 1024-pixel textures and normalized 1.42-unit car lengths.

Regenerate the browser models with Blender 3+:

```sh
blender -b --python tools/export-cars-glb.py
```

The earlier PNG sprite exporter remains available as `tools/render-cars.py`; the active match uses the GLB models.

## Validation

`apps/web/test/arena3dProjection.test.ts` covers slingshot direction and power for both board orientations. `apps/web/e2e/arena3d.spec.ts` checks model loading and complete shots on desktop and phone viewports. The existing pointer-based browser helpers use the perspective camera projection.

Run with `pnpm install` then `pnpm dev`. GitHub: Jolly-Panda-Works/BumperGoal.
