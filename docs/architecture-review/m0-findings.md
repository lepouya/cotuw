# M0 architecture findings

## Scope

- Revision: `8599f34cf4ccdc0a7ce76dd429a9b42cbac02df3`.
- Included working changes: `src/main.ts`, `src/session.ts`,
  `src/simulation/player-view.ts`, and `tests/player-view.test.ts`.
- Both initial passes inspected this unchanged snapshot. The survey ran in a
  read-only sub-agent without seam findings. The main agent identified the seam
  candidate before receiving partial survey feedback; feedback arrived before
  writing its report, so some influence is possible. Neither pass edited files.
- Internal interfaces may change. Specified gameplay, locked requirements,
  mission format 8, and content format 1 remain binding.
- Inspected: recent changes, loading, content, session assembly, simulation
  transactions, player access, application transitions, callers, and tests.
  Exhaustive renderer, generated-asset, and native-host review is a gap.
- No concrete post-M0 feature is selected; future extensibility alone is not
  evidence for a new interface.

## Initial survey: improve-codebase-architecture

- **Strong: renderer-independent mission preparation.** `session.ts` combines
  `loadMission` and `createSessionSimulation` with graphics assembly.
  `tests/mission-file.test.ts` and `e2e/missions.ts` need the former without
  the latter. Content parsing also imports renderer implementations for
  serializable validation. The existing Vitest webstorage workaround records
  Babylon's import-time environment probe.
  - Before: headless callers → session → render; content → render factories.
  - After: headless callers and session → mission preparation → simulation
    and content schemas; render consumes those schemas.
  - The module gains depth through one preparation seam; renderer adapters
    retain graphics ownership. Locality improves without a generic registry.
  - Cost: move validators and contracts, update callers, preserve errors and
    exact continuation, and verify renderer consumers.
- **Worth exploring: application transitions.** `main.ts` distributes busy
  state, read invalidation, and session replacement among handlers. Before:
  handlers coordinate replacement; after: a transition module owns ordering.
  This could improve locality, but existing stale-load and cleanup browser
  tests cover the behavior and no failure was demonstrated. Conversion must
  account for readiness callbacks, popups, and error presentation.
- Retain the existing player-view work. Its deletion would redistribute actor
  lookup and visibility policy. No broader interface is justified.
- Top recommendation: mission preparation and content contracts.

## Initial seam-ripper assessment

- Dependency map, counting unique local imports including types:
  - `session.ts`: 59 dependencies, 3 importing modules; combines graphics,
    controls, content, and simulation composition.
  - `simulation/mission.ts`: 19 dependencies, 14 importing modules; owns the
    deterministic transaction and invokes economy, combat, vision, and orders.
  - `content/content-pack.ts`: 14 dependencies, 4 importing modules; validates
    authored rules and presentation, including renderer implementation imports.
  - `main.ts` → session for lifecycle; session → render/UI for presentation;
    render/UI → simulation for committed state and queued commands;
    platform → browser/Tauri for storage and files.
  - Type-inclusive cycles occur among actor/command contracts and rendering
    contracts. Their presence alone does not establish runtime failure.
- **Medium, supported existing debt:** content validation depends on graphics
  implementations. `glb-model.ts` even registers its loader at import. Mission
  preflight consumers therefore inherit engine setup unrelated to validation.
- Target: content owns serializable presentation contracts and known IDs;
  render owns factories and checks actual loaded assets. Mission preparation
  owns pack resolution, scenario-reference validation, and behavior wiring.
- Transformation: move shared schemas and validators; check factory coverage;
  extract preparation; update callers together; verify malformed input,
  continuation, real rendering, and import independence. Conversion includes
  multiple renderer consumers even though internal compatibility is waived.
- Retain mission transaction and resource-lifetime ownership. Their ordering
  and cleanup responsibilities implement explicit runtime contracts.

## Modularity challenge and consolidation

- **Selected: mission preparation and content schemas.** Impact is medium;
  evidence is demonstrated dependency coupling and supported testing burden;
  scope is existing debt, not introduced by the working changes. Both reports
  identify the same issue, but admission rests on inspected imports and callers.
