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
- `simulation/authority.ts` decides whether a command's issuer may command
  the actors involved before its handler runs. Handlers and queued orders
  trust that check; its exhaustive policy requires new command kinds to name
  their commanded actors. Only an explicit `script: true` grants script
  authority, and script grants reject unknown fields.
  Session feedback reads only outcomes the player owner issued.
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
- Support links, power, and placement coverage use actor owners and explicit
  scenario sharing under
  [ownership rules](../DESIGN.md#ownership-and-relationships). Roots supply
  only paths through owners they share with. Shared coverage requires access
  to both the covering node and its supplying root; presentation uses the
  same owner-specific projection.
- Simulation rules read actor owners and relationships, not the player owner.
  The exception records the player's perspective: authored objectives decide
  the player's victory or defeat. A defeat freezes the whole mission and
  stops events.
- `simulation/observations.ts` owns each owner's memory and `knowledgeOf`,
  the boundary for what an owner may know beyond its own actors and economy:
  authored site locations, its explored terrain and vision, and its
  sightings. AI planning reads only this view. Player presentation shows
  sites and loot through `knownEconomy`, so others' unseen gathering and
  pickups stay hidden until the player looks again.

## Economy, infrastructure, and growth

- `simulation/cultivation.ts` owns renewable reserves, worker gathering,
  delivery, and interruptions. Regeneration and collection retain integer
  remainders; stable worker-ID ordering allocates the shared reserve without
  overdrawing. Movement, audio, and presentation never advance cultivation.
- `simulation/infrastructure.ts` owns headquarters queues for construction.
  Growth uses its Heartgrove kind without a support chain; other
  construction needs support rooted at the hosting headquarters. Buildings
  retain their headquarters while eligible, including after completion.
  Completed headquarters affiliate with themselves. Eligible active jobs keep
  their slots; blocked jobs yield without losing payment, progress, or queue
  priority. The scenario's emergency rule runs one replacement headquarters
  per owner without capacity or support. Completed Circle buildings have no
  support-network dependency.
- `simulation/growth.ts` owns tending: candidate workers, the tending route,
  and releasing the worker when growth completes.
- `simulation/worker-navigation.ts` resolves reachable building entrances and
  advances automatic routes for harvesting, cultivation, and tending. Callers
  choose arrival distance and work-specific blocked states. Reachability
  reads cached navigation regions; only route starts search for a path.
  Placement tests a prospective footprint through a read-only occupancy
  adapter, preserving the published navigation state.
- `simulation/resources.ts` maps each common resource to its price field and
  display name. Prices, the sidebar, and the top bar read that table; the top
  bar shows the player faction's resource.
- `simulation/stockpiles.ts` owns owner balances, deliveries, and pools.
  Affordability, payment, and refunds use the paying owner's stockpile. An
  owner without a stockpile of a resource cannot fund a job, even at zero
  cost. Pools follow `sharesResources` and regroup whenever sharing changes.
- `simulation/economy.ts` owns workers, sites, gifts, and production.
  `enrollWorker` creates worker state from an actor's definition. Shared
  queries expose sites, compatible workers, and outstanding automatic orders;
  explicit actor commands interrupt either worker type without losing cargo.
  Building loss cancels affected automatic routes. Cultivators retain delivery
  work and queued orders while selecting a replacement drop-off.
- Workers tend and deliver only to their owner's buildings; training inherits
  the producer's owner.
  Harvesters choose explored sites using their owner's last-seen yields.
  Unknown yields can be investigated; unseen depletion does not cancel a
  route. Gathering uses the actual yield once the worker reaches the site.

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
- `ui/dom.ts` mounts feature markup or binds an existing root with shared
  cleanup, abortable listeners, and scoped element access. Failed setup keeps
  its original error while reporting cleanup faults and releasing resources.
- Dialogs own menu and guide markup, focus, pause restoration, panel requests,
  and child audio controls. Reset closes modals and cancels pending loads
  before session replacement without resuming the departing mission. Panel
  revisions suppress late UI work; storage writes still finish in order.
  Disposal releases global audio listeners and status subscriptions without
  disposing the application-owned mixer.
- Delivered world keys check visibility and blocking overlays without requiring
  `document.hasFocus()`, which browsers can misreport. Pointer input and
  continuous navigation retain their focus checks.
- Asset collections release after their views; a failed cleanup cannot skip
  the remaining assets.
- Transient combat effects have a fixed instance budget. Bursts evict the
  oldest effects; expiration and disposal release instances once. Disposed
  views ignore new hits and markers. Loaded idle clips drive effect animation
  and hold their first pose under reduced motion.
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
- `simulation/player-view.ts` owns ownership and fog-limited actor lookups.
  Sidebar actors are owned or detected; private workers, income, production,
  and balances belong to the player, including explicitly shared balances.
  Support overlays include only usable, owned or detected buildings and links
  between them. Session views and controls use these projections; simulation
  and world-animation consumers retain live state, except that only the
  player's production queues sound.

## Content lookup

- Authored IDs identify entries in dictionaries; inherited object properties
  are not content. Use `Map` or own-property checks for lookups.
- Terrain without authored layer rules has no visual layers. Rendering still
  reads its simulation terrain independently of presentation.
