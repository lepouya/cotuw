# Citadels of the Unquiet World

_Citadels of the Unquiet World_ is a science-fantasy real-time strategy game.

Humanity's Anomaly Response Command follows an alarming signal to a living,
damaged world and encounters the elven Circle of Repose. Their struggle over
its citadels and lost technology begins humanity's first contact and helps
awaken the deathless Everwake, eventually requiring an uneasy alliance.

## Documentation

- [Design](DESIGN.md) — vision, requirements, technical direction, decisions,
  and game specifications.
- [Roadmap](ROADMAP.md) — milestones and implementation work.
- [Design questionnaire](docs/design-questionnaire.md) — detailed rationale,
  alternatives, and queued design questions.

## Development

Install Node.js 26 and Rust before starting desktop development.

```sh
npm install
npm run dev        # browser
npm run tauri dev  # desktop
npm run test:visual # browser screenshot checks
npm run check      # required before completing a coding task
```

The visual test starts the Vite app in headless Chromium, captures the terrain,
and verifies that its initial bounds fill the viewport without clipping. It
writes an HTML report to `playwright-report/`; CI uploads that report after a
failed check. Install its browser locally once with
`npx playwright install chromium`.

## Working principles

- Start with a small playable RTS core, then expand.
- Keep the deterministic game simulation separate from rendering and platform
  APIs.
- Keep content data-driven to support balancing, campaigns, and eventual mods.
- Keep the core browser-runnable. Treat multiplayer and native mobile delivery
  as planned constraints rather than initial scope.
- Respect players: no predatory cash shop, microtransactions, clickbait, false
  advertising, rug-pulls, or other deceptive design and business practices.
