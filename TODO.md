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
  spanning RTS-familiar and less experienced players.
- [ ] **1.02** Run baseline M0 playtests using in-game guidance. Record
  controls, clarity, pacing, reliability, assistance, and abandonment; turn
  actionable findings into prioritized issues for the UI and onboarding work.
- [ ] **1.03** Settle Circle construction, placement restrictions,
  infrastructure dependence, interrupted work, and Conservatory worker
  capacity. Do not assume ARC's support chain or one-worker-per-Refinery rule
  applies.
- [ ] **1.04** Specify cultivation throughput, dormancy triggers, recovery, and
  worker behavior. Preserve the agreed renewable-resource distinction in
  [Q8][sites], with initial tunable values and visible site states.
- [ ] **1.05** Select the minimum roster: ARC relay, basic defenses, one extra
  combat role per faction, support units, producers, and any Circle expansion
  structure. Define each role, counter, and production requirement. Include
  Mechanic and Artificer only if the selected slice gives them a useful role.
- [ ] **1.06** Settle resource and progression scope. Prefer common resources
  initially; decide whether selected content requires Catalysts and Resonance.
  Decide whether any building upgrade is essential, and defer permanent
  research unless explicitly brought into scope. Identify which roster and AI
  tasks depend on the optional systems in 1.58.
- [ ] **1.07** Define skirmish setup: fixed start slots, starting assets, map
  generation per faction assignment or assembly at launch, and mission-script
  command authority. Restart and saves must reproduce the chosen setup.
- [ ] **1.08** Decide actor ownership. Hostility, support, vision, and control
  currently use definition factions, so two ARC sides share control and support
  rather than acting as opponents. Objectives reference fixed actor IDs.
  Separate the controlling owner from the faction type, define which rules
  use each, and record the rule in DESIGN.md. Consider later alliances and
  multiplayer.
- [ ] **1.09** Lock victory, defeat, and post-result behavior for both factions,
  including rebuilt headquarters, surviving units, disconnected buildings,
  and economic dead ends. Define the summary's income, production, expansion,
  and attack milestones precisely enough to measure.
- [ ] **1.10** Set match-length targets, AI milestone time windows, the headless
  profile/start-slot test set, actor-count targets, and simulation tick-time
  and frame-rate budgets for named desktop and compact-device configurations.
  Decide whether M1 offers difficulty selection beyond the Normal baseline.
- [ ] **1.11** Set the M1 persistence policy, including whether distributed M0
  saves must load. Plan mission-file and content-pack version changes and
  incompatible-file behavior before changing formats.
- [ ] **1.12** Choose default keys and touch/on-screen alternatives for control
  groups, idle workers, selection, Attack Move, production, and construction.
- [ ] **1.13** Establish Circle art and audio direction for living structures,
  constructs, infantry, growth, damage, and faction identity. Confirm that
  the offline generators can express it without hand-authored binary art.

Phase gate: dependent rules and acceptance values are recorded, the selected
roster is bounded, and baseline findings have an actionable disposition.

### B. Multi-faction and UI foundations

Use the decisions from phase A. Keep the ARC introduction playable throughout
and bring up the rough skirmish map early for simulation and AI development.

- [ ] **1.14** Author the rough skirmish map with both start slots, expansion
  sites, scouting opportunities, and attack routes. Implement the selected
  setup mechanism and verify reproducible starts and restarts for either side.
- [ ] **1.15** Implement the actor ownership model from 1.08 across hostility,
  support networks, vision and fog, economy, objectives, presentation, and
  saves. Verify that two owners of the same faction type are hostile and keep
  separate support networks.
- [ ] **1.16** Give each owner its own stockpiles, workers, production,
  construction queue, infrastructure slots, and stall state. Verify that
  spending and refunds cannot affect another owner's economy.
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
  without stale handlers, pending work, or retained session resources.
- [ ] **1.24** Make sidebar features composable and supply faction names,
  resource labels, costs, and actions through content and player-visible state.
  Modularize their markup and styles without duplicating the ARC sidebar.
- [ ] **1.25** Add the agreed objective rules for actors constructed during
  play. Cover headquarters replacement and the chosen base-destruction rules
  without relying only on fixed authored actor IDs.
- [ ] **1.26** Record match milestone ticks, losses, and result in mission state
  using the definitions from 1.09. Make the data available to summaries and
  headless reports.
- [ ] **1.27** Update mission and content formats, validation, and documentation
  for ownership, multi-faction state, observations, objectives, and metrics.
  Verify save/load continuation and the compatibility policy from 1.11.
- [ ] **1.28** Profile the rough map at the agreed actor count. Measure
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
  and result. Support the agreed profile and start-slot variations instead of
  depending on random seeds in a simulation that has no randomness.
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
- [ ] **1.38** Exercise the ARC mirror harness through completed matches,
  recovery cases, and the agreed scale with AI enabled. Resolve deadlocks,
  resource leaks, ownership faults, and performance blockers.

Phase gate: ARC AI establishes and rebuilds its base, scouts, defends, and
attacks through shared rules, with reproducible results and useful diagnostics.

### D. Expanded ARC base and controls

