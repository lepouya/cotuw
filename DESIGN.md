# Design

This is the living design source of truth. Keep entries concise; add detail only
when it informs a prototype, implementation, or content decision.

## Vision

_Citadels of the Unquiet World_ is an approachable science-fantasy real-time
strategy game. Players build bases, control territory, assemble combined-arms
forces, and fight across a living world that becomes progressively more hostile.
The title remains tentative until a formal trademark review is warranted.

## Setting and story

Humanity is beginning interstellar exploration when an alarming signal draws the
Anomaly Response Command to a damaged frontier world. ARC encounters the Circle
of Repose, an elven pilgrimage that arrived first in response to a prophecy
commanding it to quiet the Unquiet.

Neither expedition initially understands the world's citadels, lost caches, or
ancient inhabitants. ARC seeks to secure and exploit them; the Circle believes
they are essential to its pilgrimage. Each side first treats the other as the
central antagonist.

The mid-to-late campaign reveals the Everwake: ancient inhabitants who changed
themselves into deathless demonic forms, devastated their world, and were
imprisoned by the citadels. They call their transformation ascension and call
the player the Chainbearer. ARC and the Circle must eventually cooperate against
the crisis their conflict helped release.

## Gameplay pillars

1. **Readable combined-arms warfare** — classic base building, production,
   scouting, counters, and positional tactics.
2. **Meaningfully asymmetric factions** — factions differ in economy,
   infrastructure, mobility, defense, and battlefield tools.
3. **A living hostile world** — ancient sites, unstable wards, corruption, and
   world events create strategic decisions beyond attacking the opponent.
4. **Approachable strategic depth** — scouting, planning, and map control
   matter more than extreme actions-per-minute.
5. **Small playable core first** — expand only after the basic RTS loop is
   fun.

## Requirements and scope

- 3D world with an isometric/top-down strategy camera.
- Visual readability over photorealism.
- Desktop first: Windows and macOS through Tauri.
- The core remains browser-runnable. M0 also validates compact phone and tablet
  landscape browser layouts with touch-style input.
- Linux/SteamOS and native Android and iOS builds are future targets.
- Eventual small-session multiplayer, roughly 2-8 players; no massively
  multiplayer features.
- Data-driven game content to support balancing, campaigns, and eventual mods.
- Original setting, names, art, and lore.

## Technical direction

- Native packaging: Tauri 2
- Web build: Vite
- Package manager: npm
- Language: TypeScript
- 3D rendering: Babylon.js
- Model geometry, materials, skeletons, and animations are generated offline
  into glTF 2.0 binary assets (`.glb`). Texture files, including sprite sheets,
  are generated offline into PNGs. Seeded generators are the source of truth;
  committed output must match them. No hand-authored binary art is required.
- Infantry and wolves use skeletal GLBs; vehicles and building machinery may
  use articulated node clips. Content packs reference the generated files.
  Terrain heightfields and placement transforms remain map-dependent rendering
  geometry; interface overlays remain renderer-owned.

The core game remains browser-runnable. Tauri-specific functionality must stay
behind platform-service boundaries so simulation, rendering, and UI remain
portable.

The simulation advances in fixed ticks counted from real time, independent of
rendering. Players, NPC AI, and mission scripts change actors only through
serializable commands queued for the start of the next tick. Rendering
interpolates between immutable states from the last two committed ticks. A tick
commits actor, footprint, and terrain state atomically; invalid behavior output
permanently faults the simulation and restores the last committed state.

## Mission terminology

- A campaign is a faction's long-form narrative and progression.
- A story point is a campaign beat that may contain dialogue, choices, and one
  or more missions.
- A mission is one authored, playable scenario. It owns objectives, scripts,
  result, free play, saves, restart, and replay.
- A scenario is the immutable authored setup from which a mission starts.
- A session is one continuous runtime instance of a mission. It is not the
  general name for playable content.

## Core mission

The traditional RTS loop is to establish a base, gather resources, construct
production, train forces, scout, expand, and defeat mission opposition. The
world may also contain neutral or local forces, unknown structures, objectives,
and environmental pressure rather than only conventional faction bases.

Resource denial is a strategy for both players and faction AI: disrupting
gatherers, delivery buildings, or resource access reduces future spending and
reinforcements. Existing stockpiles and forces remain available, so income loss
does not automatically end an offensive.

## Factions

### Anomaly Response Command

ARC is the human military expedition sent to investigate the signal. Its
identity centers on machines, explosives, artificial intelligence, disciplined
organization, industry, and connected infrastructure. Its campaign addresses the
player as **Commander** and is the recommended first campaign.

Its selected early names are **Command Center**, **Materials Refinery**,
**Harvester**, **Field Barracks**, **Trooper**, **Scout**, **Medic**, and
**Mechanic**.

### Circle of Repose

The Circle is an elven pilgrimage, not all elven civilization. The elves are a
post-industrial, interstellar people attuned to nature; their ships, structures,
and vehicles are alive. The Circle cultivates rather than extracts and addresses
the player as **Guide** or **Guide of the Circle**. Its campaign is intended for
players with more RTS familiarity.

Its selected parallel names are **Heartgrove**, **Lifebloom Conservatory**,
**Cultivator**, **Sentinel**, **Wayfinder**, **Healer**, and **Artificer**.

### The Everwake

The Everwake are the concealed world antagonists and remain non-playable. ARC
and the Circle do not initially know what the Unquiet are. The Everwake's
identity, self-name, and demonic nature are revealed only in the middle or later
story.

## Economy and construction

- The full game uses three parallel resource roles with faction-specific names
  and collection presentation.
- ARC's common resource is **Industrial Materials** or **Materials**; the
  Circle's is **Lifebloom** or **Bloom**.
- ARC's rare resource is **Strategic Catalysts** or **Catalysts**; the Circle's
  is **Ley Resonance** or **Resonance**.
- The exotic Everwake resource remains hidden until the story reveal and has no
  selected name yet.
- One worker gathers both common and rare yields from data-driven sites: ARC's
  **Harvester** returns to a **Materials Refinery**, while the Circle's
  **Cultivator** returns to a **Lifebloom Conservatory**.
- Resources use unlimited global faction stockpiles. Deposited resources are not
  tied to storage buildings and survive building loss.
- ARC places paid blueprints directly within construction support. No builder
  unit is required. Cancelling unfinished construction gives a full refund.
- Completed ARC buildings require an unbroken support chain to the **Command
  Center**. Disconnected buildings stop operating, extending support, and
  providing active vision; interrupted work pauses with progress preserved.
- Buildings and fully deployed mobile structures may be sold. Mobile units and
  vehicles may not. The refund is half the resources invested in construction
  and completed installed upgrades, multiplied by the current-health fraction
  and independently rounded down for each resource. Campaign unlocks do not
  count as investment.

## Repair and healing

- ARC uses a **Medic** for human units and a **Mechanic** for mobile machines
  and vehicles. The Circle uses a **Healer** for biological units and an
  **Artificer** for mobile living constructs and vehicles.
- Support units are unarmed. They automatically service a nearby eligible unit
  while idle, or prioritize a manually selected target, and consume no faction
  resources.
- One support unit services one target at a time, and only one provider may
  service a target. It must stop within range; a moving target may be followed
  within a limited pursuit distance.
- A building uses contextual **Repair** without a builder. Repair restores 1% of
  maximum health per second and charges each tick before applying health.
- Repairing 100% health costs 50% of the building's original common-resource
  cost. Each job costs that amount multiplied by its starting missing-health
  fraction and never uses rare or exotic resources.
- Unaffordable or disconnected repair pauses and later resumes. Cancellation
  keeps restored health because unpaid future ticks require no refund.
- Construction and building repair share a faction-wide infrastructure pool. A
  faction has one baseline slot; ARC Command Center upgrades may add slots.
