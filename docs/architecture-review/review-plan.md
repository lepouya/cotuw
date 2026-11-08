# Codebase review campaign plan

Temporary multi-session tracker for the pre-Phase-C codebase review. Update
slice status and cross-cutting findings in place as work completes. Promote
lasting contracts to `DESIGN.md` or owning files in `docs/`, track deferred
product work in `TODO.md`, and remove temporary files in
`docs/architecture-review/` when the campaign closes.

## Locked campaign rules

- **Cadence (hybrid slice loop):** run Session 1 as a read-only repo-wide
  architectural survey first, then process each slice in order through
  modular assessment, authorized refactoring (when evidence justifies it),
  and an exhaustive file-by-file low-level review pass before advancing.
- **Priority tiers:**
  - Tier 1 (top priority): `src/`, `index.html`, and `src-tauri/`.
  - Tier 2 (secondary priority): `scripts/` and documentation (`README.md`,
    `AGENTS.md`, `DESIGN.md`, `TODO.md`, and `docs/*`).
  - Tier 3 (lowest priority): `tests/`, `e2e/`, and test runner configs.
- **Low-level review depth:** exhaustive file-by-file inspection from line 1
  to EOF for every file in the active slice once its module seams settle.
  Split a slice across two sessions (Pass A modular + refactor, Pass B
  exhaustive low-level review) whenever Pass A performs substantial structural
  edits so no file is skimmed.
- **Compatibility bounds:** pre-alpha development permits breaking mission,
  save, and content format changes without backward-compatibility migrations.
  Any format change still requires a version bump, `npm run levels`
  regeneration, updated validation and `docs/mission-files.md` or
  `docs/content-packs.md`, same-build round-tripping, and deterministic
  continuation. Specified gameplay and locked technical rules in `DESIGN.md`
  and `docs/runtime-boundaries.md` remain binding.
- **Reporting format:** use concise Markdown lists (`<= 80` chars in repo
  docs) rather than HTML reports or Markdown tables.

## Per-slice execution protocol

1. **Pass A: modular assessment and structural refactor**
   - Run `$improve-codebase-architecture` (survey-only, Markdown) and
     `$seam-ripper` independently against the slice snapshot and cross-slice
     notes in `docs/architecture-review/`.
   - Challenge and consolidate claims with `$reviewing-code-modularity-skill`
     (Mode A), comparing no change, local repair, and substantial redesign.
   - Pause only for material design trade-offs or conflicts with locked
     decisions in `DESIGN.md`.
   - Execute supported structural improvements in verified chunks via
     `$architectural-refactor` or modularity Mode D, running focused checks
     per chunk and `npm run check` (plus affected browser/asset checks).
2. **Pass B: exhaustive low-level code review**
   - Read every file in the slice manifest completely and check:
     - Flattened control flow, clear state transitions, and minimal flag
       coupling.
     - Domain-aligned naming matching `DESIGN.md`, retiring stale
       single-player or single-faction phrasing in shared paths.
     - Strong discriminated unions, `readonly` projections, and `Map` or
       own-property dictionary lookups.
     - Removal of dead exports, obsolete shims, and duplicated local logic.
     - Concise 1-line rationale comments and non-obvious contract doc
       comments per `AGENTS.md`, removing restatement comments.
     - Avoidance of unnecessary per-tick or per-frame allocations in hot
       simulation and rendering paths.
   - Apply `$code-simplifier` within the slice's settled architecture, rerun
     affected checks and `npm run check`, and mark the slice complete below.

## Session and slice backlog

### Macro pass

- [x] **Session 1: repo-wide architectural survey (read-only)**
  - Scope: cross-folder dependency graph across `src/*` and `src-tauri/*`,
    central coordinators (`src/simulation/mission.ts`, `src/session.ts`,
    `src/application.ts`, `src/mission-loading.ts`), cross-subsystem edges,
    and readiness for M1 Phases C-F (`1.29-1.66`).
  - Deliverable: [macro-findings.md](macro-findings.md) with consolidated
    cross-slice seam targets and refined slice ordering; no game code edits.

### Tier 1: runtime and desktop host (`src/`, `index.html`, `src-tauri/`)

