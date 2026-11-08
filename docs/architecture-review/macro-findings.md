# Pre-Phase-C macro architectural findings

Read-only Session 1 repository survey following `docs/architecture-review.md`
Stages 1 through 3 ahead of Milestone 1 Phase C.

## Scope and compatibility

- **Revision and working state:** commit
  `118d17de8792e49f89555bd3b2f410358c62664c` (Milestone 1 Phase B complete,
  entering Phase C `1.29-1.38`). Uncommitted workspace state consists only of
  `docs/architecture-review/review-plan.md`; zero tracked runtime, script, or
  test files are modified.
- **Evaluated footprint:** `147` TypeScript modules in `src/` plus
  `index.html`, `src/styles.css`, and `src-tauri/` (`~33.9k` runtime LOC across
  `166` files), plus attachment edges from `scripts/` (`37` files, `~5.1k` LOC),
  `tests/` (`97` files, `~30.2k` LOC), and `e2e/` (`37` files, `~11.6k` LOC).
- **Upcoming milestone pressure (`TODO.md`, `DESIGN.md`):**
  - Phase C (`1.29-1.38`): deterministic AI director planning from owner-legal
    knowledge with unseen `lastHit` attackers hidden (`1.29`), headless
    AI-vs-AI match runner (`1.30`), AI dev overlay (`1.31`), serialized AI
    state invariant across clock catch-up batching (`1.32`), and ARC AI base,
    recovery, scouting, and attack operations (`1.33-1.37`).
  - Phase D (`1.39-1.46`): Relay Station and Sentry Turret (`1.39`), HQ-pooled
    building repair (`1.40`), Medic and Mechanic unit support (`1.41`),
    demolition bonuses (`1.42`), ARC models and owner-color markings (`1.43`),
    control groups, matching-unit selection, and idle-worker cycling (`1.44`),
    and physical-code command shortcuts and rebinding (`1.45`).
  - Phase E (`1.48-1.57`): Circle roster, emergency Heartgrove recovery
    (`1.49`), Healer and Artificer support (`1.52`), Circle procedural models
    and living damage (`1.53`), and Circle AI (`1.55`).
  - Phase F (`1.59-1.66`): skirmish setup and post-match summary screens
    (`1.60-1.62`) and WebKit two-faction frame budgets (`1.64`).
- **Compatibility bounds:**
  - Internal TypeScript interfaces, module boundaries, and session binders may
    be replaced directly without backward-compatibility shims.
  - Pre-alpha mission, save, and content formats may change without legacy
    migrations, provided `MISSION_FILE_VERSION` or content pack version bumps,
    `npm run levels` regenerates built-in levels, validation and docs update
    together, and same-build save round-tripping and deterministic continuation
    hold.
  - Specified gameplay and locked technical invariants in `DESIGN.md`,
    `docs/runtime-boundaries.md`, and `docs/ui-ownership.md` remain binding.
- **Graph baseline and hotspots:**
  - Runtime value-import cycles: `0` across all `147` `src/` modules.
  - Type-inclusive strongly connected components: `5` (`19`-file simulation
    component through `actor.ts`, `command.ts`, and `economy.ts`; `3`-file
    terrain/occupancy component; `skirmish.ts` <-> `skirmish-map.ts`;
    `tile-placed-actor-view.ts` <-> `glb-model.ts`; and lazy dynamic imports in
    `platform/index.ts`).
  - Highest churn (last 60 commits) and fan-out hubs: `src/session.ts` (`24`
    commits, `1,267` LOC, fan-out `57`), `src/simulation/mission.ts` (`15`
    commits, `2,247` LOC, fan-out `30`), `src/main.ts` (`13` commits),
    `src/ui/sidebar.ts` (`10` commits), `src/simulation/mission-file.ts` (`10`
    commits), `src/application.ts` (`501` LOC, fan-out `19`), and
    `src/simulation/economy.ts` (`872` LOC, fan-in `18`, fan-out `17`).