- Deployable actors have a stable unit-serviced or infrastructure-serviced
  policy that never changes with mode. Infrastructure repair requires the actor
  to be fully deployed and connected or operating as a network root.
- Player actors have no universal passive regeneration or standard recovery
  structure. Actor, upgrade, aura, or scripted regeneration is an explicit
  exception and updates the veterancy damage ledger normally.
- Destroyed actors are not repaired, healed, or revived by these systems.

## Building upgrades

- Upgrades are installed on individual building actors through their context
  menu or sidebar. Building types have a finite, data-driven number of tiers,
  and some buildings have no upgrades.
- Tiers form a strictly linear sequence and require the preceding tier. There
  are no mutually exclusive building-upgrade branches; broader branching choices
  belong to the separate research system.
- Upgrades never change a building's tile footprint, anchor, orientation, or
  collision. They may add visible modules, animation, lighting, textures, and
  other tier details. The installed tier appears in the sidebar and beside the
  building's world-space health or status display.
- A transformation requiring a different footprint is a separate building type
  rather than an upgrade tier.
- Campaign progression unlocks the maximum tier available for each building
  type. Installed upgrades remain local to the current mission and do not carry
  into later missions; a mission script may explicitly place an upgraded
  building.
- Replacements begin unupgraded unless scripted. Deployable buildings retain
  their installed upgrades when changing modes.
- An upgrade may improve its building or provide a faction-wide capability while
  that building remains operational. Selling or destroying the building removes
  its installed effects.
- Command Center upgrades may add infrastructure slots or construction range;
  Barracks upgrades may unlock advanced units; Radar upgrades may extend range
  or add detectable kinds. Building upgrades remain distinct from permanent
  research and technology-tree progression.
- Mission saves store installed tiers and in-progress upgrade state. Campaign
  saves store the maximum tiers unlocked by campaign progression.
- The full upgrade cost is paid when it enters the shared infrastructure queue.
  Active upgrading consumes one slot, while waiting work does not. Each building
  may have only one waiting or active upgrade.
- A completed building cannot have repair and upgrade work waiting or active at
  the same time. Starting either requires cancelling the other under its normal
  cancellation rules.
- A building operates at its last completed tier during upgrading. New effects
  apply only at completion. Disconnection pauses the work and yields its slot;
  damage does not interrupt it.
- Completing any upgrade fully restores the building to its current maximum
  health. A tier may explicitly change maximum health; an unusual reduction
  clamps current health to the new maximum. Cancelling provides no healing.
- Upgrades do not increase the repair-price basis. A full repair continues to
  cost 50% of the base common-resource construction cost. Upgrade spending
  increases resale investment but not repair price.
- Cancelling an unfinished upgrade gives a full refund and preserves the last
  completed tier. Selling or undeploying requires cancellation first.
  Destruction loses the paid upgrade cost.
- Infrastructure-capacity changes apply immediately. If active work exceeds the
  new limit, the oldest jobs continue and newer excess jobs pause with their
  progress, payment, and original priority preserved. A stable job ID resolves
  equal-time ties, and one grouped warning reports the capacity loss.
- Upgrades are excluded from M0. Individual building tiers, effects, costs,
  timing, and presentation remain later content and balance work.

## Mod support

- Initial mod support covers data and content: units, buildings, upgrades,
  factions, balance, maps, campaigns, objectives, visual assets, audio, and
  localization. Base-game content uses the same public schemas wherever
  practical.
- Mods author mission behavior through deterministic, sandboxed events and
  actions. They cannot run arbitrary JavaScript or native code, access
  unrestricted platform services, or initially provide unrestricted interface
  extensions.
- The public mod schema is a living compatibility contract that must be
  revisited as game data evolves without weakening deterministic simulation,
  save compatibility, browser portability, or security.
- Single-player provides a modding console, bound to backtick by default and
  rebindable, with an on-screen Advanced or Developer menu alternative. Opening
  it pauses by default. It provides history, autocomplete, help, and clear
  errors while exposing approved inspection and deterministic command APIs,
  never an unrestricted code or operating-system shell.
- Read-only console use has no progression consequence. The first state-changing
  command warns the player and permanently marks that mission session and its
  derived saves as modified. Those saves remain usable but cannot award official
  completion, achievements, or progression unlocks; returning to a clean save or
  restart restores eligibility.
- A mod may be an ordinary directory during development. Distribution uses a
  ZIP-compatible `.cotuwmod` archive with a required manifest containing its
  stable namespaced ID, metadata, semantic version, license, compatibility
  ranges, dependencies, conflicts, and content roots.
- Package paths cannot escape the package boundary. Browser and desktop builds
  use the same format, validate before activation, and leave invalid packages
  installed but disabled with actionable errors.
- Package format is independent of distribution source, allowing local files, a
  future workshop, and third-party repositories to distribute the same bundle.
- Mod support and the deferred map editor remain independent features.

## Controls and interface

- Primary click selects or issues the contextual default command. Clicking a
  selected actor keeps it selected. Primary drag box-selects friendly mobile
  units. Shift-click toggles individual units; Shift-drag adds boxed units.
  Buildings remain individually selected and cannot join a mobile group.
- Stop cancels selected mobile actors' orders without clearing selection.
  Clear removes selection without changing orders. Selection is client UI state.
- Shift-commands, and commands in the touch Queue Orders mode, append Move,
  Attack Move, Attack, Gather, and Collect orders to each selected unit's
  queue; Done leaves the mode, and a queued Attack Move target keeps Attack
  Move mode open. Accepted unqueued commands and Stop replace the current
  order and clear the queue. A unit starts its next order at the start of the
  tick after its current one ends; a blocked route counts as ended, and a
  rejected order gives way to the next. Harvesting continues until its site
  runs out, so orders behind a Gather wait until then. Units cannot queue
  orders they could never carry out, such as an unarmed attack. Queues are
  saved mission state.
  Selected units preview them as dashed legs with rings at destinations,
  crosses on attack targets, and diamonds on Gather sites.
- Touch and on-screen controls provide persistent Box select and Add units
  modes. Box select must be disabled before a terrain tap issues movement.
- Secondary click opens a radial context menu. Secondary drag pans; Shift plus
  secondary drag rotates. Every secondary action has an on-screen alternative.
- The radial menu rings the clicked point with the target's applicable commands.
  The primary click's default comes first and is highlighted: Attack for
  detected hostiles with movers selected, Select and Add to or Remove from group
  for actors, Move with Attack Move for ground, and Clear selection when nothing
  selected can move or commands wait for resuming. Actor targets end with
  Focus, and Follow for mobile actors. Move reads Gather on a
  Materials site for a selected Harvester and Collect on salvage; in a mixed
  group, Harvesters gather while the other units move there. An action, Escape,
  or a press outside closes it. A world press that closes it issues no command,
  and Escape closes it before clearing selection. It also opens in Pan mode.
- Pan mode reserves primary and one-finger world gestures for navigation,
  preserving selection and pending commands. In Pan mode, scrolling pans;
  Ctrl-scroll zooms. Outside Pan mode, scrolling zooms.
  Pan mode keeps a chosen construction footprint fixed.
- When the world is focused, Space plus primary drag temporarily pans, and
  arrow keys pan continuously. Escape exits Pan mode before clearing selection.
  Keyboard navigation stops on lost focus; direct pans have no momentum.
  World shortcuts yield to form fields and dialogs. Losing window focus or
  hiding the page abandons gestures and held navigation keys.
- Mouse hover pans within 16 pixels of a world-view edge after a short dwell.
  Corners pan diagonally at the same screen speed. Edge panning is enabled by
  default and has an on-screen toggle. It stops over controls, outside the
  world, during pressed-button gestures, in dialogs, and on lost window focus.
  Touch and pen input never start edge panning.
- Touch uses taps, one-finger empty-world panning, explicit box-selection and
  queued-order modes, and on-screen camera controls.