- [x] **Slice 1: simulation kernel, commands, authority, probe, and saves**
  (17 files, ~4,998 LOC)
  - `src/simulation/`: `mission.ts`, `mission-file.ts`, `command.ts`,
    `authority.ts`, `loop.ts`, `clock.ts`, `world.ts`, `validation.ts`,
    `scenario.ts`, `skirmish.ts`, `mission-setup.ts`, `ownership.ts`,
    `objectives.ts`, `match-metrics.ts`, `events.ts`, `mission-result.ts`.
  - `src/`: `benchmark-probe.ts`.
  - Focus: transaction staging/commit and order-queue extraction in
    `mission.ts`, `MissionFile.uiState` separation from `MissionState`,
    non-mutating tick controller/observer hooks replacing `simulation.tick`
    monkey-patching, and Phase C AI state/command readiness (`1.29-1.32`).
  - [x] **Pass A** (modular assessment and refactor, base `60a0796`):
    - Added `MissionSimulation.observeTicks` (`TickObserver` with
      `beforeTick`/`afterTick`) so every driver runs observers; the
      benchmark probe uses it instead of replacing `simulation.tick`.
    - Moved `dismissedPopups` from `MissionState` to `MissionFile.uiState`;
      `serializeMission` takes `{ save, uiState }`; mission file version
      `18`; levels regenerated; `docs/mission-files.md` and `DESIGN.md`
      updated.
    - Checks: format, lint, typecheck, units, and the affected browser specs
      (`economy`, `saves`, `skirmish-results`, `benchmark`) pass.
    - Deferred: order-queue policy consolidation (`busy`,
      `queuedOrderOf`, `canQueueOrder`, `sequence`) until `1.41` adds
      order kinds; player-owner defaults on `submitCommand` and
      `evaluatePlacement` (290 call sites) with Slice 2 `viewOf(owner)`;
      AI director state slot in `MissionState` with `1.32`.
  - [x] **Pass B** (exhaustive review and `$code-simplifier` cleanup):
    - `mission.ts`: committed objective verdict cached per tick instead of
      re-evaluated by every `result`, `objectives`, and mutation check; the
      end-of-tick identity check reads frozen committed actors without
      copying; queued-order rejection reasons moved into `queueRejection`.
    - Local cleanups in `ownership.ts`, `objectives.ts` (own-property rule
      lookup), `command.ts`, `mission-file.ts`, `match-metrics.ts`, and
      `scenario.ts`; unused value exports `QUEUEABLE_KINDS`,
      `RELATIONSHIPS`, and `SAVE_POLICIES` made module-private.
    - Deferred to Slice 2: player-specific helpers in `ownership.ts`
      (`createPlayerAccess`, `playerRelation`, `playerFactionOf`) and
      `MissionSimulation.fog`/`playerFaction`, which `viewOf(owner)` replaces.
    - Deferred to Slice 3: `evaluateSpawn` in `mission.ts` copies every used
      ID per evaluation; `production.ts` only needs `has`.

- [x] **Slice 2: simulation actors, combat, vision, and owner projections**
  (5 files, ~2,147 LOC)
  - `src/simulation/`: `actor.ts`, `combat.ts`, `vision.ts`,
    `observations.ts`, `player-view.ts`.
  - Focus: symmetric `simulation.viewOf(owner)` projection replacing
    single-player `createPlayerView`, redacting foreign intent and unseen
    `combat.lastHit.attackerId` (`1.29`) while preserving observable posture,
    plus unit-assist (`1.41`, `1.52`) and demolition (`1.42`) seams.
  - [x] **Pass A** (modular assessment and refactor, base `c3037ef`):
    - Replaced `player-view.ts` with `owner-view.ts`:
      `MissionSimulation.viewOf(owner)` returns one memoized `OwnerView` per
      owner and replaces `knowledgeOf`, `fog`, and `playerFaction`
      (`view.knowledge`, `view.faction`). Unknown owners throw.
    - Detected foreign actors are `ObservedActor` projections: pose, health,
      construction progress and activity, turret aim, `activeTick`, territory
      mode, and an attack target only when the viewer also sees it. Own
      actors drop `combat.lastHit` unless the owner detects the attacker.
    - The view exposes no omniscient lookups; session interpolation, follow,
      and `showActor` read shown actors, and route previews read own mobile
      actors. Render and sidebar parameters take `ObservedActor`;
      `TilePlacedActorState` omits `paidCost`.
    - `ownership.ts`: `createPlayerAccess`/`PlayerAccess` folded into the
      view; `playerRelation` -> `ownerRelation`, `playerFactionOf` ->
      `factionOf(owners, id)`; `Detectable` moved to `vision.ts`. Economy
      controls take `faction` as an option.
    - No persisted format change. Docs: `runtime-boundaries.md`,
      `ui-ownership.md`, and `TODO.md` (`1.19`, `1.29`).
    - Checks: format, lint, typecheck, units, the browser smoke checks, and
      the affected browser specs pass.
    - Deferred to Slice 5: remaining omniscient session reads
      (`simulation.actors` for health/damage effects, alerts, popups, and
      audio; `simulation.economy` for gathering posture and balances) and
      dropping the now-redundant `ownIds` route filter.
    - Deferred to `1.41`/Slice 4: extracting pursuit (`chase`,
      `followOrder`, route retry) from `updateCombat` for unit assistance.
      `1.42` needs only the single damage site in `updateCombat`.
    - Deferred: player-owner defaults on `submitCommand` and
      `evaluatePlacement` (mostly test call sites) until an AI caller lands.
  - [x] **Pass B** (exhaustive review and `$code-simplifier` cleanup):
    - `combat.ts`: personal-sight cache keyed by actor objects instead of a
      `JSON.stringify` pair per lookup; `validateCombatActor` split into
      named attack-move, health, attack, return, and combat checks.
    - `vision.ts`: visible tile count kept during `update` instead of reduced
      on every read; module `seesTile` renamed `tileInSight` so the owner
      vision's `seesTile` no longer shadows it; `personallyDetects` narrows
      with `isTilePlacedActor`; unused value exports `visionSources`,
      `createVision`, and `createFog` made module-private.
    - `observations.ts`: sightings copy tile placements with `cloneData`
      rather than per-tick `structuredClone`.
    - `actor.ts`: `ActorRenderState` is `DeepReadonly<Actor>`, documented as
      published committed state; stale player and legacy wording removed.
    - `owner-view.ts`: inner hit redaction renamed so it no longer shadows
      `ownActor`.
    - Checks: format, lint, typecheck, and units pass; browser smoke could
      not launch Chromium in the sandbox.
    - Deferred to Slice 4: `WOLF_MODES`/`WolfMode` name a generic territory
      state after one NPC; per-update `Uint8Array` in `createVision` and
      `occupiedTilesFor` in owner `detects` stay until profiling shows cost.

