# M0 refactor plan

Source: [findings and design](m0-findings.md).

Target: prepare missions and validate content without loading graphics.

## Baseline and bounds

- Preserve the four included working files' existing behavior and unrelated
  edits. Change their imports only where this scope requires it.
- Mission format 8, content format 1, gameplay, dependencies, and locked
  requirements remain unchanged. Commits are authorized.
- Baseline `npm run check`: formatting, lint, types, and 908 unit tests pass
  with 2 skipped. Browser server binding requires execution outside the
  sandbox; separate `npm run test:visual:quick` passes all 4 checks.

## Chunk 1: serializable presentation contracts

- Status: complete.
- Verification: 162 focused tests passed, 2 skipped; lint and types passed.
- Entry: stable reviewed snapshot and baseline checks established.
- Move graphics types, identifiers, roles, validators, and color values from
  renderer implementations into `src/content/presentation.ts`.
- Update content and render consumers, including typed built-in catalogs.
  Keep checks of actual loaded geometry and clips inside rendering.
- Update affected type imports in tests and session assembly.
- Exit: content, model, effect, and resource-presentation tests pass; lint and
  TypeScript checks pass; catalogs cover the accepted built-in IDs.

## Chunk 2: mission preparation and closure

- Status: complete. Depends on chunk 1.
- Verification: 173 focused tests passed; lint and types passed. Final
  `npm run check` passed with 910 unit tests, 2 existing skips, and 4 Chromium
  smoke checks. All 60 affected browser checks passed across Chromium and
  WebKit. `npm run build` passed with a bundle-size advisory.
- Move `LoadedMission`, `loadMission`, and `createSessionSimulation` into
  `src/mission-loading.ts`; update application, session, unit, and browser
  consumers. Use simulation terrain for headless browser mission authoring.
- Add an import-independence regression and document the runtime contract.
- Exit: mission-file, continuation, and dependency tests pass; lint and types
  pass; relevant save/scenario/lifecycle browser specs and quick checks pass.
- Inspect changed code and final diff. Run `npm run check`. Record results,
  deferred findings, and closure in these current-state documents.

## Next action

None. The selected scope is complete. `npm run check:full` passes with 1,014
unit and asset tests, 2 existing skips, and all 199 browser checks. Rust checks
and the production build pass. Work is grouped into player-view and headless
preparation commits. Application transitions and simulation decomposition
remain deferred as described in the findings.
