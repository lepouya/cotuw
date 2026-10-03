# Roadmap implementation audit

An item is complete when all of its stated scope has implementation and
verification evidence. Open items can have substantial working parts.
The [roadmap](../ROADMAP.md) owns task status; [DESIGN.md](../DESIGN.md) owns
the requirements.

## Completion evidence

- **0.16, renderer-independent map content:**
  [terrain content](../src/content/prototype-terrain.ts) supplies terrain and
  heights to a plain `TerrainGrid`.
  [Scenario content](../src/content/economy-scenario.ts) captures that grid as
  immutable terrain data, and
  [scenario initialization](../src/simulation/scenario.ts) loads it without
  Babylon objects.
  [Simulation terrain tests](../tests/simulation-terrain.test.ts)
  verify renderer-free restoration and navigation.
- **0.20, pathfinding and feedback:**
  [navigation tests](../tests/navigation.test.ts) and
  [occupancy tests](../tests/occupancy.test.ts) cover weighted routes, blocked
  targets, and replanning after terrain or footprint changes.
  [Movement-path rendering](../src/render/movement-path.ts) distinguishes
  requested blocked targets from reachable destinations and shows rejected
  targets. [Group tests](../tests/group-movement.test.ts) verify receipts and
  separate approach positions.
- **0.30, minimap rendering:**
  [the minimap](../src/render/minimap.ts) draws terrain, footprint polygons,
  mobile actors, selected outlines, fog, and the camera viewport.
  [Unit tests](../tests/minimap.test.ts) and
  [browser checks](../e2e/minimap.spec.ts) cover its projection, terrain colors,
  changing footprints, moving markers, and navigation.
- **0.33, prototype browser visual checks:**
  [terrain](../e2e/terrain.spec.ts), [minimap](../e2e/minimap.spec.ts),
  [group selection](../e2e/group-control.spec.ts), and
  [building](../e2e/tile-placed-actor.spec.ts) checks cover the requested scene
  elements. Group and [sidebar](../e2e/sidebar.spec.ts) checks also attach
  screenshots containing the map, minimap, units, and buildings.
- **0.35, ARC roster and costs:**
  [ARC definitions](../src/content/arc.ts) contain all six required actors,
  costs, and construction or training times.
  [The opening](../src/content/economy-scenario.ts) places the fixed Command
  Center. [Economy browser checks](../e2e/economy.spec.ts) exercise the paid
  Refinery, Harvester, Barracks, and Trooper flow;
  [sidebar checks](../e2e/sidebar.spec.ts) exercise both infantry types.
- **0.37, Materials collection:**
  [economy tests](../tests/economy.test.ts) cover finite patches, paid Harvester
  production, Refinery assignment, cargo, delivery, exhaustion, reassignment,
  and one-time salvage. [Browser checks](../e2e/economy.spec.ts) exercise the
  controls through both mouse and compact touch input. This scope also has
  integration coverage under completed task 0.53.
- **0.40, combat:** rifles, wolf bites, detection, pursuit, health, hit effects,
  destruction, and remains cleanup have [combat tests](../tests/combat.test.ts).
  Attack Move preserves destinations, investigates detection loss, and resumes
  after encounters, including saved fights and blocked routes. Combat loss of
  the starting Command Center freezes the mission and saves its defeat result.
  [Browser checks](../e2e/economy.spec.ts) cover mouse, phone and tablet touch,
  destination feedback, defeat, file loading, restart, and exit.

## Remaining scope

- **0.5, module boundaries:** simulation, rendering, content, and UI have
  separate modules. Tauri currently only hosts the app; platform-service
  interfaces and browser/native adapters are absent. Persistence is the first
  concrete use for that boundary. Application wiring remains in
  [the prototype](../src/prototype.ts).
- **0.11 and 0.12, terrain frame animation:** terrain supports static textures
  and UV scrolling. Frame sequences, timing, playback modes, and frame-based
  texture playback are absent.
- **0.21 and 0.22, actor animation:**
  [graphics definitions](../src/prototype-content.ts) and
  [the GLB loader](../src/render/skinned-actor-appearance.ts) implement skeletal
  idle, walking, and turning. Actor texture-frame clips and playback are absent.
- **0.32, prototype unit tests:** movement, navigation, multi-tile occupancy,
  and group destinations have focused tests. Terrain-animation data tests
  depend on the missing frame-animation pipeline.
- **0.41, M0 map:** the movement map has slopes, cliffs, paths, rough ground,
  one wolf, and salvage. The compact mission layout, five-wolf den and alpha,
  mission landmarks, and recovery loot placement still need integration.
- **0.42, wolf AI:** baseline target retention, stable choices, pursuit, hard
  leash, return, regeneration, and saved combat continuation work.
  Personal perception, shared den territories, visible-wolf alert propagation,
  investigation, return interruptions, blocked-route policies, and the complete
  serializable state machine remain. Q29's M0 gameplay decisions are
  resolved; the [wolf implementation contract](
    ../DESIGN.md#m0-wolf-implementation-contract) defines content, saves, and
  acceptance checks.
- **0.43, mission interface:** sidebar tabs, resource display, count-based
  practice goals, status feedback, and network alerts work. Mission objectives,
  victory results, the radial menu, general notifications, explanatory
  popups, and top-bar time/menu controls remain.
- **0.44, persistence:**
  [versioned serialization](../src/simulation/scenario.ts) and saved-state
  validation work. Defeat results provide file loading, paused inspection, and
  restart. Manual saving, general save/load controls and storage, rolling
  quicksave, and autosave remain.
- **0.45, on-screen actions:** construction, production, economy, rally points,
  selection, movement, and camera actions have on-screen controls. Missing M0
  actions still need controls, including general persistence. Attack Move
  targeting works with mouse and compact touch input.
- **0.46, presentation:** skeletal infantry, articulated machinery, tracers,
  bite effects, health bars, remains, blueprint progress, and staged resource
  markers work. Frame animation, the complete actor combat/death clips,
  ambient objects, escalating damage effects, construction stages, and the
  remaining building activity animations still need integration.
- **0.47, locked controls:** basic selection, contextual commands, Stop/Clear,
  touch camera controls, smooth minimap navigation, and some reduced-motion
  behavior work. Queued orders, camera presets, actor Focus/Follow, keyboard
  and edge panning, and the remaining locked bindings are incomplete.
- **0.48, slice unit tests:** economy, support, production, fog, combat, and
  save continuation have focused coverage. Complete wolf AI, objectives,
  victory and complete mission reconstruction still need coverage. Defeat and
  opening restart have focused simulation and browser checks.
- **0.49, complete mission browser flow:** absent. The tested opening ends
  with economy and lone-wolf combat; six-wolf victory and post-victory free
  play require the mission systems and den.
- **0.50, compact interaction checks:** phone landscape checks exercise
  construction, production, economy, rally points, selection, movement, and
  camera controls without a keyboard or secondary button. Attack Move also has
  phone and tablet checks. Full mission actions and the remaining tablet
  interactions remain unverified.

## Recommended next task

Plan and implement **0.42** using the locked wolf rules and the
[wolf contract](../DESIGN.md#m0-wolf-implementation-contract). Scope includes
personal perception, visible-wolf alert propagation, alert investigation, and
the complete serializable state machine. These support the den encounter in
**0.41**, followed by mission objectives and victory in **0.43**.

Animation and the remaining persistence controls retain their own open scope.