- [x] **Slice 3: simulation economy, infrastructure, growth, and production**
  (11 files, ~2,835 LOC)
  - `src/simulation/`: `economy.ts`, `cultivation.ts`, `growth.ts`,
    `worker-navigation.ts`, `cargo.ts`, `stockpiles.ts`, `resources.ts`,
    `infrastructure.ts`, `support.ts`, `placement.ts`, `production.ts`.
  - Focus: unifying `ProductionJob` queues into `production.ts`, decoupling
    `infrastructure.ts` from `EconomyState` for HQ-pooled construction and
    building repair (`1.40`), emergency Heartgrove rules (`1.49`), and AI
    economic planning (`1.33-1.34`, `1.55`).
  - [x] **Pass A** (modular assessment and refactor, base `6ef1e5e`):
    - `production.ts` owns the paid queue lifecycle: `ProductionJob`,
      `PRODUCTION_QUEUE_LIMIT`, `refineryOccupied`, `productionRejection`
      (affordability, queue limit, one Harvester per Refinery),
      `createProductionJob`, `advanceProduction`, `cancelProduction`,
      `removeProducer`, and `isValidProductionQueue`. `economy.ts` runs the
      queue in `updateEconomy` and enrolls produced workers; `mission.ts`
      keeps only the disconnection check and payment.
    - `evaluateSpawn` checks used IDs through a `has` predicate instead of
      copying the set per evaluation (Slice 1 deferral).
    - No persisted format change or new value-import cycle (`0` runtime
      SCCs in `src/`). Docs: `runtime-boundaries.md`.
    - Checks: format, lint, typecheck, and units pass; browser smoke could
      not launch Chromium in the sandbox, so `economy`, `sidebar`, and
      `benchmark` specs are unverified here.
    - Kept: `infrastructure.ts` on `EconomyState`, which it reads only for
      growth tending; `1.40` repair needs the ledger for oldest-first
      per-second payment, so repair jobs should join `updateInfrastructure`'s
      work list and `claimSlot` rather than a new module.
    - Rejected: moving the economy branch of `evaluatePlacement` into
      `infrastructure.ts`; it would forward about ten closure fields through
      a shallow wrapper.
    - Deferred: a `harvesting.ts` split mirroring `cultivation.ts` (state,
      commands, update, validation) until ARC harvesting next changes;
      duplicated first-order and queue-count logic in `audio/mission.ts`
      (Slice 9) and `benchmark-probe.ts`.
    - Pass B leads: three hosting-rule shapes in `infrastructure.ts`
      (`HostingRules`, `EmergencyRules`, `AffiliationRules`); the support
      resolver's per-call `JSON.stringify` key for unfrozen staged actors,
      reached several times per tick; per-call array spreads in
      `economySites` and `activeSites`.
  - [x] **Pass B** (exhaustive review and `$code-simplifier` cleanup):
    - `production.ts`: saved-queue validation reads the producer definition
      once.
    - `economy.ts`: imports grouped; one actor lookup per economy command;
      Refinery assignment phase without a nested ternary; harvester site
      checks use the site-ID set; loot proximity helper moved beside its
      loop; `HARVESTER_PHASES` made module-private.
    - `cultivation.ts`: efficiency and status without nested ternaries;
      worker capacity and rate read once per worker; routes take
      `WorldPosition`.
    - `infrastructure.ts`: headquarters affiliation choice flattened. The
      three hosting-rule shapes stay, since each matches its callers.
    - `stockpiles.ts`: ledger validation keys owner-resource pairs without
      per-entry `JSON.stringify`; `resourcePools` made module-private.
    - `placement.ts`: one terrain lookup per footprint tile; `TileCoord`
      from `grid.ts`; "chosen by the player" -> "chosen by the issuer";
      `PLACEMENT_REASONS` made module-private.
    - `cargo.ts`, `support.ts`: hole-safe validation comment; imports
      merged; over-long comments shortened.
    - Reviewed without change: `growth.ts`, `worker-navigation.ts`,
      `resources.ts`.
    - Checks: format, lint, typecheck, units, and the full Vitest suite
      (`1485` passed) pass; browser smoke could not launch Chromium in the
      sandbox.
    - Deferred until profiling shows cost: the support resolver's
      `JSON.stringify` key for unfrozen staged actors, per-call navigation
      closures in `advanceWorkerRoute`, and array spreads in
      `economySites`/`activeSites`.

