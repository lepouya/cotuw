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
  Babylon objects. Its map factory also supplies presentation with the
  scenario's dimensions, scale, and saved terrain.
  [Scenario browser checks](../e2e/scenario.spec.ts) verify restored geometry,
  water, and base focus.
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
- **0.42, wolf AI:** [territorial simulation](../src/simulation/territory.ts)
  implements personal sight, shared territory centers and individual homes,
  visible-wolf alerts, investigation, hard leashes, route recovery, and delayed
  regeneration. [Wolf tests](../tests/wildlife.test.ts) cover all seven states,
  relay chains, expiry, stable choices, blocked homes, actor order, and saved
  continuation. [Combat tests](../tests/combat.test.ts) cover blocked pursuit
  and terrain retries. Normal and alpha content and appearances are available;
  the authored den and lone-wolf sight isolation belong to **0.41**.
- **0.41, authored M0 map:**
  [terrain content](../src/content/prototype-terrain.ts) supplies branching
  ridge crossings, slow rough ground, a traversable hill, the enclosed den,
  and distinct mountain landmarks. Two recovery supplies beyond the lone wolf
  pay for two Troopers. [Scenario tests](../tests/economy-scenario.test.ts)
  verify reachable homes, the three-tile entrance, weighted detours,
  reconnecting routes, inaccessible peaks, and hidden recovery supplies.
  Sight checks cover each wolf's movement profile and territory over a
  conservative superset of travel tiles, including leash boundary tiles.
- **0.48, slice unit tests:** economy, construction support, production, fog,
  combat, wolf state and save continuation have focused tests. The
  [objective tests](../tests/objectives.test.ts) and
  [scenario tests](../tests/economy-scenario.test.ts) cover defeat priority,
  combat-only progress, victory, free play, saved continuation, validation,
  and fresh opening reconstruction. Browser checks also cover restart.
- **0.49, complete mission browser flow:**
  [mission checks](../e2e/mission.spec.ts) exercise the production app from its
  authored Command Center through gathering, paid buildings and production,
  Scout exploration, lone-wolf combat, recovery supplies, the den, victory,
  and post-victory training. Mouse and phone touch pass in Chromium and WebKit.
  Only time is controlled; resources, actors, health, and objectives use the
  authored values. [Playthrough notes](m0-playthrough.md) describe the resource
  budget, measured pacing, and the normal-speed check.

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
- **0.43, mission interface:** sidebar tabs, resource display, count-based
  practice goals, mission objectives, victory and defeat results, status
  feedback, and network alerts work. The radial menu, general notifications,
  explanatory popups, and top-bar time/menu controls remain.
- **0.44, persistence:**
  [versioned serialization](../src/simulation/scenario.ts) and saved-state
  validation work. Mission results provide file loading, paused inspection,
  resume, restart, and exit. [Load checks](../e2e/mission-load.spec.ts) verify
  that pending reads cannot override restart, exit, or a newer load. Manual
  saving, general save/load controls and storage, rolling quicksave, and
  autosave remain.
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
  behavior work. Pan mode, scrolling in Pan mode, Space-drag, and focused-world
  arrow keys provide laptop and touch navigation while preserving selection.
  Mouse edge panning supports corners and an on-screen toggle, with gesture,
  UI, dialog, and focus safeguards.
  [Navigation checks](../e2e/camera-navigation.spec.ts) cover mouse, phone, and
  tablet input, construction previews, interrupted gestures, form fields,
  dialogs, blur, and restored commands.
  Queued orders, camera presets, actor Focus/Follow, and other locked bindings
  are incomplete.
- **0.50, compact interaction checks:** phone landscape checks exercise
  construction, production, economy, rally points, selection, movement, and
  camera controls without a keyboard or secondary button. Attack Move also has
  phone and tablet checks. The full mission loop has phone coverage; the
  remaining tablet interactions and future persistence controls remain
  unverified.

## Recommended next task

Implement **0.44**: manual saving, general save/load and restart controls,
rolling quicksave, and autosave. Introduce the browser/native platform-service
boundary in **0.5** around storage. Preserve paused inspection and validation
before replacing a running mission.

Pacing needs tuning and first-time human playtests: the efficient full-flow
check completes in about five simulated minutes, below the intended familiar
replay duration. Animation and the remaining interface retain their open scope.
