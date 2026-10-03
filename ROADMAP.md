# Roadmap

This document tracks milestones and implementation work. Record design decisions
in [DESIGN.md](DESIGN.md). Task IDs show their milestone and insertion order;
they do not prescribe completion order.

## Milestone 0: Foundations

**Goal:** Deliver a small standalone ARC mission that proves the minimum
base-building RTS loop, its technical architecture, and its player interface.

### Design

- [x] 0.1 Define the initial player fantasy, scenario, and immediate objective.
- [x] 0.2 Define the smallest core loop and vertical-slice boundary.
- [x] 0.3 Record the resulting decisions in [DESIGN.md](DESIGN.md) and retain
      the detailed rationale in
      [the design questionnaire](docs/design-questionnaire.md).

### Codebase

- [x] 0.4 Scaffold the Tauri 2, Vite, TypeScript, and Babylon.js application.
- [ ] 0.5 Establish small module boundaries for simulation, rendering, and
      platform services.
- [x] 0.6 Add the basic development, type-checking, and build commands.

### Proof of concept

- [x] 0.7 Run the game in a browser and the Tauri development shell.
- [x] 0.8 Render one small map with a strategy camera.
- [x] 0.9 Render one placeholder actor and prove pointer hit-testing with
      temporary selection feedback.
- [x] 0.10 Prove direct target movement on an unobstructed surface before
      introducing terrain-aware path finding.

### Terrain and map content

- [ ] 0.11 Define data-driven terrain-animation clips: frame sequence, frame
      timing, playback mode, and per-layer texture source.
- [ ] 0.12 Render frame-based terrain texture animation without changing the
      deterministic terrain state.
- [x] 0.13 Keep scrolling UV effects available independently for layers that
      need them.
- [x] 0.14 Create a movement-test map with hills, cliffs, and paths.
- [x] 0.15 Define which slopes, cliffs, and path surfaces are traversable for
      the prototype actor.
- [ ] 0.16 Make that map data-driven and loadable without renderer-specific
      state.

### Actors and movement

- [x] 0.17 Define the prototype actor's simulation state, movement properties,
      target command, and deterministic update rules.
- [x] 0.18 Render a visible Trooper actor at its simulated world position.
- [x] 0.19 Replace the direct-motion spike with data-driven target commands and
      movement along a valid path.
- [ ] 0.20 Provide path finding that respects terrain and occupancy, replans
      when blockers change, and reports unreachable targets clearly.
- [ ] 0.21 Define actor animation clips for skeletal animation and texture-frame
      animation, including their simulation-facing state.
- [ ] 0.22 Render both animation types on prototype actors without coupling
      animation playback to simulation timing.

### Structures and selection

- [x] 0.23 Define footprint data for stationary objects that occupy one or more
      tiles, including placement origin, occupied tiles, and blocking behavior.
- [x] 0.24 Render one multi-tile building or stationary object aligned to its
      footprint and terrain.
- [x] 0.25 Include occupied structure tiles in placement and path-finding
      constraints.
- [x] 0.51 Add a placement sandbox with rotated terrain previews, rejection
      feedback, building selection and removal, and an articulated prototype
      Command Center with renderer-owned idle animation.
- [x] 0.26 Replace the selection spike with persistent individual-selection
      state and production visual feedback.
- [x] 0.27 Support selecting multiple actors by additive selection and drag-box
      selection.
- [x] 0.28 Issue a target command to every selected actor, with destinations
      resolved so the group does not converge on one tile.

### Interface

- [x] 0.29 Define the minimap's information, camera-frustum treatment, and input
      behavior for the prototype.
- [ ] 0.30 Render a corner minimap showing terrain, stationary-object
      footprints, actors, current selection, and the camera viewport.
- [x] 0.31 Support minimap navigation while keeping it independent of simulation
      state.
- [x] 0.52 Add a left sidebar with selection, construction, units, and goals
      tabs; start the sandbox empty and train Troopers and Scouts through Field
      Barracks with deterministic, blocked-exit-aware spawning.

### Verification