- Strongest counter-explanation: presentation validation should match renderer
  capabilities. Keep that guarantee through shared identifier types and
  exhaustive factory catalogs, while leaving asset inspection in render.
- No change preserves import-time graphics dependencies. Moving only loading
  leaves content's graphics dependencies intact. Moving serializable contracts
  plus preparation removes the complete runtime dependency at a bounded cost.
- A plugin registry, generic loader adapter, or simulation rewrite adds concepts
  without present variation. None is selected.
- Defer application transitions: meaningful coordination exists, but current
  coverage and the absence of a demonstrated defect weaken the case relative
  to its callback and lifecycle conversion cost.
- Defer simulation splitting and additional player-view redesign: transaction
  ordering and existing ownership are stronger counter-evidence than file size.

## Selected interface design

- `content/presentation.ts` owns serializable graphics configuration,
  animation roles, effect styles, known built-in IDs, and their validation.
  It hides no graphics resources and imports no renderer implementation.
- `mission-loading.ts` owns `LoadedMission`, `loadMission`, and
  `createSessionSimulation`. It hides pack resolution, scenario-reference
  checks, occupancy/behavior wiring, and disposable simulation preflight.
- Example: `const mission = loadMission(source)` before replacing a session;
  `createSessionSimulation(map, mission)` for deterministic headless execution.
- Render keeps geometry, playback, loaded-asset validation, and disposal.
  Existing terrain-style types may remain type-only dependencies; runtime
  preparation must not load render, DOM, Babylon, or platform modules.
- Internal import locations change together; no compatibility facades.
  Validation results/errors, simulation ordering, saves, content, and asset
  bytes remain unchanged. Existing behavior tests survive with import updates.
- Completion: both dependency cuts verified, factory coverage enforced,
  malformed-input and continuation tests pass, affected browser checks pass,
  and `npm run check` passes. Commits are authorized.

## Closure

- Complete: mission preparation and content validation have no runtime renderer
  dependency. Inspection traced 32 local preparation modules without renderer,
  platform, or external runtime edges. The headless regression exercises both
  bundled levels while rejecting Babylon, platform, or session initialization.
- The moved preparation functions and validators keep their original checks
  and errors. Typed catalogs cover all accepted built-in IDs.
- A follow-up review kept the selected architecture and simplified within it:
  `createSessionSimulation(mission, map?)` builds headless terrain by default
  through `missionTerrain`; validators share `isOneOf` and accept unknown
  input; player-view lookups share one filtered lookup; aiming uses the
  player's shown-actor lookup. Application and session retain their included
  player-view and halted-state changes. Persisted
  content, formats, gameplay rules, dependencies, and generated assets are
  unchanged.
- Verification:
  - `npm run typecheck:ts` and `npm run lint:ts`: passed per chunk.
  - `npm run test:ts:quick -- <focused files>`: chunk 1 passed 162 tests
    with 2 skips; chunk 2 passed 173 tests. Exact file lists are in the
    manifest.
  - `npm run check`: passed after cleanup; 910 unit tests passed, 2 existing
    tests skipped, and all 4 Chromium smoke checks passed.
  - `npm run test:visual -- <affected specs>`: 53 Chromium and 7 WebKit checks
    passed, including complete mouse and phone M0 playthroughs in both engines.
    Exact specs are in the manifest. Browser runs require localhost access
    outside the sandbox; all completed successfully with that access.
  - `npm run build`: passed; reports a bundle-size advisory.
  - `git diff --check`: passed. Final source and caller diffs inspected.
- Deferred findings remain application-transition ownership, simulation
  decomposition, and any additional player-view redesign. No unresolved
  trade-off blocks the selected scope. `npm run check:full` passes: 1,014 unit
  and asset tests, 2 existing skips, and all 199 Chromium/WebKit checks. Rust
  checks and the production build pass. The player-view commit's isolated
  intermediate state passes types, lint, and 55 focused tests. Packaged native
  apps were not exercised. Work is grouped into two authorized commits.
