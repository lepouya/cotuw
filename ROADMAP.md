# Roadmap

This document tracks milestones and implementation work. Record design decisions
in [DESIGN.md](DESIGN.md). Task IDs show their milestone and insertion order;
they do not prescribe completion order.

## Milestone 0: Foundations

**Goal:** Establish the game's minimal player experience and a working movement
proof of concept.

### Design

- [ ] 0.1 Define the initial player fantasy, scenario, and immediate objective.
- [ ] 0.2 Define the smallest core loop and vertical-slice boundary.
- [ ] 0.3 Record the resulting decisions in [DESIGN.md](DESIGN.md).

### Codebase

- [x] 0.4 Scaffold the Tauri 2, Vite, TypeScript, and Babylon.js application.
- [x] 0.5 Establish small module boundaries for simulation, rendering, and
      platform services.
- [x] 0.6 Add the basic development, type-checking, and build commands.

### Proof of concept

- [x] 0.7 Run the game in a browser and the Tauri development shell.
- [x] 0.8 Render one small map with a strategy camera.
- [ ] 0.9 Render one controllable actor with basic selection feedback.
- [ ] 0.10 Accept a movement command and move the actor to its target.

### Terrain and map content

- [ ] 0.11 Define data-driven terrain-animation clips: frame sequence, frame
      timing, playback mode, and per-layer texture source.
- [ ] 0.12 Render frame-based terrain texture animation without changing the
      deterministic terrain state.
- [x] 0.13 Keep scrolling UV effects available independently for layers that
      need them.
- [ ] 0.14 Create a movement-test map with hills, cliffs, and paths.
- [ ] 0.15 Define which slopes, cliffs, and path surfaces are traversable for
      the prototype actor.
- [ ] 0.16 Make that map data-driven and loadable without renderer-specific
      state.

### Actors and movement

- [ ] 0.17 Define the prototype actor's simulation state, movement properties,
      target command, and deterministic update rules.
- [ ] 0.18 Render a visible vehicle-like actor at its simulated world position.
- [ ] 0.19 Accept a player target command for the selected actor and move it
      along a valid path to that target.
- [ ] 0.20 Provide path finding that respects the test map's traversability and
      reports unreachable targets clearly.
- [ ] 0.21 Define actor animation clips for skeletal animation and texture-frame
      animation, including their simulation-facing state.
- [ ] 0.22 Render both animation types on prototype actors without coupling
      animation playback to simulation timing.

### Structures and selection

- [ ] 0.23 Define footprint data for stationary objects that occupy one or more
      tiles, including placement origin, occupied tiles, and blocking behavior.
- [ ] 0.24 Render one multi-tile building or stationary object aligned to its
      footprint and terrain.
- [ ] 0.25 Include occupied structure tiles in placement and path-finding
      constraints.
- [ ] 0.26 Add selection state and visual feedback for individual actors.
- [ ] 0.27 Support selecting multiple actors by additive selection and drag-box
      selection.
- [ ] 0.28 Issue a target command to every selected actor, with destinations
      resolved so the group does not converge on one tile.

### Interface

- [ ] 0.29 Define the minimap's information, camera-frustum treatment, and
      input behavior for the prototype.
- [ ] 0.30 Render a corner minimap showing terrain, stationary-object
      footprints, actors, current selection, and the camera viewport.
- [ ] 0.31 Support minimap navigation while keeping it independent of
      simulation state.

### Verification

- [ ] 0.32 Add focused tests for terrain-animation data, path finding, actor
      movement, multi-tile occupancy, and group command destination assignment.
- [ ] 0.33 Add a browser visual check covering the test map, minimap, selected
      actors, and a multi-tile stationary object.

### Complete when

- The proof of concept runs locally, and a player can navigate the
  hills-and-cliffs test map, select one or multiple vehicle-like actors, and
  give them reachable movement targets from the world or minimap.
- Actors animate through both skeletal and frame-texture techniques, terrain
  supports frame-based animated textures in addition to scrolling effects, and
  paths account for terrain and multi-tile stationary objects.
- The Milestone 0 design decisions are recorded in [DESIGN.md](DESIGN.md).
