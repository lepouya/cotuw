# Agent guidance

## Sources of truth

- `README.md` is the concise project introduction and working principles.
- `DESIGN.md` is the source of truth for game vision, requirements, decisions,
  and game specifications.
- Put future focused documentation in `docs/`. Do not duplicate information
  already owned by `README.md` or `DESIGN.md`.
- When a design choice is locked, record it in `DESIGN.md`.

## Documentation

- Keep writing concise but complete. Explain only what helps a developer or
  reader make, understand, or verify a decision.
- Describe the current state, never the history of how it got there. Edit the
  affected text in place rather than recording what it replaced, what was
  removed, or what something used to be. Version control holds the history.
- Use Markdown lists instead of tables.
- Wrap Markdown lines at 80 characters or fewer.
- Comment intent, constraints, trade-offs, and non-obvious behavior. Drop the
  comment when the name and surrounding code already carry it.
- Keep comments short and plainly worded. Prefer one line. A comment longer
  than the code it explains is usually over-explaining.
- Say the thing directly. No throat-clearing, no restating the signature, no
  flourishes such as em-dash asides or invented metaphors.
- Use a doc comment for a contract a caller cannot infer from the signature,
  and a line comment for local rationale at the point it applies.
- Keep commit messages concise and informative; explain motivation only when
  it is not clear from the change itself.

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
