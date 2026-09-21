# Agent guidance

## Sources of truth

- `README.md` is the concise project introduction and working principles.
- `DESIGN.md` is the source of truth for game vision, requirements, decisions,
  and game specifications.
- Put future focused documentation in `docs/`. Do not duplicate information
  already owned by `README.md` or `DESIGN.md`.
- When a design choice is locked, record it in `DESIGN.md` with its date.

## Documentation

- Keep writing concise but complete. Explain only what helps a developer or
  reader make, understand, or verify a decision.
- Use Markdown lists instead of tables.
- Wrap Markdown lines at 80 characters or fewer.
- Do not add comments that merely restate code; comment intent, constraints,
  trade-offs, or non-obvious behavior.
- Keep comments and commit messages concise and informative; explain motivation
  only when it is not clear from the change itself.

## Implementation

- Respect the locked technical direction in `DESIGN.md`.
- Keep the game core browser-runnable; isolate Tauri-specific behavior behind
  platform-service boundaries.
- Keep simulation deterministic and independent of the render loop. It must run
  deterministically at a high tick rate even when the screen refresh rate is low
  or the rendering engine is lagging, and must not depend on GPU/DOM/Tauri
  state.
- Prefer data-driven content for game balance, campaigns, and future mods.
- Do not change a locked design decision or add major dependencies without
  explicit direction.

## Working practice

- Inspect relevant code and documentation before editing.
- Make the smallest coherent change that fully satisfies the request; include
  necessary local refactoring, but preserve unrelated work.
- Verify changes in proportion to their risk and scope.
- Run `npm run check` before considering a coding task complete.
- Use original or appropriately licensed code, assets, and content.