- [x] **Slice 4: simulation spatial world, terrain, occupancy, and movement**
  (10 files, ~3,070 LOC)
  - `src/simulation/`: `grid.ts`, `terrain.ts`, `terrain-movement.ts`,
    `terrain-sightline.ts`, `occupancy.ts`, `territory.ts`, `navigation.ts`,
    `navigation-changes.ts`, `group-movement.ts`, `automatic-movement.ts`.
  - Focus: pathfinding/occupancy invariants, group movement tick cost, shared
    pursuit behavior for combat/unit-assist, and spatial query ergonomics.
  - [x] **Pass A** (modular assessment and refactor, base `de4ff44`):
    - `NavigationGrid.within(bounds)` caches bounded grids on their physical
      grid and shares its tile-cost cache; `unbounded()` returns that grid.
      This replaces the string-keyed cache in `terrain-movement.ts` and the
      duplicate physical grid each bounded grid built.
    - `navigationDestination` owns the reachable-destination point rule
      shared by `findNavigationPath` and the mission's combat `destination`.
    - Local repairs only; no persisted format change, so Pass B continued in
      the same session.
    - Kept: `followRoute` is already the shared pursuit module. `1.41`
      support units are unarmed and run outside `updateCombat`'s armed loop,
      so they should call `followRoute` with their own `RouteRetryState` and
      the mission's bounded `move`/`destination` rather than an extracted
      combat chase.
    - Rejected: narrowing `NavigationGrid` to `blocksMovementAt` (worker
      entrances still need a placement query), moving `RouteBounds` out of
      `actor.ts` (type-only gain), and the type-only
      `terrain`/`navigation-changes`/`occupancy` SCC.
    - `WolfMode`/`WolfAlert` stay: DESIGN names the territorial state machine
      and alerts after wolves (Slice 2 lead resolved).
  - [x] **Pass B** (exhaustive review and `$code-simplifier` cleanup):
    - `terrain-sightline.ts`: crossing checks without per-call tuple arrays.
    - `automatic-movement.ts`: remaining route distance without a slice.
    - `navigation-changes.ts`: test-only `since` removed; `entriesSince`
      filters in one pass; `layers` readonly.
    - `terrain.ts`: `TerrainBounds`/`TileCoord` re-export shim removed;
      importers use `grid.ts` (`map.ts` re-exports from there).
    - `navigation.ts`: cost invalidation split into `forgetCosts`; imports
      grouped. `group-movement.ts`, `territory.ts`, `occupancy.ts`,
      `grid.ts`: import order, one definition lookup, inclusive-bounds doc.
    - Reviewed without change: `terrain-movement.ts` beyond the grid cache.
    - Checks: format, lint, typecheck, units (`1359` passed), and the
      browser smoke checks (run outside the sandbox) pass.
    - Deferred until profiling shows cost (`1.64`): per-tick allocations in
      `separateMobileActors` (string bucket keys, maps), full-map slot scans
      per group move, `entriesSince` copies per grid sync, and
      `placementByOwnerId` cloning in worker entrance checks.

- [x] **Slice 5: session coordinator, shortcuts, world tools, and binders**
  (18 files, ~4,730 LOC)
  - `src/session.ts`.
  - `src/render/`: `camera.ts`, `building-placement.ts`, `command-input.ts`,
    `pointer-gesture.ts`, `edge-pan.ts`, `selection.ts`, `input-focus.ts`,
    `primary-click.ts`.
  - `src/ui/`: `economy-controls.ts`, `unit-training.ts`, `unit-controls.ts`,
    `radial-menu.ts`, `camera-controls.ts`, `rally-controls.ts`,
    `attack-move-controls.ts`, `network-controls.ts`, `contextual-move.ts`.
  - Focus: centralized physical `KeyboardEvent.code` shortcut router (`1.45`),
    exclusive world-tool state machine, removing `render -> ui` imports from
    `building-placement.ts`, `viewOf(playerOwner)` and `MissionFile.uiState`
    wiring, and control-group readiness (`1.44`).
  - Manifest after Pass A: `src/render/building-placement.ts` moved to
    `src/ui/building-placement.ts`; added `src/render/placement-preview.ts`
    and `src/ui/world-shortcuts.ts` (20 files).
  - [x] **Pass A** (modular assessment and refactor, base `2689e90`):
    - `src/ui/world-shortcuts.ts`: `bindWorldShortcuts` routes unmodified,
      unrepeated world keys by `KeyboardEvent.code` to ordered handlers.
      The session binds Escape (Pan mode, placement, targeting or camera
      focus, selection, menu), `KeyR` (rotate while placing), and `KeyS`
      (stop). Command input, placement, and the session menu fallback no
      longer listen for keys; camera Escape became `cancelPan`, and command
      input exposes `deselect` instead of taking `cancelFocus`.
    - Placement split: `src/render/placement-preview.ts` owns the preview
      model, footprint overlay and offset, tender ring, and cached terrain
      picking; `src/ui/building-placement.ts` owns the tool state, controls,
      copy, and probes. `render -> ui` value imports: `2 -> 0`.
    - Intended input changes: letters match physical keys, as DESIGN
      specifies; held keys no longer repeat Stop or step through Escape
      stages; open tooltips take Escape before Pan mode exits.
    - No persisted format change. Docs: `ui-ownership.md`.
    - Checks: format, lint, typecheck, units (`1367` passed), and a Vite
      build pass; new unit coverage for the router, `deselect`, and
      `cancelPan`. The full Chromium browser suite (`test:visual`) passed
      on the host.
    - Kept: tool exclusivity through each tool's `onStart` until `1.45`
      adds card shortcuts that wait for placement; contextual UI and dialog
      capture listeners; held camera navigation in `camera.ts`.
    - Rejected: splitting `session.ts` by size (forwards closures without
      removing state tangle); sidebar-owned control binders
      (`ui-ownership.md` assigns binding to the session).
    - Deferred to `1.45`/Slice 8A: layout-aware labels for the static
      `(R)`, `(S)`, and `(Esc)` hints in `sidebar-orders.ts`.
  - [x] **Pass B** (exhaustive review and `$code-simplifier` cleanup):
    - HUD controls read the player's own actors: `economy-controls.ts` takes
      `owner` and `ownActors` instead of `simulation.actors`, `playerOwner`,
      and `canControl`; cultivator phase and construction status without
      nested ternaries. Rally controls take the selected own actor instead
      of `simulation.actorById` copies; network controls drop the redundant
      `canControl`; rally, network, and attack-move controls take `Pick`
      simulation parameters. Attack Move compares selections without
      `JSON.stringify`; unit and Attack Move status use `setText`.
    - `session.ts`: the starting actor, popup ownership, balances,
      contextual-move workers, and queued gather sites read
      `viewOf(playerOwner)`; the Slice 2 `ownIds` route filter is removed,
      since only own mobile actors' routes are drawn; one removable-actor
      check serves the Remove control and its action.
    - `camera.ts`: arrow panning matches `KeyboardEvent.code` through a
      `Map`; keyboard guards merged.
    - Kept: omniscient reads that show observable posture (offline dimming
      of detected buildings, gathering animation, seen attack effects) and
      alert/health inputs, which `mission-alerts.ts` and
      `session-effects.ts` filter (Slices 8A and 7).
    - Reviewed without change: `pointer-gesture.ts`, `edge-pan.ts`,
      `selection.ts`, `input-focus.ts`, `primary-click.ts`,
      `unit-training.ts`, `radial-menu.ts`, `camera-controls.ts`,
      `contextual-move.ts`, `placement-preview.ts`, `world-shortcuts.ts`.
    - Checks: format, lint, typecheck, and units (`1367` passed) pass; the
      e2e economy harness uses the new options. Affected browser specs
      (`camera-navigation`, `interface`, `tile-placed-actor`, `economy`,
      `sidebar`, `queued-orders`) pass on the host: `68` Chromium cases and
      `20` tagged WebKit cases.

