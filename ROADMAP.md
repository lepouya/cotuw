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
- [ ] 0.5 Establish small module boundaries for simulation, rendering, and
      platform services.
- [x] 0.6 Add the basic development, type-checking, and build commands.

### Proof of concept

- [x] 0.7 Run the game in a browser and the Tauri development shell.
- [ ] 0.8 Render one small map with a strategy camera.
- [ ] 0.9 Render one controllable actor with basic selection feedback.
- [ ] 0.10 Accept a movement command and move the actor to its target.

### Complete when

- The proof of concept runs locally, and a player can select the actor and move
  it around the map.
- The Milestone 0 design decisions are recorded in [DESIGN.md](DESIGN.md).
