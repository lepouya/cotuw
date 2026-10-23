# Design

This is the living design source of truth. Keep entries concise; add detail only
when it informs an implementation or content decision.

The playable build contains the ARC M0 mission and construction sandbox. M1's
two-faction skirmish is the active development target; [TODO.md](TODO.md) owns
task order and progress. Game-wide rules below include accepted systems that
are not yet implemented. The prototype sections describe the playable build.

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
- The core remains browser-runnable, including compact phone and tablet
  landscape layouts with touch-style input.
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

Catch-up work is bounded per clock pump; further owed ticks stay pending until
later pumps run them. Speed changes preserve both whole and fractional owed
ticks. Render interpolation holds at the latest committed pose while catching
up. Pausing discards outstanding catch-up time; resuming starts from the
current time, so inspection and paused time never advance the mission.

See [runtime extension contracts](docs/runtime-boundaries.md) for behavior,
clock, and resource ownership boundaries.

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
**Cultivator**, **Musterhall**, **Sentinel**, **Wayfinder**, **Healer**, and
**Artificer**.

### The Everwake

The Everwake are the concealed world antagonists and remain non-playable. ARC
and the Circle do not initially know what the Unquiet are. The Everwake's
identity, self-name, and demonic nature are revealed only in the middle or later
story.

## Ownership and relationships

- An actor's controlling owner is independent of its faction type. Faction
  type identifies its roster, capabilities, construction rules, and
  presentation; ownership identifies the participant that controls it.
- Commands are authorized against the issuing owner's actors. Construction
  creates actors for the issuing owner; trained units inherit their producer's
  owner. Using allied headquarters does not change ownership. Mission-script
  command authority is specified separately by the scenario.
- An owner may control multiple bases and actors from one or several faction
  types. Separate owners may also cooperate as allies. Missions may use either
  arrangement or combine them.
- A base's infrastructure queue and capacity belong to its central headquarters,
  a Command Center or Heartgrove. One owner may operate several independent
  bases. Unit-training queues belong to individual production buildings.
  Each operational headquarters roots its own base. An additional headquarters
  uses an eligible existing base's construction queue until completed, then
  supplies its own queue and baseline capacity. Emergency recovery is the
  skirmish-specific exception below.
- New construction is automatically assigned to the nearest eligible,
  operational headquarters; stable actor IDs break equal-distance ties. The
  building retains that base affiliation when support networks overlap or a
  closer headquarters becomes available. Its repair and upgrade work uses the
  assigned headquarters' infrastructure queue.
- An eligible headquarters must be compatible with the building's faction
  rules and satisfy that faction's infrastructure conditions. ARC requires a
  support connection; the Circle does not require a support chain. Headquarters
  handle only their owner's work by default. Scenarios may separately permit
  access to compatible allied headquarters' infrastructure queues, independently
  of support coverage sharing. Jobs then compete for the allied headquarters'
  slots; the building keeps its owner, whose available resource balances pay for
  the work.
