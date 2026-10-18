# Verification

[DESIGN.md](../DESIGN.md#milestone-0-playable-slice) owns the prototype rules
and acceptance targets. These checks cover the application, authored mission,
and desktop host. Automated runs establish correctness; human runs establish
clarity, pacing, and usability.

## Automated checks

Run `npm run check` before completing a coding task. It checks formatting,
TypeScript and Rust linting and types, unit tests, generated assets, and browser
flows. The Rust harness has no tests; platform adapters have TypeScript tests.

Install Playwright browsers once with `npx playwright install chromium`, plus
`webkit` on macOS. Checks use full headless Chromium with GPU WebGL; macOS also
runs WebKit to cover the desktop webview engine. The headless shell's software
WebGL can time out under parallel load. Browser checks write screenshots and
attachments to `playwright-report/`. Some use `e2e/harness.ts` to inspect views
or drive a controlled simulation clock.

Set `COTUW_TEST_PORT=1421` to run checks beside a server on the default port.
The GitHub Actions Check workflow runs only by manual request to conserve the
monthly quota. It checks TypeScript and Rust on Windows and macOS, browser
flows on macOS, and browser-only code on Linux.

Build browser and native artifacts with:

```sh
npm run build
npm run tauri build -- --debug --no-bundle
npm run tauri build
```

Regenerating assets and levels with `npm run assets` and `npm run levels`
should leave committed output unchanged unless their sources changed.

## Mission flow

The full browser mission starts at the title screen and uses the authored
economy, actors, combat, and objectives through victory and free play. It runs
with mouse and phone touch input in Chromium and WebKit. Its controlled clock
accelerates waiting without granting resources or changing balance.

```sh
npx playwright test e2e/mission.spec.ts --workers=1
```

Run the same strategy with the app's normal timers and render loop:

```sh
COTUW_REALTIME_PLAYTHROUGH=1 npx playwright test e2e/mission.spec.ts \
  --project=chromium --workers=1 --grep 'with mouse'
```

## Human acceptance

- Have RTS-familiar first-time players attempt the mission using only in-game
  guidance. Observe the economy bootstrap, Harvester assignment, controls,
  route discovery, army preparation, and den assault. Record completion time,
  pauses, speed changes, confusion, assistance, and abandonment. Fix recurring
  blockers and repeat the affected paths. Aim for the design's 5 to 10 minute
  successful run without slowing the economy or adding encounters to pad it.
- On a fixed revision, run the built Windows and macOS apps from the title
  screen through victory and continued free play. Exercise defeat, load,
  restart, Main menu, and Exit. Check the default 800×600 window and resizing,
  keyboard and pointer controls, audio, and returning after Alt-Tab.
- Verify named saves survive relaunch, repeated quicksave overwrite and
  quickload, objective autosave, native Import and Export, cancellation, and
  malformed or incompatible files preserving the current session.
- Check Options before starting a mission and confirm settings persist through
  loads, restarts, and relaunch. Listen for the mix and loops throughout a run.
- Test release bundles and installation when distributing the desktop demo.
  Compilation and browser WebKit checks do not verify packaged-app behavior.

Include the revision, platform, build mode, input method, observed result, and
reproduction details with actionable bug reports. Track work in issues and
commit history rather than keeping dated acceptance logs in project docs.
