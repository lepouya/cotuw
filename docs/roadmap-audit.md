# Roadmap implementation audit

An item is complete when all of its stated scope has implementation and
verification evidence. Open items can have substantial working parts.
The [roadmap](../ROADMAP.md) owns task status; [DESIGN.md](../DESIGN.md) owns
the requirements.

## Milestone 0 closeout

55 of 57 tasks are complete. The remaining tasks are **0.44**, native
persistence verification, and **0.55**, human playtesting and pacing.
The mission loop has browser coverage from the authored opening through
victory and free play. Milestone acceptance also requires recorded unaided
first-time human completion and a desktop mission run.

The implementation is ready for closeout testing. The October 13, 2026 review
of the roadmap and locked design against the mission, content, clock,
platform adapters, saves, interface, checks, and desktop configuration found no
missing core M0 system. Automated checks and builds establish technical
readiness, not unaided usability, pacing, or native runtime behavior.

## Verification baseline

- `npm run check` passes on Windows 10: formatting, TypeScript and Rust linting
  and type checks, 991 unit tests, and 132 Chromium browser checks.
  Two conditional Scout attack-animation tests are skipped because Scouts
  cannot attack. The Rust test harness has no tests. Playwright teardown needed
  its temporary Vite server stopped manually before the command exited
  successfully.
- The recorded macOS baseline passes 990 unit tests and 264 Chromium and
  WebKit browser checks. The Windows asset normalization still needs a macOS
  check to confirm generated files match on both platforms.
- Chromium checks run in full headless mode with GPU WebGL. The headless shell
  renders with SwiftShader at about 25 frames per second, which made Chromium
  checks about five times slower than WebKit and timed out touch selection
  checks under parallel load.