Use the roster from 1.05 and extend the functioning ARC AI as content lands.
Complete selected optional systems in 1.58 before dependent roster, AI, and
playtest tasks in phases D and E. Task IDs remain stable across phase changes.

- [ ] **1.58** Implement resource or building-upgrade systems selected in 1.06
  and integrate them with ARC. Include collection, costs, payment, refunds,
  infrastructure, UI, AI budgets, and persistence as applicable, or record the
  agreed deferral here. Circle content uses these systems in phase E.
- [ ] **1.39** Add the selected ARC relay and defensive structure as data-driven
  content. Verify support loss, reconnection, placement, targeting, and the
  expansion or protection choices they are intended to provide.
- [ ] **1.40** Implement building repair through the shared infrastructure pool,
  following [recovery rules](DESIGN.md#repair-and-healing). Cover payment,
  cancellation, paused work, disconnection, and competition with construction.
- [ ] **1.41** Add Medic support and any selected Mechanic role, including
  eligible targets, automatic service, manual priority, pursuit limits,
  single-provider rules, and save/load continuation.
- [ ] **1.42** Add the selected ARC combat role and its production requirements.
  Verify the intended counter relationship and reason to field a mixed force.
- [ ] **1.43** Generate and register the added ARC models, animation, command
  feedback, effects, and essential audio. Verify readability and generated
  asset contracts for each included actor.
- [ ] **1.44** Add control groups, double-click selection, select-all-of-type,
  and idle-worker controls with the chosen keyboard and touch alternatives.
- [ ] **1.45** Add Attack Move, production, and construction bindings. Verify
  focus rules, dialog/form-field precedence, disabled-action explanations,
  and compact landscape usability for all new controls.
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
phase A and the shared foundations from phases B and C. Integrate selected
resource and upgrade systems from 1.58 into dependent Circle content and AI
before testing the complete loop.

- [ ] **1.48** Add Heartgrove, Lifebloom Conservatory, Cultivator, Musterhall,
  Sentinel, and Wayfinder as data-driven content with Circle-facing labels,
  costs, production, and starting resources.
- [ ] **1.49** Implement the selected Circle construction, placement,
  infrastructure, and worker-capacity rules. Verify interrupted work and
  rebuilding without inheriting ARC-specific assumptions accidentally.
- [ ] **1.50** Implement renewable cultivation, throughput limits, dormancy,
  and recovery. Verify worker routing, delivery, reassignment, and restoration
  of active cultivation after a site recovers.
- [ ] **1.51** Add site and worker feedback that distinguishes dormancy, blocked
  routes, idle workers, and missing delivery destinations. Provide the guides
  and briefing needed to explain the Circle's economy and construction.
- [ ] **1.52** Add Healer support, the selected Circle defense and combat role,
  and any agreed Artificer or expansion structure. Verify target eligibility,
  counter relationships, recovery, and production requirements.
- [ ] **1.53** Generate Circle models, textures, growth and combat animations,
  effects, and essential audio using the selected faction direction. Check
  readability and asset contracts for the complete selected roster.
- [ ] **1.54** Author the short Circle introductory scenario teaching
  cultivation, dormancy, construction, and production before skirmish play.
  Keep M0 available as ARC's introduction.
- [ ] **1.55** Add the Circle AI build plan and operations for its economy,
  infrastructure, roster, and recovery. Exercise it through the shared harness.
- [ ] **1.56** Verify Circle saves and deterministic continuation through
  construction, cultivation, dormancy, recovery, and support work.
- [ ] **1.57** Playtest the Circle introduction and base loop with the cohort,
  launched through a development link or test-build entry until 1.60 adds the
  menu flow. Verify that RTS-familiar newcomers understand its differences,
  can establish and sustain a base, and can explain a useful cultivation
  decision. Fix and retest recurring confusion before full-match balancing.

Phase gate: Circle play is a complete, understandable loop with a meaningful
cultivation distinction, and its AI can sustain the same economy and roster.

### F. Complete skirmish integration

Build on both playable loops and the shared opponent, including any optional
resource and upgrade systems selected in 1.06 and delivered through 1.58.

- [ ] **1.59** Finish the map with viable routes, expansion opportunities,
  scouting landmarks, and defensible starts for both player assignments.
- [ ] **1.60** Add the normal-menu flow for faction choice, introductions, and
  skirmish launch. Include difficulty selection only if agreed in 1.10.
- [ ] **1.61** Wire the agreed objectives, victory, defeat, and post-result
  behavior into complete matches. Verify restart and load preserve the chosen
  faction assignment, rules, and scenario.
- [ ] **1.62** Present the persisted match summary on the results panel and in
  headless reports, including income, production, expansion, attack, losses,
  and result. Use the same definitions in playtest reports.
- [ ] **1.63** Run the agreed headless profile/start-slot set for ARC versus
  Circle and Circle versus ARC. Tune both sides until each match reaches a
  result within the agreed duration and AI milestone time windows.
- [ ] **1.64** Measure the complete skirmish with AI at the agreed actor count
  on the named desktop and compact configurations. Meet tick-time and
  frame-rate targets without wall-clock-dependent simulation decisions.

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
  opening depends on developer knowledge.
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