- If its headquarters is destroyed or becomes ineligible and the mission
  continues, a surviving building automatically joins the nearest eligible,
  operational headquarters.
  Outstanding infrastructure work keeps its payment, progress, and priority,
  and follows the receiving headquarters' slot limits. If none is eligible,
  work pauses until one becomes available. Training queues remain on their
  surviving producers and follow their normal operational requirements.
  The M1 skirmish permits the narrow headquarters-recovery exception in
  [skirmish results](#m1-skirmish-results).
- Each pair of distinct owners has one mutual relationship: allied, neutral,
  or hostile. Matching faction types do not imply an alliance, and different
  faction types do not imply hostility. Fixed teams can be expressed through
  these owner-to-owner relationships. Mission behavior may restrain a hostile
  force from initiating attacks without changing its relationship.
- Units do not automatically engage neutral owners, and ordinary Attack orders
  cannot provoke hostility. A mission event or explicit mission decision must
  first change the relationship to hostile.
- Allied owners share vision and detection under the existing rules without
  gaining control over one another's actors.
- Vision, exploration, observations, and private economic and queue state are
  scoped by owner. Other owners' actors are inspected through detection rules;
  sharing a service does not grant command authority over their actors or jobs.
- Objectives identify relevant owners independently of faction type. A rule
  may also restrict faction types or name specific actor IDs. Skirmish result
  conditions, including rebuilt headquarters, are specified separately.
- Mission events may form or break alliances and change owner pairs between
  allied, neutral, and hostile during play. A change updates both directions
  together through the deterministic simulation boundary and is preserved in
  saves. Relationship changes do not transfer actor ownership or faction type.
- Ending an alliance stops shared live vision and detection, resource sharing,
  construction support, and allied headquarters queue access between those
  owners. Shared pools separate under the division rules below. Learned terrain
  remains explored. Buildings whose headquarters becomes ineligible
  automatically reassign under the same preservation and capacity rules as
  headquarters loss; work pauses if no eligible headquarters remains. AI
  operations reassess under the existing operation rules.
- These game-wide rules support opposing forces of the same faction type,
  reluctant allies, joint bases, and future team or cooperative play. M1's
  player-facing matchup remains ARC versus Circle.

The [M1 checklist](TODO.md) tracks implementation of these ownership rules.

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
- ARC extracts faster but exhausts or permanently damages its sources. Circle
  cultivation is slower and renewable, with limited throughput and temporary
  dormancy and recovery under heavy use. Exact rates and capacities are tunable.
- Circle sites hold a renewable reserve that replenishes over time, including
  during active cultivation. Workers draw from that reserve; modest use can
  remain sustainable, while heavier use drains it toward dormancy. Output
  falls as the reserve approaches exhaustion, providing an incentive to rest
  or rotate sites. A site becomes dormant at a low reserve threshold, stopping
  cultivation before complete exhaustion.
- Initial Circle dormancy thresholds are 10% reserve to enter dormancy and 60%
  to reopen. Dormant sites replenish automatically without a worker, payment,
  manual reactivation, or additional cooldown timer. Thresholds are data-driven
  tuning values.
- Cultivation runs at full speed from 60% to 100% reserve. Below 60%, speed
  declines linearly to 50% just above the 10% dormancy threshold. Slowing
  cultivation increases cargo-filling time without changing the site's
  common-to-rare yield ratio. These are initial data-driven tuning values.
  Sites show Healthy, Strained, or Dormant states; a dormant site remains
  Dormant throughout recovery until it reopens at 60%.
- Selected sites show a reserve bar and percentage, current cultivation
  efficiency, and their state. Dormant sites show that recovery reopens them
  at 60%. Workers waiting at a dormant site show Waiting for site recovery
  rather than Idle. A worked site entering dormancy produces one notification
  per transition, without repeated reminders. Feedback follows normal
  visibility rules; the common-to-rare yield ratio remains hidden.
- Cultivation sites have no fixed worker limit or aggregate output cap. Each
  active Cultivator contributes at the site's reserve-adjusted rate, and all
  cultivation draws from the same site reserve. Light use can be sustainable;
  concentrating workers increases immediate output and can force dormancy.
- Initial site capacity is 100 reserve units, regenerating 1 unit per second
  up to capacity. Each Cultivator gathers 1 resource unit per second at full
  speed, consuming an equal amount of reserve, and carries 30 resource units.
  One Cultivator is sustainable; heavier simultaneous cultivation can drain
  the site. Dormant recovery from 10% to 60% takes 50 seconds. These values
  are data-driven starting points to refine with the playable Circle slice.
- Cultivators retain their assigned site through dormancy. They deliver any
  partial cargo to a Conservatory, then wait at a reachable position near the
  site and resume cultivation automatically when it reopens. They do not seek
  another site automatically; changing sites requires a manual order.
- For each delivery trip, Cultivators automatically choose the nearest
  reachable Conservatory belonging to their owner. They have no fixed
  Conservatory assignment. If none is reachable, they retain their cargo and
  show a blocked-delivery warning.
- Move, Stop, and construction orders interrupt cultivation immediately while
  preserving cargo, without a delivery detour. A new Gather order at another
  site delivers existing cargo before beginning cultivation there. Explicit
  interruption ends the prior cultivation order; resuming requires a new
  Gather order. Dormancy keeps Gather active, so orders queued behind it wait
  through dormancy and recovery.
- Sites have an internal common-to-rare yield ratio. Starting sites favor common
  resources; richer rare yields encourage expansion. Exact ratios stay hidden;
  players learn a site's value from collected output.
- Resources use unlimited global stockpiles per owner by default. Materials
  and Lifebloom remain distinct balances even when one owner controls both
  faction types; Catalysts and Resonance follow the same rule when available.
  Deposited resources are not tied to storage buildings and survive building
  loss.
- Scenarios may explicitly enable shared resource pools, including for future
  cooperative play. Each pool holds one resource type; Materials and Lifebloom
  cannot fund one another's costs. An alliance alone does not pool resources.
  Multiplayer remains outside M1.
- When a shared resource pool separates, its remaining balance is divided
  equally among its owners by default. Scenarios may specify a different
  division. Previous spending is not reversed, and division preserves the
  remaining total. Stable owner IDs resolve indivisible remainders.
- Construction pays its full cost and reserves its footprint on placement,
  including queued work. Cancelling unfinished construction gives a full refund.
- ARC places blueprints directly within construction support. No builder unit
  is required.
- Circle construction requires continuous tending by a Cultivator at the
  growing building. Tending commits the worker instead of gathering. Growth
  advances only while its assigned Cultivator is present and the job has an
  available Heartgrove infrastructure slot. Only one Cultivator tends a
  building at a time; extra workers do not accelerate growth.
- Losing the tending worker or its ability to reach tending range pauses
  growth without losing payment or progress. Untended work yields its slot.
  The player selects a replacement Cultivator and issues Tend on the unfinished
  building to resume without paying construction costs again, under the normal
  infrastructure queue rules. Replacement is manual. Completion releases the
  tending assignment.
- Cultivators may grow Circle buildings on explored, valid terrain they can
  reach, without growth-area coverage or a chain of supporting buildings.
  Ordinary footprint, terrain, and occupancy rules still apply.
- Completed Circle buildings operate and provide vision independently of a
  Heartgrove support chain. Construction, repair, and upgrades still use the
  assigned eligible operational Heartgrove's infrastructure slots. Losing that
  headquarters triggers the normal reassignment rules; without an eligible
  replacement, infrastructure work pauses while completed buildings continue
  their normal operations.
- A Lifebloom Conservatory serves multiple Cultivators without a worker-slot
  limit. Sustainable income depends on cultivation-site throughput, travel,
  and dormancy rather than a per-Conservatory worker cap. More Conservatories
  improve delivery routes and provide redundancy.
- Heartgroves train Cultivators through normal paid, timed unit production.
  Their training queues are independent of infrastructure slots. Conservatories
  receive cultivated resources and do not produce Cultivators.
- Completed ARC buildings require an unbroken support chain to the **Command
  Center**. Disconnected buildings stop operating, extending support, and
  providing active vision; interrupted work pauses with progress preserved.
- Construction support is owner-specific by default. Scenarios may explicitly
  enable support sharing between allied owners. Shared ARC support lets allied
  ARC buildings link, extend placement coverage, and connect to an allied
  Command Center. Other faction types do not supply ARC construction support.
  An alliance alone does not enable support sharing, and support sharing does
  not grant control over allied actors or pool resources.
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
- A building uses contextual **Repair** without a builder. Each simulated
  second, a paid repair step restores up to 1% of maximum health, with a
  smaller final step. Charge for that step before applying its health.
- Repairing 100% health costs 50% of the building's original common-resource
  cost. Each job costs that amount multiplied by its starting missing-health
  fraction and never uses rare or exotic resources.
- Unaffordable or disconnected repair pauses and later resumes. Cancellation
  keeps restored health because unpaid future ticks require no refund.
- Repair jobs drawing from the same balance pay oldest first each second.
  An unaffordable job and later repair jobs pause for that second, preserving
  their priority and progress.
- Each Command Center or Heartgrove owns its base's infrastructure queue and
  capacity, shared by construction, building repair, and building upgrades.
  Each headquarters has one baseline slot; ARC Command Center upgrades may
  add slots to that headquarters. Unit training uses each production building's
  own queue and does not consume infrastructure slots.
- Infrastructure jobs start in priority order. Blocked jobs yield their slots
  without losing payment, progress, or priority. Becoming eligible again does
  not preempt active work; the job waits for an available slot.
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
- An upgrade may improve its building or provide a capability to its owner's
  compatible actors while that building remains operational. Sharing a faction
  type does not give another owner the upgrade. Selling or destroying the
  building removes its installed effects.
- Command Center upgrades may add infrastructure slots to that headquarters or
  extend construction range; Barracks upgrades may unlock advanced units;
  Radar upgrades may extend range or add detectable kinds. Building upgrades
  remain distinct from permanent research and technology-tree progression.
- Mission saves store installed tiers and in-progress upgrade state. Campaign
  saves store the maximum tiers unlocked by campaign progression.
- The full upgrade cost is paid when it enters its base headquarters'
  infrastructure queue. Active upgrading consumes one slot, while waiting work
  does not. Each building may have only one waiting or active upgrade.
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
- Individual building tiers, effects, costs, timing, and presentation remain
  content and balance decisions. M1 upgrade scope is tracked in TODO.md.

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

- Normal launch opens a title screen with New mission, Load, Options, and Exit.
  No mission runs until the player starts or loads one. Options shares the
  in-game audio settings. Main menu releases the current mission and returns
  to this screen. Exit closes the desktop app; browsers show a close-tab
  message. The title screen shows the game version.
  Explicit `?level=<scenario ID>` links open bundled levels for development.
- Primary click selects or issues the contextual default command. Clicking a
  selected actor keeps it selected. Primary drag box-selects friendly mobile
  units. Shift-click toggles individual units; Shift-drag adds boxed units.
  Buildings remain individually selected and cannot join a mobile group.
  Box selection tests stable ground-level anchors, independent of animated
  model bounds, weapons, and effects.
- Stop cancels selected mobile actors' orders without clearing selection.
  Clear removes selection without changing orders. Selection is client UI state.
- Shift-commands, and commands in the touch Queue Orders mode, append Move,
  Attack Move, Attack, Gather, and Collect orders to each selected unit's
  queue; Done leaves the mode, and a queued Attack Move target keeps Attack
  Move mode open. Accepted unqueued commands and Stop replace the current
  order and clear the queue. A unit starts its next order at the start of the
  tick after its current one ends; a blocked route counts as ended, and a
  rejected order gives way to the next. ARC harvesting continues until its
  site runs out, so orders behind a Gather wait until then. Circle cultivation
  continues through dormancy and recovery; dormancy does not advance its
  queue. Units cannot queue orders they could never carry out, such as an
  unarmed attack. Queues are saved mission state.
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
- The left sidebar splits its available height between production above and
  selection below, with independent scrolling. Buildings and Units tabs use
  illustrated cards with names and Materials costs; hover or keyboard focus
  reveals descriptions, footprint or speed, work duration, and unavailable
  reasons. Disabled cards still expose their explanations. Card focus follows
  changes in availability. Unavailable cards also explain themselves on touch.
  Explanations stay within the viewport and consume Escape before world
  commands. The lower panel always shows selection details, health, contextual
  actions, and that building's production queue. Construction queues belong to
  Buildings. Active placement controls occupy their own row above the orders
  toolbar; idle placement controls stay hidden. Construction cards follow the
  content pack's build order, with the Materials Refinery before the Field
  Barracks. Units shows only the selected friendly building's trainable units,
  including unavailable orders with explanations. With no production building
  selected, it prompts selection on the map. Units also provides collapsible
  field unit and resource lists. The sidebar header's Goals button toggles
  Goals in place of the production tabs, and the top bar's objective opens it.
  Selecting a friendly production building opens Units without hiding
  selection details. The orders toolbar stays below both scrolling panels and
  remains visible as their content grows. Tab arrows, Home, and End navigate
  the production tabs.
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
  shows them again. The opening explains basic goals, selection, movement,
  camera controls, and the sidebar when the starting Command Center is owned.
  It explains support at first Refinery placement, gathering at the first
  Harvester, training and rally points at the first completed Barracks, and
  fog, scouting, and combat at the first Scout.
- The game menu pauses a single-player mission and offers Save, Quicksave,
  Load, Restart, and Main menu; its Load panel lists saves and imports files. F5
  quicksaves, F9 loads the quicksave, and F10 opens the menu.
- The minimap is north-up, distinguishes explored terrain from current vision,
  respects detection, supports camera navigation, and accepts commands only in
  an explicit command mode.

### M1 control groups

- Provide ten manually assigned groups numbered 1 through 9 and 0, containing
  the player's owned mobile units. A unit may belong to multiple groups.
  Buildings retain individual selection and do not join control groups in M1.
- Recalling a group replaces selection without moving the camera. Recalling
  it twice quickly focuses the camera on its surviving members. Destroyed
  members drop out; newly trained units join only through manual assignment.
- An on-screen Groups panel provides numbered recall buttons and explicit
  Assign, Add, and Clear actions for touch and pointer users.
- Number-row keys recall groups; a quick repeated press selects and focuses.
  Ctrl+Shift+number replaces that group's membership with the selected units;
  Shift+number adds selected units. Clear uses the Groups panel. These defaults
  use Control on every platform, including Mac, and match in browser and
  desktop builds to avoid browser tab shortcuts.
- Save group membership with the mission as player interface state. Loading
  restores surviving mobile members still owned by the player. Starting a new
  mission or restarting clears groups. Groups do not affect simulation
  outcomes; loading uses current keyboard preferences rather than saved keys.

### M1 idle-worker controls

- Period selects and focuses the next owned idle Harvester or Cultivator;
  repeated presses cycle through them. Shift+Period selects all idle workers
  without moving the camera. An Idle workers button shows their count and
  cycles through them, with a Select all action for touch and pointer users.
- Idle workers have no active work assignment or pending orders. A Harvester's
  Refinery affiliation alone does not make it busy. Workers stopped
  manually or finished with an exhausted ARC site qualify, including those
  carrying resources. Cultivators waiting for site recovery, workers awaiting
  a delivery route, and workers assigned to paused construction retain their
  assignments and show their waiting or blocked status instead.

### M1 matching-unit selection

- Double-clicking an owned mobile unit selects all owned mobile units of that
  exact type in the current view. Shift-double-click adds those units to the
  current selection. Buildings retain individual selection.
- The selection panel shows one entry per selected mobile-unit type with its
  selected count. Each entry offers Same type in view and Same type across map
  actions, naming the exact type affected. These work with mixed selections
  and touch or pointer input. An action replaces selection by default; Add
  units mode adds its matches while retaining other selected types. Map-wide
  selection requires the explicit across-map action.

### M1 command shortcuts

- A enters Attack Move targeting; a destination click or tap submits the order.
  Shift-click appends the destination and keeps targeting open for more queued
  waypoints. Escape or Cancel leaves targeting without issuing an order.
- S stops selected mobile units immediately, cancelling active and queued
  orders while retaining selection. Attack Move, Stop, and Cancel retain
  on-screen actions for touch and pointer users.
- B opens the construction panel. Q, W, E, R, and T choose its first through
  fifth building cards, followed by normal placement. Selecting a production
  building opens its training panel, where the same keys queue one unit from
  the corresponding card. Keys act on the active production panel.
- Circle construction requires a selected Cultivator. Without one, its cards
  explain that a Cultivator must be selected. If several are selected, assign
  the nearest selected worker that can reach the site, with stable actor IDs
  breaking distance ties. Highlight the chosen worker in the placement
  preview. It travels to the site and tends under the normal interruption and
  infrastructure rules. A worker's death or new order pauses its construction;
  select a replacement and issue Tend on the unfinished building to resume.
  Tend has on-screen and radial-menu actions.
- Cards display their shortcuts. Unavailable cards retain their positions and
  key assignments. Both factions use the same menu-position pattern, with
  clicking and tapping available for every card.
- During building placement, R rotates the footprint. Card shortcuts wait
  until placement finishes or is cancelled.
- Command shortcuts yield to dialogs and text fields.

### M1 keyboard preferences

- M1 includes basic keyboard rebinding in Options for gameplay actions and
  production-card slots. Support European and other keyboard layouts without
  requiring players to switch their system layout.
- Gameplay defaults follow physical key positions. Letter and punctuation
  names in these defaults refer to the US QWERTY layout; labels show the
  corresponding keys on the player's layout. Production slots retain their
  five adjacent positions, and groups use the ten number-row positions even
  where those keys produce other characters. Players can rebind each action.
- Buttons and cards show current bindings. Flag conflicts between actions
  that can respond in the same context, and provide Reset to defaults.
- Bindings are player preferences shared across missions, independent of
  mission saves.

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
  `attack` fires with each hit the actor deals, as a shot or a bite. `hit`
  fires on surviving targets after damage commits; lethal hits go directly to
  death. `unload` fires on the Harvester that delivers cargo. Repeated triggers
  between rendered frames coalesce, and another hit restarts the reaction.
- An actor's GLB supplies skeletal or articulated clips by role: idle,
  locomotion, optional run, left and right turn leans, aim, work, deploy,
  stow, one per trigger, and death. Rendered movement blends idle, locomotion,
  and leans. Wolves use their run clip during pursuit and trot otherwise.
  Troopers hold the aim pose while their detected target is within rifle range.
  A trigger plays its clip once, layered over the others as its difference
  from its first frame. Remains play the death clip once from destruction and
  hold its last frame, so remains older than the clip, as after loading, show
  that frame. Without a death clip, remains lie on their side.
  The Harvester lowers its collector into the work loop when gathering starts
  and stows it when gathering ends. Reversing a transition keeps its current
  collector position. Loading settles into the current work or idle pose.
  Unloading tips its hopper without delaying delivery or the next route.
  Generated amber and green lamps preserve its state when motion is reduced.
- Frame effects play a content pack's texture clip once on a camera-facing
  square anchored in the actor's model space, so they turn with it. An actor's
  presentation names them by trigger. The Trooper's muzzle flash plays on
  `attack`.
- Reduced motion skips trigger clips, settles collector transitions, holds
  locomotion on its first frame and aim at its held pose, suppresses turn
  leans, holds frame effects on their first frame, and shows death clips' last
  frame at once. Death overrides all live animation.

## Building and ambient presentation

- Building presentation follows committed simulation state and real time,
  never changes simulation state, and saves nothing. Building activities are
  committed per-tick events: `exit` when a produced unit leaves its producer,
  and `delivery` when a Harvester unloads at its Refinery.
- A building GLB supplies a looping idle clip and an optional clip per
  activity. Activity clips start and end at rest, play once per activity, and
  key no channel that idle keys; a new activity replaces one in progress.
  Blueprints and disconnected buildings play neither. The Command Center
  turns its sensor array. The Barracks slides its entrance open for each
  trained unit. The Refinery rolls its garage door up for each Harvester it
  produces, and for each delivery also runs its press and raises a green
  processing lamp.
  Activity time survives terrain and asset refreshes; disconnection or actor
  removal clears it.
- ARC construction shows three equal stages of progress: the foundation inside a
  scaffold at half the building's height, then the building cut off at half
  height inside a full scaffold, then the whole building inside the scaffold.
  Blueprints stay translucent under their progress bar, and completion removes
  the scaffold.
- Actors whose presentation names a damage effect show it at 60% health or
  less and more strongly at 30% or less. Mechanical actors, such as ARC
  buildings and Harvesters, release intermittent smoke puffs when moderately
  damaged and a dense smoke column with fire and sparks when critical.
  Biological actors, which are infantry and wolves, drip occasional drops when
  moderately damaged and frequent ones when critical. Effect size, frequency,
  and fire, not color alone, convey severity.
- Wolves whose presentation enables regeneration show a green halo with
  rising cross marks while actively healing at home. The effect follows the
  idle pose, stays still under reduced motion, and disappears when healing
  stops, the wolf becomes hidden, or it is destroyed. Loading rebuilds it
  from the wolf's current state.
- Destroyed buildings collapse: their debris slumps from building height to
  rubble over 0.8 seconds.
- Missions may author bird flocks that circle a point at a fixed altitude
  above the highest terrain under their loop. Birds hide over unexplored
  terrain. Clearance includes the flock's varying radii and refreshes after
  terrain edits.
- Reduced motion skips activity clips, holds damage effects and birds still,
  preserves a visible damage cue during emission gaps, and shows collapsed
  debris at once.

## Audio

- Essential sound effects cover accepted commands, invalid actions, attacks,
  damage, alerts, objective completion, victory, defeat, and training start and
  completion. The ARC slice adds Harvester work and movement and Refinery
  garage doors.
  Sounds reinforce the visual feedback; every core action remains usable when
  muted.
- Gameplay sounds follow committed simulation events without changing
  simulation state or timing. Loading rebuilds current audio activity without
  replaying past events. Group commands and repeated combat events must not
  produce an overwhelming stack of sounds.
- World sounds respect fog and detection and must not reveal hidden hostiles.
  Player alerts remain audible for events involving the player's own actors.
- Master volume defaults to 50% and scales sound and music together. Volume
  sliders and accessible mute icons work in compact touch layouts. Playback
  starts after player interaction in the browser; unavailable or blocked audio
  must not prevent the mission from running.
- Exploration and combat music loop with separate volume and
  mute controls. Music stays below gameplay cues in the mix and continues while
  paused; world sounds stop and player feedback remains audible. Menu controls
  save preferences on the device.
- Content packs assign cue variants, cooldowns, voice limits, spatial ranges,
  unselected gain multipliers, timed event sequences, and state loops.
  Harvester work is quieter when unselected. Selected audible objects take
  precedence within world loop limits. A presentation adapter translates
  committed mission changes into generic named events and emitter states.
  Audio playback remains outside deterministic simulation; see
  [gameplay audio](docs/audio.md) for extension points.
- Use original or appropriately licensed audio and document asset provenance.
  Voice acting and a final soundtrack are deferred.
- The initial asset palette uses atmospheric synths, sparse percussion, and
  crisp gameplay cues. Original offline generators produce PCM WAV cues and
  looping exploration and tension music; see
  [audio assets](docs/audio-assets.md) for inventory, provenance, and audition.

## Fog, stealth, and detection

- Terrain is **Unexplored**, **Explored**, or currently **Visible**. Actor
  detection is a separate owner-scoped state with allied sharing.
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
  footprint center. Unfinished buildings and disconnected ARC buildings provide
  no vision. Completed Circle buildings do not require a support chain for
  vision.
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
- Single-player campaign missions offer optional free play after victory or
  defeat, using surviving forces and the battlefield as they stand. After a
  defeat, label the action Continue free play - mission failed. The recorded
  outcome and summary remain fixed; later play cannot turn that defeat into
  campaign completion or progression. A successful attempt requires restarting
  or loading an earlier save.
- A campaign mission's earned victory stays recorded for progression. Defeat
  later in post-victory free play cannot revoke it.

## Combat and veterancy

- Direct and automatic attacks require detected compatible targets belonging
  to hostile owners. Attack Move engages compatible detected hostiles and
  resumes its route afterward.
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

## Mission setup

- Starting conditions are authored per owner. Scenarios support both sides
  establishing their bases together, or one or both sides beginning with a
  completed or partially constructed base. Headquarters establishment is also
  scenario-specific: a side may begin with an operational headquarters or a
  mobile base that must establish itself. Neither is a universal default.
- Mobile-base starts use the accepted deployable-actor rules. Their
  implementation remains outside M1's selected scope.
- Scenarios may script aspects of base expansion alongside autonomous
  base-building AI, under the shared mission behavior and simulation rules.
- Initial setup directly authors starting actors, resource balances, and
  construction progress. During play, ordinary scripted expansion pays normal
  costs and uses normal build times, infrastructure queues, placement, and
  support rules. Free resources, reinforcements, or completed installations
  are separate, explicit story-event grants through validated deterministic
  simulation actions.
- M1's skirmish uses one authored battlefield with two fixed starting areas,
  each able to accommodate either faction. At launch, setup assembly assigns
  owners and faction types to slots and supplies faction-specific starting
  assets, resources, and AI profiles. Terrain, routes, and expansion sites stay
  the same across assignments. Both assignments are available for verification.
- Both M1 skirmish owners begin at the same simulation tick with one
  operational headquarters: an ARC Command Center or Circle Heartgrove. Each
  receives enough starting resources to establish income through normal play.
  ARC constructs a Refinery and produces its Harvester; Circle trains a
  Cultivator at the Heartgrove, then grows a Conservatory. No preplaced worker
  is required. Economy buildings, production buildings, defenses, and armies
  are developed during the match.
- Starting packages use the amounts in
  [M1 resources and progression](#m1-resources-and-progression), covering the
  first worker and drop-off building. They are data-driven and verified against
  normal costs; this opening does not constrain other scenarios' starts.
- Setup assembly produces a resolved tick-0 mission file through the shared
  validation and loading path. Restart reproduces the pristine resolved setup,
  including faction-to-slot assignments and starting assets. Saves preserve
  that setup alongside runtime state so loading and restarting cannot silently
  choose a different opening.

## Mission behavior

- Common mission logic uses data-driven triggers and actions. Complex campaign
  missions and story sequences may use mission-specific TypeScript modules in
  the codebase, independent of rendering and platform services.
- Mission code reads deterministic simulation state and uses the shared event,
  action, and command boundaries. Player choices enter through serializable
  commands; persistent story state is explicit simulation data.
- Events can change AI behavior profiles, posture permissions, and priorities,
  assign goals, change mutual owner relationships, and issue ordinary commands.
  Negotiation outcomes can change relationships, offensive pressure, or both.
  These are separate effects. Actors obey shared movement, perception, and
  combat rules.
- Ordinary scripted goals express intent; the AI chooses forces, routes,
  timing, and tactics and responds to threats or infeasible goals. Mandatory
  story goals may override normal strategic priorities, with authored
  completion, failure, and cancellation conditions. They respect mission
  permissions and shared simulation rules.
- Scenarios declare which AI-controlled owners their scripts may command.
  Direct orders to player-owned actors are disabled by default and require
  explicit scenario permission, which may restrict the actors or scripted
  sequence. All orders use the normal command rules. Story grants are
  separately authorized and do not grant direct control over their recipients.

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
- AI factions know the authored map: terrain, routes, and resource site
  locations. Enemy actors and current site yields require observation.

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
  and presentation data. The Units tab trains from the selected production
  building and lists field units for selection. Selecting or placing a friendly
  production building opens Units; selection details remain visible below.
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
  shows available Materials. Blue resource markers shrink in four nonempty
  stages and disappear at depletion. The content pack sets descending fullness
  cutoffs and model scales; a fraction equal to a cutoff enters the smaller
  stage. Salvage uses hovering, rotating gold gift boxes
  with red ribbons and disappears on collection. Clicking a gift box sends
  selected mobile units to its tile. Both marker types follow terrain edits
  and appear on the minimap. Exhaustion, missing assignments,
  blocked routes, and unaffordable harvesting recovery have explanatory
  feedback. Building timers show in Buildings and Selection, with a progress bar
  over translucent, staged blueprints.
  Gathering Harvesters lower and spin a drill with a green light; idle workers
  raise the drill and show amber. Completed Refineries turn a rooftop fan and
  work a pump, and animate each Harvester exit and delivery. Reduced motion
  retains static activity cues.
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
  the diamond remains during combat. M1 assigns A to enter targeting.
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
  saving, and the results panel offers Restart, Load, and Main menu. Restart
  reloads the level; Main menu releases the session. Load lists
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
  and Main menu. Continuing restores all ordinary actions. A loaded victory
  opens the same paused results panel. Command Center destruction still causes
  defeat in free play.
- Saves preserve health, weapon cooldowns, building aim, attack destinations,
  returns and their retry state, route bounds, remains, and the complete
  [wolf and alert state](#m0-wolf-implementation-contract).
  Combat destinations and remains must lie within mission bounds.

## Milestone 0 playable slice

The M0 mission is the playable ARC introduction. It is canon-compatible and
standalone, not the canonical first campaign mission or a scripted tutorial.
Its rules remain the acceptance baseline for that mission during M1 work.

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
- A successful run takes about 5 to 10 minutes. M0 does not lengthen it by
  slowing gathering, production, or movement, and it is not a hard timer.
  RTS-familiar first-time players can finish using only the in-game guidance.
- M0 includes contextual notifications, full save/load/restart coverage,
  compact landscape browser UI checks, and contextual guides for command
  basics, support coverage, harvesting, Barracks training, and scouting.
- Essential gameplay sound effects and background music are included as defined
  in [Audio](#audio).
- M0 excludes the Circle, Everwake, rare and exotic resources, repair, healing,
  upgrades, veterancy, stealth, special movement layers, oversized deployables,
  multiplayer, native mobile builds, a map editor, mod management, and the
  modding console.

## Milestone 1 planning direction

M1 targets a small single-player ARC-versus-Circle skirmish with a
base-building AI opponent. Either faction is playable, with enough buildings
and units to establish and sustain a base. The Circle slice includes its core
roster and a distinct construction or cultivation mechanic.

- M0's mission remains ARC's introduction. A short Circle introductory
  scenario teaches its economy and construction before the skirmish.
- The skirmish mission-start dialog selects ARC or Circle and Easy, Normal,
  or Hard difficulty. Faction choice and difficulty are independent.
- The AI is developed first as ARC against ARC on the existing roster. That
  mirror matchup is a development harness, not a shipped option. It requires
  an actor's controlling owner to be distinct from its definition's faction.
- M1 adds control groups, an idle-worker control, double-click and
  select-all-of-type selection, and keyboard bindings for Attack Move,
  production, and building actions, each with a touch alternative.
- UI work covers modular ownership of dialogs, sidebars, markup, and styles.
- External playtesting and incorporating feedback are part of the milestone.

The [M1 checklist](TODO.md#milestone-1) tracks design decisions, implementation,
and acceptance. Ownership, construction, cultivation, the roster, resource
scope, results, summary metrics, pacing, acceptance targets, controls, and
Circle presentation are defined here. Implementation and playable-slice tuning
are tracked in the checklist.

### M1 roster

- Troopers are general-purpose ranged infantry. Sentinels are tougher ranged
  infantry with shorter reach than Troopers. Troopers benefit from maintaining
  distance and concentrated fire; Sentinels withstand more punishment while
  advancing and protecting assault constructs. Both threaten exposed
  specialists and support units. Relative costs, speed, and durability are
  tuned through matches.
- Scouts and Wayfinders are fast, fragile, unarmed exploration specialists
  with substantially more vision than basic infantry. Scouts train at the
  Field Barracks; Wayfinders train at the Musterhall. Both use ordinary vision
  to discover routes and resources and observe enemy positions and expansion.
  Their speed, sight, health, and cost are independently tunable.
- Each faction adds one defense-breaking combat specialist. Specialists
  threaten structures but are inefficient against mobile troops. Both use
  ordinary single-target attacks with low damage against mobile units and a
  data-driven damage bonus against buildings, including defenses, producers,
  and economic structures. Exact damage, bonuses, and cadence are match-tuning
  values. Splash damage, siege deployment, and activated siege abilities are
  outside M1.
- ARC's **Demolition Trooper** is fragile, slow-firing infantry with a portable
  heavy launcher that outranges basic defenses. The Field Barracks trains it,
  and Medics restore its health.
- M1 includes Medics for ARC personnel and Mechanics for Harvesters, following
  the normal support rules. Both train at the Field Barracks and share its
  production queue with Troopers, Scouts, and Demolition Troopers. Surviving
  Harvesters can recover from raid damage through Mechanic support; buildings
  use their separate paid Repair action.
- The Circle's **Briar Ram** is a tougher, slower living assault construct
  that approaches and batters structures. Sentinels protect its approach;
  committing it to an assault carries more risk than ranged bombardment.
- The Circle's Heartgrove trains Cultivators. Its Musterhall trains Sentinels,
  Wayfinders, and Healers. Its **Construct Nursery** grows Briar Rams and
  trains Artificers through its own normal unit-production queue. Investing
  in the Nursery opens the construct assault force without occupying the
  Musterhall's queue and leaves room for future construct types.
- M1 includes Artificers to repair Briar Rams under the normal support
  rules. Healers restore biological units rather than living constructs.
- Basic troops protect specialists and threaten exposed enemy specialists.
  Static defenses protect economic sites against small raids. This gives
  mixed armies a way to attack defended positions.
- ARC's Sentry Turret is a relatively fragile, rapid-fire defense with moderate
  range. Overlapping coverage protects approaches. The Circle's Thornspire is
  a tougher living defense with shorter range and slower, heavier shots.
  Both use single-target attacks, automatically engage detected hostiles, and
  accept manual attack targets. Normal faction construction and repair rules
  apply, including ARC support connections and Cultivator tending for growth.
- Demolition Troopers outrange these basic defenses. Briar Rams can withstand
  defensive fire long enough to approach and attack.
- ARC's Relay Station is an inexpensive, unarmed building with a larger
  support radius than ordinary structures. It extends the connected network
  toward resource sites and forward positions. Losing an upstream connection
  can disable downstream buildings. Relays extend coverage; infrastructure
  capacity remains with Command Centers.
- Connected ARC expansion and worker-led Circle expansion are a core
  play-style difference. Circle expansion uses Cultivators and existing
  buildings without a dedicated expansion structure in M1. Additional
  Heartgroves provide independent infrastructure queues when needed.
- Resource costs follow the common-resource scope below. Combat statistics
  and costs are refined through playable matches.

### M1 Circle presentation

- Use sculpted living architecture: deliberately grown arches, curved
  structural ribs, layered bark or leaf plates, and clear entrances. Each
  building has a purposeful silhouette readable at the strategy camera's
  distance. Cultivated precision expresses an advanced interstellar people.
- Use warm, pale living wood for structural ribs, darker roots and joints,
  deep green foliage, and restrained violet light for magical activity.
  Reserve clear areas for owner colors, separate from faction materials.
- The Heartgrove has a tall, branching central trunk supporting a broad crown,
  with open arches between its roots.
- The Lifebloom Conservatory has a low, wide leaf canopy over a visible
  collection basin, with easy access for returning Cultivators.
- The Musterhall is elongated, with a vaulted roof of curved wooden ribs and
  a broad infantry entrance.
- The Construct Nursery is a rounded cradle enclosed by protective arches,
  with an opening large enough for a Briar Ram.
- The Thornspire is a narrow, sturdy column with thorn-like plates around a
  violet focus. Its crown opens briefly to fire a heavy magical bolt.
- Personnel are recognizable elven figures in fitted clothing and deliberately
  grown armor. Pale armor plates and curved equipment share the buildings'
  style. Clothing, equipment, and posture distinguish roles at gameplay scale.
- Sentinels have broad shoulders and substantial layered armor.
  Their grown focus weapon is a compact, curved frame of pale living wood
  around a violet core, held in both hands. It releases brief, concentrated
  magical bolts from a braced firing pose.
- Wayfinders have light equipment and compact silhouettes suited to speed.
- Cultivators wear practical clothing and carry a visible pod and a
  growth-tending tool.
- Healers have flowing mantles and open-handed casting poses.
- Artificers wear fitted work gear with prominent tool harnesses for tending
  constructs.
- The Briar Ram is a heavy quadruped with a low, broad body, four thick
  root-like legs, overlapping pale wood armor, and a reinforced head framed
  by curved thorns. Dark flexible joints and a partially sheltered violet
  core share the faction palette. It walks with deliberate steps, plants its
  feet, and delivers a short, forceful head strike at melee range.
- Circle construction has three stages, each covering one third of progress:
  roots establish and the central structure emerges; ribs and arches rise;
  then armor plates, leaves, and canopy elements unfold into the mature form.
- Small growth motions and restrained violet pulses show active tending.
  Paused construction retains its form, stops growth motion, and shows a
  paused indicator. The full reserved footprint and progress bar remain
  visible throughout. Loading derives the stage from saved progress.
- Living buildings and the Briar Ram show cracked wood plates, occasional
  falling leaves or fragments, and faint violet leaks at 60% health or below.
  At 30% or below, show deeper splits, drooping foliage, more frequent
  fragments, and an unstable, flickering core. Broken shapes and falling
  material convey severity alongside light effects. These cues recede as
  repair restores health.
- Destroyed living buildings fold and collapse into broken wood and roots as
  their light fades. The Briar Ram's legs buckle and its body settles into an
  inert husk. Personnel retain biological hit reactions and fallen bodies.
- Circle sound effects combine wooden impacts, leaf-like rustling, and clear
  musical tones. Orders and readiness use brief, distinct chimes; cultivation
  and growth use soft rustling over a warm, gently pulsing tone.
- Sentinel fire combines a sharp wooden crack with a short, bright magical
  tail; Thornspire fire uses a deeper, heavier version. Briar Ram strikes use
  weighty wooden impacts and cracking fibers. Healing and construct repair
  use soft harmonic patterns distinct from weapon sounds. Destruction uses
  splitting wood and fading low resonance.
- Keep sounds brief and limit overlapping work loops so a busy base remains
  comfortable to hear. Voice acting remains deferred.
- ARC and Circle share musical themes with faction arrangements. M1 adds one
  Circle exploration loop and one combat loop using soft plucked tones, airy
  sustained notes, and wooden percussion. Exploration is spacious and
  contemplative; combat adds a stronger pulse and denser percussion. The
  player's chosen faction selects the arrangement. Music stays below gameplay
  cues in the mix.
- The direction fits the offline GLB and WAV pipeline: seeded curved geometry
  and layered plates, humanoid and quadruped rigs, articulated clips, and
  original synthesis and composition. Implementation extends presentation for
  progress-selected growth forms, living damage and debris, and faction music
  selection. Task 1.53 owns assets, integration, and gameplay-scale validation.

### M1 resources and progression

- M1 uses common resources only: Materials for ARC and Lifebloom for Circle.
  All selected units and buildings use their faction's common resource,
  including Demolition Troopers, Briar Rams, and Construct Nurseries.
- Catalysts, Resonance, and mixed-yield collection are deferred beyond M1.
  Expansion remains useful for fresh ARC deposits and distributing Circle
  cultivation across renewable sites.
- Each selected unit is available once its assigned producer is operational,
  subject to ordinary costs, queue capacity, and worker-assignment rules.
  Building upgrades and permanent research are deferred beyond M1. Investment
  in income, producers, expansion, and forces provides progression.
- Headquarters retain one baseline infrastructure slot each. Adding another
  headquarters creates its own infrastructure queue and baseline capacity.
- ARC's initial skirmish balance is 150 Materials, covering a Materials
  Refinery at 100 and its Harvester at 50.
- Circle's initial skirmish balance is 150 Lifebloom, covering a Cultivator at
  50 and a Lifebloom Conservatory at 100.
- Each opening stockpile covers exactly its first worker and drop-off
  building. Player and AI use the same starting package for their chosen
  faction. Costs and starting balances are data-driven initial tuning values;
  adjust them together so the opening remains affordable through normal play.

### M1 skirmish results

- A side is eliminated when its owner has no qualifying completed buildings
  remaining. If exactly one owner is eliminated, the other wins. Surviving
  mobile units do not prevent elimination, avoiding a search for hidden units
  after their base is gone.
- Evaluate both owners' elimination once at the end of each simulation tick,
  after commands, simultaneous combat damage, and construction updates.
  Count surviving qualifying buildings completed by that checkpoint. If both
  owners have none, record a draw. Actor-processing order does not decide the
  outcome. Record the result and final statistics together, then freeze.
- ARC's qualifying types are Command Centers, Materials Refineries, Field
  Barracks, and Sentry Turrets. Circle's are Heartgroves, Conservatories,
  Musterhalls, Construct Nurseries, and Thornspires. Relay Stations do not
  count. Walls are outside M1's roster.
- Defensive buildings count because they can help surviving forces win from
  a stranded position. Revisit their inclusion through skirmish playtesting.
- Qualifying buildings count even when disconnected or otherwise inactive,
  including buildings completed during play and replacement headquarters.
  Losing the original headquarters alone does not eliminate an owner with
  another qualifying completed building.
- Unfinished construction does not prevent elimination. A replacement
  headquarters completed during the tick can keep its owner in the match even
  if the last earlier qualifying building is lost that tick. Normal tending,
  support, and infrastructure requirements still apply; paused jobs do not
  receive free completion. Sales use the same end-of-tick checkpoint, so an
  owner with no qualifying buildings then is eliminated. Unfinished blueprints
  cannot prolong a decided match.
- Economic stalls and weak surviving forces remain player-judged soft defeats;
  they do not eliminate an owner while a qualifying completed building remains.
- After losing its last operational headquarters, a surviving side may run
  one emergency replacement-headquarters construction job at a time without
  headquarters infrastructure capacity. It pays normal costs and uses normal
  build time. Other infrastructure work remains paused until an eligible
  operational headquarters becomes available.
- ARC may place that replacement Command Center within the usual support
  radius of a surviving owned, completed building, even when disconnected.
  Circle requires a surviving Cultivator to tend the replacement Heartgrove
  under normal placement rules. Completion restores normal infrastructure
  operation. This exception applies to the M1 skirmish.
- Victory, defeat, and draw end the M1 skirmish at its result tick and show
  the match summary. The battlefield remains frozen for camera and selection
  inspection. Offer Save, Restart, Load, and Main menu, without post-match free
  play. Named saves and Quicksave remain available for every outcome.
  The result and summary remain fixed. Loading a finished skirmish preserves
  that result; restarting begins a fresh match with the same setup.
- M1 skirmishes autosave at match start and every five simulation minutes
  while in progress. A tick ending the match does not overwrite Autosave,
  preserving its latest pre-result checkpoint. Manual saves, Quicksave, and
  Autosave remain separate entries. Loading a finished save restores frozen
  inspection; loading an in-progress save permits another attempt.

### M1 match summary

- Record each owner's milestones once, using simulation ticks. Display a
  milestone that never occurs as Not reached. The same definitions drive
  player summaries, headless AI reports, and playtest timing.
- First income is the first positive delivery of harvested or cultivated
  resources. Starting stocks, refunds, sales, and loot do not count.
- Military production ready is the first operational Field Barracks,
  Musterhall, or Construct Nursery. First combat unit is the first armed
  mobile unit entering play through normal production; workers, scouts, and
  support units do not count.
- First expansion is the first positive delivery containing resources
  gathered outside the owner's starting resource area. The authored map
  identifies starting resource sites for each start position; other sites
  qualify. A new headquarters or drop-off building is not required. Record
  the delivery tick, preserving cargo source attribution through site changes
  and saves.
- First engagement is the first positive damage an owner deals to or receives
  from the opposing owner. First base attack is the first positive damage it
  deals to an opposing building, including defenses, relays, and unfinished
  structures. Attack orders without damage do not count. Wildlife and neutral
  actors do not trigger these opponent-specific milestones.
- Track living mobile-unit counts and completed-building counts per owner,
  including defenses and relays regardless of elimination eligibility. Also
  track explored and currently visible map-tile counts. Explored tiles measure
  discovered terrain; currently visible tiles measure active vision coverage.
- Sample histories every five seconds of simulation time, with an initial
  sample and a final sample at the result. Milestones retain exact ticks.
  Saves preserve histories. Post-match comparison graphs show both owners;
  opponent histories are unavailable during play under normal visibility rules.
- Resources gathered counts harvested or cultivated resources deposited into
  stockpiles, excluding starting stocks, carried cargo, loot, sales, and
  refunds.
- Resources spent counts payments for construction, training, and repair,
  minus cancellation refunds. Sale proceeds do not erase earlier spending.
- Units produced counts units entering play through normal production,
  including workers and support units. Starting units and direct story grants
  do not count. Buildings completed counts normal construction completions,
  including replacement headquarters, excluding starting buildings and direct
  story grants.
- Combat losses counts owned units and buildings destroyed in combat,
  including unfinished construction. Sales and cancellations do not count.
- Peak army size is the maximum simultaneous count of living, armed mobile
  units, excluding defenses, workers, scouts, and support units. Track counters
  and peaks exactly through simulation events and ticks, independently of
  graph sampling. All recorded metrics stop at the result tick.

### M1 pacing and acceptance

- Normal M1 skirmishes target 15 to 25 minutes of simulation time at 1x speed,
  excluding pauses and loading, for both faction matchups. This is a balance
  target rather than a mission timer; longer matches may continue. Repeated
  stalemates prompt review of the map, AI, defenses, and economy.
- M1 AI has a four-minute opening grace period before initiating offensive
  operations. It establishes income, builds forces, and scouts during that
  period; local defense is allowed immediately.
- Initial development windows for an undisturbed Normal AI use whole-minute
  markers: first income around minutes 1 to 2, military production ready
  around minutes 2 to 4, first combat unit around minutes 3 to 5, and first
  expansion income around minutes 5 to 8. Earlier development is acceptable;
  these windows do not force waiting. Disruption can delay development, and
  factions may reach different parts of the windows. Preserve exact milestone
  ticks for analysis while using whole-minute targets for reporting.
- In normal, undisrupted play, target a first small raid against an observed
  opportunity around minutes 4 to 6 and a first substantial base assault around
  minutes 8 to 12. Use normally produced forces and observed targets. Losses,
  income disruption, or urgent defense can delay attacks. These are initial
  tuning targets for both factions rather than forced attack deadlines.
- Operation timing targets do not redefine the damage-based first engagement
  and first base-attack metrics; an earlier raid can damage a building.
- M1 includes Easy, Normal, and Hard using the existing enemy health and damage
  scaling: sqrt(0.5), 1, and sqrt(2), respectively. Difficulty does not change
  starting stocks, roster availability, AI profiles, or opening grace. Normal
  remains the pacing and balance baseline.
- Resolved mission setup and saves preserve faction choice, difficulty, and
  effective scaling. Restart uses the same choices. Existing saves retain
  their original difficulty.
- The headless baseline has 12 cases: either player faction, either start
  position, and all three difficulties. Both sides are AI-controlled; one
  stands in for the player while the opponent receives the selected enemy
  scaling. Each faction uses its standard skirmish AI profile.
- Normal cases establish pacing. Easy and Hard verify scaling, completed
  matches, and save/load behavior. Recovery and disruption cases are tested
  separately from the baseline matrix.
- Headless baseline cases have a 30-minute simulation-time cutoff. A case
  without a result at that limit is reported as Incomplete / stalled and fails
  the automated completion check. Preserve its state, milestones, and AI
  diagnostics for investigation. The cutoff belongs to the test runner;
  player-controlled matches continue under normal elimination rules.
- Benchmark scenes use a 5:1 mobile-unit-to-building ratio across both owners:
  200 mobile units and 40 buildings for the normal workload, and 400 mobile
  units and 80 buildings for stress testing. Units include workers, scouts,
  support, and combat actors. Exercise movement, pathfinding, gathering,
  combat, vision, and AI together.
- The normal workload must meet the agreed performance budgets. The stress
  workload measures degradation and exposes bottlenecks. These counts define
  benchmark scale; gameplay population limits remain a separate decision.
- The desktop performance reference is the development Mac laptop with an
  Apple M3 Pro and 18 GB memory. M1 performance acceptance uses this Mac.
- Phone and tablet browser layout and touch-input checks remain in M1.
  Physical mobile-device performance targets are deferred beyond M1.
- Measure the normal workload in production browser and packaged macOS builds
  at 1920 x 1080 actual render resolution. Target 60 FPS at 1x speed, with 95%
  of frames completing within 20 ms. Include active movement, gathering,
  combat, vision, and AI.
- Keep 60 simulation ticks per simulation second. For the normal workload,
  95% of simulation ticks should complete within 4 ms and 99% within 8 ms.
  At 2x speed, sustain 120 ticks per real second without a growing backlog
  and report rendering performance. Stress-case performance is diagnostic
  rather than subject to these same acceptance thresholds.

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
  and resolution ticks. M0 derives victory or defeat from those objectives.
  M1 preserves owner elimination, victory, defeat or draw, and the fixed result
  summary. Objective progress must match the definitions in the same file.
- Mission files carry their scenario popups and the IDs the player dismissed,
  and any ambient bird flocks.
- Mission saving provides manual save, load, restart, one rolling quicksave,
  and one rolling autosave. Loading begins paused. Restart reloads the level
  with the mission's scenario ID and preserves the original launch setup for
  assembled missions. Loading a level file makes it that scenario's restart
  level for the session. A tick-0 file with save metadata remains a save and
  does not replace that level. M1 saves preserve the pristine resolved setup
  required to reproduce their opening on restart.
- Manual saves form a named list without a count limit. Each entry shows its
  kind (Manual, Quick, or Auto), name, mission name, elapsed time, and
  timestamp. The quicksave and autosave replace only themselves.
- M0 autosaves when an objective completes and disables saving after defeat,
  so neither rolling save captures a lost M0 mission. Saving after a simulation
  fault is unavailable. M1 skirmishes permit named saves and Quicksave after
  every result; their start and five-minute autosaves preserve an in-progress
  recovery checkpoint under the skirmish rules.
- Platform services own storage. Browsers keep saves in local storage and
  exchange files by download and upload; the desktop build keeps saves as
  files in its app data folder and uses native file dialogs.
  Save writes and deletions finish in request order. Desktop library writes
  replace the previous file only after the new file has been written.
- Mission and campaign saves are separate schemas. A mission save owns one
  mission snapshot; a campaign save owns longer-lived choices and progression.
- Authoritative simulation state is serialized. Rendering objects, navigation
  caches, effects, and platform handles are reconstructed.
- M1 saves also carry control groups as player interface state outside the
  authoritative simulation snapshot. Keyboard bindings stay in device
  preferences and are not restored from a mission save.
- As ownership systems are implemented, saves preserve actor owners,
  effective relationships, sharing permissions, pool balances and membership,
  base affiliations,
  infrastructure queues, Cultivator tending assignments, and owner-scoped
  exploration and observations.
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
- Incompatible saves fail with a clear explanation. M0 guarantees same-build
  round-tripping without requiring cross-build migration. M1 is not required
  to load M0 saves, including distributed playtest saves. The ARC introduction
  remains playable from bundled levels authored for the current build.
- M1 development may break compatibility with earlier M1 builds. Migrations,
  legacy formats, and older rulesets are not required. Each build must reliably
  save and load its own authoritative state with deterministic continuation.
- Compatible updates, including presentation-only changes, preserve save
  compatibility. Application build changes alone do not invalidate saves.
- Increment the mission-file version for incompatible persisted-state, command,
  or built-in simulation changes. Increment the content-pack schema's
  `formatVersion` for incompatible pack-schema changes, and a pack's `version`
  when its rules or balance change how an existing save plays. Keep only the
  current supported formats and rulesets; mismatches fail explicitly.
- Apply version changes with the corresponding implementation, update validation
  and format documentation, and regenerate bundled levels to match. Ownership
  requires a mission-file version change when its state is implemented; other
  version changes follow the affected contracts. Current versions remain in
  use until those changes land.
- Incompatible saves remain listed with an **Incompatible** label, an
  explanation of the mismatch, and an option to delete them. A failed load
  leaves the current mission and stored save unchanged. Incompatibility alone
  never deletes or rewrites a save. Quicksave and autosave retain their normal
  rolling replacement behavior.

## Open decisions

- **Factions and campaigns**
  - Full rosters, counters, faction motifs, technologies, and campaign missions.
  - Exact Everwake resource, citadel, cache, and reveal details.
  - Alliance-only units or abilities and skirmish modes beyond the M1 matchup.
- **Maps and world systems**
  - Campaign map sizes, terrain palettes, resource placement, and neutral
    systems beyond the current playable slice.
  - World-event cadence and escalation.
  - Whether corruption spreads, and how players counter or exploit it.
- **Interface and presentation**
  - Accessibility tuning and final art and audio direction.
- **Future systems**
  - Multi-owner shared-pool membership and partial alliance-breakup policies
    beyond the accepted balance-division rule.
  - Technology-tree and permanent-research design.
  - Script conflict precedence and missing-target policies.
  - Historical strategic intelligence sharing and uncertainty tuning beyond
    the locked allied vision and detection rules.
  - Faction build plans, force composition, budgets, and behavior-profile
    schemas and tuning for concrete missions.
  - Deterministic mod dependency and load-order resolution, overrides, save
    compatibility across mod changes, trust and signing, and exact console APIs.
  - Multiplayer session rules, lobby flow, networking, and replay requirements.
