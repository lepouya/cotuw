# ARC M0 playtest

Play Citadels of the Unquiet World's ARC introduction using its in-game
instructions. This is an early RTS prototype. You do not need prior RTS
experience.

## Before playing

- Use the link supplied by the organizer in a current desktop browser. Keep
  this build's revision from `build.json` with your report.
- Set aside about 20 minutes. A successful mission aims for 5 to 10 minutes;
  learning, pauses, and feedback can take longer. You may stop at any time.
- Record your operating system, browser and version, input method, and prior
  RTS experience in `playtest-report.md`.
- If you have played another build, use a fresh browser profile or private
  window for this session. Save data and preferences are stored per browser
  origin. Private-window saves disappear when that window closes. Export a
  save before closing if you want to attach it to a report.

## Play

Open the supplied link at its root, without a `?level=` parameter. Choose
**New mission**, then **Anomaly Response Command**, and try to complete the
mission using only the game and its in-game guidance. Play at your own pace.
The organizer should not give a walkthrough unless you ask for help or cannot
continue.

Tell the observer what you are trying to do and what seems unclear. If you
need help, record when and why. If you stop, record what led you to stop.
Your difficulties are useful feedback about the game.

After the attempt, complete the report. Describe what happened, what you
expected, and how to reproduce any problems. Attach screenshots or exported
saves when useful. Ask the organizer where to send your report.

## Organizer: serve the bundle

`site/` contains the production website. Upload its contents to the root of
an HTTPS static host. Share the root URL, the revision in `build.json`, and
these instructions and the report template. Keep `build.json` alongside the
original bundle so reports can identify the exact artifact. The JSON lists
SHA-256 hashes and byte counts for every bundled file except itself.

For a local session, run this from the bundle directory with Python 3:

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory site
```

Open `http://127.0.0.1:4173/`. Opening `site/index.html` directly as a file
will not work. Keep the server running throughout the session. Use a browser
profile or port separate from development to avoid mixing saves.

Only distribute bundles with `distributionReady: true`. The marker confirms
clean source provenance; it does not certify that acceptance checks passed.
A bundle marked false is a local preview and does not identify reproducible
source by revision alone.
