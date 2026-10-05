# Content packs

A content pack holds the rules and presentation that missions share. Mission
files name a pack and its version in `scenario.content`. The game reads the
bundled packs through the same parser future mod packs will use.

## Files

- [`src/content/packs/base.json`](../src/content/packs/base.json) holds the
  Anomaly Response Command roster and wildlife.
- [`src/content/packs.ts`](../src/content/packs.ts) lists the bundled packs.
- Change `version` whenever a change would alter how an existing save plays.
  Saves made against another version then fail to load with a clear message
  instead of continuing under different rules. Regenerate the bundled levels
  with `npm run levels` afterward so they name the new version.

## Layout

- `format` is `"cotuw-content"`; `formatVersion` is the schema version.
- `id`, `version`, and `name` identify the pack.
- `actors` holds simulation actor definitions: stats, weapons, movement,
  footprints, costs, and timings. The simulation validates the ones a mission
  uses when it loads. Actor IDs must be unique, and every actor needs its
  name, description, and the model or building geometry its rules require.
- `movementProfiles` prices each terrain type and slope for ground movement.
- `presentation` maps actor IDs to what the player sees:
  - `name`, `description`, and optional `build` or `train` button labels.
  - `attackEffect` is `"tracer"` or `"bite"`.
  - `model` is a GLB with clips under `glb`, or a built-in procedural model
    under `builtin`, such as `"wolf"`, with an optional `scale`. GLB `clips`
    name the `idle`, `locomotion`, optional `turn`, trigger, and `death`
    clips, as [actor assets](actor-assets.md) describes.
  - `frameEffects` on mobile models maps a trigger to a clip played once on a
    camera-facing square. `attack` plays with each hit. Each names its `clip`,
    the sheet at `url`, its `size` in world units, and an `anchor` in the
    actor's model space: `[x, y, z]` from its ground point, facing +Z.
  - `building` sets a tile-placed actor's height, colors, and optional
    built-in `details`, such as `"command-center"`.
- `clips` maps IDs to frame-sequenced textures. `columns` and `rows` divide a
  sprite sheet into equal cells numbered row by row from the top left.
  `frames` lists `{ cell, seconds }` in play order, and `playback` is
  `"loop"`, `"ping-pong"`, or `"once"`. Sheet dimensions must divide into
  whole-pixel cells. Clip validation and timing live in
  `src/content/texture-clip.ts`; GPU frame loading lives in
  `src/render/texture-clip.ts`.
- `terrain.tileTypes` defines textured layers. Each pins a `slot` so optional
  layers stack consistently. A layer marked `layerAlphaOnly` ignores its
  image's alpha, so the layer color alone controls opacity; the water image
  caps itself at about two thirds opaque. `clip` plays a clip from the sheet
  at `url`, and `clipPhase` delays each tile by `u` seconds per tile along x
  and `v` along z. Every cell must repeat without a seam.
- `terrain.layers` lists, for each terrain type, its layers from the bottom:
  - `variation` adds a gentle per-tile tint.
  - `coverage` shows the layer on that share of tiles in a fixed pattern.
  - `shoreFade` fades the layer from the terrain's edge to its center using
    `terrain.shore`.
- `view` sets the background color and lighting.

Built-in models and building details live in
[`builtin-models.ts`](../src/render/builtin-models.ts). Loading rejects a pack
that names one the build lacks. Parsing validates presentation, lighting,
textures, and terrain layers before a mission can use the pack. Cached packs
are immutable; editing a loaded mission cannot change another mission's rules.

## Generated sprite sheets

[`scripts/sprite-sheet.ts`](../scripts/sprite-sheet.ts) draws seamless frames
and packs them into sheets.
[`scripts/grass-sheet.ts`](../scripts/grass-sheet.ts) builds the dense and
sparse grass sheets, whose cells each span four tiles so repeats are hard to
spot. Run `npm run assets:grass` after changing it and copy the printed clip
and minimap colors into the pack.
[`scripts/muzzle-flash-sheet.ts`](../scripts/muzzle-flash-sheet.ts) builds the
muzzle flash; run `npm run assets:effects` after changing it and copy the
printed clip into the pack. Effect cells must be transparent at their edges.
The unit tests fail while a committed sheet or clip differs from what its
script builds.
