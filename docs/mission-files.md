# Mission files

Levels and saves share one JSON format. A level is a mission file at tick 0;
a save is the same mission later. The game starts every mission, including the
bundled levels, by loading a file through the same path, so any level or save
can be read, edited by hand, and loaded again.

## Files

- [`src/content/levels/`](../src/content/levels/) holds the bundled levels:
  `arc-economy-opening.json`, `sandbox.json`, `skirmish-map.json`, and
  `circle-wolf-den.json`.
- `npm run levels` rebuilds them from
  [`scripts/levels/`](../scripts/levels/), replacing hand edits. Edit the
  scripts to keep a change, or edit the JSON for quick experiments.
- Prettier skips the level directory; the game writes its own layout.
- Free-construction previews share `scripts/levels/sandbox-level.ts`. Each
  can supply its own content reference and actor roster.
- ARC and Circle introductions share `scripts/levels/wolf-den.ts` for terrain,
  starting headquarters placement, wildlife, objectives, and crossing gifts.
  Each opening supplies its economy, roster, guidance, and reward currency.
  `base-content.ts` resolves actor definitions and prices for authored text;
  neither introduction imports the other.
- Fixed-force scenarios can omit the authoring fields `materials`, `sites`,
  and `loot` together. `createScenarioState` then supplies fog and actor state
  without an economy. The Circle level uses `materials: 0`, empty Materials
  sites, Lifebloom gifts, and an authored `cultivation` with `lifebloom` and
  `sites`. Worker states for harvesting and cultivating units derive from
  their definitions, as they do for trained units.
- `skirmish-map` is a development terrain preview with free construction and
  training. It has no economy, so its resource areas are not shown. The
  authoring inputs in `scripts/levels/skirmish-map.ts` define mirrored
  west/east start slots, flat base areas, three ridge crossings, resource
  areas, and faction opening packages. Each slot names its starting resource
  area for expansion attribution. `createSkirmishOpening` assembles one
  faction's headless opening at a slot, owned by that slot's ID. Two-owner
  assembly and setup state are not yet part of the mission format.
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

## Owners

- `state.owners` lists the participants that control actors, each with an
  `id` and an optional `faction` the participant plays. That faction selects
  the player's labels, prices, and music; it does not limit control.
- `state.playerOwner` names the owner the player controls and whose
  exploration the fog records. Owner IDs are distinct.
- Every actor and wreck has an `owner` naming one of `state.owners`.
- `state.relationships` lists allied and hostile pairs as `{ "owners": [a,
  b], "relationship": "allied" | "hostile" }`; every other pair is neutral.
  Each pair appears once. Allies may add `"sharesSupport": true` and
  `"sharesHeadquarters": true` independently.
- Only hostile owners attack each other; Attack orders against neutral or
  allied actors are rejected.
- Support links connect same-faction buildings of owners that share support.
  A building is powered only by a linked root whose owner shares support with
  every relay along the path. Placement also requires sharing with both the
  covering relay and its root; a relay cannot lend a third owner's support.
- Circle growth uses the nearest Heartgrove of its owner or of an ally that
  shares headquarters. When sharing ends, the growth moves to the nearest
  eligible Heartgrove on the next tick, or pauses with its payment and
  progress until one is available. Construction without a headquarters queue,
  such as ARC construction, has one slot per owner.
- Harvesters deliver only to their owner's Refineries; the stockpiles are
  still shared by the mission. Cultivators tend and deliver only to their
  owner's buildings, including when restoring saved assignments.
- With `fog`, every owner sees what its own and its allies' actors see. Only
  the player owner keeps explored terrain, which remains after an alliance
  ends. Harvesters choose sites from their owner's known tiles: explored
  terrain for the player, current vision for other owners. Without `fog`,
  every owner sees everything.
- Placement creates buildings for the player owner, and trained units inherit
  their producer's owner. Behaviors cannot change an actor's owner.
- Scenario authoring assigns each building and unit without an explicit
  `owner` to the first owner playing its definition's faction, and rejects an
  actor that no owner plays. Wolf-den levels use a `player` owner and a
  `wildlife` owner, hostile to each other; free-construction previews use a
  factionless `player` owner.

## Events

- `scenario.events` lists one-time events, each with an `id`, a `trigger`,
  and a nonempty list of `actions`. `state.firedEvents` lists the IDs that
  have fired, so loading never repeats them.
- Triggers are `{ "kind": "time", "seconds": n }`, which holds once `n`
  simulation seconds have elapsed, and `{ "kind": "objective-complete",
  "objectiveId": id }`.
- The `set-relationship` action names two distinct `owners` and a
  `relationship` of `allied`, `neutral`, or `hostile`. An `allied` action may
  add `sharesSupport` and `sharesHeadquarters`; sharing an action leaves out
  is revoked.
- Events fire in authored order at the end of the tick their trigger first
  holds, and take effect from the next tick. A defeat stops them.

## Circle economy state

- `state.economy.cultivation` owns Lifebloom, deposited Lifebloom, renewable
  sites, and Cultivator states. Materials remain a separate balance.
- Site reserves and regeneration use integer thousandths of a resource unit.
  Sites save capacity, reserve, thresholds, regeneration remainder, and
  dormancy. Workers save integer cargo, fractional collection and rate
  remainders, site and delivery targets, the building they tend, and phase.
  At most one worker tends each building.
- Each `economy.loot` entry has exactly one positive `materials` or
  `lifebloom` reward and a saved `collected` flag. The mission must hold that
  resource. Pickups credit its stockpile once; they do not count as worker
  deliveries. Materials and Lifebloom share the gift model and pickup rules.
- Paid construction and production save `paidCost`; their actor definition
  identifies its currency. Circle construction also saves `headquartersId`;
  any construction saves whether it holds an active slot.
  Growth layers derive from completed ticks and save no rendering state.
- Placement commands can carry selected `workerIds`. Evaluation chooses the
  nearest reachable eligible worker against the prospective footprint. A
  `tend` command names one worker and its unfinished `buildingId`.

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
