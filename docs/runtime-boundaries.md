# Runtime extension contracts

[DESIGN.md](../DESIGN.md#technical-direction) owns the simulation requirements.
These contracts describe where new behaviors, views, and services attach.

## Module dependencies

- Imports between `src/` directories run one way. `simulation` and `platform`
  import no other directory, `content` imports only `simulation`, and `audio`
  and `render` import neither `ui` nor each other.
- `src/` has no value-import cycles. Cycles through `import type`, such as those
  around `simulation/actor.ts`, have no runtime effect and do not justify
  splitting a module.

## Simulation and timing

- Actor behaviors modify their staged actor through `handleCommand` and
  `update`. They cannot call mission mutation, tick, or disposal methods during
  a tick. A violation faults the mission without publishing staged changes.
- Behaviors preserve actor identity, owner, tile placement, and occupancy layer.
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
  Session feedback reads only outcomes the player itself issued.
- Tick observers (`observeTicks`) run before and after every tick, whichever
  driver ticks: the real-time loop, a headless runner, or a benchmark. They
  run outside the transaction and may queue commands but not tick or dispose.
  Their errors propagate from `tick` without faulting the mission.
- `simulation/director.ts` plans for the owners a scenario assigns to AI. The
  mission runs it after `beforeTick` observers and before selecting due
  commands, so every driver and loaded save runs it, and its commands apply in
  the same tick with the owner and `ai` as issuer. Planning and command execution share
  the tick transaction; either failing restores the committed state and faults
  the mission. Concerns cannot call mission mutation, tick, or disposal methods.
- Director concerns are built-in code that profiles name by ID, registered in
  `simulation/ai-concerns.ts` with the shared ones; sessions use that registry
  unless a caller supplies concerns. Faction plans such as
  `simulation/arc-concerns.ts` build on `simulation/ai-planning.ts`. Group
  operations run through `simulation/ai-operations.ts`; a concern saves each
  in its memory's `operations` list, which diagnostics read. Operations keep
  their home rally separate from temporary regrouping points.
  `simulation/ai-recovery.ts` keeps a reserve for restoring income and
  switches between recovering and developing as the base loses and regains
  its headquarters, income, or army production. Income plans own all worker
  training; defense controls when its posture ends. Each concern receives
  `viewOf(owner)`, the authored terrain, and no route to the simulation.
  Rounds, concern turns, and commands use counted per-tick limits, never
  elapsed time. A concern's saved
  memory must stay JSON, and it learns of refused commands on its next turn.
  Each owner generates IDs from its saved sequence without reading other
  owners' actors. A concern can name only actors its view shows, its own paid
  orders, and IDs it generated, so a refusal cannot reveal a hidden actor.
  Allied AI owners that pool resources each budget the whole balance, and the
  first listed spends it first. A concern with nothing left to buy releases
  its savings, or those beyond a reserve, for the next reconciliation to
  share by weight. `state.ai` holds budgets and claims;
  [faction strategy](../DESIGN.md#faction-strategy) owns their rules.
  `simulation.ai` exposes it read-only for reports and
  development tools.
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
  Results express the player's perspective. Campaign objectives track authored
  actors; skirmish rules count qualifying completed buildings for both named
  owners after commands, combat, and construction. A skirmish verdict commits
  with the final metrics checkpoint and freezes the mission; campaign defeats
  also stop play and events, while campaign victories allow free play.
- `simulation/match-metrics.ts` records exact per-owner counters and milestones
  from staged payments, refunds, deliveries, production, completion, and
  combat. Production records peaks before a same-tick loss can hide them.
  Histories share immutable samples without traversing them each tick. The
  verdict and final sample commit together after knowledge and active vision
  update. This omniscient reporting data stays outside owner views.
- `spawnActor` and `removeActor` are test setup hooks that no runtime code
  calls. In a skirmish they work only at tick 0. Live skirmish changes use
  commands so every snapshot retains the end-of-tick elimination checkpoint.
- `simulation/observations.ts` owns each owner's memory and its
  `OwnerKnowledge`: what an owner may know beyond its own actors and economy,
  meaning authored site locations, its explored terrain and vision, and its
  sightings. AI planning reads only `viewOf(owner)`, which carries it.
  Player presentation shows sites and loot through `knownEconomy`, so
  others' unseen gathering and pickups stay hidden until the player looks
  again.

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
- `simulation/production.ts` owns paid production queues: admission,
  payment-backed orders, advancing each producer's first order, exits,
  cancellation, producer loss, and saved-queue validation. A Refinery holds
  one Harvester, fielded or paid. `simulation/economy.ts` runs the queues
  during its update and enrolls produced workers.
- `simulation/economy.ts` owns the shared worker rules, sites, and gifts.
  `enrollWorker` creates worker state from an actor's definition. Shared
  queries expose sites, compatible workers, and outstanding automatic orders;
  explicit actor commands interrupt either worker type without losing cargo.
  `simulation/harvesting.ts` and `simulation/cultivation.ts` own each worker
  type's state, commands, updates, and validation.
  Building loss cancels affected automatic routes. Cultivators retain delivery
  work and queued orders while selecting a replacement drop-off.
- `simulation/order-queue.ts` owns which orders can wait, when an actor counts
  as busy, and queuing behind its current order. `simulation/mission.ts` starts
  queued orders through the normal command handlers.
- `simulation/cargo.ts` preserves ordered resource-source amounts, including
  fractional cultivation, independently of workers' current orders and sites.
  Both economies consume provenance on delivery before recording income.
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
- `TerrainMap` in `map.ts` extends `TerrainGrid`, so a session gives the
  simulation one grid whose terrain commands update rendered views, without
  copied arrays or forwarded methods. Headless preparation builds a plain
  `TerrainGrid` and never imports `map.ts`.
- `content/presentation.ts` owns serializable presentation contracts and their
  validation. Renderer catalogs implement every accepted built-in identifier;
  rendering owns loaded-asset checks, playback, and disposal.
- `simulation/owner-view.ts` owns `viewOf(owner)`, the projection that player
  presentation and AI planning share. Own actors are committed state, except
  that a latest hit names its attacker only while the owner detects it.
  Detected others show pose, health, construction progress, turret aim,
  recent combat, territory mode, and an attack on an actor the owner also
  sees. Their orders, routes, Attack Moves, rally points, headquarters links,
  and payments stay private. Private workers, income, production, and
  balances belong to the owner, including explicitly shared balances.
  Support overlays include only usable, owned or detected buildings and links
  between them. Remains follow the same rule: own, or currently detected.
  `workingIds` and `offlineIds` name shown actors that are visibly working or
  cut off from support, whoever owns them. The view also holds the placement,
  training, rally, and tending checks, which answer only for the owner's own
  actors and use its knowledge. These checks exist only on the view.
  `simulation/owner-rule-world.ts` builds their occupancy and navigation from
  shown actors and remembered building footprints without changing live
  occupancy or navigation versions. Mobile sightings do not block routes.
  Shown footprints take precedence over memories, and newer memories over older
  overlapping footprints. Authored site locations stay reserved until Materials
  are known depleted. Salvage uses last-seen pickups, and debris uses shown
  remains. Hidden actors, retired IDs,
  and foreign paid orders do not reserve preview IDs.
  `simulation/rule-checks.ts` shares rule calculations between these advisory
  previews and authoritative staged command validation. A preview can pass
  while execution rejects an unseen obstruction, including a tending worker's
  route; rejection spends nothing, keeps the worker's job, and does not name the
  hidden actor. These derived queries add no save state.
  Session actor views, controls, alerts, audio, health bars, and damage and
  regeneration effects use these projections. Hit and building activity events
  name hidden actors too, so consumers resolve participants through the view.
  The wreck view keeps hidden remains undrawn, so a building's captured top
  height survives until they come back into view.

## Content lookup

- Authored IDs identify entries in dictionaries; inherited object properties
  are not content. Use `Map` or own-property checks for lookups.
- Terrain without authored layer rules has no visual layers. Rendering still
  reads its simulation terrain independently of presentation.