- **Inspection coverage and explicit gaps:**
  - Inspected in full: governance and contract docs (`AGENTS.md`, `README.md`,
    `DESIGN.md`, `TODO.md`, `docs/architecture-review.md`,
    `docs/runtime-boundaries.md`, `docs/ui-ownership.md`), all `src/` root
    modules, `src/platform/*`, `src-tauri/*`, core `src/simulation/*`
    (`mission.ts`, `mission-file.ts`, `command.ts`, `authority.ts`, `loop.ts`,
    `observations.ts`, `player-view.ts`, `actor.ts`, `combat.ts`, `economy.ts`,
    `infrastructure.ts`, `cultivation.ts`, `production.ts`, `placement.ts`,
    `ownership.ts`, `support.ts`, `vision.ts`), core `src/content/*`
    (`content-pack.ts`, `presentation.ts`, `skirmish.ts`, `audio.ts`), all
    `src/audio/*`, core `src/render/*` (`index.ts`, `camera.ts`,
    `building-placement.ts`, `command-input.ts`, `actor-view-registry.ts`,
    `tile-placed-actor-view.ts`, `session-assets.ts`, `builtin-models.ts`,
    `terrain-style.ts`), and core `src/ui/*` (`dialogs.ts`, `sidebar.ts`,
    `sidebar-orders.ts`, `sidebar-production.ts`, `economy-controls.ts`,
    `top-bar.ts`, `mission-alerts.ts`, `production-card.ts`).
  - Mapped via static import/export graph only and deferred to Slices 2-13 for
    line-by-line review: internal pathfinding/spatial algorithms
    (`navigation.ts`, `occupancy.ts`, `terrain-movement.ts`,
    `terrain-sightline.ts`), leaf render shaders/meshes/effects
    (`terrain-mesh.ts`, `fog.ts`, `minimap.ts`, `skinned-actor-appearance.ts`,
    `glb-model.ts`, `combat-effects.ts`, `damage-effects.ts`), procedural asset
    generators in `scripts/`, and individual `tests/` and `e2e/` specs.

## Healthy seams to retain

- **Headless simulation core and mission preparation (`src/simulation/*`,
  `src/mission-loading.ts`):** `src/simulation/*` has zero imports outside its
  own directory, and `loadMission` / `createSessionSimulation`
  (`src/mission-loading.ts:62-177`) run without DOM, WebGL, audio, or Tauri.
  Two real adapters already consume this seam (`src/application.ts` and
  headless `tests/` + `scripts/benchmark/workload.ts`), and `1.30` adds a
  third.
- **Central command ownership gate (`src/simulation/authority.ts:18-121`):**
  `createCommandAuthority` validates any `issuer` (`player`, `script`, or owner
  ID) via exhaustive `switch (command.kind)` dispatch invoked once in
  `src/simulation/mission.ts:1434`. Phase C AI directors (`1.29`) can submit
  normal commands under their owner ID without new privilege paths.
- **Fixed-step clock and loop (`src/simulation/clock.ts`,
  `src/simulation/loop.ts`)** and **declarative sighting memory
  (`src/simulation/observations.ts:189-247`):** both hide tricky state
  invariants behind compact, well-tested interfaces that survive the deletion
  test.
- **Platform capability boundary (`src/platform/*`, `src/saves.ts`,
  `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json`):** dynamic
  provider loading keeps `@tauri-apps/*` out of browser bundles while scoping
  desktop filesystem access strictly to `$APPLOCALDATA/saves/*`.
- **Resource lifetime (`src/lifetime.ts`), audio voice budgeting
  (`src/audio/mixer.ts`, `src/audio/scene.ts`), and extracted UI feature
  ownership (`src/ui/dom.ts`, `src/ui/dialogs.ts`, `src/ui/save-panel.ts`,
  `src/ui/sidebar.ts`):** LIFO cleanup, voice caps, and `mountFeature` DOM
  scoping prevent listener and WebGL leaks cleanly.

## Independent assessments

### Initial survey (`$improve-codebase-architecture`)

- Proposed six deepening candidates using `$codebase-design` criteria:
  1. Replace narrow `knowledgeOf(owner)` and single-player `createPlayerView`
     with a deep owner-scoped `simulation.viewOf(owner)` projection and an
     authoritative per-tick controller/observer seam (`Strong`).
  2. Centralize physical `KeyboardEvent.code` shortcut routing, dynamic keycap
     labels, and an exclusive world-tool state machine (`Strong`).
  3. Decompose `createMissionSimulation` (`src/simulation/mission.ts`) around
     shared internal `AuthoritativeWorld` state for command execution,
     full placement/production eligibility, HQ structure work (`1.40`), and
     unit assistance (`1.41`, `1.52`) (`Strong`).
  4. Separate `MissionFile.uiState` (`dismissedPopups`, `1.44` `controlGroups`)
     from authoritative `MissionState` and split `session.ts` scene vs. HUD
     assembly (`Worth exploring`; `Strong` for `uiState`).
  5. Thread owner-color palettes through `OwnerConfig`, `ActorViewRegistry`,
     `TilePlacedActorViewRegistry`, and minimap markers while decoupling
     `scripts/model-assets.ts` from runtime views (`Worth exploring`).
  6. Remove four inverted cross-directory imports (`content -> render`,
     `save-policy -> ui`, `audio -> ui`, `render -> ui`) (`Worth exploring`).

