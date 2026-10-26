# TODO

## Milestone 1

Build a small ARC-versus-Circle skirmish, playable as either faction against
an AI that establishes and sustains its own base. Players should make useful
choices about income, production, expansion, protection, and recovery.

[DESIGN.md](DESIGN.md#milestone-1-planning-direction) owns the agreed game
requirements. This checklist tracks delivery; unresolved choices are tasks,
not settled rules. Record accepted rules in DESIGN.md and supporting rationale
in the [design questionnaire](docs/design-questionnaire.md).

### Using this checklist

- Work through the phases in order. Tasks within a phase may overlap when
  their prerequisites are ready; explicit dependencies take precedence.
- Task IDs are the milestone number and a task number, independent of phase
  letters. Keep them stable once work starts. Check a task only when its
  stated outcome is verified, including appropriate checks for implementation
  work.
- Run `npm run check` before completing coding tasks and `npm run check:full`
  before committing. Use [verification](docs/verification.md) for focused
  checks, platform coverage, and human acceptance.
- Keep task-specific findings and reproduction details in issues. Link issues
  from their tasks when useful; do not accumulate dated playtest logs here.
- Tasks that depend on an optional scope choice implement only the agreed
  content. Record a deliberate deferral beside the affected task.

### A. Baseline and design decisions

These decisions define implementation scope. Resolve each before starting
work that depends on it; Circle art direction can begin once construction and
roster choices are ready.

- [ ] **1.01** Prepare a reproducible M0 playtest build and report template.
  Agree on distribution and recruit an initial five-to-eight-person cohort
  spanning RTS-familiar and less experienced players. The browser bundle
  command and [tester instructions](docs/playtest-instructions.md) include a
  [report template](docs/playtest-report.md) and revision/file hashes.
  Distribution, cohort recruitment, and fixed-revision acceptance remain.
- [ ] **1.02** Run baseline M0 playtests using in-game guidance. Record
  controls, clarity, pacing, reliability, assistance, and abandonment; turn
  actionable findings into prioritized issues for the UI and onboarding work.
- [x] **1.03** Settle Circle construction, placement, infrastructure,
  interruptions, and worker capacity.
  [Construction](DESIGN.md#economy-and-construction) defines single-Cultivator
  tending, preserved progress, valid explored placement, independent buildings,
  Heartgrove infrastructure and worker production, and Conservatories without
  worker-slot caps. The skirmish
  trains its first Cultivator instead of requiring a preplaced worker.
  Implementation is tracked in 1.48 and 1.49.
- [x] **1.04** Specify cultivation throughput, dormancy triggers, recovery, and
  worker behavior. [Cultivation](DESIGN.md#economy-and-construction) defines
  renewable shared reserves, uncapped staffing, declining output, automatic
  dormancy and recovery, retained site assignments, delivery, interruptions,
  cargo handling, and visible feedback. Initial rates and capacities are
  data-driven. Implementation is tracked in 1.50 and 1.51, save verification
  in 1.56, and playable-slice tuning in 1.57.
- [x] **1.05** Select the minimum roster, roles, counters, and producers.
  [M1 roster](DESIGN.md#m1-roster) defines Demolition Troopers, Briar Rams,
  Construct Nurseries, support units, scouting, Sentinels, Sentry Turrets,
  Thornspires, and Relay Stations. Connected ARC expansion and worker-led
  Circle expansion use distinct infrastructure rules. Implementation is
  tracked in 1.39, 1.41, 1.42, 1.48, and 1.52. Resource and upgrade scope
  follows 1.06; balance is refined through playable matches.
- [x] **1.06** Settle resource and progression scope.
  [M1 resources](DESIGN.md#m1-resources-and-progression) defines common-only
  costs, producer-based availability, baseline headquarters capacity, and
  initial skirmish stocks of 150 Materials or Lifebloom. Each faction can
  afford its first worker and drop-off building. Costs and starts are tuned
  together. Implementation is tracked in 1.14, 1.16, and faction tasks;
  1.58 records the deferral of rare resources, upgrades, and research.
- [x] **1.07** Define skirmish setup. [Mission setup](DESIGN.md#mission-setup)
  defines two fixed start areas on one authored map, faction-specific assembly
  at launch, simultaneous operational-headquarters starts with income bootstrap
  packages, reproducible load and restart, and scenario-declared script
  authority. Starting amounts are defined in 1.06; the Circle worker bootstrap
  is defined in 1.03. Implementation is tracked in 1.14, 1.17, and 1.27.
- [x] **1.08** Decide actor ownership and distinguish owner rules from faction
  type rules. [Ownership rules](DESIGN.md#ownership-and-relationships) define
  control, vision, economy, support, headquarters-owned infrastructure,
  objectives, mutual relationships, and scenario-defined sharing, including
  relationship changes and recovery. Implementation is tracked in phase B.
- [x] **1.09** Lock victory, defeat, post-result behavior, and summary metrics.
  [Skirmish results](DESIGN.md#m1-skirmish-results) defines qualifying completed
  buildings, defense inclusion, relay exclusion, emergency headquarters
  recovery, soft defeats, end-of-tick elimination and draws, frozen results,
  and post-result named saves and Quicksave. Skirmish autosaves occur at start
  and every five simulation minutes, excluding result ticks. Campaigns offer
  optional free play after victory or defeat with the outcome preserved.
  [Match summary](DESIGN.md#m1-match-summary) defines milestones, exact totals
  and peaks, and five-second population and map-coverage histories.
  Implementation is tracked in 1.16, 1.25-1.27, 1.49, 1.61, and 1.62.
  Revisit defense inclusion through playtesting in 1.66.
- [x] **1.10** Set pacing, difficulty, test coverage, scale, and performance
  targets. [M1 acceptance](DESIGN.md#m1-pacing-and-acceptance) defines Normal's
  15-to-25-minute match target, whole-minute AI windows, four-minute offensive
  grace, all three difficulties, 12 baseline cases, and a 30-minute headless
  cutoff. Benchmark 200 units/40 buildings normally and 400 units/80 buildings
  for stress testing on the M3 Pro/18 GB development Mac. Budgets cover 1080p
  rendering, tick-time percentiles, and 2x simulation pace. Physical mobile
  performance is deferred; compact layout and touch checks remain.
  Implementation and verification are tracked in 1.14, 1.27-1.30, 1.37, 1.60,
  1.63, and 1.64.
- [x] **1.11** Set the M1 persistence policy.
  [Persistence](DESIGN.md#persistence) defines development compatibility breaks
  without migrations or legacy rulesets, deterministic same-build continuation,
  version-change rules, and visible, manually deletable incompatible saves with
  safe load rejection.
  Implementation is tracked in 1.23 and 1.27.
- [x] **1.12** Choose default keys and touch/on-screen alternatives for control
  groups, idle workers, selection, Attack Move, production, and construction.
  [Controls and interface](DESIGN.md#controls-and-interface) defines the
  accepted group, idle-worker, matching-unit, command, and menu-position
  shortcuts and their on-screen alternatives. M1 includes keyboard rebinding
  and support for European layouts. Defaults use physical key positions with
  layout-aware labels. Group membership persists with saves and clears on
  restart or a new mission; keyboard preferences remain independent.
  Circle construction uses selected Cultivators and manual Tend replacement.
  Matching-unit actions belong to explicit type entries in mixed selections,
  replacing selection by default and adding matches in Add units mode.
  Implementation is tracked in 1.27, 1.44, 1.45, and 1.49.
- [x] **1.13** Establish Circle art and audio direction for living structures,
  constructs, infantry, growth, damage, and faction identity.
  [Circle presentation](DESIGN.md#m1-circle-presentation) defines architecture,
  palette, silhouettes, weapons, growth, damage, sound effects, and faction
  music arrangements. The direction fits the existing offline geometry,
  rigging, animation, and audio synthesis pipeline without hand-authored
  binary art. New asset recipes, presentation integration, and gameplay-scale
  validation remain in 1.53.

Phase gate: dependent rules and acceptance values are recorded, the selected
roster is bounded, and baseline findings have an actionable disposition.

### B. Multi-faction and UI foundations

Use the decisions from phase A. Keep the ARC introduction playable throughout
and bring up the rough skirmish map early for simulation and AI development.

- [ ] **1.14** Author the rough skirmish map with both start slots, expansion
  sites, scouting opportunities, and attack routes. Implement the selected
  setup mechanism using the ARC mirror harness for starts and restarts.
  Map authoring can begin first; setup integration depends on 1.15-1.17 and
  1.27. Supply ARC starting packages and define the Circle setup inputs for
  later content integration. Circle income checks follow 1.48-1.50;
  both-faction first deposits and restart coverage are verified in 1.59.
  Identify starting resource sites per start position for expansion metrics.
  Resolve chosen faction and difficulty into setup, applying existing enemy
  health/damage scaling while keeping starting stocks and AI profiles intact.
  The generated `skirmish-map` preview and authoring inputs provide both
  slots, three independent crossings, home income, and expansion areas.
  The rough-map preview is playtested and accepted.
  Headless checks cover slot symmetry, flat base space, resource access, and
  ARC's paid first-income opening from either slot through the single-faction
  opening builder. Owner-based launch assembly,
  difficulty, resolved restart setup, and Circle integration remain pending
  their implementation dependencies.
- [ ] **1.15** Implement the actor ownership model from 1.08 across hostility,
  support networks, vision and fog, economy, objectives, presentation, and
  saves. Verify that opposing owners of the same faction type fight and keep
  separate support networks.
  Cover mutual relationship changes, neutral attack restrictions, allied
  vision ending with exploration retained, and revocation of scenario-enabled
  support and headquarters access. Preserve effective relationships in saves.
- [ ] **1.16** Give each owner its own stockpiles, workers, production, and
  stall state, with infrastructure queues and slots per headquarters and
  training queues per production building. Verify that spending and refunds
  cannot affect another owner's economy without explicit resource sharing.
  Verify that completing another headquarters adds an independent queue and
  baseline capacity without moving existing buildings' affiliations.
  Cover separate resource types, same-type sharing, and separating pools
  without losing or duplicating balances. Verify reassignment preserves paid
  work and priority within receiving capacity; training stays on its producer.
  Implement the M1 skirmish's single emergency headquarters job at normal cost
  and build time when no operational headquarters remains.
- [ ] **1.17** Add issuing-owner authority to commands and validate actor
  ownership, including between same-faction-type owners in the development
  harness. Implement the agreed mission-script authority and reject
  unauthorized work.
- [ ] **1.18** Replace player-only simulation assumptions, including loot
  collection, with owner-neutral rules or explicit documented exceptions.
- [ ] **1.19** Add authoritative AI observation memory for observed enemies,
  economic sites, and threats, with last-seen positions and ticks. Expose
  only the observations and authored map knowledge permitted by the plan.
- [ ] **1.20** Keep player alerts, audio, minimap pulses, and sidebar data
  limited to the player's own actors and detections. Verify that hidden AI
  activity does not leak through these presentation paths.
- [ ] **1.21** Review UI ownership and choose the smallest coherent structure
  for feature-owned markup, behavior, styles, and shared layout primitives.
  Record the boundaries before refactoring; retain the locked technical stack.
- [ ] **1.22** Modularize dialogs with consistent focus, dismissal, pause and
  resume, asynchronous-work handling, and disposal. Verify interactions among
  menus, contextual guides, and mission-result screens.
- [ ] **1.23** Separate navigation and save/load presentation from session
  startup and teardown. Verify repeated loads, restarts, and returns to title
  without stale handlers, pending work, or retained session resources. Keep
  incompatible saves listed with their reason and deletion action, following
  the persistence policy from 1.11.
  Allow named saves and Quicksave after all skirmish results. Autosave at match
  start and each five-minute simulation boundary while in progress, skipping
  result ticks and preserving separate save entries.
- [ ] **1.24** Make sidebar features composable and supply faction names,
  resource labels, costs, and actions through content and player-visible state.
  Modularize their markup and styles without duplicating the ARC sidebar.
- [ ] **1.25** Add the agreed objective rules for actors constructed during
  play. Eliminate owners on loss of qualifying completed buildings, including
  inactive buildings and replacement headquarters, without relying only on
  fixed authored actor IDs. Mobile units and unfinished construction do not
  prevent elimination. Selling the last qualifying building also eliminates
  its owner. Include defensive buildings and exclude Relay Stations. Verify
  emergency recovery while a qualifying building remains and same-tick draws
  independent of actor-processing order. Economic stalls alone never resolve
  the match.
  Evaluate both owners once at tick end after commands, combat, and
  construction. Cover same-tick completion and loss, sales, and construction
  paused by lost support or tending. Latch result and final metrics together.
- [ ] **1.26** Record match milestone ticks, losses, and result in mission state
  using the definitions from 1.09. Make the data available to summaries and
  headless reports. Freeze the recorded summary at the result tick.
  Include per-owner population, exploration, and active-vision histories;
  sample every five simulation seconds, with initial and final samples, and
  preserve histories and exact milestone ticks through save/load.
  Preserve cargo source attribution to record the first delivered income from
  outside each owner's starting resource area, including mixed-source cargo.
  Record opponent-specific engagement and building-attack milestones from
  committed damage, including defenses, relays, and unfinished structures.
  Verify exact resource, production, completion, loss, and peak-army counters,
  including cancellation refunds, sale proceeds, and authored starting actors.
- [ ] **1.27** Update mission and content formats, validation, and documentation
  for ownership, multi-faction state, observations, objectives, and metrics.
  Include effective difficulty and scaling, plus the skirmish draw result and
  its resolution tick. Control-group interface-state persistence is added
  with the feature in 1.44.
  Apply version changes with their implementations and regenerate bundled
  levels. Verify save/load continuation and safe rejection under the
  compatibility policy from 1.11.
- [ ] **1.28** Profile the rough map at 200 mobile units and 40 buildings
  across both owners, with a 400-unit/80-building stress scene. Measure
  pathfinding, group movement, vision, and tick/frame costs; address blockers
  before roster and AI work depend on the target scale.

Phase gate: independent owners can operate through the same simulation rules,
ownership and information boundaries hold, and M0 still works.

### C. AI development harness

Use ARC against ARC on the rough map and existing roster to prove the shared
AI before Circle content. This matchup remains a development tool. Build the
runner, overlay, and persistence first so later AI tasks are developed and
verified with them.

- [ ] **1.29** Add a deterministic director with mission profiles, concurrent
  priorities, shared spending and force allocation, and counted work limits
  per tick. All actions enter through the normal command boundary.
- [ ] **1.30** Add a headless AI-versus-AI runner reporting each match summary
  and result. Accept profiles and start-slot assignments as case inputs rather
  than depending on random seeds in a simulation that has no randomness.
  Exercise the runner with the ARC mirror harness first. Support player-side
  AI and opposing enemy difficulty scaling through configurable cases; the
  full 12-case ARC-versus-Circle matrix runs in 1.63 after Circle is playable.
  Stop unfinished baseline cases at 30 simulation minutes, report Incomplete /
  stalled as a failed completion check, and preserve state and AI diagnostics.
- [ ] **1.31** Add a development overlay showing posture, operations, budgets,
  and remembered observations without exposing them in normal player UI.
- [ ] **1.32** Serialize authoritative AI state, including plans, assignments,
  observations, timers, and budgets, as each part is added. Verify identical
  continuation after loading and across different clock batching, including
  bounded catch-up work.
- [ ] **1.33** Implement the initial ARC build plan: gather, place valid
  buildings, train workers and forces, and maintain functioning income and
  production using actual resources and normal costs and timings.
- [ ] **1.34** Add recovery plans for ordinary worker, production, and
  support-link losses. Verify recovery without free replacements or resources.
- [ ] **1.35** Add scouting and observation-driven goals. The AI may know
  authored terrain, routes, and resource locations; enemy state and current
  yields require observation. Test stale reports and lost contact.
- [ ] **1.36** Add group operations for local defense, raids on exposed income,
  and attacks. Implement assignment, retreat, regrouping, bounded replanning,
  and release of forces under the existing [AI rules](DESIGN.md#npc-ai).
- [ ] **1.37** Tune opening grace, commitment, pursuit, retreat, and recovery
  through profiles. Keep these separate from difficulty health/damage scaling.
  Enforce M1's four-minute offensive grace period while allowing local defense.
  Tune normally funded, observation-driven raids and substantial assaults to
  the agreed windows without forcing attacks during crises.
- [ ] **1.38** Exercise the ARC mirror harness through completed matches,
  recovery cases, and the agreed scale with AI enabled. Resolve deadlocks,
  resource leaks, ownership faults, and performance blockers.

Phase gate: ARC AI establishes and rebuilds its base, scouts, defends, and
attacks through shared rules, with reproducible results and useful diagnostics.

### D. Expanded ARC base and controls

Use the roster from 1.05 and extend the functioning ARC AI as content lands.
M1 uses common resources and producer-based availability, with rare resources,
upgrades, and research deferred. Task IDs remain stable across phase changes.

- [x] **1.58** Record the optional-system scope from 1.06. Rare resources,
  mixed-yield collection, building upgrades, and permanent research are
  deferred beyond M1. Common owner balances, Circle Lifebloom, and ordinary
  producer availability remain part of 1.16 and the faction implementation
  tasks. No selected roster or AI task requires these deferred systems.
- [ ] **1.39** Add the ARC Relay Station and Sentry Turret as data-driven
  content. Verify support loss, reconnection, placement, targeting, and the
  expansion or protection choices they are intended to provide.
- [ ] **1.40** Implement building repair through each headquarters'
  infrastructure pool, following [recovery rules](DESIGN.md#repair-and-healing).
  Cover payment, cancellation, paused work, disconnection, and competition with
  construction.
- [ ] **1.41** Add Medic and Mechanic support from the Field Barracks, including
  eligible targets, automatic service, manual priority, pursuit limits,
  single-provider rules, and save/load continuation. Verify personnel healing
  and recovery of Harvesters that survive raid damage.
- [ ] **1.42** Add the Demolition Trooper to Field Barracks production.
  Implement its single-target building damage bonus and verify the counter
  relationship and reason to field a mixed force.
- [ ] **1.43** Generate and register the added ARC models, animation, command
  feedback, effects, and essential audio. Verify readability and generated
  asset contracts for each included actor.
- [ ] **1.44** Add control groups, double-click selection, select-all-of-type,
  and idle-worker controls with the chosen keyboard and touch alternatives.
  Verify ten manual mobile-unit groups, overlapping membership, selection-only
  recall, quick-repeat focus, destroyed-member removal, and Groups panel
  actions. Verify number-key recall, Ctrl+Shift+number assignment, and
  Shift+number addition in browser and desktop builds, including Mac Control.
  Verify Period cycling and focus, Shift+Period selection without camera
  movement, and the Idle workers count and actions. Cover stopped and depleted
  workers, carried resources, pending orders, and retained waiting assignments.
  Verify exact-type owned mobile-unit selection in view by double-click,
  additive Shift-double-click, and panel actions for view or map scope with
  Add units support. Buildings retain individual selection.
  Extend the save format for player interface state and restore group
  membership, retaining only surviving owned mobile units. Verify restart and
  new-mission clearing, and loading with current keyboard preferences without
  affecting simulation outcomes. Verify type entries and selected counts in
  mixed selections, named in-view and map-wide actions, replacement selection,
  and Add units preserving the other selected types.
- [ ] **1.45** Add Attack Move, production, and construction bindings. Verify
  A targeting, Shift-click queuing, Escape and Cancel, and S stopping active
  and queued orders without clearing selection. Verify B opening construction,
  Q/W/E/R/T activating stable card positions in the active production panel,
  one unit per training activation, displayed keys, and R rotating during
  placement while card shortcuts wait. Verify focus rules, dialog/form-field
  precedence, disabled-action explanations, and compact landscape usability.
  Add keyboard rebinding in Options, current-binding labels, context-aware
  conflict feedback, Reset to defaults, and preferences shared across missions
  independently of saves. Verify physical-position defaults and layout-aware
  labels on QWERTY, AZERTY, and QWERTZ, including number-row group shortcuts
  with modifiers and production-card positions. Cover hosts without automatic
  layout labels and unavailable system/browser key combinations.
- [ ] **1.46** Extend ARC AI build plans and operations to use the selected
  expansion, defense, recovery, and combat content.
- [ ] **1.47** Playtest ARC expansion, base layout, defense, rebuilding, support
  units, and controls with the cohort. Play against the harness AI on the rough
  map through a development link or test-build entry; keep the mirror matchup
  out of the normal menu. Check whether repair under attack blocks rebuilding
  excessively; propose any rule changes explicitly before tuning beyond the
  locked infrastructure rules. Fix and retest recurring blockers.

Phase gate: the expanded ARC base can grow, defend, recover, and field useful
mixed forces under both player and AI control.

### E. Circle playable loop and introduction

Use the construction, cultivation, roster, and presentation choices from
phase A and the shared foundations from phases B and C. Use Lifebloom-only
costs and producer-based availability for Circle content and AI.

- [ ] **1.48** Add Heartgrove, Lifebloom Conservatory, Cultivator, Musterhall,
  Sentinel, and Wayfinder as data-driven content with Circle-facing labels,
  costs, production, and starting resources. Verify tougher, shorter-ranged
  Sentinels and fast, fragile, unarmed Wayfinders with extended ordinary vision.
  Heartgroves train Cultivators; verify startup funds cover the first worker
  and Conservatory through normal play without a preplaced worker.
- [ ] **1.49** Implement the selected Circle construction, placement,
  infrastructure, and worker-capacity rules. Verify interrupted work and
  rebuilding, single-worker tending and replacement, slot yielding, independent
  completed buildings, and Conservatories without worker-slot caps.
  Verify emergency Heartgrove recovery still requires Cultivator tending.
  Require a selected Cultivator, explain unavailable construction cards, and
  choose the nearest selected reachable worker with a highlighted preview.
  Verify manual Tend replacement preserves payment and progress and normal
  interruption rules apply to the assigned worker. Provide Tend through
  on-screen and radial-menu actions.
- [ ] **1.50** Implement renewable cultivation, reserve-limited output,
  dormancy, and recovery. Verify the selected rates, output curve, thresholds,
  active regeneration, uncapped staffing, retained site assignments, manual site
  changes, automatic recovery resumption, nearest reachable owned Conservatory
  delivery, and cargo retention when delivery is blocked. Verify immediate
  interruptions preserve cargo, a new site order delivers cargo first, and
  dormancy keeps Gather active without advancing queued orders.
  Verify that simultaneous workers cannot overdraw reserves and that reserve
  allocation and dormancy transitions remain deterministic.
- [ ] **1.51** Add site and worker feedback that distinguishes dormancy, blocked
  routes, idle workers, missing delivery destinations, untended construction,
  and unavailable Heartgrove capacity. Show selected-site reserve, efficiency,
  state, and recovery threshold, recovery-waiting worker status, and one
  notification when a worked site enters dormancy. Provide the guides and
  briefing needed to explain the Circle's economy and construction.
- [ ] **1.52** Add Healer and Artificer support, the Thornspire, Briar Ram,
  and Construct Nursery. Circle expansion uses existing structures. Verify
  target eligibility, counter relationships, recovery, production requirements,
  the Briar Ram's single-target building damage bonus, and the Nursery's shared
  Briar Ram/Artificer queue. Musterhalls train Healers.
- [ ] **1.53** Generate Circle models, textures, growth and combat animations,
  effects, and essential audio under the
  [Circle presentation direction](DESIGN.md#m1-circle-presentation).
  Verify the complete roster's silhouettes, palette, owner markings,
  entrances, weapons, and animation contracts at gameplay scale. Integrate
  three growth stages, active and paused tending feedback, and restoration
  from saved progress. Verify damage thresholds, repair recovery, destruction,
  and reduced-motion readability. Generate distinct work, weapon, support, and
  destruction cues with brief tails and work-loop limits. Add Circle
  exploration and combat arrangements selected by player faction, with music
  below gameplay cues. Rebuild assets reproducibly and verify pack bindings.
- [ ] **1.54** Author the short Circle introductory scenario teaching
  cultivation, dormancy, construction, and production before skirmish play.
  Keep M0 available as ARC's introduction.
- [ ] **1.55** Add the Circle AI build plan and operations for its economy,
  infrastructure, roster, and recovery. Exercise it through the shared harness.
- [ ] **1.56** Verify Circle saves and deterministic continuation through
  construction, tending assignments and worker replacement, cultivation,
  dormancy, recovery, and support work. Preserve site reserves and dormancy
  state, worker cargo, cultivation progress, assignments, and queued orders.
- [ ] **1.57** Playtest the Circle introduction and base loop with the cohort,
  launched through a development link or test-build entry until 1.60 adds the
  menu flow. Verify that RTS-familiar newcomers understand its differences,
  can establish and sustain a base, and can explain a useful cultivation
  decision. Refine cultivation rates, reserve capacity, cargo capacity, and
  dormancy thresholds using the playable slice. Fix and retest recurring
  confusion before full-match balancing.

Phase gate: Circle play is a complete, understandable loop with a meaningful
cultivation distinction, and its AI can sustain the same economy and roster.

### F. Complete skirmish integration

Build on both playable loops and the shared opponent using the common-resource
and producer-based progression scope from 1.06.

- [ ] **1.59** Finish the map with viable routes, expansion opportunities,
  scouting landmarks, and defensible starts for both player assignments.
  Verify both factions in both start slots can fund and complete their first
  worker and drop-off building, deliver resources, and restart reproducibly
  from the assembled setup after 1.48-1.50.
- [ ] **1.60** Add the normal-menu flow for faction choice, introductions, and
  skirmish launch. The mission-start dialog offers ARC or Circle and Easy,
  Normal, or Hard difficulty.
- [ ] **1.61** Wire the agreed objectives, victory, defeat, and post-result
  behavior into complete matches, including same-tick elimination draws.
  Freeze skirmishes for inspection after every result and offer Save, Restart,
  Load, and Main menu. Keep Quicksave available; loading finished saves
  restores frozen inspection. Campaign free play is separate from this flow.
  Verify load preserves the result and restart begins a fresh match with the
  same chosen faction assignment, difficulty, scaling, rules, and scenario.
  Verify a terminal tick coinciding with an autosave boundary preserves the
  pre-result Autosave. Apply the end-of-tick result timing from 1.09.
- [ ] **1.62** Present the persisted match summary on the results panel and in
  headless reports, including income, production, expansion, attack, losses,
  and result. Include unit, building, exploration, and active-vision histories.
  Show both owners' comparison graphs after the match, keeping opponent
  histories hidden during play. Show the defined resource, production, loss,
  and peak-army totals. Use the same definitions in playtest reports.
- [ ] **1.63** Run the agreed headless profile/start-slot set for ARC versus
  Circle and Circle versus ARC: both player factions, both start positions,
  and Easy, Normal, and Hard, totaling 12 baseline cases. Use standard faction
  profiles. Tune pacing on Normal; verify scaling, results, and save/load on
  Easy and Hard. Require results by the 30-minute simulation cutoff; preserve
  unfinished cases for diagnosis. Test recovery and disruption separately.
- [ ] **1.64** Measure the complete skirmish with AI at 200 mobile units and
  40 buildings across both owners on the M3 Pro/18 GB development Mac. Meet
  the tick-time and frame-rate budgets in production browser and packaged
  macOS builds at 1920 x 1080 actual rendering, following the
  [performance procedure](docs/verification.md#m1-performance-measurement).
  Verify 2x keeps simulation pace and report rendering performance. Report
  degradation at 400 units and 80 buildings, exercising movement, gathering,
  combat, vision, and AI together. Physical mobile performance targets are
  deferred; compact layout and touch checks remain.

Phase gate: either faction can enter a complete skirmish through the normal
menu, and both matchups meet the agreed automated behavior and scale targets.

### G. External feedback and milestone acceptance

Use a distributable build and complete the feedback loop on a fixed revision.
Automated matches establish correctness; human play establishes clarity,
challenge, pacing, and useful choices.

- [ ] **1.65** Distribute the integrated build through the agreed channel and
  run full skirmish playtests with both factions. Observe in-game onboarding,
  time to key milestones, assistance, confusion, and abandonment; ask what
  drove build, expansion, and combat choices.
- [ ] **1.66** Verify that first-time ARC players, using M0 and in-game help,
  and RTS-familiar Circle players, after the Circle introduction, establish
  income, production, defense, and an expansion. Observe testers winning and
  losing with both factions on Normal, exercising attack, defense, and
  recovery. Verify that included combat and support roles are useful and no
  opening depends on developer knowledge. Revisit whether surviving defensive
  buildings support useful comebacks or mainly prolong cleanup.
- [ ] **1.67** Triage external findings into actionable issues, incorporate
  fixes, and retest affected paths. Resolve recurring progression blockers;
  give remaining issues an explicit priority and disposition.
- [ ] **1.68** Complete regression coverage for actor ownership, resource
  isolation, command authority, information boundaries, recovery,
  cultivation, objectives, metrics, AI save/load, and clock-batching
  equivalence. Verify end-to-end startup, match, results, load, restart, and
  return-to-title flows.
- [ ] **1.69** Verify browser, built Windows and macOS apps, keyboard/pointer,
  representative compact touch layouts, audio, focus, pause, and session
  replacement on a fixed revision. Test installation and release bundles
  when distributing desktop packages, following docs/verification.md.
- [ ] **1.70** Run the required automated checks, verify generated levels and
  assets match their sources, and confirm that human and headless acceptance
  targets are met. Update DESIGN.md, README.md, docs/verification.md, and
  affected format/content contracts to describe the delivered game before
  closing M1.

Phase gate: both factions pass the agreed match, performance, persistence,
platform, and human acceptance targets, with feedback incorporated and known
issues dispositioned.

### Deferred scope

Keep these outside the checklist unless an explicit scope decision adds them:

- Full faction rosters, tech trees, campaign progression, and competitive
  balance across arbitrary maps.
- Mirror matchups as a player-facing option.
- Multiplayer, native mobile delivery, map editing, mod management, and the
  modding console.
- Citadel and relic systems, the Everwake reveal and exotic currency,
  corruption, and world-event escalation.
- Air, underground and naval layers, transports, oversized deployables,
  stealth, and veterancy.

[sites]: docs/design-questionnaire.md#q8g-do-resource-sites-deplete-or-recover