- Building placement shows a semi-transparent model at its proposed position
  and orientation alongside the terrain footprint and placement validity.
- Move, Attack, Attack Move, Clear, Gather, Collect, Board, Unload, Focus, and
  Follow appear only where applicable and use shape as well as color.
- A selected mobile actor with an active route shows a ground-hugging dotted
  path to its resolved destination. If that destination differs from the
  requested point, the requested point uses a distinct blocked marker. A
  rejected move order briefly shows the same marker at its target.
- The camera provides orthographic Isometric, Top-down, Grid, and Reset View
  presets. Isometric faces the nearest diagonal and Grid the nearest cardinal
  direction at the default pitch, breaking ties toward Rotate right. Top-down
  looks straight down with north up. Reset View restores the default pitch and
  heading. Presets keep the focal point and zoom.
- A View button beside the camera cluster opens the presets and closes after
  one is chosen, an outside press, or moving focus elsewhere. Escape closes
  this popup before acting on the world selection. Rotate left and right turn
  a quarter turn between the active preset's headings, or by 22.5 degrees
  without one. Manual rotation or tilt leaves the preset.
- Preset, focus, and rotation changes ease over 0.3 seconds unless reduced
  motion is enabled; conflicting rotation or tilt input interrupts them.
- Focus glides to the selection's center. Follow keeps easing toward the
  center of the mobile actors it started with. Panning, another focus, or
  Escape ends Follow, and Escape ends a focus glide or Follow before clearing
  selection; zoom, rotation, and presets do not end it. Follow ends where
  its actors were last shown once all are gone or undetected. The sidebar's
  selection controls and the radial menu on actors offer both.
- Initial and reset views look 22.5 degrees east of north (NNE).
- Camera zoom is measured in visible tile rows so framing is independent of map
  and tile size. New views show roughly 24 rows or fit a smaller map; resizing
  preserves the player's zoom.
- The left sidebar uses Selection, Buildings, Units, and Goals tabs. It owns
  selection details, contextual actions, construction and production, queues,
  and a keyboard-free Cancel action.
- The top bar owns the game menu, resources, objectives, alerts, elapsed mission
  time, and single-player pause and speed controls. The left holds Menu, Pause,
  and ½×, 1×, and 2× speed. The center shows the first unfinished victory
  objective with progress, or the result, and opens Goals. The right shows
  Materials, elapsed simulation time, and the alert history toggle with its
  unread count. Compact screens reduce the objective and resource label to
  symbols. Speed changes only how many fixed ticks run per real second;
  missions start at 1×. Changing speed preserves fractional tick progress.
- Alerts report attacks, losses, completed construction and training, units
  whose routes become blocked, disconnected and reconnected buildings, and
  objective results. They appear as brief non-modal toasts and stay in the
  alert history; entries with a location glide the camera there. Hits on the
  same kind of target, Harvester, building, or unit, form one attack until 15
  simulated seconds pass without one. Attacks, losses, failures, and
  disconnections are high priority, and Harvester attacks also pulse on the
  minimap. Normal toasts yield space to active high-priority alerts. Alerts
  derive from committed state and never pause simulation.
- Scenario popups explain a mechanic the first time their trigger holds: while
  placing a building type, or once the player owns a completed actor type. A
  popup pauses single-player until dismissed and keeps an active placement.
  Actor triggers are checked after committed ticks, independently of rendering.
  Dismissals are mission state, so loading never repeats one and restarting
  shows them again.
- The game menu pauses a single-player mission and offers Save, Quicksave,
  Load, Restart, and Exit; its Load panel lists saves and imports files. F5
  quicksaves, F9 loads the quicksave, and F10 opens the menu.
- The minimap is north-up, distinguishes explored terrain from current vision,
  respects detection, supports camera navigation, and accepts commands only in
  an explicit command mode.

## Maps and world systems

- Mobile units use continuous world positions; the tile grid defines terrain,
  pathfinding, building placement, and stationary footprints.
- Heightfield terrain uses a shared grid of corner heights. Each tile has an
  ordered stack of color- or texture-backed visual layers with independent RGBA
  tint and optional edge feathering. A layer may pin itself to a fixed slot so
  that layers only some tiles carry do not shift the stack out of alignment
  between neighbors. Tile and map-boundary lines are optional debug overlays.
- Terrain textures repeat by wrapping, so generated tiles must have matching
  opposite edges. Vegetation layers fade out on steep grades to avoid stretching
  blades over cliff faces, and a rock layer fades in to cover hillsides and
  cliffs. Slope fading changes rendering only.
- Tile type IDs resolve one canonical visual definition. Conflicting definitions
  with the same ID are invalid content.
- Scrolling textures and frame-based texture clips are rendering effects and
  do not enter deterministic terrain state. A content pack's clips play cells
  of a sprite sheet laid out as an equal grid, numbered row by row. Each frame
  names its cell and duration, and a clip loops, ping-pongs without repeating
  its end frames, or plays once and holds its last frame. A tile type names a
  clip and its sheet, and may lag each tile's playback by its position so
  motion rolls across the terrain; lags round to eighths of a cycle. Reduced
  motion holds the first frame. Generated sheets come from scripts that tests
  check against the committed images.
- A mission owns its simulation terrain: corner heights and tile terrain. They
  change only through terrain commands at the start of a tick, so saves and
  replays capture every edit. A terrain command applies whole or is rejected.
- Terrain changes report affected tile bounds. Renderers batch those reports by
  frame and rebuild only affected chunks while preserving shared material and
  texture state.
- Terrain provides per-profile passability, slope limits, and movement costs.
  Routes minimize estimated travel time and recalculate when blockers change.
  - A tile's terrain type sets its cost or blocks it for each profile. A map
    declares its terrain types, and edits cannot introduce undeclared ones.
    Every declared type must be priced by every profile that moves on it.
    Slope up to the profile's limit raises cost linearly; steeper tiles are
    blocked unless authored as passable. Out-of-bounds tiles block every
    profile.
  - Routes step between the eight neighboring tiles, and a diagonal step needs
    both tiles beside it passable. The route is then straightened wherever a
    direct segment crosses only passable tiles and is no slower.
  - An actor on an edge or corner shared with a passable tile stands on that
    tile. An actor standing on a blocked tile may step off it to a neighbor.
  - A target the actor cannot reach resolves to the reachable tile closest to
    it. If no tile is closer than the actor's own, a new order is rejected and
    any current order continues. A recalculated order finishes at the center
    of the actor's own tile only if that tile was already its destination;
    otherwise it waits as blocked.
  - A route recalculates when a navigation change touches it. Blocked orders
    and orders that stop short of their target recalculate after any
    navigation change. A route that meets a blocker its checks missed
    recalculates once that tick, then waits as blocked. Presentation-only
    terrain edits are not navigation changes.
- A group move is one serializable command resolved at the start of a tick.
  Units receive distinct reachable tile-center destinations near the requested
  point, using their own profiles and occupancy layers. Stable actor IDs order
  assignment; distance to the click, distance to the unit, then tile order break
  slot ties. Units retain their own speeds rather than waiting for the group.
  Destinations avoid unselected units and assigned same-layer destinations.
  An actor without an available destination keeps its current order. An
  unreachable click uses separate approach positions and blocked-target
  feedback; an approach position must be nearer the click than the unit is.
- Movement definitions author a separation radius independently of visual
  bounds.
  Friendly contact correction runs after movement, cannot cross blocked terrain,
  and is bounded by half that tick's actual travel for moving units. Passing
  units yield to stopped units; overlapping idle units separate gradually.
- Friendly mobile actors use soft separation. Detected opponents are hard local
  blockers; physical contact with an undetected same-layer opponent forces a
  temporary reveal.