- [x] **Slice 6: world rendering, terrain, fog, minimap, and overlays**
  (20 files, ~3,550 LOC)
  - `src/map.ts`.
  - `src/render/`: `index.ts`, `game-view.ts`, `canvas-size.ts`,
    `lighting.ts`, `terrain-mesh.ts`, `terrain-style.ts`, `fog.ts`,
    `materials-sites.ts`, `minimap.ts`, `movement-path.ts`,
    `support-network.ts`, `footprint-overlay.ts`, `queued-orders.ts`,
    `rally-point.ts`, `ground-marker.ts`, `health-bars.ts`, `screen-bar.ts`,
    `debug-overlay.ts`, `ambient-birds.ts`.
  - Focus: per-frame allocation and WebKit frame budget (`1.64`), moving pure
    `TerrainStyle` schema types to `src/content/`, owner-colored minimap
    markers, and AI dev-overlay extension points (`1.31`).
  - Manifest after Pass A: added `src/content/terrain-style.ts`; removed
    `src/render/index.ts` in Pass B (20 files).
  - [x] **Pass A** (modular assessment and refactor, base `f67c26a`):
    - `src/content/terrain-style.ts` owns the terrain presentation schema
      (`TerrainStyle`, `TerrainLayerRule`, `TileType`, `TileGraphics`);
      `content-pack.ts` no longer imports from `src/render/`. `map.ts` and
      `render/terrain-style.ts` keep tile layers, the map, and layer building.
      Docs: `content-packs.md`.
    - Small type move with no persisted format change, so Pass B continued
      in the same session.
    - Kept: caller-side caching of `aboveTerrainLayers`; `TerrainMap` cannot
      cache `layerCount`, since tests and specs push manual layers through
      `layersAt`. `minimap.ts` stays whole; its terrain baking, projection,
      and pointer code share one canvas and are tested through pure exports.
    - Rejected as speculative: owner-colored minimap markers (the session
      already chooses `MinimapActor.color`; owner palettes arrive with `1.43`
      and Slice 9) and a `1.31` extension point in `debug-overlay.ts`, a
      terrain grid unrelated to AI posture, operations, and budgets.
  - [x] **Pass B** (exhaustive review and `$code-simplifier` cleanup):
    - `render/index.ts` barrel removed: about 30 of its 40 re-exports were
      unused, and `session.ts` mixed it with direct imports. `session.ts`
      and `e2e/harness.ts` import the owning modules.
    - `terrain-mesh.ts`: `cornerAlpha` re-export shim removed (tests import
      `map.ts`); layer slots use `layerSlot`; `TERRAIN_LAYER_OFFSET` and
      `TERRAIN_PICK_KIND` made module-private.
    - `debug-overlay.ts`: unused `grids` and `boundaryColor` options folded
      into constants; it takes the layer offset directly.
    - `fog.ts`: corner shading visits neighbors without per-corner tuple
      arrays on each fog change; `fogAlpha` without a nested ternary.
    - `ambient-birds.ts`: per-bird seeds computed once instead of hashing a
      string per bird per frame.
    - `minimap.ts`: `clampToMap` uses `clampToBounds`; marker comparison
      reads each pair once. `movement-path.ts`: always-true route `actorId`
      check removed. `health-bars.ts`: fill color without a nested ternary.
      `support-network.ts`, `rally-point.ts`: imports grouped.
      `materials-sites.ts`: "as the player knows them" wording removed.
    - Reviewed without change: `game-view.ts`, `canvas-size.ts`,
      `lighting.ts`, `footprint-overlay.ts`, `queued-orders.ts`,
      `ground-marker.ts`, `screen-bar.ts`.
    - Checks: `npm run check` passes (`1367` unit tests and five Chromium
      smoke cases), along with a Vite build and `23` terrain asset tests.
      Affected browser specs (`terrain`, `terrain-animation`, `minimap`,
      `observations`, `queued-orders`, `economy`, `interface`,
      `presentation`) pass all `84` Chromium and tagged WebKit cases on
      the host.
    - Deferred until profiling shows cost (`1.64`): per-frame
      `JSON.stringify` in `support-network.ts` (while visible),
      `queued-orders.ts`, and `rally-point.ts`; per-frame maps in
      `materials-sites.ts` `update` (an identity guard needs tests that stop
      mutating the economy in place); `JSON.stringify` group keys in terrain
      chunk rebuilds.
    - Deferred to Slice 9: moving `validateTerrainStyle` from
      `content-pack.ts` beside its schema. Deferred to Slices 7/10:
      `scripts/model-assets.ts` importing `MATERIALS_COLOR`/`SALVAGE_COLOR`
      from `render/materials-sites.ts`.

