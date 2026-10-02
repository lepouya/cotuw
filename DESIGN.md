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
4. **Approachable strategic depth** — scouting, planning, and map control matter
   more than extreme actions-per-minute.
5. **Small playable core first** — expand only after the basic RTS loop is fun.

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
- Actor models and skeletal clips: glTF 2.0 binary assets (`.glb`), referenced
  by actor graphics definitions. Keep editor source files for authored assets.

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
- Mission behavior uses deterministic, sandboxed events and actions. Mods cannot
  run arbitrary JavaScript or native code, access unrestricted platform
  services, or initially provide unrestricted interface extensions.
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

- Primary click selects or issues the contextual default command. Primary drag
  box-selects friendly mobile units. Shift-click adds or removes units.
- Secondary click opens a radial context menu. Secondary drag pans; Shift plus
  secondary drag rotates. Every secondary action has an on-screen alternative.
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
  presets. Preset and focus changes ease unless reduced motion is enabled.
- Camera zoom is measured in visible tile rows so framing is independent of map
  and tile size. New views show roughly 24 rows or fit a smaller map; resizing
  preserves the player's zoom. Direct panning has no momentum.
- The left sidebar uses Selection, Buildings, Units, and Goals tabs. It owns
  selection details, contextual actions, construction and production, queues,
  and a keyboard-free Cancel action.
- The top bar owns the game menu, resources, objectives, alerts, elapsed mission
  time, and single-player pause and speed controls.
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
- Terrain textures repeat by wrapping, so authored tiles must have matching
  opposite edges.
- Tile type IDs resolve one canonical visual definition. Conflicting definitions
  with the same ID are invalid content.
- Scrolling textures and future frame-based terrain animation are rendering
  effects and do not enter deterministic terrain state.
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

## Fog, stealth, and detection

- Terrain is **Unexplored**, **Explored**, or currently **Visible**. Actor
  detection is a separate per-faction state.
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

## NPC AI

- NPC actors use the same movement, pathfinding, targeting, visibility, damage,
  and command systems as player-controlled actors.
- Each actor uses deterministic, serializable state for immediate behavior, with
  stable identifiers resolving equal choices. Encounter coordinators may share
  goals or alerts, while actors still execute their own actions.
- Future faction AI layers a strategic director and group controllers above the
  same actor controllers. Mission scripts assign goals or ordinary commands
  rather than replacing core simulation logic.
- M0 wolves use idle-at-home, alerted, pursuing, attacking, investigating,
  returning-home, and regenerating states. They have no economy, base-building
  logic, or strategic director.
- A wolf retains a valid current target. Otherwise it selects the nearest
  detected, reachable hostile within its leash, using stable actor ID to break
  ties, without value targeting or coordinated focus fire.
- A den alert shares an attacker's last-known position but not continuing hidden
  knowledge. Each wolf chooses its own target after detection. Lost or
  unreachable targets are investigated before returning home, and no alert
  overrides the hard leash.
- Opposing-faction base planning, economy, production, expansion, defense, and
  attack planning require a later strategic-AI design pass.

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
- Defeating all six wolves completes the objective. The player may continue in
  free play afterward.
- Command Center destruction or a failed mandatory objective causes hard defeat.
  Economic or military dead ends remain player-judged soft defeats.
- A first successful run should take about 15 to 25 minutes; a familiar replay
  about 10 to 15 minutes. Neither is a hard timer.
- M0 includes contextual notifications, two simple explanatory popups, full
  save/load/restart coverage, and compact landscape browser UI checks.
- M0 excludes the Circle, Everwake, rare and exotic resources, repair, healing,
  upgrades, veterancy, stealth, special movement layers, oversized deployables,
  multiplayer, native mobile builds, a map editor, mod management, and the
  modding console.

## Persistence

- Scenario definitions are immutable content; mission saves are mutable runtime
  snapshots with stable actor identifiers and versioned envelopes. Actor IDs
  are never reassigned within a mission, including after saving and loading.
- Manual save, load, restart, one rolling quicksave, and one rolling autosave
  are required in M0. Loading begins paused.
- Mission and campaign saves are separate schemas. A mission save owns one
  mission snapshot; a campaign save owns longer-lived choices and progression.
- Authoritative simulation state is serialized. Rendering objects, navigation
  caches, effects, and platform handles are reconstructed.
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
  - Accessibility tuning, art direction, audio direction, and asset-production
    approach.
- **Future systems**
  - Technology-tree and permanent-research design.
  - Opposing-faction and allied strategic AI behavior, including economy, base
    planning, production, expansion, defense, and attacks.
  - Deterministic mod dependency and load-order resolution, overrides, save
    compatibility across mod changes, trust and signing, and exact console APIs.
  - Multiplayer session rules, lobby flow, networking, and replay requirements.