- Movement profiles and occupancy layers are separate. Initial layers are
  **surface**, **air**, and **subterranean**. Watercraft and amphibious units
  remain on the surface layer. An actor's current occupancy layer is runtime
  state so explicit takeoff, landing, burrowing, and emerging can change it.
- Footprints define occupied tile offsets, an occupancy layer, and whether
  they block movement. Runtime occupancy is keyed by stable actor ID. Placement
  and removal update every footprint tile atomically.
- Buildings and other tile-placed objects use the actor identity and lifecycle.
  Actor definitions own optional footprint and terrain-placement rules; a
  definition with a footprint cannot also define movement. A tile-placed actor
  adds an origin and clockwise quarter-turn rotation, matching `facing`, to
  ordinary actor state. The simulation derives its position and facing from
  that placement. Surface placement rejects map bounds, unbuildable or
  disallowed terrain, excessive slope, occupied footprints, and ground units.
- Terrain edits that change a footprint tile or one of its corner heights are
  rejected, so a placed footprint keeps satisfying its placement rules.
- Actor identities and placed origins, rotations, and layers stay fixed during
  ordinary behavior updates. Footprint definitions require placed runtime
  state. Placement commands carry only the actor ID, definition, origin, and
  rotation, and report their tick-time rejection reason.
- Occupancy is a derived spatial index, separate from terrain, rebuilt from
  tile-placed actors when a mission starts, loads, or faults. Saves do not store
  a second authoritative copy of footprint state. Initialization validates an
  isolated candidate world before changing live terrain or occupancy.
  Restoration validates footprints without replaying placement-time ground-unit
  exclusion; units may cross nonblocking objects. Occupancy consumers receive
  only read-only queries. Renderer-owned appearance catalogs remain outside
  actor definitions used by the simulation.
- A mission owns its occupancy-based terrain-edit constraint and releases it
  on disposal. Occupancy indexes do not register terrain rules themselves.
- Terrain queries, edits, serialization, and navigation use a renderer-neutral
  grid. Babylon map helpers add visual layers, vectors, and render
  notifications. Edits and restoration reject noninteger coordinates, nonfinite
  heights, and invalid terrain flags before changing state.
- One air layer and one subterranean layer are sufficient initially; rendered
  altitude and depth are not tactical bands.
- Air movement ignores ordinary surface terrain and footprints but respects map
  bounds and authored air blockers. Takeoff and landing are explicit layer
  transitions, and landing requires a valid surface footprint.
- Burrowed actors ignore ordinary surface obstacles but respect subterranean
  blockers. Burrowing and emerging are explicit transitions; cross-layer attacks
  require an explicit compatible weapon or ability.
- Watercraft traverse water; amphibious profiles traverse land and water and
  cross valid shorelines without changing occupancy layers.
- Mixed-layer groups are permitted. Each actor resolves movement with its own
  profile, while every weapon declares which layers it can target.
- Passenger transport is a reusable capability; an APC is one planned use.
  Boarding is explicit, and passengers cannot attack, provide vision, or receive
  world commands while loaded.
- Transports retain passenger identities, health, veterancy, and persistent
  state. Unloading places the same actors in nearby positions they can traverse.
- Destroying a transport attempts an emergency unload. Survivors take 50% of
  maximum health as damage and are briefly stunned; passengers without a valid
  position die. Any otherwise sellable transport must be empty.
- Oversized units have selection areas spanning more than one square tile and
  use authored movement clearance distinct from selection bounds.
- Deployability is separate from size. Deployable actors retain one identity
  across mobile and grid-aligned deployed modes, and each actor declares whether
  completed deployment can be reversed.
- Deployment uses a nearby grid-snapped preview, a valid reserved footprint, and
  a timed transition. Capabilities declare whether they operate while mobile,
  deployed, or both.
- A deployed actor may be a network consumer, relay, root, or nonparticipant.
  Network participation begins when deployment completes and ends when
  undeployment begins.
- The playable map uses an irregular mask within a rectangular data grid. Camera
  bounds follow explored terrain and do not expose the full map early.

## Actor animation

- Actor animation is presentation. It follows committed simulation state and
  real time, never changes simulation state, and saves nothing; loading
  rebuilds it.
- Triggers are committed simulation events an actor's appearance responds to.
  `attack` fires with each hit the actor deals, as a shot or a bite.
- An actor's GLB supplies skeletal or articulated clips by role: idle,
  locomotion, optional left and right turn leans, work, one per trigger, and
  death. Rendered movement
  blends idle, locomotion, and leans. A trigger plays its clip once, layered
  over the others as its difference from its first frame. Remains play the
  death clip once from destruction and hold its last frame, so remains older
  than the clip, as after loading, show that frame. Without a death clip,
  remains lie on their side.
  The Harvester's work clip replaces idle and transit while gathering; generated
  amber and green lamps preserve its state when motion is reduced.
- Frame effects play a content pack's texture clip once on a camera-facing
  square anchored in the actor's model space, so they turn with it. An actor's
  presentation names them by trigger. The Trooper's muzzle flash plays on
  `attack`.
- Reduced motion skips trigger clips, holds frame effects on their first
  frame, and shows death clips' last frame at once.

## Fog, stealth, and detection

- Terrain is **Unexplored**, **Explored**, or currently **Visible**. Actor
  detection is a separate per-faction state.
- Missions begin unexplored except for what starting actors see. Explored
  terrain is saved mission state; current vision is derived from actors after
  every tick and after loading.
- Actor definitions author a vision radius. A tile is visible when its center
  is within the radius and the sightline from 1.5 units above the observer's
  ground to 0.5 units above the tile's ground clears the terrain heightfield.
  Ridges and cliffs therefore hide what lies behind them, while high ground
  near its rim sees over lower obstructions. Units and buildings do not
  occlude vision.
- Mobile units see from their tile's center; buildings see from their
  footprint center. Blueprints and disconnected buildings provide no vision.
- Unexplored terrain is covered in the background color on the main view and
  minimap; explored terrain outside current vision is dimmed. Fog edges soften
  inward, so known ground never reveals unexplored tiles.
- The camera's focal point stays within four world units of an explored tile
  center; panning, focus, minimap navigation, and Reset View clamp to that
  frontier. Zooming out still shows only darkness beyond explored terrain.
- Move orders may enter unexplored terrain. Building footprints and rally
  points must be explored.
- Concealment categories are **Exposed**, **Camouflaged**, **Cloaked**, and the
  layer-derived **Subterranean** category.
- Detection has no levels. It matches authored signature type, concealment
  category, occupancy layer, and range deterministically.
- Detectors may provide full detection in current vision or a coarse sensor
  contact through fog. Radar, sonar, magical detectors, quantum locks, and traps
  share this capability model.
- Direct targeting requires full detection. Compatible Attack Ground, line,
  projectile, and area effects can strike undetected actors through blind fire.
- Attacking, using hostile abilities, taking blind damage, or making physical
  contact normally suppresses concealment for three seconds. Ordinary reveal
  does not itself bypass fog or line of sight.
- Allies share vision, detections, sensor contacts, and temporary reveals but
  never unit control.
- A friendly concealed actor shows when at least one opponent fully detects it,
  but never identifies the detector, its channel, or its coverage.

## Campaign

- The player chooses ARC or the Circle and remains with that side throughout its
  campaign. Both campaigns show different perspectives on the same crisis.
- ARC and the Circle do not know about one another before their first conflict
  over a citadel or lost cache. Each initially understands the other, not the
  Everwake, as its main opponent.
- The factions eventually ally. In single-player the other faction remains an AI
  ally; future cooperative play may assign it to another player.
- Both campaigns are immediately available. ARC is labeled **Recommended First
  Campaign** and the Circle **Advanced Campaign**.
- Easy, Normal, and Hard are independent of campaign choice. Easy multiplies
  enemy health and damage by `sqrt(0.5)`; Hard uses `sqrt(2)`; Normal is the
  baseline. Other behavior is unchanged unless explicitly revised.