### Initial seam analysis (`$seam-ripper`)

- Mapped all `147` `src/` modules, export counts, fan-in/fan-out, and `5`
  type-inclusive SCCs, raising five critical/high findings:
  1. Omniscient `MissionSimulation` surface, unredacted `ActorRenderState`,
     unseen `combat.lastHit.attackerId` exposure, and duplicated privacy
     filtering across `player-view.ts`, `session.ts`, `economy-controls.ts`,
     and `audio/mission.ts` (`Critical`).
  2. `mission.ts` transaction/validation monolith, split production/HQ queues
     in `economy.ts` vs. `production.ts`/`infrastructure.ts`, and the `19`-file
     simulation type cycle (`Critical`).
  3. `session.ts` fan-out bottleneck (`57` imports), `7+` uncoordinated
     `keydown` listeners mixing `event.key` and `event.code`, `render -> ui`
     value imports in `building-placement.ts`, and scattered `canvas.dataset`
     probes (`High`).
  4. `content-pack.ts -> render/terrain-style.ts` inversion, `TerrainMap
     extends TerrainGrid` in `src/map.ts`, `definitionId`-only material caches
     blocking `1.43` owner markings, and `scripts/model-assets.ts` importing
     runtime `src/render/*` modules (`High`).
  5. Unmigrated `#top-bar` markup in `index.html`, minor cross-layer leaks
     (`save-policy -> ui/top-bar`, `top-bar -> session`, `audio -> ui`), and
     `benchmark-probe.ts` monkey-patching `simulation.tick` (`Medium`).

## Challenge and consolidated recommendations

### Top recommendation

- Execute **Recommendation 1 (Symmetric owner-scoped world projection and
  authoritative tick controller/observer seam)** first across Slice 1 and the
  reordered Slice 2 (formerly Slice 4), paired with `MissionFile.uiState`
  separation. Phase C (`1.29-1.38`) is the immediate next milestone work and
  depends directly on leak-free per-owner perception, unseen `lastHit`
  redaction, headless AI-vs-AI parity without a privileged human owner, and
  batch-invariant AI state serialization.

### Supported cross-cutting candidates

#### 1. Symmetric owner-scoped projection, `MissionFile.uiState`, and tick hooks

- **Impact:** `high` - prevents fog-of-war intent/attacker leaks into Phase C
  AI (`1.29`) and HUD/audio consumers, unlocks headless AI-vs-AI (`1.30`) and
  clock-batch-invariant AI saves (`1.32`), and eliminates `simulation.tick`
  monkey-patching.
- **Evidence:** `Demonstrated` in existing code:
  - `MissionSimulation` (`src/simulation/mission.ts:330-402`) mixes omniscient
    state (`actors`, `economy`, `support`, `attacks`, `wrecks`) with
    single-player properties (`playerOwner`, `playerFaction`, `fog`).
  - `knowledgeOf(owner)` (`src/simulation/mission.ts:1200-1213`) exposes only
    fog and sightings, omitting `owner`'s own actors, private economy, and
    support.
  - `createPlayerView` (`src/simulation/player-view.ts:31-128`) hardcodes
    `simulation.playerOwner` and returns raw `ActorRenderState`, exposing
    detected enemies' `orders`, `movement` destinations, `attackMove`,
    `rallyPoint`, and `headquartersId` while `src/simulation/combat.ts:660`
    records `combat.lastHit = { attackerId, tick }` even when the attacker is
    undetected in fog.
  - Consumers compensate inconsistently: `src/session.ts:545-548, 1094-1097`
    manually filters `ownIds` to hide enemy routes/queues, while
    `src/ui/economy-controls.ts:235, 275` and `src/audio/mission.ts:40-58` read
    omniscient `simulation.actors`, `simulation.economy`, and
    `simulation.support`.
  - `dismissedPopups` lives on authoritative `MissionState`
    (`src/simulation/mission.ts:266`) and is patched on save in
    `src/session.ts:1164-1183`, whereas `DESIGN.md:677-680` specifies `1.44`
    control groups as non-authoritative player UI state.
  - `attachBenchmarkProbe` (`src/benchmark-probe.ts:148-160`) overwrites
    `simulation.tick` in place.
