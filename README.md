# Citadels of the Unquiet World

_Citadels of the Unquiet World_ is a science-fantasy real-time strategy game.

Humanity's Anomaly Response Command follows an alarming signal to a living,
damaged world and encounters the elven Circle of Repose. Their struggle over
its citadels and lost technology begins humanity's first contact and helps
awaken the deathless Everwake, eventually requiring an uneasy alliance.

The playable build contains ARC's M0 mission, a construction sandbox, and a
Circle cultivation slice. M1 targets an ARC-versus-Circle skirmish with a
base-building AI opponent. Follow [TODO.md](TODO.md) for active tasks,
dependencies, and progress.

## Play the prototype

The title screen offers **New mission**, **Load**, **Options**, and **Exit**.
New mission opens the wolf-den faction chooser: ARC's base-building mission
or the Circle's worker-tended cultivation slice. Difficulty selection is planned
for this screen.
Options provides master, sound, and music volume and mute controls; preferences
persist on this device. Leaving a mission through **Main menu** returns to the
title screen. Exit closes the desktop app; browsers show a close-tab message.

For ARC, follow the in-game guides. Build a Materials Refinery
and its Harvester, gather Materials, then build a Field Barracks and train
Troopers and Scouts. Defeat the lone wolf and all five den wolves while
protecting your Command Center. Victory allows continued free play.

Click or tap to select and command. Drag a box to select units; touch uses
**Box select**. **Pan** enables camera dragging, and **View** offers camera
presets. **Goals** shows objectives and preparation. **Menu**, `F10`, or `Esc`
opens save, load, restart, audio, and Main menu controls. `Esc` first cancels
active tools or clears selection. Choose **½×**, **1×**, **2×**, or **4×** in
the top bar to change game speed. `F5` quicksaves and `F9` quickloads. Loading
starts paused for inspection.

## Development

Install Node.js 26 and Rust for desktop development, then run:

```sh
npm install
npm run dev            # browser
npm run tauri dev      # desktop
npm run check          # quick checks while developing and before finishing
npm run check:full     # full checks before committing
npm run build          # production browser build
npm run tauri build    # desktop app and bundles
npm run playtest:build # browser playtest bundle with build manifest
```

Open `/?level=sandbox` for free construction and training. Explicit
`?level=<scenario ID>` links open a bundled level directly for development.
Use `/?level=skirmish-map` to inspect the rough M1 battlefield the same way.
Choose Circle in New mission or use `/?level=circle-wolf-den`. Start with a
Heartgrove and 150 Lifebloom. Train a Cultivator for 50, select it, and grow a
Conservatory for 100. Keep the worker nearby to tend construction, then send it
to Gather Lifebloom. Deliveries fund a Musterhall, Sentinels, and Wayfinders.
Sites regenerate; heavy staffing slows output and can trigger dormancy. Rotate
between the two sites or let workers wait for recovery. Moving or stopping a
worker pauses growth; select a replacement and use Tend to resume. Protect the
Heartgrove and clear the wolves to win. Gift boxes beyond the lone wolf grant
Lifebloom when a friendly unit walks over them.

This development slice uses the existing single-player control model.
Multi-owner economies and authority, emergency headquarters recovery, healing,
defenses, constructs, faction AI, difficulty, and skirmish balance remain
pending. See the [slice scope](DESIGN.md#circle-wolf-den-development-slice).

Levels and assets are generated from source and committed. `npm run levels`
rebuilds bundled levels, replacing hand edits; `npm run assets` rebuilds all
art and audio. The full check verifies that committed assets match their
generators. See [verification](docs/verification.md) for focused and watch runs.

## Documentation

- [Design](DESIGN.md): vision, locked rules, milestone scope, and open
  decisions.
- [Design questionnaire](docs/design-questionnaire.md): supporting rationale,
  future systems, and unresolved design questions.
- [TODO](TODO.md): ordered milestone tasks, design decisions,
  dependencies, and acceptance gates for the two-faction skirmish.
- [Verification](docs/verification.md): automated checks and demo acceptance.
- [Architecture review](docs/architecture-review.md): installed skills and the
  milestone review workflow.
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