- Difficulty may be overridden per mission. Changing it during play restarts
  the mission; existing mission saves retain their original difficulty.

## Combat and veterancy

- Direct and automatic attacks require detected compatible targets. Attack Move
  engages compatible detected targets and resumes its route afterward.
- Damage, cadence, acquisition, pursuit, line of fire, and targetable occupancy
  layers are data-driven and deterministic.
- Combat actors and armed defensive structures earn one kill when at least 35%
  of a destroyed target's remaining unrecovered damage ledger is theirs. At most
  two contributors can qualify.
- Healing removes damage contributions proportionally. Dead contributors remain
  in the denominator but cannot receive promotions.
- Veterancy is mission-local: 10 kills grants +25% base damage; 25 adds +25%
  base attack speed; 50 raises damage to +50%; 100 raises speed to +50%; 200
  raises both to +75%.
- Five purpose-made SVG badges appear on promoted actors. New actors begin at
  zero unless a mission script explicitly specifies otherwise.

## Mission behavior

- Common mission logic uses data-driven triggers and actions. Complex campaign
  missions and story sequences may use mission-specific TypeScript modules in
  the codebase, independent of rendering and platform services.
- Mission code reads deterministic simulation state and uses the shared event,
  action, and command boundaries. Player choices enter through serializable
  commands; persistent story state is explicit simulation data.
- Events can change AI behavior profiles, posture permissions, and priorities,
  assign goals, and issue ordinary commands. Negotiation outcomes can enable
  offensive pressure. Actors obey shared movement, perception, and combat rules.
- Ordinary scripted goals express intent; the AI chooses forces, routes,
  timing, and tactics and responds to threats or infeasible goals. Mandatory
  story goals may override normal strategic priorities, with authored
  completion, failure, and cancellation conditions. They respect mission
  permissions and shared simulation rules.

## NPC AI

- NPCs use the same movement, pathfinding, targeting, visibility, damage, and
  command systems as player-controlled actors.
- Actor behavior is deterministic and serializable. Stable identifiers resolve
  equal choices. Encounter coordinators share goals or alerts while individual
  actors execute movement and combat.
- Faction AI adds a strategic director and group controllers above actor
  behavior. The director assigns priorities, budgets, and forces; groups
  execute operations. M0 wolves use only actor and encounter control.

### Faction strategy

Building, economy, scouting, defense, military production, aggression,
expansion, technology, and recovery run concurrently. Strategic postures change
priorities and allocations:

- **Establishing:** secure basic income, support, production, and protection.
- **Developing:** grow income, production, technology, and map access.
- **Pressuring:** pursue opportunities through probes, raids, or attacks.
- **Defending:** reinforce threatened assets or mandatory objectives.
- **Recovering:** regroup survivors and restore essential capacity after losses.

Posture selection and spending follow these rules:

- Choose posture from observed conditions, mission goals, and available
  capacity. Urgent threats can trigger defense immediately; other changes need
  sustained conditions. Defense ends after threats stay low for a tunable
  interval.
- Each AI faction uses a data-driven mission profile controlling posture
  permissions and emphasis. Missions may disable offensive pressure; earlier
  missions use gentler behavior. Profiles are independent of Easy, Normal, and
  Hard combat scaling.
- Protect essential income and immediate defense, then allocate remaining
  resources and units through the profile. Crises reduce optional commitments,
  use reserves, and prompt reassessment of active attacks.
- A faction with offensive pressure disabled defends locally when attacked.
  Wider retaliation requires an explicit mission rule or event.
- Resource-denial operations target known economic opportunities when the
  profile permits aggression. Income loss prompts protection and recovery.
- Remember observed enemies, economic sites, and threats with last-seen
  positions and observation ticks. Older reports become uncertain and prompt
  fresh scouting. Hidden positions, enemy stockpiles, production queues, and
  unobserved destruction stay unknown. Operations can investigate remembered
  locations; attacks require current detection.

### Faction operations

- Operations have objectives, assigned forces, and completion, failure, and
  cancellation conditions. Confirmed completion releases survivors for new
  assignments; loss of detection alone does not confirm success.
- Lost contact prompts investigation of the last-known location. End or
  redirect an optional operation if the search finds no viable objective.
- Blocked routes prompt replanning with bounded retries or waiting. Losses and
  newly observed threats prompt a viability check and retreat, regrouping, or
  permitted reinforcement.
- Profile or relationship changes trigger reassessment. Cancel operations no
  longer permitted and give survivors valid follow-up assignments.
- Mandatory operations follow authored failure and cancellation rules and
  report when they cannot proceed. Search limits, retry limits, retreat
  thresholds, reinforcement budgets, and follow-up destinations are tunable or
  mission-authored.

### M0 wolves

- Wolves use idle-at-home, alerted, pursuing, attacking, investigating,
  returning-home, and regenerating states, with no economy or strategic
  director.
- Each encounter has a fixed circular territory with an authored center and
  tunable hard leash radius. The lone wolf has its own territory; the five den
  wolves share one. Each wolf returns to its own authored home inside it.
- Wolves engage personally detected hostiles within their own sight and leash.
  Terrain obstructs sight under the shared visibility rules. The alpha detects
  farther than normal wolves; exact ranges remain tunable.
- Retain a valid target. Otherwise choose the nearest personally detected,
  reachable hostile within the leash, using stable actor ID for equal choices.
  Wolves do not prioritize valuable or injured targets or coordinate focus fire.
- Losing personal detection ends pursuit and starts return home. A confirmed
  destroyed or invalid target ends the attack; engage another detected,
  reachable hostile if available, otherwise return. Unobserved destruction
  grants no knowledge. Temporary route blockage uses the movement rules below.
- Fresh detection of a reachable hostile inside the leash interrupts return,
  investigation, or regeneration and starts combat.
- Damage stops regeneration and raises an alert at the wounded wolf's position
  without revealing an unseen attacker. Damage alone does not divert return
  or move a wolf from home.
- Regenerate only at authored home after the out-of-combat delay. Wolves retain
  damage during combat and pursuit. Dead wolves remain dead and do not respawn.

### M0 wolf alerts

- Fresh personal enemy sightings and incoming damage can originate alerts.
  Each alert has a stable ID and a fixed snapshot of its originating wolf's
  position. Observing another wolf's alert prompts investigation of that origin.
- Alerts propagate through individual wolf sight and terrain sightlines. Relays
  preserve the original ID and position. Each wolf responds at most once per
  alert; observing or relaying it again cannot restart investigation.
- Personal enemy detection takes priority. Otherwise retain an active
  investigation. With no target or investigation, choose the nearest observed,
  unhandled, unexpired alert reachable inside the leash, using stable alert ID
  for equal choices. A new eligible alert can interrupt return or regeneration.
- Alert lifetime runs from creation; relays do not refresh it. Expiry prevents
  new responses without cancelling an investigation already underway.
- At the origin, check for enemies for a short interval, then return home if
  none are personally detected. The encounter rests when survivors are home
  with no targets, investigations, or pending eligible alerts.
- Alert investigation and combat never override the hard leash. Alert lifetime
  and investigation duration remain tunable.

### M0 wolf movement

- Temporarily blocked pursuit or investigation permits a short wait and
  replanning inside the leash. After a tunable interval without progress,
  abandon the approach and return home.
- Remember failed approaches until target movement or relevant navigation
  changes permit another attempt. Handled alerts remain handled.
- If home is blocked, approach the closest reachable waiting point inside the
  territory with deterministic tie-breaking. Keep authored home as the goal
  and retry when conditions change. Waiting wolves cannot regenerate short of
  home, but can respond to fresh threats and eligible alerts.

### M0 wolf implementation contract

