# TODO

## Milestone 1

Build a small ARC-versus-Circle skirmish, playable as either faction against
an AI that establishes and sustains its own base. Players should make useful
choices about income, production, expansion, protection, and recovery.

[DESIGN.md](DESIGN.md#milestone-1-planning-direction) owns the agreed rules
and open design decisions. This checklist owns delivery and acceptance.
Phases A and B are complete except for deferred cohort task 1.02. Phase C is
in progress; the Circle cultivation slice is playable with acceptance work
remaining.

### Using this checklist

- Work through the phases in order, except the Circle wolf-den slice below
  may progress alongside phases B-D as its prerequisites become ready, and
  1.02 is deferred. Tasks within a phase may overlap; explicit dependencies
  take precedence.
- Task IDs are the milestone number and a task number, independent of phase
  letters. Keep them stable once work starts. Check a task only when its
  stated outcome is verified, including appropriate checks for implementation
  work.
- Run `npm run check` before completing coding tasks or committing, plus
  affected focused checks. Reserve `npm run check:full` for acceptance and
  releases. Use [verification](docs/verification.md) for check selection,
  platform coverage, and human acceptance.
- Keep completed tasks to a short outcome. Pending tasks retain dependencies,
  remaining work, and acceptance criteria; link rules instead of repeating them.
- Keep findings and reproduction details in linked issues. Version control
  owns delivery history; do not accumulate playtest or implementation logs.
- Tasks that depend on an optional scope choice implement only the agreed
  content. Record a deliberate deferral beside the affected task.

### A. Baseline and design decisions

Design decisions are complete. The external cohort is deferred until the AI
is playable.

- [x] **1.01** Reproducible browser playtest bundle, tester instructions, and
  report template. See
  [playtest preparation](docs/verification.md#playtest-preparation).
- [ ] **1.02** Recruit five to eight RTS-familiar and less experienced players
  once the enemy AI is playable. Run one cohort through 1.47 and 1.57,
  covering controls, clarity, pacing, reliability, assistance, and abandonment.
  Revise the session scope for that build and turn findings into prioritized
  issues for controls and onboarding.
- [x] **1.03** Circle construction and infrastructure rules.
- [x] **1.04** Cultivation, dormancy, delivery, and recovery rules.
- [x] **1.05** Minimum roster, roles, counters, and producers.
- [x] **1.06** Common-resource progression and affordable starting packages.
- [x] **1.07** Scenario setup, start slots, restart, and script authority.
- [x] **1.08** Ownership independent of faction type and explicit sharing.
- [x] **1.09** Results, emergency recovery, saves, and summary definitions.
- [x] **1.10** Pacing, difficulty, coverage, scale, and performance targets.
- [x] **1.11** Development save-compatibility policy.
- [x] **1.12** Keyboard defaults, rebinding, and on-screen alternatives.
- [x] **1.13** Circle art and audio direction.

[DESIGN.md](DESIGN.md) owns these rules; dependent tasks implement them.

### B. Multi-faction and UI foundations

Complete. The shared simulation supports independent owners, private
information, faction-specific economies, and reproducible skirmish setup.
The ARC introduction remains the regression baseline.

- [x] **1.14** Rough skirmish map and launch assembly for either faction in
  either slot, with difficulty scaling and reproducible load/restart.
- [x] **1.15** Actor ownership, relationships, vision, and shared services.
- [x] **1.16** Owner stockpiles, headquarters queues, producer queues, and
  emergency headquarters recovery.
- [x] **1.17** Issuing-owner and scenario-script command authority.
- [x] **1.18** Owner-neutral simulation rules, including loot collection.
- [x] **1.19** Persisted owner exploration and observation memory.
- [x] **1.20** Player alerts, audio, minimap, and sidebar information isolation.
- [x] **1.21** UI ownership boundaries.
- [x] **1.22** Dialog focus, navigation, pause, asynchronous work, and disposal.
- [x] **1.23** Application/session lifecycle, save presentation, compatibility
  feedback, and skirmish save policy.
- [x] **1.24** Shared content-driven sidebar with feature-owned DOM and CSS.
- [x] **1.25** End-of-tick owner elimination, frozen verdicts, and draws.
- [x] **1.26** Exact match metrics, cargo provenance, and sampled histories.
- [x] **1.27** Mission/content formats, validation, and deterministic saves.
  Control-group persistence belongs to 1.44.
- [x] **1.28** Pre-AI scale profiling. Normal ticks meet the pre-AI budget and
  sustain 2× pace in Chromium and WebKit. WebKit rendering misses the frame
  budget, and stress scenes fall behind at 2×; 1.38 and 1.64 own AI-enabled
  verification and remaining performance work.

Use [runtime contracts](docs/runtime-boundaries.md),
[UI ownership](docs/ui-ownership.md), and
[mission files](docs/mission-files.md) when extending these foundations.

### C. AI development harness

Prerequisite complete: owner-view placement, training, rally, and tending
previews use only owned, detected, and remembered state. The director must use
this [view boundary](docs/runtime-boundaries.md#headless-preparation).

Use ARC against ARC on the rough map and existing roster to prove the shared
AI. Circle slice work can proceed alongside it. This matchup remains a
development tool. Build the runner, overlay, and persistence first so later
AI tasks are developed and verified with them.

- [x] **1.29** Deterministic director with pack profiles, prioritized concerns,
  shared budgets and force claims, and counted per-tick limits. It runs as a
  mission tick step through `viewOf(owner)` and owner-issued commands.
  `submitCommand` requires an issuer.
- [x] **1.30** Headless AI-versus-AI runner (`npm run ai:match`) with ARC
  mirror cases by player slot and difficulty. It reports results, milestones,
  totals, scaling, and AI diagnostics, and preserves Incomplete / stalled
  cases at the 30-minute cutoff. `createSessionSimulation` accepts concerns.
  The 12-case ARC-versus-Circle matrix belongs to 1.63.
- [x] **1.31** Development AI overlay (`ui/ai-overlay.ts`), offered by `ai=`
  development links in dev and playtest builds. Backquote cycles AI owners'
  posture, budgets, claims, operations, recent and refused commands, concern
  memory, and sightings.
- [x] **1.32** `state.ai` saves budgets, claims, timers, plans, scouting goals,
  and operations, with observations from 1.19. Concern-owned validators reject
  malformed memory before startup. Tests verify deterministic save/load and
  continuation through clock batching and bounded catch-up.
- [x] **1.33** ARC build plan in `simulation/arc-concerns.ts` with the shared
  `forces` concern, which sessions use by default. It opens with a Refinery and
  Harvester, then a Field Barracks, and grows to three Refineries and two
  Barracks while training Troopers to a rally point. The undisturbed mirror
  reaches first income near 1:15, military production near 2:30, and a first
  Trooper near 2:40 through ordinary placement and costs.
- [x] **1.34** Recovery reserves income replacement costs and restores lost
  headquarters. Income and production plans replace workers and offline
  buildings, reusing stranded Harvesters, and restore one Refinery and
  producer before growing again. Tests cover paid recovery from
  worker, income, production, headquarters, and support-link losses, defense
  timing, and deterministic save/load continuation.
- [x] **1.35** Faction-neutral `scouting` concern in
  `simulation/ai-scouting.ts` explores authored sites, refreshes stale reports,
  retreats after damage, skips failed approaches, and replaces lost scouts at
  normal cost. The undisturbed mirror sights every site and enemy income;
  Harvesters can use scouted deposits after home Materials run out.
- [x] **1.36** Faction-neutral group operations in
  `simulation/ai-operations.ts` assemble, advance, regroup, retreat when
  outmatched or depleted, retry stalls within limits, and return survivors
  home. Defense protects buildings and workers; offense raids observed income
  and attacks known buildings after the four-minute grace. Idle scouts sweep
  for unseen buildings, including while stale reports are avoided. Every ARC
  mirror case completes, with raids from about 4:25.
- [ ] **1.37** Tune opening grace, commitment, pursuit, retreat, and recovery
  through profile `tuning`, kept separate from difficulty health/damage
  scaling. Tactical thresholds come from the profile. Normal ARC mirrors
  end near 16:20, with first raids near 4:20 and first attacks near 9:20;
  Easy and Hard cases end decisively near 9:30 to 9:50, which is accepted.
  Recovery saves to restart income and sells production when it cannot.
  Losing the Command Center before 300 Materials are banked is an accepted
  loss. Remaining: human playtest against the harness AI.
- [ ] **1.38** Exercise the ARC mirror harness through completed matches,
  recovery cases, and the agreed scale with AI enabled. Resolve deadlocks,
  resource leaks, ownership faults, and performance blockers. The runner's
  audit, baseline, recovery, and full-state save/load continuation cases
  pass. Worker, income, and production losses recover; headquarters loss is
  an accepted loss that must still finish cleanly. Remaining: measure
  the 200-unit, 40-building benchmark with AI enabled, which needs a way to
  hold the scene's scale while the AI trains from its stockpile.

Phase gate: ARC AI establishes and rebuilds its base, scouts, defends, and
attacks through shared rules, with reproducible results and useful diagnostics.

### D. Expanded ARC base and controls

Use the roster from 1.05 and extend the functioning ARC AI as content lands.
M1 uses common resources and producer-based availability, with rare resources,
upgrades, and research deferred. Task IDs remain stable across phase changes.

- [x] **1.58** Optional-system scope: rare resources, mixed yields, upgrades,
  and research are deferred beyond M1.
- [ ] **1.39** Add the ARC Relay Station and Sentry Turret as data-driven
  content. Verify support loss, reconnection, placement, targeting, and the
  expansion or protection choices they are intended to provide. Exclude Relay
  Stations from assembled skirmishes' qualifying buildings.
- [ ] **1.40** Implement building repair through each headquarters'
  infrastructure pool, following [recovery rules](DESIGN.md#repair-and-healing).
  Cover payment, cancellation, paused work, disconnection, and competition with
  construction. Add repair jobs to `updateInfrastructure`'s work list and
  `claimSlot`; they read the ledger for oldest-first per-second payment.
- [ ] **1.41** Add Medic and Mechanic support from the Field Barracks, including
  eligible targets, automatic service, manual priority, pursuit limits,
  single-provider rules, and save/load continuation. Verify personnel healing
  and recovery of Harvesters that survive raid damage. Add order kinds through
  `simulation/order-queue.ts`. Support units run outside `updateCombat`, so they
  pursue through `followRoute` with their own `RouteRetryState` and the
  mission's bounded `move` and `destination`.
- [ ] **1.42** Add the Demolition Trooper to Field Barracks production.
  Implement its single-target building damage bonus at `updateCombat`'s damage
  site and verify the counter relationship and reason to field a mixed force.
- [ ] **1.43** Generate and register the added ARC models, animation, command
  feedback, effects, and essential audio. Verify readability and generated
  asset contracts for each included actor. Reserve owner-color areas on ARC
  models, as the [Circle direction](DESIGN.md#m1-circle-presentation) does,
  and render owner colors there and on minimap markers so owners of the same
  faction are distinguishable. 1.53 uses the same owner-color path. Add a color
  to owners; the session picks each `MinimapActor.color`. Buildings' GLB
  instances share materials, so key per-owner copies of named marking materials
  by appearance and owner color in the view registries. Infantry `accent` parts
  bake into the vertex-colored body, so owner colors need a separate marking
  mesh and regenerated GLBs.
- [ ] **1.44** Implement [control groups](DESIGN.md#m1-control-groups),
  [idle-worker controls](DESIGN.md#m1-idle-worker-controls), and
  [matching-unit selection](DESIGN.md#m1-matching-unit-selection).
  Verify keyboard and on-screen actions in browser and desktop builds,
  including Mac Control, mixed selections, and Add units mode. Cover destroyed
  group members and workers with cargo, pending orders, or waiting assignments.
  Extend `MissionFile.uiState` for groups; verify load filters invalid members,
  new missions and restart clear groups, and bindings remain device preferences.
- [ ] **1.45** Implement [command shortcuts](DESIGN.md#m1-command-shortcuts)
  and [keyboard preferences](DESIGN.md#m1-keyboard-preferences). Verify queued
  targeting, Stop, placement/card precedence, dialog/form focus, disabled
  explanations, and compact landscape controls. Test QWERTY, AZERTY, QWERTZ,
  number-row modifiers, missing automatic layout labels, and host-reserved keys.
  Replace static hints in `ui/sidebar-orders.ts` with current bindings. Use
  one active-tool state so card shortcuts wait during placement. Share device
  preference storage with audio; keep it independent of mission saves.
- [ ] **1.46** Extend ARC AI build plans and operations to use the selected
  expansion, defense, recovery, and combat content. Include Refineries at
  scouted remote deposits, which need support reach; Harvesters otherwise
  haul to home Refineries.
- [ ] **1.47** Playtest ARC expansion, base layout, defense, rebuilding, support
  units, and controls with the 1.02 cohort, in the same sessions as 1.02 and
  1.57. Play against the harness AI on the rough
  map through a development link or test-build entry; keep the mirror matchup
  out of the normal menu. Check whether repair under attack blocks rebuilding
  excessively; propose any rule changes explicitly before tuning beyond the
  locked infrastructure rules. Fix and retest recurring blockers.

Phase gate: the expanded ARC base can grow, defend, recover, and field useful
mixed forces under both player and AI control.

### E. Circle playable loop and introduction

Use the construction, cultivation, roster, and presentation choices from
phase A and the required shared foundations from phase B. Develop the
wolf-den slice alongside the ARC AI and roster; faction AI integration still
requires phase C. Use Lifebloom-only costs and producer-based availability.

The [playable slice](DESIGN.md#circle-wolf-den-development-slice) includes
core infantry, paid worker production, tended growth, renewable cultivation,
feedback, guides, generated art/audio, and focused save checks. Full task
acceptance remains open below; normal-menu skirmish launch belongs to 1.60.

- [ ] **1.48** Complete core-roster acceptance for Heartgrove, Conservatory,
  Cultivator, Musterhall, Sentinel, and Wayfinder content, labels, costs,
  production, and starting resources. Verify tougher, shorter-ranged
  Sentinels and fast, fragile, unarmed Wayfinders with extended ordinary vision.
  Heartgroves train Cultivators; verify startup funds cover the first worker
  and Conservatory through normal play without a preplaced worker.
- [x] **1.49** Circle placement, single-worker tending and replacement,
  infrastructure, and emergency Heartgrove recovery, with saved continuation
  and keyboard-free construction controls.
- [ ] **1.50** Complete cultivation acceptance against
  [economy rules](DESIGN.md#economy-and-construction). Verify reserve-adjusted
  output, regeneration, dormancy/recovery, retained assignments, manual site
  changes, nearest reachable owned delivery, cargo-preserving interruptions,
  and queued orders waiting through dormancy. Cover simultaneous workers,
  reserve overdraw, and deterministic transition ordering.
- [ ] **1.51** Complete feedback and guidance acceptance for cultivation and
  construction. Verify site reserve/efficiency/recovery displays, one dormancy
  notification per transition, and distinct states for idle, waiting, blocked
  delivery/routes, untended growth, and unavailable infrastructure capacity.
- [ ] **1.52** Add Healer and Artificer support, the Thornspire, Briar Ram,
  and Construct Nursery. Circle expansion uses existing structures. Verify
  target eligibility, counter relationships, recovery, production requirements,
  the Briar Ram's single-target building damage bonus, and the Nursery's shared
  Briar Ram/Artificer queue. Musterhalls train Healers.
- [ ] **1.53** Complete full-roster assets and presentation acceptance under
  [Circle direction](DESIGN.md#m1-circle-presentation). Extend the slice's
  generated models, growth layers, effects, work/weapon audio, and faction
  music for the remaining roster. Verify silhouettes, owner markings,
  entrances, weapons, interrupted growth, saved progress, damage/repair,
  destruction, reduced motion, and mix readability at gameplay scale.
  Rebuild assets reproducibly and verify pack bindings.
- [ ] **1.54** Finish the Circle introduction using the wolf-den slice.
  Verify it teaches cultivation, dormancy, construction, and production before
  skirmish play. Keep M0 available as ARC's introduction.
- [ ] **1.55** Add the Circle AI build plan and operations for its economy,
  infrastructure, roster, and recovery. Exercise it through the shared harness.
- [ ] **1.56** Verify Circle saves and deterministic continuation through
  construction, tending assignments and worker replacement, cultivation,
  dormancy, recovery, and support work. Preserve site reserves and dormancy
  state, worker cargo, cultivation progress, assignments, and queued orders.
- [ ] **1.57** Playtest the Circle introduction and base loop with the 1.02
  cohort, in the same sessions as 1.02 and 1.47, launched through the demo
  setup screen or a development link. Verify RTS-familiar newcomers understand
  its differences, establish and sustain a base, and explain a useful
  cultivation decision. Refine cultivation rates, reserve capacity, cargo
  capacity, and
  dormancy thresholds using the playable slice. Fix and retest recurring
  confusion before full-match balancing.

Phase gate: Circle play is a complete, understandable loop with a meaningful
cultivation distinction, and its AI can sustain the same economy and roster.

### F. Complete skirmish integration

Build on both playable loops and the shared opponent using the common-resource
and producer-based progression scope from 1.06.

- [ ] **1.59** Finish the map with viable routes, expansion opportunities,
  scouting landmarks, and defensible starts for both player assignments.
  Verify both factions' paid first income and restart from either slot.
- [ ] **1.60** Extend the demo setup screen to offer the complete Circle
  introduction and skirmish launch. Preserve independent ARC/Circle and
  Easy/Normal/Hard choices and access to ARC's introduction.
- [ ] **1.61** Verify [result rules](DESIGN.md#m1-skirmish-results) in
  complete matches. Cover same-tick draws, frozen inspection, named/quick
  saves, loaded results, and restart preserving launch choices. Verify a result
  on an autosave boundary preserves the pre-result Autosave. Reuse the phase B
  result and persistence implementation.
- [ ] **1.62** Present the [match summary](DESIGN.md#m1-match-summary) in the
  results panel and headless reports. Include exact milestones, totals, peaks,
  and comparison histories for both owners. Keep opponent histories hidden
  during play and use the same definitions in playtest reports. Add a
  `MenuView` field and a panel in `ui/dialogs.ts`.
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
  deferred; compact layout and touch checks remain. Profile WebKit rendering
  and stress-case backlog with AI enabled before choosing optimizations.
  Candidate rendering work includes merging unit meshes and skipping off-screen
  animation; change allocation sites only when measured costs justify it.

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
  closing M1. Keep completed tasks concise.

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
- Catalysts, Resonance, mixed-yield collection, building upgrades, permanent
  research, voice acting, and physical mobile performance targets.
- Scenario-specified resource pool divisions other than equal shares, and
  restricting script authority to a scripted sequence.
- Removing the test-only `MissionSimulation.spawnActor` and `removeActor`
  hooks. Tests that use them on a running mission would need restarts from
  edited snapshots or a persisted `spawn-actor` command.
