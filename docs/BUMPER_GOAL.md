# Bumper Goal

Independent car-themed variant of FlickKick. Cars replace player discs; the football and turn-based rules remain.

## Car art

Cicada, Cruiser and Carrier use the supplied RetroCartoonCarsPack1 low-poly FBX models and their 3072 texture atlases. Textures were flattened from the supplied PSD composites. The original Unity .mat files are not browser materials; the sprite renderer uses their diffuse atlases with simple studio lighting.

`art-source/cars/` contains the source models and converted texture atlases. Regenerate transparent sprites with Blender 3+:

```sh
blender -b --python tools/render-cars.py
```

The current Phaser renderer uses top-down PNG renders, not live 3D models. Each team uses one matching model and paint scheme: red Cicada cars for the left team, police Cruisers for the right team. Cars are 38% larger than the first car build and face the aim and travel direction. Colored rings distinguish teams. Tire tracks use measured speed and acceleration, fade after 12 seconds, and never connect kickoff corrections or separate shots. Existing circular collision shapes and shot physics are retained; rectangular vehicle collisions are a separate gameplay change.

Run with `pnpm install` then `pnpm dev`. GitHub target: Jolly-Panda-Works/BumperGoal. Published as a standalone repository snapshot, with car source assets included.