- Content supplies normal and alpha detection ranges, homes and territories,
  leash radii, alert lifetime, investigation wait, blocked retry and
  stalled-time limits, arrival tolerance, combat values, and regeneration delay
  and rate.
- Saves preserve wolf state and assignments, targets, home and territory
  references, health, combat and regeneration timing, active routes and bounds,
  investigation progress, failed approaches, and retry timing.
- Saved alerts retain IDs, creation and expiry ticks, origins, propagation
  state, response history, and the next alert ID. Loading preserves
  continuation and cannot duplicate an alert or restart a handled response.
  Personal vision and derived encounter-rest status are reconstructed.

Deterministic acceptance checks cover:

- Personal detection, terrain occlusion, alpha range, and lone-wolf isolation
  from den alerts in the authored M0 map.
- Relay chains, fixed origins, one response per alert, stable simultaneous
  choices, expiry, and investigation completion.
- Detection loss, fresh threats and alerts, unseen incoming hits, and target
  retention during combat or temporary blockage.
- Hard leashes, failed-route suppression, blocked homes, retries, and delayed
  regeneration only at home.
- Save continuation in every wolf state, including blocked routes and active
  relay chains, matching uninterrupted state tick for tick.
- Identical results across actor iteration order and render or fixed-tick
  scheduling batches, without render or platform state entering wolf logic.

## Construction and training sandbox

- The browser sandbox starts with no actors. Players place **Command Centers**
  and **Field Barracks** from the Buildings tab, then train **Troopers** and
  **Scouts** through a selected barracks in the Units tab.
- Construction and training are instant, with no resource cost, build time,
  production queue, or construction-support requirement in this sandbox.
- The Command Center has a 2 × 2 footprint; the Field Barracks has a 3 × 2
  footprint. Both support quarter-turn rotation and terrain placement previews.
- Training is a serializable command applied at the start of a simulation tick.
  Building definitions list their trainable unit definitions. A unit spawns on
  a free orthogonally adjacent surface tile within mission bounds that its
  movement behavior permits.
  Spawn selection prefers the entrance side, then distance to the building
  center, then tile order. Rotation turns the entrance side.
- Training rejects missing producers, unsupported units, reused actor IDs, and
  blocked exits. Requests in the same tick use separate available tiles.
  Clearing an exit lets the player retry; there is no waiting production job.
- Construction and training choose actor IDs that exclude active actors,
  retired actors, and queued creations, including restored pending commands.
  Previewing does not reserve IDs; rejected requests leave theirs available.
- Selection shows the actor's type, building footprint and orientation, or unit
  movement speed. Sidebar options and details derive from content definitions
  and presentation data. The Units tab lists production buildings and field
  units for selection. Selecting or placing a production building opens the
  Units tab; selecting any other actor opens Selection.
- Goals show current building and unit counts for construction and training
  practice. The sandbox has no victory or defeat condition.
- The sidebar reserves screen width beside the world canvas. Its content
  scrolls independently in compact landscape layouts. Placement controls stay
  available across tabs, and touch placement uses explicit confirmation.

## Materials economy prototype

- The default level file is the Materials opening, with a fixed Command Center
  in the map-edge pocket. `/?level=sandbox` selects the free construction and
  training sandbox.
- The opening starts with 150 Materials. Prototype costs are 300 for a Command
  Center, 100 for a Materials Refinery, 50 for a Harvester, 100 for a Field
  Barracks, 25 for a Trooper, and 20 for a Scout. Unit training takes six, four,
  and three seconds for Harvesters, Troopers, and Scouts respectively.
- Building blueprints reserve their footprint and pay their full cost at
  placement. One baseline construction slot processes them in placement order:
  twelve seconds for a Command Center, eight for a Refinery or Barracks.
  Unfinished buildings cannot produce units or receive Harvester assignments.
  Cancelling a blueprint refunds its full cost and releases the footprint;
  losing it gives no refund. Placement requires the blueprint center inside a
  completed connected building's support radius. Prototype radii are twelve
  world units for Command Centers and six for Refineries and Barracks; one
  world unit is one tile. These are data-driven tuning values.
- Completed buildings link when either center lies within the other's support
  radius: their center distance is at most the larger radius. Completed Command
  Centers are network roots. Blueprints never relay support and operate only
  while their center lies in connected coverage. Rootless clusters stay
  disconnected. Redundant paths remain live when another path is lost.
  Connectivity is derived from authoritative actors and definitions, and is
  rebuilt after loading. Losing every completed Command Center removes support
  coverage and prevents placement recovery. Combat destruction of the starting
  Command Center ends the opening in defeat.
- Disconnection pauses construction and production without losing payment,
  progress, or queue order. Paused blueprints yield the shared construction
  slot; the oldest connected blueprint advances. Restoring coverage resumes
  work automatically. Disconnected Refineries retain Harvester assignments but
  cannot accept cargo; mobile Harvesters keep their cargo and remain
  controllable. Offline cancellation and sale use the normal refunds.
- Support coverage appears during placement, building selection, and persistent
  Network View. Active areas and links are solid; inactive radii and broken
  connections are dashed with gap crosses. Offline buildings dim, stop animated
  machinery, turn off emissive lights, and show a crossed power badge.
  Sidebar states explain paused work. Grouped disconnection and restoration
  alerts focus the camera on affected buildings.
- Prototype vision radii are 14 world units for Command Centers and Scouts,
  8 for Refineries and Barracks, 7 for Troopers, and 5 for Harvesters. A
  building's vision covers its own support radius, so connected coverage is
  explored once the building completes. The Command Center reveals the near
  patch; the south patch and every salvage box start unexplored. Undiscovered
  resources stay hidden from the world, minimap, and sidebar, and harvesters
  cannot be sent to them. The construction sandbox has no fog.
- A Refinery has one paid production or assigned Harvester slot. Barracks
  queues hold up to five paid orders and train one unit at a time. Cancelling
  an unfinished order refunds its full cost. Completed production waits for
  a free, passable adjacent exit; the paid order remains cancellable. A yellow
  placement-preview arrow marks the preferred exit side and follows rotation;
  blocked exits may send units to another adjacent side.
- Each production building retains one optional ground rally point in its
  mission state. Set Rally Point in Selection or Units enters click-or-tap
  targeting; Cancel or Esc exits. The location must be explored, passable for
  every unit the producer trains, and clear of building footprints. Clear Rally
  Point restores exit-and-idle behavior.
  A flag appears only while the producer is selected. Newly completed units
  exit first, then use ordinary movement toward the current rally point.
  Later blockers use the normal pathfinding and unreachable-target rules.
- A Harvester carries 100 Materials and takes 60 seconds to gather a full
  load, plus travel. It gathers the assigned tile, then resource tiles within
  two tiles on each axis. Only explored tiles are candidates. Candidates use
  distance from the assigned tile, then row and column order; Harvesters resolve
  shared yields in actor-ID order. Resources enter the global stockpile only on
  delivery.
- Move and Stop interrupt collection while preserving cargo. A new patch
  order with cargo returns it first. Return cargo also works after Stop.
  Exhaustion delivers any partial final load, then waits for a new patch.
  Blocked routes wait for navigation changes or a new order.
- A lost Refinery interrupts automation and frees its surviving Harvester for
  assignment to an empty slot. The unit remains movable and keeps its cargo.
  Producer loss discards paid production; cancelled identities remain retired.
  Completed buildings sell for half their prototype cost multiplied by their
  health fraction, rounded down; mobile units cannot be sold.
- The near patch contains four 200-Materials tiles; the south patch contains
  two. Three ordinary salvage tiles each grant 25 Materials to the first
  player-owned mobile unit reaching them, without a delivery. One lies near
  the base at (25, 52). Two lie beyond the lone wolf at (54, 32) and (56, 34),
  providing 50 Materials for two replacement Troopers before the den.
  Resource tiles and uncollected salvage prevent placement. Depleted tiles
  become buildable.
