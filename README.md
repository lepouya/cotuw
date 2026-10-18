# Citadels of the Unquiet World

_Citadels of the Unquiet World_ is a science-fantasy real-time strategy game.

Humanity's Anomaly Response Command follows an alarming signal to a living,
damaged world and encounters the elven Circle of Repose. Their struggle over
its citadels and lost technology begins humanity's first contact and helps
awaken the deathless Everwake, eventually requiring an uneasy alliance.

## Play the prototype

The title screen offers **New mission**, **Load**, **Options**, and **Exit**.
Options provides master, sound, and music volume and mute controls; preferences
persist on this device. Leaving a mission through **Main menu** returns to the
title screen. Exit closes the desktop app; browsers show a close-tab message.

Start a new mission and follow the in-game guides. Build a Materials Refinery
and its Harvester, gather Materials, then build a Field Barracks and train
Troopers and Scouts. Defeat the lone wolf and all five den wolves while
protecting your Command Center. Victory allows continued free play.

Click or tap to select and command. Drag a box to select units; touch uses
**Box select**. **Pan** enables camera dragging, and **View** offers camera
presets. **Goals** shows objectives and preparation. **Menu** or `F10` opens
save, load, restart, audio, and Main menu controls; `F5` quicksaves and `F9`
quickloads. Loading starts paused for inspection.

## Development

Install Node.js 26 and Rust for desktop development, then run:

```sh
npm install
npm run dev         # browser
npm run tauri dev   # desktop
npm run check       # required before completing a coding task
npm run build       # production browser build
npm run tauri build # desktop app and bundles
```

Open `/?level=sandbox` for free construction and training. Explicit
`?level=<scenario ID>` links open a bundled level directly for development.

Levels and assets are generated from source and committed. `npm run levels`
rebuilds bundled levels, replacing hand edits; `npm run assets` rebuilds all
art and audio. Asset tests verify that committed files match their generators.

## Documentation

- [Design](DESIGN.md): vision, locked rules, prototype scope, and open
  decisions.
- [Design questionnaire](docs/design-questionnaire.md): supporting rationale,
  future systems, and unresolved design questions.
- [Verification](docs/verification.md): automated checks and demo acceptance.
- [Runtime boundaries](docs/runtime-boundaries.md): simulation and resource
  ownership contracts.
- [Mission files](docs/mission-files.md): level and save format and hand
  editing.
- [Content packs](docs/content-packs.md): shared rules and presentation data.
- [Actor assets](docs/actor-assets.md): model, texture, and animation contracts.
- [Audio assets](docs/audio-assets.md): inventory, generators, and provenance.
- [Gameplay audio](docs/audio.md): playback, settings, and extension points.

## Working principles

- Start with a small playable RTS core, then expand.
- Keep the deterministic game simulation separate from rendering and platform
  APIs.
- Keep content data-driven to support balancing, campaigns, and eventual mods.
- Keep the core browser-runnable. Treat multiplayer and native mobile delivery
  as planned constraints rather than initial scope.
- Respect players: no predatory cash shop, microtransactions, clickbait, false
  advertising, rug-pulls, or other deceptive design and business practices.