- **Why it increases complexity (and counter-explanation check):**
  - Every consumer of `MissionSimulation` must remember which fields are
    omniscient vs. fog-filtered.
  - Counter-explanation verified in `src/session.ts:1089-1092` and
    `docs/runtime-boundaries.md:161-163`: world-animation and spatial-audio
    consumers legitimately need observable posture (`moving`, `aiming`,
    `working`) on detected non-owned actors so visible enemies animate walk,
    aim, and gather clips rather than sliding in idle pose. Stripping all
    movement/work state from detected actors (as `$seam-ripper` proposed) would
    break enemy animations. The projection must preserve **observable posture**
    on detected actors while redacting **private intent** (`orders`, route
    destinations/paths, `attackMove`, `rallyPoint`, `headquartersId`,
    `paidCost`) and redacting `combat.lastHit.attackerId` unless `owner`
    currently detects that attacker (`1.29`).
- **Comparison and smallest useful fix:**
  - *No change:* forces Phase C AI to either reach into omniscient
    `MissionSimulation` or duplicate `player-view.ts` filtering.
  - *Full dual-type split across all 46 render modules:* unnecessary churn in
    leaf mesh renderers that only read pose and posture.
  - *Selected redesign:* replace `createPlayerView` with cached per-tick
    `simulation.viewOf(owner)` serving human session/HUD/audio and AI
    directors; add authoritative per-tick controller execution (`MissionState`
    AI slot for `1.32`) plus a read-only tick observer callback (replacing
    `benchmark-probe.ts` monkey-patching and feeding `1.31`); and move
    `dismissedPopups` (plus upcoming `1.44` `controlGroups`) onto
    `MissionFile.uiState` with a `MISSION_FILE_VERSION` bump.
- **What not to change:** keep `authority.ts` and `observations.ts` rule tables
  intact as internal building blocks of `viewOf(owner)`, and keep observable
  animation posture available for detected actors.
- **Owning slices:** Slice 1 and Slice 2 (with consumer wiring in Slices 5, 8A,
  8B, and 9).

#### 2. Physical-code shortcut router and exclusive world-tool coordinator

- **Impact:** `high` - eliminates brittle cross-listener `Escape`/hotkey
  ordering, removes the sole `render -> ui` value dependency, and provides the
  required foundation for Phase D `1.44` control groups and `1.45` physical
  keycap rebinding and contextual `Q/W/E/R/T` card slots.
- **Evidence:** `Demonstrated` in existing code:
  - Keyboard listeners are split across `main.ts:62` (`F5`/`F9`/`F10`),
    `session.ts:1214-1232` (`Escape` fallback relying on registration order and
    `defaultPrevented`), `render/camera.ts:450, 507` (capture `Escape`,
    `event.code === "Space"`, `event.key` arrows),
    `render/building-placement.ts:395, 410` (`Escape`,
    `event.key.toLowerCase() === "r"`), `render/command-input.ts:413, 419`
    (`Escape`, `event.key.toLowerCase() === "s"`), `ui/production-card.ts:64`,
    and `ui/dialogs.ts:302`.
  - Button labels hardcode `(R)`, `(Esc)`, and `(S)` in
    `src/ui/sidebar-orders.ts:8, 16, 70`.
  - `src/render/building-placement.ts:16-21` value-imports `setText`,
    `setActionAvailability`, and `presentResult` from `src/ui/*`, while
    `src/session.ts:696-805` manually cancels competing modes (`placement`,
    `attackMove`, `rally`, `pan`, `boxMode`).
  - Under `1.45`, `KeyR` rotates active placement when placing a building but
    activates production slot 4 otherwise, which cannot be conflict-checked or
    rebound cleanly across disconnected `event.key` listeners.