- The sidebar provides cargo, phase, Gather, Return cargo, Refinery assignment,
  paid-order cancellation, patch totals, and salvage commands. The top bar
  shows available Materials. Blue resource markers shrink in four stages and
  disappear at depletion; salvage uses hovering, rotating gold gift boxes
  with red ribbons and disappears on collection. Clicking a gift box sends
  selected mobile units to its tile. Both marker types follow terrain edits
  and appear on the minimap. Exhaustion, missing assignments,
  blocked routes, and unaffordable harvesting recovery have explanatory
  feedback. Building timers show in Units and Selection, with a progress bar
  over translucent blueprints.
  Gathering Harvesters lower and spin a drill with a green light; idle workers
  raise the drill and show amber. Refineries animate a rooftop fan and pump
  when complete. Reduced motion retains static activity cues.
- Mission snapshots include stockpiles, tile yields, collected salvage,
  Harvester assignments, cargo, gathering progress, phases, routes, paid
  production, rally points, blueprint progress and queue order, explored
  terrain, pending commands, and reserved or retired actor identities.

## Combat prototype

- Every unit and building definition authors maximum health. Current health is
  saved actor state and is absent while undamaged. Only actors with health can
  be targeted, damaged, or destroyed.
- Definitions name a faction; actors of different factions are hostile, and an
  actor without a faction is neutral. The scenario names the player's faction.
  The fog records only that faction's vision; other factions derive current
  vision each tick without exploration memory. A faction detects an actor
  when it currently sees the unit's tile or any of a building's footprint
  tiles. Without a player faction, as in the sandbox, or without fog, every
  faction detects everything.
- A weapon authors fixed damage, a damage type, a range, and a cooldown. Range
  runs from the attacker's center to the target's footprint or body edge.
  Weapons hit hostile actors on their own occupancy layer. Damage types are
  reserved for armor matchups such as kinetic versus energy; every type
  currently deals full damage. Scouts, Harvesters, and current buildings are
  unarmed; a future armed building such as a turret uses the same weapon data.
- A tick applies commands, then resolves combat in actor-ID order, then moves
  actors, updates the economy, and separates units. Every hit in a tick applies
  together, so simultaneous attackers both land; actors left at zero health are
  destroyed before movement. A shot needs range and line of fire: the terrain
  sightline from 1.2 units above the attacker to 0.5 above the target, and no
  blocking footprint other than the attacker's or target's. Units do not block
  shots. Armed buildings aim without changing their placement facing and do not
  chase targets; they give up an order whose target is out of range, out of
  line of fire, or hidden.
- **Attack** targets a detected hostile. Move and Stop cancel it. Attackers
  stop, face the target, and fire whenever the weapon is ready; out of range or
  line of fire they chase, replanning once the target moves a tile from the
  route's end. A point no route approaches is retried only after the target
  moves away from it or navigation changes. A lost target is chased to its
  last-known position; an explicit attack then ends there, while automatic
  engagements end at once. Destruction outside vision does not end a
  last-known search; visible remains confirm the target's destruction.
- **Attack Move** keeps each mobile unit's resolved destination while it engages
  the nearest detected compatible hostile. It uses the guard's acquisition
  radius, or weapon range without a guard rule, and stable ID breaks ties.
  Unarmed group members move without engaging. Lost targets are investigated
  at their last-known position; combat ending resumes the destination without
  returning to a guard post. Move, Stop, and direct Attack replace the order,
  as does a territory heading home. A blocked destination keeps its retry state
  until navigation changes or a new command. Harvester automation replaces
  Attack Move. Destinations, investigations, and retries survive saving.
- **Attack Move** has an on-screen targeting action and Cancel; Esc exits
  targeting. A terrain click or tap submits the order. The minimap submits it
  only on explored ground while targeting; otherwise it navigates the camera.
  Minimap drags pan without submitting an order.
  Orange dashes and a diamond distinguish aggressive routes and destinations;
  the diamond remains during combat. No keyboard binding is assigned yet.
- Idle armed units with a guard rule engage the nearest detected hostile
  within their acquisition radius and their post's chase radius, stable ID
  breaking ties. They return to their post when it dies, hides, or was last
  seen beyond the chase radius from that post. A unit waiting on a blocked
  route counts as idle. Any armed actor without an order fires at a detected
  attacker that hit it in the previous tick and is in range, without leaving
  its route.
- Guards ignore hostiles while their route back proceeds. A blocked return
  keeps its point and retries after navigation changes; the guard may fight
  meanwhile. Move, Stop, and Attack replace a guard's return.
