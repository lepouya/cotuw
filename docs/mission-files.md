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
  `scripts/levels/base-content.ts` resolves actor definitions and prices for
  authored text; neither introduction imports the other.
- Fixed-force scenarios can omit the authoring fields `stockpiles`, `sites`,
  and `loot` together. `createScenarioState` then supplies fog and actor state
  without an economy. The Circle level gives the player only a Lifebloom
  stockpile, with empty Materials sites, Lifebloom gifts, and an authored
  `cultivation` with `sites`. Worker states for harvesting and cultivating
  units derive from their definitions, as they do for trained units.
- `skirmish-map` is a development terrain preview with free construction and
  training. It has no economy, so its resource areas are not shown. The
  authoring inputs in `src/content/skirmish-map.ts` define mirrored west/east
  start slots, flat base areas, three ridge crossings, and resource areas with
  both Materials and Lifebloom sites. Each slot names its starting resource
  area for expansion attribution. `src/content/skirmish.ts` holds the faction
  opening packages and assembles any `SkirmishMap`. Each map supplies a stable
  `id` used as `scenario.id`; distinct maps use distinct IDs. Alternate maps
  restart from their registered level source.
- Built-in skirmishes have no bundled level file. `assembleSkirmish` resolves
  faction-to-slot assignments, the player's slot, and difficulty into a tick-0
  mission at launch, with one owner per slot sharing the slot's ID. Links use
  `?skirmish=<west>-<east>&player=<slot>&difficulty=<level>`, for example
  `?skirmish=arc-circle&player=east&difficulty=hard`. Development links add
  `&ai=<slot>:<profile>,...`, such as `&ai=east:arc-skirmish`, to assign AI.
- `scenario.setup` records launch choices: `difficulty`, the matching
  `enemyScale`, `enemyOwners`, and for skirmishes `factions` by slot. Restart
  reapplies them; a level without it plays at the authored baseline. Enemy
  owners are fixed at launch, so later alliance changes do not change scaling.
- Imported level files remain their scenario's restart source for the session,
  including assembled skirmishes edited as levels. Otherwise, only saves with
  a known built-in skirmish setup can restart without a registered level.
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
  - `id` identifies the scenario. Restart uses its registered level source or
    reconstructs the built-in skirmish from its setup.
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
  - `ai` lists `{ "owner": id, "profileId": id }` for each AI-controlled owner,
    naming a [content pack](content-packs.md) profile. The player's owner may
    appear, as in headless matches.
  - `tileSize`, `terrainTypeIds`, and `objectives` define the map scale, valid
    terrain types, and victory and defeat rules.
  - `savePolicy` defaults to `"skirmish"` when `skirmish` rules are present,
    otherwise `"objectives"`. The objectives policy autosaves when an objective
    completes and prevents saving after defeat. `"skirmish"` autosaves at a
    fresh start and every five simulation minutes until a result, skipping a
    result tick, and permits saving after every result. The skirmish map
    preview uses it. Owner-based skirmish rules reject an explicit
    `"objectives"` policy.
- `uiState` holds player interface state outside the simulation. Levels omit
  it. `uiState.dismissedPopups` lists the popup IDs the player dismissed;
  removing an ID shows that popup again.
