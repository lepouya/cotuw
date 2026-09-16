# Citadels of the Unquiet World

_Citadels of the Unquiet World_ is a science-fantasy real-time strategy game.

Two rival powers struggle over a living, damaged world: a technology-and-weapons
coalition seeking to stabilize it through industry, and a magic-and-nature
coalition seeking to protect its old balances. Their war awakens the deeper
force that once ruined the world, eventually requiring an uneasy alliance.

## Documentation

- [Design](DESIGN.md) — vision, requirements, technical direction, decisions,
  and game specifications.
- [Roadmap](ROADMAP.md) — milestones and implementation work.

## Development

Install Node.js 26 and Rust before starting desktop development.

```sh
npm install
npm run dev        # browser
npm run tauri dev  # desktop
npm run check      # required before completing a coding task
```

## Working principles

- Start with a small playable RTS core, then expand.
- Keep the deterministic game simulation separate from rendering and platform
  APIs.
- Keep content data-driven to support balancing, campaigns, and eventual mods.
- Treat multiplayer, mobile, and browser delivery as planned constraints, not
  initial scope.
- Respect players: no predatory cash shop, microtransactions, clickbait, false
  advertising, rug-pulls, or other deceptive design and business practices.