- Territorial NPCs use the [wolf state machine](#m0-wolves), personal sight,
  shared encounter territories, and visible-wolf alert propagation. All routes
  and contact correction respect the hard leash. Blocked homes keep their
  authored goal and approach a reachable waiting point without regenerating.
- Destruction gives no refund and leaves remains for 60 seconds: a fallen unit
  or corpse, or building debris that blocks placement on its footprint until it
  clears. Remains never block movement or shots and cannot be selected.
  Hostile and neutral remains are shown only within current vision.
- Clicking or tapping a visible hostile with friendly units selected orders
  each to attack it; unarmed units keep their orders and the receipt reports
  them. Otherwise the click selects the hostile for inspection with a red
  segmented ring. Undetected hostiles are not drawn, listed, or selectable.
  Visible hostile buildings allow inspection; building actions, queues, and
  support overlays belong to the player's faction.
- Five-segment health bars show above selected actors and above actors that
  dealt or took damage in the last three seconds, then fade over one second.
  The fill drains continuously and turns amber at 60% and red at 30%. The
  sidebar shows exact health for one selected actor. Rifle hits draw a brief
  tracer, wolf bites draw claw marks on the target, and accepted attack orders
  flash a red target marker.
- Prototype values: Troopers have 100 health and a 10-damage kinetic rifle with
  range 6 and a one-second cooldown, acquiring within 7 and chasing up to 10
  from post. Scouts have 40 health, Harvesters 150, Barracks and Refineries 800,
  and Command Centers 2000. Wolves have 100 health, speed 5, vision 8, and an
  8-damage kinetic bite with range 0.6 and a 1.2-second cooldown. Their
  default leash is 14. Alpha wolves have 150 health, vision 10, and 125% normal
  size. Wolves regenerate 5 health per second after 5 seconds out of combat at
  home. Alerts last 8 seconds, investigation waits 1.5 seconds, blocked retries
  wait 0.5 seconds, and 3 seconds without progress abandons an approach. Arrival
  tolerance is 0.15 world units. Content can tune these values per encounter.
  One Trooper can defeat one normal wolf.
- The Materials opening places one lone wolf on the southern path at tile
  (46, 32), out of sight of the base, with a 14-tile territory. The den lies
  east of the ridge, enclosed by six-unit mountain walls, with a three-tile
  northern entrance at x 77–79. Four normal wolves start at (74, 21), (82, 21),
  (75, 24), and (81, 24); the alpha starts at (78, 19). Their shared territory
  centers on (78, 21) with radius 12. Rough ground surrounds the entrance path
  inside the den. The nearby ridge crossing uses flat corner rows 32–36;
  the ridge south of it blocks sight between the encounters even at their
  leash boundaries. The northern crossing uses rows 66–72. A split summit at
  (63, 43) marks the ridge, and twin mountain teeth flank the den entrance.
  These terrain peaks remain inaccessible from the ground routes and persist
  on explored terrain and the minimap.
- Combat destruction of the opening's authored starting Command Center records
  a defeat at that tick. All simultaneous hits resolve, then movement and
  economy stop. Further ticks leave the state unchanged. The result survives
  saving, and the results panel offers Restart, Load, and Exit. Restart reloads
  the level; Exit releases the session and offers a new mission. Load lists
  saves and imports files, validates the mission before releasing the current
  session, and begins paused, with Inspect and Resume actions. Inspection allows
  selection and camera movement; commands require resuming. A loaded defeat
  stays ended.
  Economic stalls and ordinary unit or building losses do not declare defeat.
- Mission objectives are data. A `destroy` objective completes when combat
  destroys all its targets; a `protect` objective fails when combat destroys
  any of them. Removals and sales never count. The result derives from
  objective state: the earliest failure is a defeat, with stable objective ID
  breaking same-tick ties. Otherwise completing every `destroy` objective is
  victory. The opening protects the starting Command Center and authors two
  destruction objectives: defeat the lone wolf and clear all five den wolves.
  Progress and resolution ticks survive corpse cleanup and saving. Command
  Center destruction takes priority over victory when they occur in the same
  tick.
- Goals shows objective counters and route and combat directives, plus the
  Command Center protection rule. Recommended preparation explains the economy
  and army buildup with current actor counts; it is not a victory requirement.
  Victory pauses at the interface and offers Continue free play, Restart, Load,
  and Exit. Continuing restores all ordinary actions. A loaded victory opens
  the same paused results panel. Command Center destruction still causes defeat
  in free play.
- Saves preserve health, weapon cooldowns, building aim, attack destinations,
  returns and their retry state, route bounds, remains, and the complete
  [wolf and alert state](#m0-wolf-implementation-contract).
  Combat destinations and remains must lie within mission bounds.

## Milestone 0 playable slice

M0 is a canon-compatible standalone ARC prototype, not the canonical first
campaign mission or a literal tutorial. It is the minimum viable mission from
which
a later tutorial could be made.

- A fixed **Command Center** starts in a safe map-edge pocket.
- Starting Materials cover a **Materials Refinery** and its separately paid
  first **Harvester**. Each Refinery has one Harvester slot. The player gathers
  finite Materials, builds a **Field Barracks**, and trains **Troopers** and
  **Scouts**.
- The compact branching map includes buildable ground, a traversable slope, an
  impassable ridge, rough slow terrain, a narrow route, landmarks, and ordinary
  Materials loot sufficient for roughly two or three Troopers.
- Fog hides the map. Scouts move faster and see farther but are too fragile to
  defeat the lone wolf.
- One Trooper can defeat the first lone wolf. Four normal wolves and one
  125%-scale alpha occupy a den and require multiple Troopers.
- The den occupies a secluded mountain enclosure using the existing ranges,
  with a chokepoint entrance. The lone wolf guards the outside approach.
  Layout, sightlines, and encounter ranges keep den wolves, including the
  alpha, from observing the lone wolf's alerts.
- Defeating all six wolves completes the objective. The player may continue in
  free play afterward.
- Command Center destruction or a failed mandatory objective causes hard defeat.
  Economic or military dead ends remain player-judged soft defeats.
- A first successful run should take about 15 to 25 minutes; a familiar replay
  about 10 to 15 minutes. Neither is a hard timer.
- M0 includes contextual notifications, full save/load/restart coverage,
  compact landscape browser UI checks, and two explanatory popups: **Support
  Network** when the first Refinery placement begins, and **Harvester
  Operations** when the first Harvester completes.
- M0 excludes the Circle, Everwake, rare and exotic resources, repair, healing,
  upgrades, veterancy, stealth, special movement layers, oversized deployables,
  multiplayer, native mobile builds, a map editor, mod management, and the
  modding console.

## Persistence

- Levels and mission saves share one human-readable JSON format, version 8. A
  level is a mission file at tick 0. Every mission starts by loading a file,
  including bundled levels, and [mission files](docs/mission-files.md)
  documents the layout for hand editing.
- Mission files carry the scenario's authored data, such as terrain,
  objectives, briefing, and goals, beside the runtime snapshot. They name a
  shared content pack and its version, and may list the pack's actors they
  use. Loading rejects unknown packs, other pack versions, other file
  versions, and other tick rates, but accepts any content the simulation
  validates, so hand-edited levels and saves load as written.
- Content packs hold actor definitions, movement profiles, presentation,
  terrain styling, and lighting as JSON in the schema mods will use, as
  [content packs](docs/content-packs.md) documents. Session code holds no
  mission-specific rules. Behaviors and procedural models that data cannot
  express are built-in code that packs name by ID.
- Terrain and fog are stored as text rows from north to south with a tile
  legend, and heights as one number row per corner row. Missions without fog
  have the whole map known.
- Bundled levels are generated from authoring scripts by `npm run levels`,
  which replaces hand edits to those files.
- Actor IDs are stable and never reassigned within a mission, including after
  saving and loading.
- Mission files preserve objective IDs, rules, targets, defeated target IDs,
  and resolution ticks, from which victory or defeat follows. Objective
  progress must match the objective definitions in the same file.
- Mission files carry their scenario popups and the IDs the player dismissed.
- Manual save, load, restart, one rolling quicksave, and one rolling autosave
  are required in M0. Loading begins paused. Restart reloads the level with
  the mission's scenario ID; loading a level file makes it that scenario's
  restart level for the session. A tick-0 file with save metadata remains a
  save and does not replace that level.
- Manual saves form a named list without a count limit. Each entry shows its
  kind (Manual, Quick, or Auto), name, mission name, elapsed time, and
  timestamp. The quicksave and autosave replace only themselves.
- The autosave updates when an objective completes. Saving is unavailable
  after defeat or a simulation fault, so neither rolling save captures a lost
  mission.
- Platform services own storage. Browsers keep saves in local storage and
  exchange files by download and upload; the desktop build keeps saves as
  files in its app data folder and uses native file dialogs.
  Save writes and deletions finish in request order. Desktop library writes
  replace the previous file only after the new file has been written.
- Mission and campaign saves are separate schemas. A mission save owns one
  mission snapshot; a campaign save owns longer-lived choices and progression.
- Authoritative simulation state is serialized. Rendering objects, navigation
  caches, effects, and platform handles are reconstructed.
- Mission and AI state includes goals, assignments, observations, plans,
  cooldowns, deterministic random state when used, and persistent story flags,
  timers, and branches. Events retain progress, completed one-time triggers,
  pending actions, and effective behavior profiles. Loading resumes without
  repeating completed events. Executable code comes from the game build;
  content definitions come from the content pack version the mission names.
- A mission snapshot includes simulation terrain and its navigation version.
  An actor's active route is simulation state, so a loaded mission continues
  every move exactly as an uninterrupted one would, without recalculating.
- Implemented systems preserve passenger identities, occupancy transitions,
  deployment state and reservations, veterancy, temporary reveals, and
  authoritative sensor contacts or detection effects.
- Incompatible saves fail with a clear explanation. Cross-build migration is not
  required for M0.

## Open decisions

- **Factions and campaigns**
  - Full rosters, counters, faction motifs, technologies, and campaign missions.
  - Exact Everwake resource, citadel, cache, and reveal details.
  - Alliance-only units or abilities and the later skirmish structure.
- **Maps and world systems**
  - Campaign map sizes, terrain palettes, resource placement, and neutral
    systems beyond M0.
  - World-event cadence and escalation.
  - Whether corruption spreads, and how players counter or exploit it.
- **Interface and presentation**
  - Accessibility tuning, art direction, and audio direction.
- **Future systems**
  - Technology-tree and permanent-research design.
  - Script conflict precedence, missing-target policies, and mission-driven
    changes to hostile, neutral, or allied relationships.
  - Historical strategic intelligence sharing and uncertainty tuning beyond
    the locked allied vision and detection rules.
  - Faction build plans, force composition, budgets, and behavior-profile
    schemas and tuning for concrete missions.
  - Deterministic mod dependency and load-order resolution, overrides, save
    compatibility across mod changes, trust and signing, and exact console APIs.
  - Multiplayer session rules, lobby flow, networking, and replay requirements.