- [x] **Slice 7: actor views, models, session assets, and visual effects**
  (25 files, ~3,810 LOC; check cross-slice caller `scripts/model-assets.ts`)
  - `src/render/`: `session-assets.ts`, `glb-model.ts`, `builtin-models.ts`,
    `view-registry.ts`, `actor-view-registry.ts`,
    `tile-placed-actor-view.ts`, `actor.ts`, `skinned-actor-appearance.ts`,
    `actor-gait.ts`, `texture-clip.ts`, `material-copies.ts`,
    `building-assembly.ts`, `construction-stage.ts`, `production-exit.ts`,
    `command-center.ts`, `barracks.ts`, `refinery.ts`, `harvester.ts`,
    `wolf.ts`, `wrecks.ts`, `combat-effects.ts`, `damage-effects.ts`,
    `regeneration-effects.ts`, `frame-effects.ts`, `session-effects.ts`.
  - Focus: async asset lifetimes, `(definitionId, ownerColorKey)` marking
    material caches ahead of `1.43` and `1.53`, and isolating procedural mesh
    recipes shared with `scripts/model-assets.ts`.
  - [x] **Pass A** (modular assessment and refactor, base `a7ae3c6`):
    - The tile-placed view owns building top height: `topHeight(actor)`
      returns the drawn top or estimates an undrawn one, such as fresh
      remains, from its placement and art. `session.ts` no longer repeats
      the roof formula; `SessionAssets.buildingModelTops` became
      `TilePlacedActorAppearance.modelTopHeight`.
    - Health bars, damage, and regeneration effects read
      `viewOf(playerOwner).actors().shown` instead of `simulation.actors`
      filtered by `shows` (Slice 5 deferral). Docs: `runtime-boundaries.md`.
    - Local repairs with no persisted format change, so Pass B continued in
      the same session.
    - Kept: asset swaps through appearance identity in view-registry keys,
      pull-based `assetFor` props beside pushed materials props, and the
      hand-rolled wreck registry (state carries over across rebuilds and
      wrecks have no `id`).
    - Rejected as speculative: an owner-color marking cache. No owner color
      or reserved model area exists yet, and shipped buildings are GLBs whose
      instances share materials, so `1.43` should key per-owner copies of
      named marking materials by `(appearance, owner color)` in the view
      registries, not by `definitionId` in `materialFor`.
    - Rejected: the type-only `tile-placed-actor-view`/`glb-model` SCC.
    - Built-in procedural models stay in `src/render`: DESIGN makes them
      content-named code, and `actor-assets.md` has them feed the exporter.
  - [x] **Pass B** (exhaustive review and `$code-simplifier` cleanup):
    - `session-assets.ts`: the foundation prop no longer adds building
      appearances for mobile definitions (bug; now tested).
    - `glb-model.ts`: `instantiateContainer` returns `clipFor`, replacing
      the clip index mapping repeated in `skinned-actor-appearance.ts`.
    - `actor-view-registry.ts`: shared selection styles and no empty trigger
      array per actor per frame. `tile-placed-actor-view.ts`: one appearance
      lookup per view; offline dimming and badge in one block.
    - `construction-stage.ts`: growth layer without a nested ternary;
      canopy/ribs precedence survives instance-name prefixes (tested).
      `wrecks.ts`: one bounds query per chunk; `lifetime` -> `lifeSeconds`.
      `regeneration-effects.ts`: default `sameKey`. `building-assembly.ts`:
      stale `place` comment. Imports grouped in `production-exit.ts`,
      `harvester.ts`, `wolf.ts`, `regeneration-effects.ts`, `wrecks.ts`;
      `ACTOR_PICK_KIND` and `BUILDING_BAR_HEIGHT` made module-private.
    - Reviewed without change: `builtin-models.ts`, `view-registry.ts`,
      `actor.ts` beyond the export, `actor-gait.ts`, `texture-clip.ts`,
      `material-copies.ts`, `command-center.ts`, `barracks.ts`,
      `refinery.ts`, `combat-effects.ts`, `damage-effects.ts`,
      `frame-effects.ts`.
    - Checks: format, lint, typecheck, units (`1368` passed), and asset tests
      (`127` passed) pass. Browser smoke (`5`) and focused actor, placement,
      presentation, Circle, and relationship checks (`26`) pass on the host.
    - Deferred to Slice 10: `scripts/model-assets.ts` finds runtime
      instance nodes by name (`${name}-template`, `harvester-drill`,
      `harvester-work-beacon`, `wolf-leg-N`); recipes should return named
      parts to both adapters. Byte-identical GLB tests guard the change.
      The Slice 6 color imports (`MATERIALS_COLOR`, `SALVAGE_COLOR`, and the
      attack colors) stay: generated models must match runtime fallbacks.
    - Deferred until profiling shows cost (`1.64`): per-frame emission arrays
      and `stableUnit` string hashes in `damage-effects.ts`, `Vector3`s in
      `selectionPoint` and `extractHealthAndDamageEffects`, and
      `JSON.stringify` view keys in `tile-placed-actor-view.ts`.
    - Deferred to Slices 8A/9: the wreck view, `mission-alerts.ts`, and
      `audio/mission.ts` read `simulation.wrecks`; add an `OwnerView` wreck
      projection when alerts and audio move onto `viewOf(playerOwner)`.