- `state` holds the complete simulation state. `state.scenarioId` must match
  `scenario.id`.

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
- The [ownership rules](../DESIGN.md#ownership-and-relationships) and
  [runtime contracts](runtime-boundaries.md#economy-infrastructure-and-growth)
  own what relationships and sharing do to combat, vision, support, and
  headquarters queues.
- `scenario.emergencyHeadquarters: true` applies the
  [recovery rule](../DESIGN.md#m1-skirmish-results). Such a job has no
  `headquartersId`, and each owner runs one at a time in placement order,
  independently of allied queues.
- Saved Harvester and Cultivator assignments must name their owner's buildings.
- Scenario authoring assigns each building and unit without an explicit
  `owner` to the first owner playing its definition's faction, and rejects an
  actor that no owner plays. Wolf-den levels use a `player` owner and a
  `wildlife` owner, hostile to each other; free-construction previews use a
  factionless `player` owner.

## Skirmish results

- `scenario.skirmish` names exactly two distinct `owners`, including the
  player, and a nonempty `qualifyingDefinitionIds` list of building types in
  the mission's content. It cannot accompany campaign objectives. All owners'
  actors use the same type list, independently of their faction.
- Only surviving, completed, tile-placed buildings of those types prevent
  elimination. Include the types specified in
  [skirmish results](../DESIGN.md#m1-skirmish-results), including defenses and
  excluding Relay Stations, as roster content becomes available.
- Both owners are evaluated once after commands, combat, and construction.
  Sales count; a building completed that tick counts. Inactive buildings
  count, while unfinished construction and mobile units do not.
- `state.skirmishResult` is absent during play. At elimination it records
  `kind` (`"victory"`, `"defeat"`, or `"draw"` from the player's perspective),
  the zero-based resolution `tick`, and `eliminatedOwners` in scenario order.
  Both eliminated owners produce a draw. The final state has `tick` equal to
  the resolution tick plus one and an empty command queue.
- Loading validates the result against the final buildings and preserves
  frozen inspection. Results cannot be dropped from finished saves. Further
  simulation ticks do nothing and simulation mutations are rejected. Camera,
  selection, saving, and loading remain available.

## Match metrics

- Owner-based skirmishes require `scenario.skirmish.startingResourceSites`,
  mapping each competing owner to its starting Materials and Lifebloom site
  IDs. Every other site qualifies for expansion income. Empty lists are valid
  for scenarios without starting resource sites.
- Actor definitions supply military roles. Armed mobile units that neither
  harvest nor cultivate form the army; buildings that train them provide
  military production.
- `state.metrics.owners` follows the competing owners' order. Each entry saves
  `milestones`, `gathered` and `spent` totals by resource, `unitsProduced`,
  `buildingsCompleted`, `unitsLost`, `buildingsLost`, `peakArmy`, and `history`.
  Losses count combat destruction; cancellations and sales do not. Paid jobs
  authored in the opening contribute their prepaid cost to spending.
- Milestone fields are `firstIncome`, `militaryReady`, `firstCombatUnit`,
  `firstExpansion`, `firstEngagement`, and `firstBaseAttack`. Their values are
  exact zero-based simulation ticks; absent fields mean Not reached. The
  [match summary](../DESIGN.md#m1-match-summary) owns their gameplay meanings.
- Each history sample saves `tick`, living mobile `units`, completed
  `buildings`, `explored` tiles, and currently `visible` tiles. The opening
  sample uses tick 0. Regular samples record the last tick of each five-second
  interval; a final sample records the resolution tick, sharing the regular
  sample if they coincide. A match ending on tick 0 keeps opening and final
  samples at that tick.
- `state.skirmishResult` owns the verdict and commits with all final-tick
  counters and history. Finished saves retain this immutable checkpoint.
  Loading rejects missing summaries after tick 0, invalid sample schedules,
  inconsistent delivery totals, and inconsistent final populations. History
  must fit saved exploration; spending must cover refundable jobs, and both
  owners must agree on the first engagement tick.
- `simulation.metrics` exposes immutable data for headless reports and
  post-match presentation. It is omniscient and is not part of owner knowledge
  or player sidebar state; rival histories remain unavailable during play.

## Commands

- `state.commands` lists commands waiting for the next tick, each with its
  `tick`, `issuer`, and `command`.
- An `issuer` is `{ "owner": id }` for an owner's player, the same with
  `"ai": true` for its AI, or `{ "script": true }` for mission scripts,
  optionally with the `owner` they act for. AI commands apply in the tick that
  issues them, so saves do not hold them.
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
  holds, and take effect from the next tick. Campaign defeats and all
  skirmish verdicts stop them.

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

## AI state

- `state.ai` maps each owner in `scenario.ai`, and no others, to its director
  state. Authoring starts each owner in `establishing`, with first rounds one
  tick apart.
- `posture` and optional `requestedPosture`, which applies at the next round,
  must be ones the profile permits. `nextRoundTick` schedules the next round,
  and `cursor` is the next concern of a round in progress. `nextActorNumber`
  starts at one and advances whenever the owner generates an actor ID.
- `budgets` maps concerns to resource amounts set aside. `claims` maps actor IDs
  to the concern holding them. Before each planning tick, budgets account for
  current balances, and claims release lost actors and units beyond the current
  posture's shares, keeping earlier actor IDs first. Refused purchases restore
  their original budget reservations. `rejections` holds each refused
  `concern`, `tick`, `command`, and `reason` until that concern's next turn.
  `memory` maps concerns to their own JSON state.

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
- Worker `cargoSources` records collection order as `{ "siteId", "amount" }`
  entries. Amounts use thousandths, including Cultivator fractional cargo.
  Deliveries consume whole resources from that sequence; any fractional
  remainder retains its source. Interruptions and site changes preserve it.
  Sources must attribute all carried cargo; a worker with none may omit them.
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