- [ ] 0.32 Add focused tests for terrain-animation data, path finding, actor
      movement, multi-tile occupancy, and group command destination assignment.
- [ ] 0.33 Add a browser visual check covering the test map, minimap, selected
      actors, and a multi-tile stationary object.

### Playable-slice integration

- [x] 0.34 Define immutable scenario content and mutable, stable-ID runtime
      state that can round-trip through serialization before mission content is
      locked.
- [ ] 0.35 Add the fixed Command Center, Materials Refinery, Harvester, Field
      Barracks, Trooper, and Scout with data-driven costs and timing.
- [x] 0.36 Implement direct blueprint placement, rotation, the baseline one-slot
      infrastructure queue, construction timers, support coverage, disconnection
      shutdown, cancellation, and resale. Include coverage and connection
      overlays, offline presentation, grouped alerts, and preserved progress.
- [ ] 0.37 Implement finite Materials sites, paid Harvester production, one
      assigned Harvester per Refinery, automated collection and delivery,
      depletion, reassignment, and loot.
- [x] 0.38 Implement five-item production queues, full unfinished-order refunds,
      rally points, and paused progress while disconnected.
- [x] 0.39 Implement unexplored, explored, and visible terrain; actor
      visibility; camera bounds based on exploration; and the north-up minimap
      rules.
- [ ] 0.40 Implement deterministic rifle and wolf combat, Attack Move, health,
      damage feedback, destruction, corpse cleanup, and Command Center defeat.
- [ ] 0.41 Build the compact branching M0 map with weighted rough terrain, one
      lone wolf, the five-wolf den, landmarks, and recovery Materials loot.
- [ ] 0.42 Implement the deterministic, serializable wolf state machine:
      persistent and stable target selection, last-known-position pack alerts,
      pursuit, hard leash, investigation, return, and regeneration.
- [ ] 0.43 Implement the sidebar, top bar, radial context menu, objectives,
      alerts, notifications, explanatory popups, and victory or defeat results.
- [ ] 0.44 Implement manual save/load, restart, rolling quicksave, rolling
      autosave, version validation, and paused inspection after loading.
- [ ] 0.45 Expose every core action through on-screen controls that work in
      compact phone and tablet landscape browser profiles without hover or
      right-click.
- [ ] 0.46 Integrate the required animated textures, skeletal actors,
      articulated buildings, tracer and weapon effects, ambient objects, damage
      effects, construction stages, and resource-depletion visuals.
- [ ] 0.47 Replace the prototype bindings with the locked mouse, keyboard, and
      touch controls; camera presets; smooth Focus and Follow; and
      reduced-motion behavior.
- [x] 0.53 Add a paid Materials economy opening with a fixed Command Center,
      Refinery, Harvester, global stockpile, finite patches, automated delivery,
      depletion feedback, reassignment, ordinary salvage, and building resale.
      Include timed five-item production, cancellation refunds, blocked-exit
      waiting, serializable economy state, and mouse and compact touch checks.

### Playable-slice verification

- [ ] 0.48 Add focused tests for economy, construction support, production, fog,
      combat, wolf AI and its saved state, objectives, save round-tripping, and
      restart reconstruction.
- [ ] 0.49 Add a browser end-to-end check for the complete M0 loop from the
      starting Command Center through victory and post-victory free play.
- [ ] 0.50 Add compact landscape interaction checks using touch-style input and
      no keyboard, hover, or secondary mouse button.

### Complete when

- The browser and Tauri builds run the standalone M0 mission from its fixed ARC
  Command Center through gathering, construction, production, exploration, and
  the six-wolf victory condition.
- Movement, weighted pathfinding, dynamic blockers, fog, combat, interface
  feedback, animation, minimap, and touch-accessible controls satisfy the M0
  rules in [DESIGN.md](DESIGN.md).
- Manual save/load, quicksave, autosave, and restart round-trip authoritative
  mission state or reject incompatible data clearly.
- The mission supports post-victory free play, hard defeat, and player-judged
  soft defeat, and an RTS-familiar first-time player can finish without
  developer guidance.
- Focused tests, the full browser flow, and compact landscape checks pass.