- [x] **Slice 8A: in-mission HUD, top bar, alerts, and sidebar**
  (29 files, ~2,350 LOC)
  - `src/ui/`: `dom.ts`, `top-bar.ts`, `mission-alerts.ts`,
    `notifications.ts`, `popups.ts`, `mission-result.ts`, `goals.ts`,
    `content-roles.ts`, `production-action.ts`, `production-card.ts`,
    `production-card.css`, `actor-portrait.ts`, `actor-portrait.css`,
    `sidebar.ts`, `sidebar.css`, `sidebar-context.ts`,
    `sidebar-navigation.ts`, `sidebar-production.ts`,
    `sidebar-production.css`, `sidebar-selection.ts`,
    `sidebar-selection.css`, `sidebar-goals.ts`, `sidebar-goals.css`,
    `sidebar-orders.ts`, `sidebar-orders.css`.
  - Plus HUD rules in `index.html` and `src/styles.css` owned by `#top-bar`
    and `#notifications`.
  - Focus: `docs/ui-ownership.md` feature extraction (`#top-bar`), removing
    `top-bar -> session` coupling, dynamic shortcut labels (`1.45`), and
    card/group UI readiness (`1.44-1.45`).
  - Manifest after Pass A: added `src/format-time.ts`, `src/ui/top-bar.html`,
    `src/ui/top-bar.css`, and `src/ui/notifications.css` (33 files); the
    `index.html` and `src/styles.css` HUD rules moved out.
  - [x] **Pass A** (modular assessment and refactor, base `b4b091c`):
    - Top bar and notifications own their markup and styles. `createTopBar`
      mounts `top-bar.html` and takes `openMenu`, so `main.ts` no longer
      reaches for `#open-menu`. `createNotifications` mounts into
      `#mission-alerts` and creates the toggle the top bar hosts, replacing
      lookups across the whole document.
    - `TopBarState` is what the top bar reads. The session state adds `speed`
      and `elapsedSeconds`, `topBarState` is gone, and `update()` with no state
      shows the idle bar. `top-bar -> session` and `top-bar -> sidebar` type
      edges: `2 -> 0`.
    - `formatElapsed` moved to `src/format-time.ts`, ending the
      `save-policy -> ui/top-bar` and `save-panel -> top-bar` value imports.
    - Alerts read `viewOf(playerOwner)`: own actors, usable support, and the
      new `OwnerView.wrecks()`. The tracker lost its `owns` filter and takes
      only attack target IDs. Docs: `ui-ownership.md`,
      `runtime-boundaries.md`.
    - No persisted format change. Substantial markup and style moves, so
      Pass B runs in its own session.
    - Checks: format, lint, typecheck, and units (`1369` passed) pass. Every
      moved CSS rule and the top bar markup match `HEAD` by script. Browser
      tests pass on the host.
    - Kept: the wreck view reads `simulation.wrecks`, since dropping hidden
      remains would lose a building's captured top height; `simulation.attacks`
      as alert input, narrowed to target IDs, since a lethal hit's target has
      already left the own-actor list.
    - Rejected: layout-aware shortcut labels now. They belong to `1.45` with
      the binding table; `R` and `S` match on the required AZERTY and QWERTZ
      layouts, so the static hints are correct until then. Also rejected:
      splitting sidebar sections, since `1.44` and `1.45` need only a panel
      entry and a card `shortcut` field, not a new seam.
    - Deferred to Slice 8B: `main.ts` F5/F9/F10 handling and the rest of the
      app shell. Deferred to Slice 9: moving audio onto `OwnerView` (including
      `wrecks()`) and removing its `MissionAlert` type import from `ui/`.
  - [x] **Pass B** (exhaustive review and `$code-simplifier` cleanup):
    - `SidebarState.relationTo` is the owner view's lookup, replacing
      `relations` and the `playerOwner` rule rebuilt in `sidebar-selection.ts`.
    - Nested ternaries flattened: `sidebar-selection.ts` (`moveHint`,
      `titleOf`, `infoOf`), `sidebar-production.ts` (`buildingBlocker`, one
      evaluation per card and none while a session blocker holds),
      `sidebar-navigation.ts` (`TAB_MOVES` map), `actor-portrait.ts`
      (`rolePortrait`), `mission-alerts.ts` (`attackKind`), `goals.ts`
      (`progressLabel`).
    - `production-card.ts`: builds elements with `dom.ts` helpers; touch
      handling uses early returns. Its description ID collision loop stays,
      since `production-card.spec.ts` covers that contract.
    - `top-bar.ts`: one pass to find the summary goal; balance element named
      for what it shows; `top-bar.html` drops the `Materials` defaults that
      `update` always replaced. `sidebar-orders.ts`: `setPressed`.
      `mission-alerts.ts`: local `window` renamed `groupTicks`.
    - Unused type and value exports made module-private: `KeyedRow`,
      `SiteObservation`, `ResultPresentation`, `ProductionBlockers`,
      `GoalEntry`, `SidebarPanels`, `portraitIdFor`.
    - CSS: the unused `roster-disclosure` class and a default
      `pointer-events` removed; the `sidebar-selection.css` queue rule moved
      before its media queries. A script found no dead selectors.
    - Reviewed without change: `notifications.ts`, `notifications.css`,
      `popups.ts`, `content-roles.ts`, `sidebar.ts`, `sidebar-goals.ts`,
      `top-bar.css`, `actor-portrait.css`, `sidebar.css`,
      `sidebar-production.css`, `sidebar-goals.css`, `sidebar-orders.css`,
      `production-action.ts` and `mission-result.ts` beyond the exports.
    - Kept: `setText` accepts `undefined`, since Slice 5 binders pass optional
      status elements.
    - Checks: `npm run check` passes (`1369` units and `5` Chromium smoke
      checks). Focused sidebar, production-card, economy, interface,
      relationship, Circle, session-lifecycle, and skirmish-result browser
      specs pass on the host (`97` cases across Chromium and WebKit).
    - Deferred until profiling shows cost (`1.64`): per-update
      `JSON.stringify` keys in the roster and selection sections; per-tick
      sets and maps in `createAlertTracker.observe` and the session's
      `workerIds` and `sites` projections.
    - Deferred: `session.ts` and `sidebar-selection.ts`
      both set the Remove button's `disabled` from `canRemove`.

