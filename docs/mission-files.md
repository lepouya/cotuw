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
- Fixed-force scenarios can omit the authoring fields `stockpiles`, `sites`,
  and `loot` together. `createScenarioState` then supplies fog and actor state
  without an economy. The Circle level gives the player only a Lifebloom
  stockpile, with empty Materials sites, Lifebloom gifts, and an authored
  `cultivation` with `sites`. Worker states for harvesting and cultivating
  units derive from their definitions, as they do for trained units.
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
  Loading rejects other formats and versions. The Load panel lists files with
  another format, version, tick rate, or content pack version as
  incompatible, with the reason and a Delete action. Incompatible state,
  command, or built-in simulation changes require a version increment under
  the [persistence policy](../DESIGN.md#persistence). Change the version with
  its implementation and regenerate bundled levels.
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
  - `savePolicy` is `"objectives"` by default: autosave when an objective
    completes, and no saving after defeat. `"skirmish"` autosaves at a fresh
    start and every five simulation minutes until a result, skipping a
    result tick, and permits saving after every result. The skirmish map
    preview uses it.
- `state` holds the complete simulation state. `state.scenarioId` must match
  `scenario.id`. `state.dismissedPopups` lists the popup IDs the player
  dismissed; removing an ID shows that popup again.

## Owners

- `state.owners` lists the participants that control actors, each with an
  `id` and an optional `faction` the participant plays. That faction selects
  the player's labels, prices, and music; it does not limit control.
- `state.playerOwner` names the owner the player controls. Owner IDs are
  distinct.
- Every actor and wreck has an `owner` naming one of `state.owners`.
- `state.relationships` lists allied and hostile pairs as `{ "owners": [a,
  b], "relationship": "allied" | "hostile" }`; every other pair is neutral.
  Each pair appears once. Allies may add `"sharesSupport": true`,
  `"sharesHeadquarters": true`, and `"sharesResources": true` independently.
- Only hostile owners attack each other; Attack orders against neutral or
  allied actors are rejected.
- Support links connect same-faction buildings of owners that share support.
  A building is powered only by a linked root whose owner shares support with
  every relay along the path. Placement also requires sharing with both the
  covering relay and its root; a relay cannot lend a third owner's support.
- Construction uses the infrastructure queue of the nearest eligible
  headquarters, a definition with `infrastructure.slots`, of its owner or of
  an ally that shares headquarters. Circle growth uses its definition's
  Heartgrove; other construction uses a headquarters of its faction whose
  support powers the blueprint. Buildings retain their affiliation after
  completion and while their headquarters remains eligible. Otherwise they
  move to the nearest eligible one on the next tick. Paid work keeps payment,
  progress, and placement priority without its slot, or pauses until a
  headquarters is available. Completed headquarters affiliate with themselves.
- `scenario.emergencyHeadquarters: true` applies the skirmish recovery rule.
  An owner without a completed headquarters may place one: ARC within the
  support radius of any completed owned building, even a disconnected one,
  and the Circle with a tending Cultivator. Such a job has no
  `headquartersId`, ignores support, and does not use infrastructure capacity;
  each owner runs one at a time in placement order, independently of allied
  queues. Other work needs an eligible operational headquarters.
- Harvesters deliver only to their owner's Refineries and Cultivators tend
  and deliver only to their owner's buildings, including when restoring saved
  assignments. Deliveries credit the worker's owner.
- With `fog`, every owner sees what its own and its allies' actors see and
  keeps the terrain it explored, which remains after an alliance ends.
  Harvesters choose explored sites using last-seen yields and investigate
  unknown yields. Placement checks footprints against the owner's explored
  terrain. Without `fog`, every owner sees everything.
- Placement creates buildings for the issuing owner, and trained units
  inherit their producer's owner. Behaviors cannot change an actor's owner.
- Scenario authoring assigns each building and unit without an explicit
  `owner` to the first owner playing its definition's faction, and rejects an
  actor that no owner plays. Wolf-den levels use a `player` owner and a
  `wildlife` owner, hostile to each other; free-construction previews use a
  factionless `player` owner.

## Commands

- `state.commands` lists commands waiting for the next tick, each with its
  `tick`, `issuer`, and `command`.
- An `issuer` is `{ "owner": id }` for an owner's player or AI, or
  `{ "script": true }` for mission scripts, optionally with the `owner` they
  act for.
- Owners command only their own actors: the ordered units, the producer for
  training and its cancellation, and selected workers for placement. A group
  move rejects only the members the issuer may not command. Rejections report
  `unauthorized`.
- Placement builds for the issuer's owner and requires that owner to know
  every footprint tile, as Harvesters do for sites. Rally points use their
  producer owner's knowledge.
- `scenario.scriptControl` lists the owners whose actors scripts may command,
  as `{ "owner": id }`, optionally limited by `actorIds`. Each owner appears
  once; actor lists are nonempty and distinct, and unknown fields are invalid.
  Scripts command the player's actors only through an entry for the
  player owner. A limited entry places only the building IDs it lists.
- Only scripts issue `terrain` commands.

## Events

- `scenario.events` lists one-time events, each with an `id`, a `trigger`,
  and a nonempty list of `actions`. `state.firedEvents` lists the IDs that
  have fired, so loading never repeats them.
- Triggers are `{ "kind": "time", "seconds": n }`, which holds once `n`
  simulation seconds have elapsed, and `{ "kind": "objective-complete",
  "objectiveId": id }`.
- The `set-relationship` action names two distinct `owners` and a
  `relationship` of `allied`, `neutral`, or `hostile`. An `allied` action may
  add `sharesSupport`, `sharesHeadquarters`, and `sharesResources`; sharing an
  action leaves out is revoked.
- Events fire in authored order at the end of the tick their trigger first
  holds, and take effect from the next tick. A defeat stops them.

## Observations

- `state.observations` maps owner IDs to what each owner remembers, as
  `{ "actors": [], "sites": [], "loot": [] }`; an owner without an entry has
  seen nothing. Each list is in ID order. Every tick ends by updating each
  owner's memory from its current vision, so loading does not change it.
- An actor sighting records another, non-allied owner's actor: `actorId`,
  `definitionId`, `owner`, `worldPosition`, any `tilePlacement`, `health`
  when damaged, construction `completedTicks` and `totalTicks`, and the
  `tick` it was last seen. Payment and queue slots stay private.
- Sightings follow the
  [memory rules](../DESIGN.md#fog-stealth-and-detection): seeing the actor
  again refreshes them, and seeing a building's footprint empty or a unit's
  wreck removes them. An alliance clears and suspends memory of its partner.
- A site sighting records `siteId`, last-seen `amount` (Materials left or the
  renewable reserve in thousandths), `dormant: true` when dormant, and
  `tick`. A loot sighting records `lootId` and `tick` for uncollected loot,
  and is removed when the owner sees its tile without it.
- Saved sightings must name active or retired actors and valid resources.
  Positions, footprints, health, construction progress, and yields must fit
  the referenced definitions, map, and site limits.

## Economy state

- `state.economy.stockpiles` lists balances as `{ "resource": "materials" |
  "lifebloom", "owners": [id], "amount": n }`. Each owner holds at most one
  stockpile per resource, and an owner without one cannot pay that resource's
  prices. Placement, training, cancellation, and sale refunds use the owner of
  the building or producer. A credit to an owner without a stockpile opens
  one.
- Owners linked by `sharesResources`, directly or through other members, form
  a pool. Each pool holds one stockpile per resource any member holds, listing
  every member in `owners`. Scenario authoring pools the starting stockpiles
  of owners that start sharing. When sharing changes, a pool's balance divides
  equally among its owners, earlier IDs taking indivisible remainders, and the
  new pools sum their members' shares.
- `state.economy.deposited` lists worker deliveries as `{ "owner",
  "resource", "amount" }`, at most once per pair. Pickups and refunds are not
  deliveries.
- `state.economy.cultivation` owns renewable sites and Cultivator states.
- Site reserves and regeneration use integer thousandths of a resource unit.
  Sites save capacity, reserve, thresholds, regeneration remainder, and
  dormancy. Workers save integer cargo, fractional collection and rate
  remainders, site and delivery targets, the building they tend, and phase.
  At most one worker tends each building.
- Each `economy.loot` entry has exactly one positive `materials` or
  `lifebloom` reward and a saved `collected` flag. Some owner must hold that
  resource. A pickup credits the collecting unit's owner once, under the
  [loot rule](../DESIGN.md#ownership-and-relationships). Materials and
  Lifebloom share the gift model and pickup rules.
- Paid construction and production save `paidCost`; their actor definition
  identifies its currency. Buildings save `headquartersId` on the actor,
  independently of construction. Construction saves whether it holds an active
  slot.
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
- `fog.explored` maps owner IDs to rows that use `1` for explored tiles. An
  owner without rows has explored nothing. Removing `fog` reveals the whole
  map to every owner.

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
