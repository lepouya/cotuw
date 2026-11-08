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

- [ ] **Slice 4: simulation spatial world, terrain, occupancy, and movement**
  (10 files, ~3,070 LOC)
  - `src/simulation/`: `grid.ts`, `terrain.ts`, `terrain-movement.ts`,
    `terrain-sightline.ts`, `occupancy.ts`, `territory.ts`, `navigation.ts`,
    `navigation-changes.ts`, `group-movement.ts`, `automatic-movement.ts`.
  - Focus: pathfinding/occupancy invariants, group movement tick cost, shared
    pursuit behavior for combat/unit-assist, and spatial query ergonomics.

- [ ] **Slice 5: session coordinator, shortcuts, world tools, and binders**
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

- [ ] **Slice 6: world rendering, terrain, fog, minimap, and overlays**
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

- [ ] **Slice 7: actor views, models, session assets, and visual effects**
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

- [ ] **Slice 8A: in-mission HUD, top bar, alerts, and sidebar**
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
  (12 TS files + JSON packs/levels, ~2,357 LOC)
  - `src/content/`: `content-pack.ts`, `packs.ts`, `levels.ts`,
    `presentation.ts`, `texture-clip.ts`, `audio.ts`, `audio-assets.ts`,
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