- [ ] **Slice 8B: app shell, desktop host, persistence, and modal dialogs**
  (24 files, ~1,850 LOC)
  - `index.html`.
  - `src/`: `main.ts`, `application.ts`, `mission-loading.ts`, `saves.ts`,
    `save-policy.ts`, `lifetime.ts`, `errors.ts`, `styles.css`,
    `vite-env.d.ts`.
  - `src/platform/`: `index.ts`, `browser.ts`, `tauri.ts`.
  - `src-tauri/`: `src/main.rs`, `src/lib.rs`, `build.rs`, `Cargo.toml`,
    `tauri.conf.json`, `capabilities/default.json`.
  - `src/ui/`: `dialogs.ts`, `dialogs.html`, `dialogs.css`, `save-panel.ts`,
    `save-panel.html`, `save-panel.css`, `audio-controls.ts`,
    `audio-controls.html`, `audio-controls.css`.
  - Focus: Tauri/browser isolation, removing `save-policy -> ui/top-bar`,
    `MissionFile.uiState` load/save wiring, Options shortcut rebinding host
    (`1.45`), and setup/summary dialog seams (`1.60`, `1.62`).

- [ ] **Slice 9: content packs, presentation contracts, and audio**
  (13 TS files + JSON packs/levels, ~2,357 LOC)
  - `src/content/`: `content-pack.ts`, `packs.ts`, `levels.ts`,
    `presentation.ts`, `texture-clip.ts`, `terrain-style.ts`, `audio.ts`,
    `audio-assets.ts`,
    `skirmish.ts`, `skirmish-map.ts`, `packs/base.json`, `levels/*.json`.
  - `src/audio/`: `mixer.ts`, `scene.ts`, `mission.ts`.
  - Focus: owning `TerrainStyle` schema in `src/content/`, breaking the
    `skirmish <-> skirmish-map` type loop, owner-palette content schemas, and
    switching `audio/mission.ts` onto `viewOf(playerOwner)` without `src/ui/`
    imports.

### Tier 2: generators, tooling, and documentation (`scripts/`, `docs/`)

- [ ] **Slice 10: procedural model, texture, and audio generators**
  (20 files, ~3,625 LOC)
  - `scripts/`: `assets.ts`, `write-assets.ts`, `model-assets.ts`,
    `infantry-model.ts`, `circle-models.ts`, `model-surface.ts`,
    `glb-export.ts`, `terrain-textures.ts`, `grass-sheet.ts`,
    `muzzle-flash-sheet.ts`, `sprite-sheet.ts`,
    `reconcile-texture-edges.ts`, `audio-assets.ts`, `generate-assets.ts`,
    `generate-models.ts`, `generate-infantry.ts`, `generate-terrain.ts`,
    `generate-grass.ts`, `generate-effects.ts`, `generate-audio.ts`.
  - Focus: shared procedural geometry/rigging/material abstractions and
    synthesis modularity ahead of `1.43` and `1.53`.

- [ ] **Slice 11: level/build/benchmark scripts and documentation suite**
  (17 script files + configs + 16 Markdown docs)
  - `scripts/`: `generate-levels.ts`, `levels/base-content.ts`,
    `levels/circle-wolf-den.ts`, `levels/index.ts`, `levels/m0-terrain.ts`,
    `levels/m0.ts`, `levels/sandbox-level.ts`, `levels/sandbox.ts`,
    `levels/skirmish-preview.ts`, `levels/wolf-den.ts`,
    `levels/wolf-encounters.ts`, `benchmark.ts`, `benchmark/metrics.ts`,
    `benchmark/workload.ts`, `check-runner.ts`, `playtest-build.ts`,
    `prepare-playtest.ts`.
  - Build configs: `package.json`, `tsconfig.json`, `vite.config.ts`,
    `prettier.config.mjs`.
  - Documentation: `README.md`, `AGENTS.md`, `DESIGN.md`, `TODO.md`, and all
    12 files in `docs/` (`actor-assets.md`, `architecture-review.md`,
    `audio-assets.md`, `audio.md`, `content-packs.md`,
    `design-questionnaire.md`, `mission-files.md`,
    `playtest-instructions.md`, `playtest-report.md`,
    `runtime-boundaries.md`, `ui-ownership.md`, `verification.md`).
  - Focus: non-duplication across docs, accuracy against refactored `src/`
    seams, and `AGENTS.md` formatting compliance.

### Tier 3: verification suites (`tests/`, `e2e/` - lowest priority)

- [ ] **Slice 12: browser E2E harness and specs**
  (37 `e2e/` files + `playwright.config.ts`, ~11,610 LOC)
  - Shared drivers (`e2e/mission-driver.ts`, `missions.ts`, `harness.ts`,
    `fixtures.ts`, `profiles.ts`, `prototype-helpers.ts`, `tags.ts`) and all
    30 `e2e/*.spec.ts` files.

- [ ] **Slice 13: unit and asset test suite**
  (97 `tests/` files + `vitest.config.ts`, ~30,175 LOC)
  - Shared helpers (`tests/helpers/*`, 5 files) and all 92 `tests/*.test.ts`
    files, batched by subsystem to remove private-implementation coupling
    and duplicated setup while retaining distinct behavioral coverage.
