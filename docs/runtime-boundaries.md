# Runtime extension contracts

[DESIGN.md](../DESIGN.md#technical-direction) owns the simulation requirements.
These contracts describe where new behaviors, views, and services attach.

## Simulation and timing

- Actor behaviors modify their staged actor through `handleCommand` and
  `update`. They cannot call mission mutation, tick, or disposal methods during
  a tick. A violation faults the mission without publishing staged changes.
- Behaviors preserve actor identity, tile placement, and occupancy layer.
  Layer transitions require explicit mission commands.
- Each single-actor command kind has one mission handler; group moves expand
  into per-member moves. Non-object submissions throw before queuing. Objects
  without the structure saves require are rejected at their tick, left out of
  snapshots, and do not reserve creation IDs.
- Loop hooks run outside the simulation transaction. They may queue commands
  or pause the loop. Recursive `advance` calls do no work; a pause invalidates
  the current batch even if its hook immediately resumes.
- Clock intervals and origins must be finite. Returned tick counts and batch
  limits must fit safe integers. Invalid clock input throws before changing
  its accounting; an invalid time source stops the loop through `onFault`.
- Terrain queries expose frozen bounds and copies of heights and the terrain
  catalog. Terrain edits use the validated command and mutation APIs.
- A mission may restrict its playable bounds within the map. Its bounds cannot
  extend outside the terrain used by navigation and vision.
- Support links and placement coverage use only the building's own faction.

## Resource ownership

- [The resource lifetime](../src/lifetime.ts) owns disposable resources and
  cleanup callbacks. Register ownership immediately after creation so a later
  setup failure can release everything already acquired.
- Disposal runs registered callbacks in reverse order, once. A failed cleanup
  does not prevent other registered callbacks from running; disposal reports
  the first failure after cleanup. Resources arriving after disposal release
  immediately.
- A game view owns its engine, scene, canvas listeners, and size watcher. A
  session owns its simulation, controls, views, and loaded assets through the
  scene's lifetime. Model instances release before their shared assets.
- Sidebar setup releases partial controls after failure. Production cards own
  their tooltip and listeners; disposal or parent cancellation releases both.
- Asset collections release after their views; a failed cleanup cannot skip
  the remaining assets.
- Session assets prepare stand-ins before loading starts. Views read their
  catalogs without mutation; `load` starts once consumers exist and returns
  shared completion. Disposal releases late arrivals without publishing them
  or firing callbacks, even while the scene remains alive.
- `disposeAsync` pauses the session and waits for pending model and BRDF loads
  before releasing the engine. A failing `onReady` follows this same path.
  Initialization failures release the partial view and session.
- Releasing a mission clears application references even if disposal fails.
  Application Exit waits for requested save-library writes and deletions.

## Headless preparation

- Mission loading and simulation preparation live in `mission-loading.ts` and
  run without initializing graphics, DOM, or platform services. Session assembly
  consumes the prepared mission and supplies its rendered terrain.
- `content/presentation.ts` owns serializable presentation contracts and their
  validation. Renderer catalogs implement every accepted built-in identifier;
  rendering owns loaded-asset checks, playback, and disposal.
- The player view in `simulation/player-view.ts` owns ownership and
  fog-limited actor lookups. Session views and controls use it instead of
  querying simulation actors directly, so hidden actors stay hidden.

## Content lookup

- Authored IDs identify entries in dictionaries; inherited object properties
  are not content. Use `Map` or own-property checks for lookups.
- Terrain without authored layer rules has no visual layers. Rendering still
  reads its simulation terrain independently of presentation.
