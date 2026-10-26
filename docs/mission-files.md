# Mission files

Levels and saves share one JSON format. A level is a mission file at tick 0;
a save is the same mission later. The game starts every mission, including the
bundled levels, by loading a file through the same path, so any level or save
can be read, edited by hand, and loaded again.

## Files

- [`src/content/levels/`](../src/content/levels/) holds the bundled levels:
  `arc-economy-opening.json`, `sandbox.json`, and `skirmish-map.json`.
- `npm run levels` rebuilds them from
  [`scripts/levels/`](../scripts/levels/), replacing hand edits. Edit the
  scripts to keep a change, or edit the JSON for quick experiments.
- Prettier skips the level directory; the game writes its own layout.
- Free-construction previews share `scripts/levels/sandbox-level.ts`. Each
  can supply its own content reference and actor roster.
- `skirmish-map` is a development terrain preview with free construction and
  training. It has no economy, so its resource areas are not shown. The
  authoring inputs in `scripts/levels/skirmish-map.ts` define mirrored
  west/east start slots, flat base areas, three ridge crossings, resource
  areas, and faction opening packages. Each slot names its starting resource
  area for expansion attribution. `createSkirmishOpening` assembles one
  faction's headless opening at a slot; owner and setup state are not yet part
  of the mission format.
- Saves live in browser local storage or, in the desktop build, in the app
  data folder's `saves` directory. **Export file** and **Import file** in the
  game menu move them between the game and ordinary files.

## Layout

- `format` is `"cotuw-mission"` and `version` is the current file version.
  Loading rejects other formats and versions. Incompatible state, command, or
  built-in simulation changes require a version increment under the
  [persistence policy](../DESIGN.md#persistence). Change the version with its
  implementation and regenerate bundled levels.
- `ticksPerSecond` must match the build's simulation rate.
- `save` holds a save's name and ISO timestamp. Levels omit it.
  A tick-0 save keeps its metadata and does not replace the restart level.
- `scenario` holds authored content that stays fixed during a mission:
  - `id` identifies the level. Restart reloads the level with this ID.
  - `content` names the [content pack](content-packs.md) and version that
    supply actor definitions and presentation. Loading rejects a pack the
    build lacks or a different version, so a save keeps its rules.
  - `actors` lists the pack's actor IDs this mission uses; omit it to use all.
  - `name`, `briefing`, and `goals` fill the save list and sidebar.
  - `popups` lists explanations with an `id`, `title`, `text`, and a
    `trigger`: `{ "kind": "placement", "definitionId": ... }` while placing
    that building, or `{ "kind": "actor", "definitionId": ... }` once the
    player owns a completed actor of it. Placement triggers require an actor
    definition with a footprint.
  - `flocks` lists ambient birds, each with a world `center`, loop `radius`,
    `altitude` above the highest terrain under the loop, bird `count`, and
    `lapSeconds`. Radius, altitude, and lap time must be positive; count is a
    non-negative integer. They are presentation only.
  - `tileSize`, `terrainTypeIds`, and `objectives` define the map scale, valid
    terrain types, and victory and defeat rules.
- `state` holds the complete simulation state. `state.scenarioId` must match
  `scenario.id`. `state.dismissedPopups` lists the popup IDs the player
  dismissed; removing an ID shows that popup again.

## Terrain and fog

Text rows run north to south and characters run west to east, so a file reads
like the minimap.

- `terrain.legend` maps one character to one tile's semantics, such as
  `"~": { "typeId": "water" }` or
  `"#": { "typeId": "plain", "outOfBounds": true }`.
- `terrain.tiles` has one string per row and one legend character per tile.
- `terrain.heights` has one number array per row of tile corners, so it has
  one more row and column than `tiles`.
- `fog.explored` uses `1` for explored tiles. Removing `fog` reveals the whole
  map.

## Positions

Actors store world positions. The map is centered on the origin, so a tile's
center is at `x = (tileX + 0.5 - width / 2) * tileSize` and
`z = (tileZ + 0.5 - height / 2) * tileSize`. Buildings take their position
and facing from `tilePlacement`, whose `origin` is in tiles.

## Unit orders

- Mobile actors may carry a nonempty `orders` list. Omit it for an empty queue.
- Each entry is a `move` or `attack-move` with a world `target`, an `attack`
  with a `targetId`, or a `gather` with a `siteId`.
- Group destinations may include `requestedTarget`, the original group click.
  Both positions must lie within mission bounds.
- Queues start in sequence after the current order ends. Targets and paths
  are checked when the order starts; removed or unavailable targets are skipped.
- Queued attacks require a weapon and queued Gather requires harvesting rules.
  Scheduled queueable commands use `queued: true` to append instead of replace.

## Validation

Loading checks the file's shape, then builds a simulation from it before it
replaces the current mission. Any error leaves the current mission running and
shows its reason, such as an unknown legend character with its tile
coordinates. Scenario metadata is checked too, including distinct actor and
terrain IDs, briefing text, goal references, and save timestamps.
