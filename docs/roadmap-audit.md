# Roadmap implementation audit

An item is complete when all of its stated scope has implementation and
verification evidence. Open items can have substantial working parts.
The [roadmap](../ROADMAP.md) owns task status; [DESIGN.md](../DESIGN.md) owns
the requirements.

## Completion evidence

- **0.5, module boundaries:** simulation, rendering, content, UI, and
  [platform services](../src/platform/index.ts) have separate modules. Browser
  and Tauri adapters implement save storage and file exchange behind one
  interface; the game imports the Tauri adapter only inside Tauri.
- **0.16, renderer-independent map content:**
  [level files](../src/content/levels/) store terrain as text, and
  [the mission file codec](../src/simulation/mission-file.ts) and
  [scenario map factory](../src/simulation/scenario.ts) load it without
  Babylon objects. The factory also supplies presentation with the scenario's
  dimensions, scale, and saved terrain.
  [Scenario browser checks](../e2e/scenario.spec.ts) verify restored geometry,
  water, and base focus.
  [Simulation terrain tests](../tests/simulation-terrain.test.ts)
  verify renderer-free restoration and navigation, and
  [mission file tests](../tests/mission-file.test.ts) verify the text layout,
  hand edits, and bundled levels.
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
- **0.32, prototype unit tests:** [navigation](../tests/navigation.test.ts),
  [occupancy](../tests/occupancy.test.ts),
  [tile-placed actor](../tests/tile-placed-actor.test.ts),
  [loop](../tests/loop.test.ts), and
  [group movement](../tests/group-movement.test.ts) tests cover path finding,
  actor movement, multi-tile occupancy, and group destination assignment.
  Terrain-animation data tests belong to **0.11**.
- **0.33, prototype browser visual checks:**
  [terrain](../e2e/terrain.spec.ts), [minimap](../e2e/minimap.spec.ts),
  [group selection](../e2e/group-control.spec.ts), and
  [building](../e2e/tile-placed-actor.spec.ts) checks cover the requested scene
  elements. Group and [sidebar](../e2e/sidebar.spec.ts) checks also attach
  screenshots containing the map, minimap, units, and buildings.
- **0.35, ARC roster and costs:**
  [The base content pack](../src/content/packs/base.json) defines all six
  required actors, costs, and construction or training times.
  [The opening level](../src/content/levels/arc-economy-opening.json) places
  the fixed Command Center.
  [Economy browser checks](../e2e/economy.spec.ts) exercise the paid Refinery,
  Harvester, Barracks, and Trooper flow;
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
  [the level's terrain script](../scripts/levels/m0-terrain.ts) bakes branching
  ridge crossings, slow rough ground, a traversable hill, the enclosed den,
  and distinct mountain landmarks. Two recovery supplies beyond the lone wolf
  pay for two Troopers. [Scenario tests](../tests/economy-scenario.test.ts)
  check the bundled level file for reachable homes, the three-tile entrance,
  weighted detours, reconnecting routes, inaccessible peaks, and hidden
  recovery supplies.
  Sight checks cover each wolf's movement profile and territory over a
  conservative superset of travel tiles, including leash boundary tiles.
- **0.43, mission interface:** the [sidebar](../src/ui/sidebar.ts),
  [top bar](../src/ui/top-bar.ts), [radial menu](../src/ui/radial-menu.ts),
  [alerts](../src/ui/mission-alerts.ts), and scenario popups have focused
  [unit](../tests/mission-alerts.test.ts) and
  [browser](../e2e/interface.spec.ts) coverage. Checks exercise pause and speed,
  compact touch controls, popup persistence and tick-time pauses, alert history,
  and radial keyboard navigation and dismissal.
  [Command input tests](../tests/command-input.test.ts) cover stale actions
  after selection, visibility, or pause changes. Mission and economy checks
  cover objectives, victory, free play, and defeat. Manual mission interface
  playtesting passes.
- **0.44, persistence:** levels and saves share
  [one JSON format](mission-files.md), and every mission starts by loading a
  file. The game menu provides named saves, export, a save list with import
  and deletion, quicksave (`F5`), quickload (`F9`), restart, and exit;
  completing an objective writes the autosave. Loading begins paused and
  rejects other versions, tick rates, and content pack versions clearly.
  [Codec](../tests/mission-file.test.ts) and
  [save library](../tests/saves.test.ts) tests pass, and a manual browser
  playthrough saved and loaded successfully.
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

- **0.54, content packs:** [the base pack](../src/content/packs/base.json)
  holds actor definitions, movement profiles, presentation, terrain styling,
  and lighting. [Session code](../src/session.ts) reads them from the mission's
  pack; built-in behaviors and procedural models are named by ID.
  [Content pack tests](../tests/content-pack.test.ts) cover parsing, unknown
  references, and terrain styling.

## Remaining scope

- **Desktop persistence:** the save folder and file dialogs need a manual
  check in Tauri. Chromium and WebKit coverage includes the
  [save checks](../e2e/saves.spec.ts).

- **0.11 and 0.12, terrain frame animation:** terrain supports static textures
  and UV scrolling. Frame sequences, timing, playback modes, their data tests,
  and frame-based texture playback are absent.
- **0.21 and 0.22, actor animation:**
  [the base content pack](../src/content/packs/base.json) and
  [the GLB loader](../src/render/skinned-actor-appearance.ts) implement skeletal
  idle, walking, and turning. Actor texture-frame clips and playback are absent.
- **0.45, on-screen actions:** construction, production, economy, rally points,
  selection, movement, camera, Attack Move, pause, and speed actions have
  on-screen controls that work with compact touch input. Focus, Follow, and
  queued orders lack controls.
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
  Secondary click opens the radial menu and secondary drag pans. Queued
  orders, camera presets, actor Focus/Follow, the minimap command mode, and
  other locked bindings are incomplete.
- **0.50, compact interaction checks:** phone landscape checks exercise
  construction, production, economy, rally points, selection, movement, and
  camera controls without a keyboard or secondary button. Attack Move also has
  phone and tablet checks. The full mission loop has phone coverage; the
  remaining tablet interactions and future persistence controls remain
  unverified.

## Recommended next task

Check Tauri saves. Then take **0.11** and **0.12**: their frame-clip format also
serves actor texture clips in **0.21** and **0.22**. Camera presets and
Focus/Follow from **0.47** follow. **0.55** needs first-time human playtests,
which the notifications and popups now support.