- `npm run build` and `npm run tauri build -- --debug --no-bundle` pass on
  Windows and macOS. A [Windows session](m0-playthrough.md#desktop-sessions)
  verifies the development app's mission and native file exchange, plus built
  debug-app persistence, input, window sizing, audio, and Alt-Tab. Installer
  and release-build acceptance remain open.

## Completion evidence

- **0.5, module boundaries:** simulation, rendering, content, UI, and
  [platform services](../src/platform/index.ts) have separate modules. Browser
  and Tauri adapters implement save storage and file exchange behind one
  interface; the game imports the Tauri adapter only inside Tauri.
  [Runtime extension contracts](runtime-boundaries.md) describe behavior and
  resource ownership. Unit and browser checks cover recursive ticks, protected
  terrain queries, and cleanup after failed session initialization.
- **0.56, simulation clock catch-up:**
  [the clock](../src/simulation/clock.ts) retains ticks beyond its batch limit.
  [Clock tests](../tests/clock.test.ts) verify that a ten-second stall at 60 Hz
  runs all 600 ticks across bounded batches, with interpolation clamped while
  whole ticks remain pending.
  [Loop tests](../tests/loop.test.ts) cover whole and fractional owed ticks
  across speed changes, independent timer pumps at 4, 250, and 1,000 ms,
  paused inspection, result pauses, faults, and stopping during catch-up.
  [Combat tests](../tests/combat.test.ts) compare identical mission snapshots
  under frequent, one-second, ten-second, and twenty-second pump schedules.
  [Browser checks](../e2e/interface.spec.ts) verify that the production app's
  timers commit all 600 ticks after a ten-second gap with rendering stopped,
  reading authoritative progress through quicksave in Chromium and WebKit.
- **0.11 and 0.12, terrain frame animation:** dense and sparse grass clips play
  generated sprite sheets with per-frame durations, phase lags, and reduced
  motion. [Clip tests](../tests/texture-clip.test.ts) cover timing, playback
  modes, cells, and validation; [mesh](../tests/terrain-mesh.test.ts) and
  [asset](../tests/terrain-assets.test.ts) tests cover phase groups, seams,
  and the generator. [Browser checks](../e2e/terrain-animation.spec.ts) verify
  frame loading, playback, reduced motion, terrain independence, and cleanup
  in Chromium and WebKit, and a manual playtest passes.
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
- **0.21 and 0.22, actor animation:** [DESIGN.md](../DESIGN.md#actor-animation)
  defines skeletal clip roles, triggers, and frame effects as presentation
  driven by committed attack events and remains.
  [The base content pack](../src/content/packs/base.json) gives infantry
  idle, walking, turning, attack, and death clips, which
  [the GLB loader](../src/render/skinned-actor-appearance.ts) plays, and gives
  the Trooper a muzzle flash that
  [frame effects](../src/render/frame-effects.ts) play on each hit.
  [Model tests](../tests/infantry-appearance.test.ts) cover recoil, falling,
  holding, and reduced motion;
  [view tests](../tests/actor-view-registry.test.ts) cover triggers and effects;
  [remains tests](../tests/wrecks.test.ts) cover timing and model replacement.
  [Content](../tests/content-pack.test.ts) and
  [effect asset](../tests/effect-assets.test.ts) tests cover validation and
  the generated sheet. [Browser checks](../e2e/frame-effects.spec.ts) verify
  anchoring, playback, reduced motion, and cleanup in Chromium and WebKit, the
  lone-wolf duel shows the flash in a mission, and a manual playtest passes.
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
- **0.44, persistence implementation:** levels and saves share
  [one JSON format](mission-files.md), and every mission starts by loading a
  file. The game menu provides named saves, export, a save list with import
  and deletion, quicksave (`F5`), quickload (`F9`), restart, and exit;
  completing an objective writes the autosave. Loading begins paused and
  rejects other versions, tick rates, and content pack versions clearly.
  [Codec](../tests/mission-file.test.ts) and
  [save library](../tests/saves.test.ts) tests pass, and a manual browser
  playthrough saved and loaded successfully. Native file exchange verification
  remains open below.
- **0.45, on-screen actions:** construction, production, economy, rally points,
  selection, movement, camera views, Focus, Follow, Attack Move, pause, and
  speed actions have on-screen controls that work with compact touch input,
  including the Queue Orders mode. Chromium and WebKit checks cover them;
  phone and tablet coverage belongs to **0.50**.
- **0.47, locked controls:** selection, contextual commands, Stop/Clear,
  touch camera controls, smooth minimap navigation, and reduced motion for
  camera moves, minimap, building activity, and terrain clips work. Pan mode,
  scrolling in Pan mode, Space-drag, and focused-world arrow keys provide
  laptop and touch navigation while preserving selection.
  Mouse edge panning supports corners and an on-screen toggle, with gesture,
  UI, dialog, and focus safeguards.
  [Navigation checks](../e2e/camera-navigation.spec.ts) cover mouse, phone, and
  tablet input, construction previews, interrupted gestures, form fields,
  dialogs, blur, and restored commands.
  Secondary click opens the radial menu and secondary drag pans.
  [The camera](../src/render/camera.ts) provides eased Isometric, Top-down,
  Grid, and Reset View presets, preset-aware rotation, Focus, and Follow, with
  [unit tests](../tests/camera.test.ts) for headings, focus retention, Follow
  cancellation, and live reduced-motion changes. The View popup dismisses on
  outside presses, focus changes, and Escape. The minimap accepts targets in
  Attack Move mode, including Shift and Queue Orders. These modes append to
  saved per-actor queues with a route preview;
  [queue tests](../tests/queued-orders.test.ts) cover
  sequencing, replacement, groups, attacks, saves, and validation. The
  [camera](../e2e/camera-navigation.spec.ts) and
  [queue](../e2e/queued-orders.spec.ts) browser checks pass in Chromium and
  WebKit, and a manual playtest passes.
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
- **0.50, compact interaction checks:** [shared profiles](../e2e/profiles.ts)
  run the touch checks at phone and tablet landscape sizes without a keyboard,
  hover, or secondary button. They cover construction previews and
  confirmation, production, the economy opening, rally points, additive and
  box selection, movement, Stop, camera controls and views, Focus, Follow,
  Attack Move, Queue Orders, the top bar and popups, and the game menu's save,
  quicksave, load, and delete controls. The full mission loop also passes by
  phone touch.
- **0.54, content packs:** [the base pack](../src/content/packs/base.json)
  holds actor definitions, movement profiles, presentation, terrain styling,
  and lighting. [Session code](../src/session.ts) reads them from the mission's
  pack; built-in behaviors and procedural models are named by ID.
  [Content pack tests](../tests/content-pack.test.ts) cover parsing, unknown
  references, and terrain styling.

- **0.46, presentation:** skeletal infantry with attack and death clips,
  articulated machinery, tracers, muzzle flashes, bite effects, health bars,
  remains, staged resource markers, wolf attack and death, and Harvester
  transit, harvesting, and destruction clips work. Blueprints rise through
  three [construction stages](../src/render/construction-stage.ts) inside
  a scaffold. Barracks and Refineries play
  [activity clips](../tests/building-presentation.test.ts) on unit exits and
  deliveries. [Damage effects](../src/render/damage-effects.ts) escalate at
  60% and 30% health, destroyed buildings collapse, and an authored flock of
  [ambient birds](../src/render/ambient-birds.ts) circles the lake shore.
  Models, materials, skeletons, clips, textures, and sprite sheets have
  offline generators; runtime art loads their committed files. Unit tests
  cover these views, and [browser checks](../e2e/presentation.spec.ts) render
  them in Chromium and WebKit. Troopers and Scouts share hit reactions;
  Troopers hold an aim pose. Normal and alpha wolves share run, turn, bite,
  hit, and death clips.
  Visible regenerating wolves show a halo and rising crosses. Harvesters
  deploy and stow their collectors, reverse interrupted transitions without
  jumping, and tip their hoppers on committed delivery. Loading settles the
  collector into its saved work state; lethal hits go directly to death.
  Materials stages use content-pack thresholds and scales.
  [Actor presentation tests](../tests/actor-presentation.test.ts) cover these
  clips, independent instances, repeated hits, death priority, reversal,
  loading, reduced motion, and regeneration cleanup. Browser presentation
  checks cover committed combat and deliveries and loaded healing visibility.
  A human visual playtest passes.

- **0.57, gameplay audio:** the required cues, exploration and combat music,
  menu volume and mute controls, fog-filtered world audio, and grouped command
  and combat feedback are implemented. [Gameplay audio](audio.md#verification)
  lists the unit and Chromium and WebKit browser checks, and
  [audio assets](audio-assets.md) records provenance. Human listening playtests
  approved the cues and mix. A macOS Tauri smoke check verified device unlock,
  volume and mute controls, and mission restart.

## Remaining scope

- **0.44, native persistence verification:** saving to and loading from the
  app data folder have desktop playtest evidence. A
  [Windows session](m0-playthrough.md#desktop-sessions) exported a mid-mission
  save and imported it through the native dialogs, then completed the mission
  from it. A built Windows debug app passed dialog cancellation, malformed and
  incompatible file rejection, named-save persistence after relaunch, repeated
  quicksave overwrite and quickload, objective autosave loading, and restart.
  Equivalent native persistence checks remain on macOS. The desktop file scope
  covers only the app data saves folder; the dialog plugin grants access to the
  chosen file.
- **0.55, human playtesting and pacing:** [DESIGN.md](../DESIGN.md) accepts the
  current 5 to 10 minute run, and M0 is not lengthened by slowing the economy
  or adding encounters.
  [The playthrough evidence](m0-playthrough.md#pacing) records automated and
  familiar-replay times; first-time times and unaided completion remain
  unrecorded.

## Closeout action plan

1. **Run unaided first-time playtests for 0.55.** A recommended initial sample
   is three RTS-familiar players who have not played this mission, then one
   familiar replay. Give players the game and its in-game guidance, without the
   README walkthrough or scripted test strategy. Observe the economy bootstrap,
   Harvester assignment, camera and selection, route discovery, army
   preparation, and den assault. Record help or abandonment as a failed unaided
   attempt rather than silently coaching the player. Repeated confusion becomes
   a concrete fix.
2. **Verify native persistence on macOS for 0.44.** In a built desktop app,
   export a mid-mission save with active gathering, production, or
   combat. Change progress, import the exported file through the native dialog,
   and compare restored time, Materials, cargo, queues, orders, fog, and
   objectives. Confirm paused inspection and successful resume. Cancel both
   dialogs and reject malformed and incompatible files without replacing the
   session. Verify named saves survive app relaunch; overwrite and reload the
   quicksave; load an objective autosave; restart from the authored opening.
3. **Fix observed blockers and retest affected paths.** Prioritize crashes,
   lost or incorrect saves, blocked progression, and repeated confusion that
   prevents unaided completion. Tune costs, timing, guidance, or layout only
   where observations support a change. Preserve locked encounter rules and
   regenerate affected content or assets. Repeat failed playtest paths and the
   full mission after changes; avoid adding post-M0 systems to this pass.
4. **Run final acceptance on one fixed revision.** Run `npm run check`,
   `npm run build`, and the Tauri build, then complete the built desktop mission
   through victory and free play. Exercise defeat, load, restart, and exit, and
   confirm audio works throughout. Cover Windows and macOS explicitly; macOS
   browser WebKit and a debug compilation do not establish Windows runtime or
   packaged-app behavior. Inspect the default 800×600 desktop window and
   resizing as well as the tested browser profiles. Record results and update
   the completion evidence before checking off **0.44**, **0.55**, and the
   milestone.

Steps 1 and 2 can run together. Step 4 follows any resulting fixes.

## Evidence to record

Add results to [the playthrough notes](m0-playthrough.md), using one record per
attempt or native test session:

- Revision or build identifier, date, platform and OS, browser or built app,
  viewport, input method, and test scope.
- For playtests: prior RTS experience and mission familiarity, outcome, wall
  time, mission time, speed changes, pauses, losses, routes, idle waiting,
  confusion, help, and the player's assessment of combat and pacing.
- For persistence: save kind, exported file and restored-state comparison,
  relaunch behavior, cancellation, invalid-file rejection, and any error shown.
- Pass or fail, reproduction details for failures, and the revision that fixes
  each blocker. Keep developer-guided and automated runs distinct from unaided
  first-time completion.

## Nonblocking follow-up

- The browser production build warns about its roughly 5.8 MB main JavaScript
  chunk, about 1.24 MB gzipped. Measure startup on intended hardware before
  deciding whether to optimize it. This warning alone is not an M0 failure.
- Record noticeable stalls during the desktop mission; deterministic catch-up
  tests do not establish smooth rendering on player hardware.
- The CI workflow is intentionally manual. Run the required checks locally on
  the final revision; enabling automatic CI is not an M0 prerequisite.
