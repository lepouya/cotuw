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
- [Actor assets](docs/actor-assets.md) — infantry GLB generation and rig
  contract.

## Development

Install Node.js 26 and Rust before starting desktop development.

```sh
npm install
npm run dev        # browser
npm run tauri dev  # desktop
npm run test:visual # browser screenshot checks
npm run check      # required before completing a coding task
```

The default browser opening starts with a fixed **Command Center** and 150
**Materials**. Build a **Materials Refinery** for 100, wait eight seconds, then
select it and produce its **Harvester** for 50. Select the Harvester in
**Units**, then use **Gather Near Materials** in **Selection** or click a blue
resource tile. It gathers 100 Materials in 60 seconds, returns to its Refinery,
deposits, and repeats. Build a **Field Barracks** for 100, then train
**Troopers** for 25 or **Scouts** for 20. The top bar shows available Materials;
cargo counts separately.

**Selection** provides Return cargo and Refinery assignment. Move and Stop
interrupt gathering and keep cargo. Exhausted patches prompt reassignment.
**Units** lists resource sites and salvage: select a mobile unit, then use
**Collect salvage** or click the hovering gift box to collect it without a
delivery. Paid production orders show remaining time and a Cancel action with
a full refund. A Refinery has one Harvester slot; a Barracks has five
outstanding orders. Blocked exits hold finished production until a tile is
cleared. Buildings sell for half cost. Buildings share one construction slot;
**Units** shows building timers and cancellation for a full refund.

Select a production building and use **Set Rally Point** in **Units** or
**Selection**, then click or tap clear, passable ground. New units exit and
move to its flag, which is visible while the building is selected. **Clear
Rally Point** restores exit-and-idle behavior; **Cancel rally point** or `Esc`
exits targeting.

Paid buildings must place their center within connected support coverage.
Completed Command Centers provide a 12-tile radius; Refineries and Barracks
provide six. Completed buildings link when one center lies within the other's
coverage, forming a chain back to a Command Center. Blueprints do not extend
coverage. Selecting a building, placing one, or enabling **Network View** shows
coverage and connection paths.
Disconnected buildings dim, stop machinery, and show a crossed power badge.
Construction and production pause without losing progress; paused construction
releases the slot for connected work. Offline Refineries hold cargo delivery
until reconnection. Broken links use dashed lines, and grouped alerts focus the
camera on affected buildings. Cancellation and sale remain available offline.

A lone wolf guards the southern path. Idle Troopers engage hostiles that come
near; to attack directly, select units and click or tap a visible wolf. Scouts
cannot attack. **Attack Move** in the unit controls enters destination
targeting; click or tap terrain to advance and engage along the way. Cancel or
`Esc` exits targeting. Groups spread their destinations; unarmed units keep
moving. Orange dashes and a diamond mark the order. Units search a lost target's
last-known position, then resume their destination. Health bars appear on
selected and fighting actors, and **Selection** shows exact health. Destroyed
actors leave remains that clear after a minute; building debris blocks
construction until then. Damaged buildings sell for less.

Combat destruction of the starting Command Center ends this opening in defeat
and pauses immediately. The results panel provides Restart, Load, and Exit. Load
accepts a compatible mission JSON file and begins paused; Inspect allows
selection and camera inspection, and Resume mission starts the clock. Invalid
files leave the current session intact. This opening has no victory condition.

Open `/?sandbox` for the empty, free construction and infantry sandbox. Use
**Buildings** to place structures on clear terrain. Use **Rotate** or `R` to
rotate and **Cancel** or `Esc` to exit placement. A yellow preview arrow marks
the preferred unit exit; blocked exits can use another side. Touch uses a
terrain tap followed by **Place building**. Construction and training in this
sandbox are instant and have no resource or power requirements.

Click or tap to select an actor. Shift-click or **Add units** toggles units in
and out of the selection. Primary drag selects mobile units; touch uses **Box
select**, which must be turned off before tapping a movement destination.
Click or tap terrain to move selected units to separate nearby positions.
**Stop** or `S` cancels their routes; **Clear** or `Esc` clears selection.

Secondary drag pans the camera; Shift-secondary drag rotates. Touch drags on
empty terrain pan when Box select is off. The world also provides camera pan,
rotation, zoom, and reset buttons.

**Selection** shows the selected actor or group and building actions.
**Units** also lists buildings that train units and the units in the field.
**Goals** shows construction and training goals and current counts.
**Building idle animation** controls rooftop equipment. A gathering Harvester
lowers and spins its drill with a green light; idle Harvesters raise it and
show amber. Reduced motion keeps these status cues without animated motion.

The visual tests start the Vite app in headless Chromium. They check the
camera, terrain rendering, terrain editing, and texture behavior, some through
canvas screenshots and some through in-page helpers in `e2e/harness.ts`. They
write an HTML report to `playwright-report/`. CI runs them only on macOS,
whose runners have a GPU, and uploads that report after a failed check.
Install the browsers locally once with `npx playwright install chromium`, plus
`webkit` on macOS, where the tests also run against WebKit to match the Tauri
webview.
Set `COTUW_TEST_PORT=1421` to run checks beside a server using the default port.

Terrain textures repeat by wrapping, so they must tile without a seam. After
editing one, make its opposite edges match with
`node scripts/reconcile-texture-edges.ts <png>...`, which rewrites the files in
place; the unit tests verify the result. Run it on freshly edited art only:
each run blends the edge band further, so re-running it on an already
reconciled texture degrades the art without changing the test outcome.

## Working principles

- Start with a small playable RTS core, then expand.
- Keep the deterministic game simulation separate from rendering and platform
  APIs.
- Keep content data-driven to support balancing, campaigns, and eventual mods.
- Keep the core browser-runnable. Treat multiplayer and native mobile delivery
  as planned constraints rather than initial scope.
- Respect players: no predatory cash shop, microtransactions, clickbait, false
  advertising, rug-pulls, or other deceptive design and business practices.
