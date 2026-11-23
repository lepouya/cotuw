# TODO

## Milestone 1

Build a small ARC-versus-Circle skirmish, playable as either faction against
an AI that establishes and sustains its own base. Players should make useful
choices about income, production, expansion, protection, and recovery.

[DESIGN.md](DESIGN.md#milestone-1-planning-direction) owns the agreed rules
and open design decisions. This checklist owns delivery and acceptance.
Phase E is active. Circle follow-ups 1.72 to 1.75 and retest 1.77 continue
cohort task 1.02.

### Using this checklist

- Work through the phases in order. Tasks may overlap when their dependencies
  are met.
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
- Track findings as tasks here, with reproduction details only while they
  inform pending work. Version control owns delivery history; do not
  accumulate playtest or implementation logs.
- Tasks that depend on an optional scope choice implement only the agreed
  content. Record a deliberate deferral beside the affected task.

### A. Baseline and design decisions

- [x] **1.01** Reproducible browser playtest bundle, tester instructions, and
  report template. See
  [playtest preparation](docs/verification.md#playtest-preparation).
- [ ] **1.02** Complete playtesting with a cohort of five to eight RTS-familiar
  and less experienced players through 1.77. Cover controls, clarity, pacing,
  reliability, assistance, and abandonment. Turn findings into prioritized
  tasks for controls and onboarding. Follow
  [playtest preparation](docs/verification.md#playtest-preparation).
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
- [x] **1.28** Pre-AI scale profiling. Normal ticks meet the pre-AI budget and
  sustain 2× pace in Chromium and WebKit. WebKit rendering misses the frame
  budget, and stress scenes fall behind at 2×. Complete-match performance
  belongs to 1.64.

Use [runtime contracts](docs/runtime-boundaries.md),
[UI ownership](docs/ui-ownership.md), and
[mission files](docs/mission-files.md) when extending these foundations.

### C. AI development harness

Complete. The [AI rules](DESIGN.md#npc-ai),
[runtime contracts](docs/runtime-boundaries.md), and
[headless checks](docs/verification.md#m1-headless-acceptance) cover the
director and development matchup.

- [x] **1.29** Deterministic, owner-scoped AI director with pack profiles.
- [x] **1.30** Headless skirmish runner with match reports.
- [x] **1.31** Development AI overlay for `ai=` links.
- [x] **1.32** Validated AI saves and deterministic continuation.
- [x] **1.33** ARC build plan for income, production, and army growth.
- [x] **1.34** Paid base recovery.
- [x] **1.35** Shared observation-driven scouting.
- [x] **1.36** Shared defense, raid, attack, and withdrawal operations.
- [x] **1.37** ARC profile tuning independent of difficulty scaling.
- [x] **1.38** ARC mirror, recovery, continuation, and headless scale checks.

### D. Expanded ARC base and controls

Complete. The expanded ARC roster is playable with the
[ARC AI plan](DESIGN.md#m1-arc-ai-plan) and
[shared controls](DESIGN.md#controls-and-interface).

- [x] **1.39** Relay Stations and Sentry Turrets.
- [x] **1.40** Building repair through headquarters queues with status feedback.
- [x] **1.41** Medic and Mechanic support.
- [x] **1.42** Demolition Trooper defense breaking.
- [x] **1.43** ARC roster models, animation, feedback, and audio.
- [x] **1.44** Saved control groups, idle-worker and select-by-type actions.
- [x] **1.45** Rebindable gameplay and production shortcuts.
- [x] **1.46** ARC AI expansion, defense, repairs, and mixed forces.
- [x] **1.47** ARC playtest feedback and local-defense follow-up.
  Carry any remaining ARC cohort coverage into 1.65. Tune pacing in 1.63.
- [x] **1.58** M1 optional-system scope. See
  [resources and progression](DESIGN.md#m1-resources-and-progression).
- [x] **1.71** Owner colors in models, remains, and minimap markers.

### E. Circle playable loop and introduction

Extend the [Circle introduction](DESIGN.md#circle-introduction)
through its full M1 roster and AI build plan. Keep Lifebloom-only costs and
producer-based availability. Normal-menu skirmish launch belongs to 1.60.

- [x] **1.48** Circle core roster and paid opening verified through cultivation,
  Musterhall training, and Wayfinder scouting.
- [x] **1.49** Circle placement, single-worker tending and replacement,
  infrastructure, and emergency Heartgrove recovery, with saved continuation
  and keyboard-free construction controls.
- [x] **1.50** Cultivation acceptance against
  [economy rules](DESIGN.md#economy-and-construction), with shortest-walk
  delivery and content-pack site tuning.
- [x] **1.51** Cultivation and growth feedback verified, including site
  inspection, dormancy alerts, worker badges, and construction status.
- [x] **1.52** Healer and Artificer support, Thornspire defense, and Briar Ram
  siege combat verified. The Construct Nursery grows Rams and trains
  Artificers in one queue. Musterhalls train Healers.
- [x] **1.53** [Circle presentation](DESIGN.md#m1-circle-presentation) covers
  the full roster, including growth, producer entrances, damage and
  destruction, service and weapon cues, faction feedback, and music.
- [x] **1.54** The [Circle introduction](DESIGN.md#circle-introduction)
  guides cultivation, site strain and dormancy, construction, and production.
  Headless, mouse, and phone playthroughs verify victory within ten minutes.
- [x] **1.55** The [Circle AI plan](DESIGN.md#m1-circle-ai-plan) covers
  cultivation, tending, expansion, Thornspires, the full roster, and recovery
  through faction-reported restart prices. `circle-mirror`, `circle-recovery`,
  `circle-continuation`, and `cross-faction` headless sets pass; Normal Circle
  mirrors finish around 17 minutes.
- [x] **1.56** Circle saves continue deterministically from every Cultivator
  phase, worker replacement, emergency regrowth, dormant recovery, support
  work, a periodically reloaded base, and the introduction. Loading rejects
  Cultivator phases that contradict their targets. `circle-continuation`
  resumes during raids, Musterhall growth, and Cultivator replacement.
- [x] **1.57** Cohort round of the Circle introduction and a Circle skirmish
  against the ARC AI with three testers. Cultivation was understood, and units
  and buildings behaved as expected. Findings continue in 1.72 to 1.77.
- [ ] **1.72** Make Circle skirmish wins against the ARC AI achievable before
  full-match pacing in 1.63. All three testers lost every Circle skirmish. In
  the Normal `cross-faction` baseline, ARC wins from both slots. Circle peaks
  at 4 to 6 army units against ARC's 9 to 14, trains 18 to 19 Cultivators, and
  reaches military readiness 38 to 45 seconds later despite earning income
  first.
  - Compare Musterhall and defense timing, Cultivator exposure and replacement
    costs, and Sentinel performance through ARC's first raid. Use the results
    to choose cultivation, combat, or Circle AI changes. Cultivation levers
    include rates, reserve and cargo capacity, and dormancy thresholds.
  - Use `npm run cultivation:probe` to compare introduction staffing before
    and after cultivation changes. Propose rule changes before tuning beyond
    the locked infrastructure rules.
  - Run both `cross-faction` cases. Both must complete without faults, with
    at least one Circle win. Verify human play in 1.77.
- [x] **1.73** Every map has a scenic out-of-bounds border, and the camera
  keeps explored ground within the central third of the view. Browser specs
  cover map edges, corners, and interior frontiers at several zooms on
  standard and wide viewports, with minimap, Focus, Reset View, and fog
  concealment. Human play is retested in 1.77.
- [x] **1.74** Halve wolf-den and skirmish wall heights while preserving
  landmark summits and open crossings. Walls block movement and construction.
  Verified longer sightlines, camera visibility, both introduction
  playthroughs, and all 28 headless skirmish cases.
- [ ] **1.75** Fix the Circle music, which testers heard as odd or out of
  order. Listen to both tracks through their loop seams and listen in-game
  as combat begins and ends. Check whether the shared echo, the combat
  track's lower off-beat pluck, or the cue transition causes the report.
  Fix the confirmed cause, regenerate any changed audio, and repeat the
  listening checks.
- [ ] **1.77** Retest 1.72 to 1.75 in the Circle introduction and skirmish
  on a rebuilt, smoke-tested bundle. Follow the
  [playtest procedure](docs/verification.md#playtest-preparation). Use returning
  testers to check the fixes and recruit new players as needed for 1.02.
  Verify RTS-familiar newcomers understand the Circle's differences,
  establish and sustain a base, and explain a useful cultivation decision.
  Require at least one unassisted Circle win on Normal and record whether
  other players hold or recover from the first ARC raid. Fix blockers
  reported by two or more testers, add regression coverage, and replay the
  affected paths on a rebuilt bundle.

Phase gate: Circle play is a complete, understandable loop with a meaningful
cultivation distinction, and its AI can sustain the same economy and roster.

### F. Complete skirmish integration

Build on both playable loops and the shared opponent using the common-resource
and producer-based progression scope from 1.06.

- [ ] **1.59** Finish the map with viable routes, expansion opportunities,
  scouting landmarks, and defensible starts for both player assignments.
  Verify both factions' paid first income and restart from either slot. East
  wins both Normal ARC mirror cases. Check whether the map or AI tie-breaking
  gives east the advantage.
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
  - Normal ARC mirrors and cross-faction development cases finish below the
    [15 to 25 minute target](DESIGN.md#m1-pacing-and-acceptance). Tune and
    verify post-raid income recovery and counterattack pressure after early
    Harvester losses.
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
  The browser spec still measures the scripted scene: give benchmark builds
  the AI scene and its training swap first.

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
  - Carry forward any unfinished ARC cohort runs. Check expansion and Relay
    Stations, layout, recovery and Mechanics, control groups, shortcuts, and
    idle-worker controls. Check whether repair under attack blocks rebuilding.
- [ ] **1.66** Verify that first-time ARC players, using M0 and in-game help,
  and RTS-familiar Circle players, after the Circle introduction, establish
  income, production, defense, and an expansion. Observe testers winning and
  losing with both factions on Normal, exercising attack, defense, and
  recovery. Verify that included combat and support roles are useful and no
  opening depends on developer knowledge. Revisit whether surviving defensive
  buildings support useful comebacks or mainly prolong cleanup.
- [ ] **1.67** Triage external findings into tasks, incorporate fixes, and
  retest affected paths. Resolve recurring progression blockers; give
  remaining findings an explicit priority and disposition.
- [ ] **1.76** Improve model and graphics fidelity based on 1.57 feedback.
  Before the integrated playtest, record the assets or scenes in scope in
  [art direction](DESIGN.md#m1-circle-presentation) and defer the rest.
  Finish the pass before fixed-revision verification in 1.69. Check visual
  readability at gameplay zoom and repeat affected human and performance
  checks for the changed scenes. Verify regenerated assets in 1.70.
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
findings dispositioned.

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
