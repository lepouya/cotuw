# TODO

## Milestone 1

Build a small ARC-versus-Circle skirmish, playable as either faction against
an AI that establishes and sustains its own base. Players should make useful
choices about income, production, expansion, protection, and recovery.

[DESIGN.md](DESIGN.md#milestone-1-planning-direction) owns the agreed rules
and open design decisions. This checklist owns delivery and acceptance.
Phase G is active. Remaining cohort coverage for 1.02 carries into 1.65.

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
- The game version is `0.<milestone>.<phase>`, numbering phases from A as 1.
  Set it when a phase starts in `package.json`, `package-lock.json`, and
  `src-tauri/Cargo.toml` with its `Cargo.lock` entry.

### A. Baseline and design decisions

- [x] **1.01** Reproducible browser playtest bundle, tester instructions, and
  report template. See
  [playtest preparation](docs/verification.md#playtest-preparation).
- [ ] **1.02** Complete and confirm coverage of five to eight RTS-familiar
  and less experienced players across the ARC and Circle playtests. Use 1.65
  for remaining coverage of controls, clarity, pacing, reliability,
  assistance, and abandonment. Turn findings into prioritized controls and
  onboarding tasks. Follow
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
  Carry any remaining ARC cohort coverage into 1.65.
- [x] **1.58** M1 optional-system scope. See
  [resources and progression](DESIGN.md#m1-resources-and-progression).
- [x] **1.71** Owner colors in models, remains, and minimap markers.

### E. Circle playable loop and introduction

Complete. The [Circle introduction](DESIGN.md#circle-introduction) teaches
cultivation, and the [Circle AI plan](DESIGN.md#m1-circle-ai-plan) sustains
the same economy and roster.

- [x] **1.48** Circle core roster and paid opening.
- [x] **1.49** Placement, tending, infrastructure, and Heartgrove recovery.
- [x] **1.50** Cultivation, shortest-walk delivery, and site tuning.
- [x] **1.51** Cultivation, dormancy, and growth feedback.
- [x] **1.52** Healer and Artificer support, Thornspire defense, and Briar Ram
  siege combat.
- [x] **1.53** [Circle presentation](DESIGN.md#m1-circle-presentation) for the
  full roster, including growth, combat effects, faction cues, and music.
- [x] **1.54** Circle introduction verified headless, with mouse, and on phone.
- [x] **1.55** Circle AI for cultivation, expansion, defense, and recovery.
- [x] **1.56** Deterministic Circle saves through cultivation, growth, support,
  recovery, and the introduction.
- [x] **1.57** Initial cohort playtest of the Circle introduction and skirmish.
- [x] **1.72** Circle opening balance and scripted wins from both starts.
- [x] **1.73** Scenic map borders and camera framing for explored terrain.
- [x] **1.74** Lower walls and longer sightlines with landmarks and crossings
  preserved.
- [x] **1.75** Phase-aligned Circle music crossfades and revised Medic,
  living destruction, and wolf attack cues.
- [x] **1.77** Circle introduction and skirmish retest complete. Player feedback
  confirmed the follow-up fixes. Three returning testers won unassisted on
  Normal in 12 to 15 minutes, including one who recovered after the first raid.

### F. Complete skirmish integration

Complete. Either faction can play a full skirmish against the other faction's
AI through the normal menu. Headless pacing and normal-scale performance
are accepted for Phase F.

- [x] **1.59** Mirrored skirmish map with viable routes, expansions, scouting
  landmarks, and defensible starts for both player assignments.
- [x] **1.60** Menu launch for either faction's introduction or skirmish at
  the selected difficulty, with skirmish setup preserved on restart.
- [x] **1.61** [Skirmish results](DESIGN.md#m1-skirmish-results) verified
  through frozen inspection, save/load, restart, and pre-result Autosave.
- [x] **1.62** [Match summary](DESIGN.md#m1-match-summary) for both owners,
  with a shared Overview in the results panel and headless reports.
- [x] **1.63** All 12 baseline cases completed with deterministic Easy and
  Hard continuations. Phase F accepted a one-slot win for the scripted
  `turtle` opening. See
  [headless checks](docs/verification.md#m1-headless-acceptance).
- [x] **1.64** Normal-scale performance accepted, sustaining 120 simulation
  ticks per second at 2× in Chromium and WebKit at 1920 × 1080. See
  [performance measurement](docs/verification.md#m1-performance-measurement).

### G. External feedback and milestone acceptance

Complete the visual polish pass before building the external playtest bundle.
Automated matches establish correctness; human play establishes clarity,
challenge, pacing, and useful choices.

- [ ] **1.76** Polish models, textures, and scene presentation before 1.65.
  Work through the [visual asset review](docs/visual-asset-review.md), which
  orders assets by first encounter and frequency of use.
  Review both faction starts and a representative battle at gameplay zoom.
  Use the 1.57 feedback and the scene review to record the scoped assets and
  scenes in the [ARC](DESIGN.md#m1-arc-presentation) and
  [Circle](DESIGN.md#m1-circle-presentation) art direction. Verify that the
  factions look distinct and that unit roles, owner colors, resource
  sites, and buildable ground are clear in play. Review the introductions
  where they share changed assets, run affected asset and browser checks,
  and recheck normal-scale performance before building the cohort bundle.
  - First model passes cover the Command Center, Heartgrove, Materials
    Refinery, Harvester, Lifebloom Conservatory, Cultivator, Field Barracks,
    Musterhall, Trooper, Sentinel, Scout, and Wayfinder. The wolf pass
    covers the standard wolf and alpha.
- [ ] **1.65** After 1.76, distribute the integrated build through the agreed
  channel and run full skirmish playtests with both factions. Observe in-game
  onboarding, time to key milestones, assistance, confusion, and abandonment;
  ask what drove build, expansion, and combat choices. Revisit skirmish pacing
  with this feedback.
  - Complete any remaining cohort coverage for 1.02. In ARC runs, check
    expansion and Relay Stations, layout, recovery and Mechanics, control
    groups, shortcuts, and idle-worker controls. Check whether repair under
    attack blocks rebuilding.
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