- **Comparison and smallest useful fix:**
  - *Local repair (adding more window listeners):* multiplies registration-order
    bugs and cannot support layout-aware keycap labels or conflict checks.
  - *Selected redesign:* introduce a single `KeyboardEvent.code` shortcut
    router with explicit context priority (`dialog > popup/tooltip >
    world-tool > selection/cards > mission-global`), layout-resolved key labels
    for UI hints, and an exclusive world-tool controller in `src/ui/`, leaving
    a pure 3D `PlacementPreviewView` in `src/render/building-placement.ts`
    (`render -> ui` drops to `0` edges).
- **What not to change:** keep native `<dialog>` `cancel`/`keydown` handling
  inside `src/ui/dialogs.ts` for modal focus safety, and preserve existing
  `canvas.dataset.*` probe attributes so Playwright `e2e/` specs require zero
  selector churn.
- **Owning slices:** Slice 5 (with hint/rebinding integration in Slices 8A and
  8B).

#### 3. Targeted `mission.ts`, `economy.ts`, and `infrastructure.ts` splits

- **Impact:** `medium` (rising to `high` in Phases C-E) - isolates command
  sequencing, production queues, HQ-pooled structure work (`1.40`), and unit
  assistance (`1.41`, `1.52`) so new mechanics do not expand `mission.ts`
  (`2,247` LOC) and `economy.ts` (`872` LOC) through 9-10 argument step calls.
- **Evidence:** `Demonstrated` in `src/simulation/mission.ts:404-2148` (`45+`
  closure helpers spanning actor validation, Layer-2 placement/training checks,
  order queues, group-move formation, retirement, and tick execution) and
  `src/simulation/economy.ts:51-59, 444-550, 601-687` (housing `ProductionJob`
  queues while `production.ts` holds only spawn geometry, and exporting
  `EconomyState` back into `infrastructure.ts`, `cultivation.ts`, `growth.ts`,
  `cargo.ts`, and `worker-navigation.ts`).
- **Comparison and smallest useful fix:**
  - *No change:* `1.40` HQ building repair, `1.41`/`1.52` unit heal/repair, and
    `1.49` emergency Heartgrove recovery each touch `mission.ts` +
    `economy.ts` + domain files together.
  - *Broad 4-layer file split of all 36 simulation files (rejected from
    `$seam-ripper`):* splitting `actor.ts` (`fan-in = 49` in `src/`, `38`
    test/e2e files) just to erase compile-time `import type` cycles creates
    ~`80` file edits without simplifying runtime behavior.
  - *Selected redesign:* extract command sequencing and group-move expansion
    out of `mission.ts`, unify `ProductionJob` queue lifecycle with
    `production.ts`, decouple `infrastructure.ts` from `EconomyState` behind a
    narrow stockpile/ledger contract so HQ construction and `1.40` building
    repair share one HQ-work module, and keep `support.ts` dedicated to the
    Base Support Network while `1.41`/`1.52` unit assistance pairs with
    `combat.ts` and `automatic-movement.ts`.
- **What not to change:** do not split `actor.ts` or introduce abstract
  repository/DI layers inside `src/simulation/`.
- **Owning slices:** Slice 1, Slice 2, and Slice 3.

#### 4. Owner-color render markings seam and clean one-way subsystem imports

- **Impact:** `medium` - enables same-faction visual readability (`1.43`,
  `1.53`, `1.30`) within `O(definitions * owners)` material budgets (`1.64`),
  decouples offline GLB generation (`scripts/model-assets.ts`) from session
  view registries, and finishes the one-way subsystem DAG.
- **Evidence:** `Demonstrated` in `src/render/actor-view-registry.ts:38,
  106-112` (appearances keyed only by `definitionId`),
  `src/render/tile-placed-actor-view.ts:206-226, 258-265` (`materialFor` cached
  by `[definitionId, name]` across all owners), `src/session.ts:588-604`
  (minimap actor colors keyed only by `definitionId`),
  `scripts/model-assets.ts:20-39` (`9` runtime `src/render/*` imports), and
  small layer inversions (`src/content/content-pack.ts:43 ->
  ../render/terrain-style`, `src/save-policy.ts:1 -> ./ui/top-bar`,
  `src/ui/top-bar.ts:4 -> ../session`, and `src/audio/mission.ts:5 ->
  ../ui/mission-alerts`).
- **Comparison and smallest useful fix:**
  - Key owner-tinted `"markings"` materials by `(definitionId, ownerColorKey)`
    while keeping untinted base materials shared by `(definitionId, name)`;
    pass owner color to minimap markers; isolate pure procedural mesh recipes
    shared by `builtin-models.ts` and `scripts/model-assets.ts`; move pure
    `TerrainStyle` schema/validation to `src/content/`; and sever the three
    1-line UI type/helper leaks (`formatElapsed`, `topBarState`, `MissionAlert`
    priority).
- **What not to change:** retain `TerrainMap extends TerrainGrid` in
  `src/map.ts` (see rejected proposals below).
- **Owning slices:** Slice 6, Slice 7, Slice 8A, Slice 8B, Slice 9, and Slice
  10.

### Challenged and rejected or narrowed proposals

- **Rewriting `TerrainMap extends TerrainGrid` (`src/map.ts`) to composition
  (rejected):** `TerrainMap` (`src/map.ts:95, 143`) intentionally extends
  `TerrainGrid` so `createSessionSimulation(mission, map)` passes one grid
  instance into simulation whose terrain-command edits fire Babylon chunk
  updates without duplicating arrays or forwarding methods across `26` `src/`
  and `19` test importers. Headless callers never import `src/map.ts`. Moving
  `TerrainStyle` types to `src/content/` resolves the only real inversion in 2
  files.
- **Eliminating compile-time-only `import type` SCCs across `actor.ts` and
  `platform/index.ts` (rejected):** runtime value cycles are already `0`.
  Splitting `actor.ts` (`fan-in = 49`) solely for type-graph acyclicity adds
  wide import churn without reducing coupling or cognitive load.
- **Stripping all movement/work state from detected foreign actors
  (narrowed):** detected foreign actors must retain observable animation
  posture (`moving`, `aiming`, `working`) for 3D walk/aim/gather playback and
  spatial audio while redacting destinations, paths, queues, rally points, HQ
  links, and unseen `lastHit.attackerId`.
- **Splitting `session.ts` purely by line count (narrowed):** extract the
  world-tool/shortcut coordinator (Candidate 2) and consider a cohesive
  `world-scene` helper only if Slice 5 Pass A confirms it removes genuine state
  tangle rather than forwarding 20 parameters through a shallow wrapper.

## Cross-slice contracts and slice adjustments

- **Locked cross-slice seam directions for Slices 1-13:**
  - `OwnerView` (`simulation.viewOf(owner)`): single per-owner read/evaluate
    boundary for human session, HUD, audio, and Phase C AI directors, redacting
    foreign intent and unseen `lastHit.attackerId` while preserving observable
    posture.
  - `MissionFile.uiState`: top-level optional persisted player interface state
    (`dismissedPopups`, `1.44` `controlGroups`) outside authoritative
    `MissionState`; authoritative AI director state (`1.32`) lives inside
    `MissionState`.
  - Non-mutating tick controller and observer hooks on `MissionSimulation`,
    retiring `simulation.tick` monkey-patching in `src/benchmark-probe.ts`.
  - Physical `KeyboardEvent.code` shortcut router + exclusive world-tool state
    in `src/ui/`, leaving `src/render/*` free of `src/ui/*` imports.
  - `(definitionId, ownerColorKey)` marking material cache seam across actor,
    building, wreck, and minimap views.
- **Adjustments applied to `docs/architecture-review/review-plan.md`:**
  1. Move `src/benchmark-probe.ts` from Slice 9 into **Slice 1** so the tick
     observer seam replaces monkey-patching immediately alongside `mission.ts`
     and `match-metrics.ts`.
  2. Reorder former Slice 4 (`actor.ts`, `combat.ts`, `vision.ts`,
     `observations.ts`, `player-view.ts`) to **Slice 2** immediately after
     Slice 1 (shifting Economy to **Slice 3** and Spatial/Movement to **Slice
     4**) so `MissionSimulation` and `viewOf(owner)` settle before downstream
     slices.
  3. Split the 53-file Slice 8 into **Slice 8A (In-mission HUD, top bar,
     alerts, notifications, and sidebar - 29 files)** and **Slice 8B (App
     shell, desktop host, persistence, and modal dialogs - 24 files)** so every
     Tier 1 slice remains small enough for an unhurried line-1-to-EOF Pass B
     and Slice 8A coordinates directly with Slice 5's shortcut/HUD seams.
  4. Record explicit cross-slice caller checks (`TerrainStyle` between Slices 6
     and 9; `scripts/model-assets.ts` during Slice 7; `MissionFile.uiState`
     across Slices 1, 5, and 8B).
