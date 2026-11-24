# Playtest

Play Citadels of the Unquiet World, an early real-time strategy (RTS)
prototype. Each round names its faction: the Circle of Repose, which grows its
base and cultivates renewable Lifebloom, or Anomaly Response Command (ARC),
which builds and mines. You do not need prior RTS experience.

## Before playing

- Play on your own using the in-game guidance.
- Open the organizer's links in a current desktop browser. Record the build
  revision supplied with the links in each report.
- Set aside about 90 minutes, plus 30 for an optional ARC skirmish. A
  skirmish aims for 15 to 25 minutes of game time; learning, pauses, and
  feedback take longer. You may stop at any time.
- Complete one copy of `playtest-report.md` for each mission you attempt.
  Record your operating system, browser and version, input method, and prior
  RTS experience in each.
- If you played an earlier build, several parts of Circle play and the camera
  have changed since then. Play as you normally would, and note what feels
  better, worse, or no different. Use a fresh browser profile or private
  window for this session. Save data and preferences are stored per browser
  origin. Private-window saves disappear when that window closes, so export
  saves before closing it.
- Keep notes as you play. The game's top bar shows elapsed game time; note it
  beside anything confusing, surprising, or broken.
- To export a save, open the menu, choose **Save**, name the save, and choose
  **Export file**. Export a save when a mission ends and whenever a bug occurs
  and the menu is available. **Restart** in the menu replays the same mission.

## Circle of Repose

### Circle introduction

Play this first, whatever your RTS experience.

Open the supplied main link as given, without a `?level=` parameter. Choose
**New mission**, select **Introduction**, **Circle of Repose**, and
**Normal**, then choose **Start**.
Play at your own pace, then continue in free play or move on.

You start with a Heartgrove and 150 Lifebloom. Cultivators grow buildings by
tending them and gather Lifebloom from renewable sites. Watch what happens to
a site's reserve as you change how many Cultivators use it. In your report,
describe one cultivation decision you made and why.

### Circle skirmish

Open the supplied Circle skirmish link as given. It starts you as the Circle
in the west base on Normal difficulty against an ARC opponent in the east.
Both sides begin with a headquarters and enough to fund their first worker
and drop-off building.

Build an economy, base, and army. Win by destroying all completed enemy
Command Centers, Materials Refineries, Field Barracks, and Sentry Turrets.
The opponent scouts, raids, attacks, and rebuilds what it loses.

If you lose, play the Circle skirmish once more from the same link and fill in
a separate report. Note what you changed in your second attempt.

## Anomaly Response Command

These are optional. If you have not played this game before and have time
after the Circle skirmish, play the ARC skirmish.

### ARC introduction

Play this before the ARC skirmish if you have no or occasional RTS
experience; otherwise skip it.
Choose **New mission**, select **Introduction**, **Anomaly Response Command**,
and **Normal**, then choose **Start**.

### ARC skirmish

Open the supplied ARC skirmish link as given. It starts you in the west base
on Normal difficulty against an ARC opponent in the east. Both sides begin
with a Command Center and enough Materials to build a Refinery and Harvester.

Win by destroying all completed enemy Command Centers, Materials Refineries,
Field Barracks, and Sentry Turrets. Try expanding to other deposits,
defending, repairing, rebuilding after losses, and using support units.

## Afterwards

Complete the reports. Describe what you were trying to do, what happened,
what you expected, and how to reproduce any problems. If you stop early or
look for help outside the game, record when and why; your difficulties are
useful feedback about the game.

Email your reports and exported saves to the address the organizer supplied
with the links. Check screenshots and attachments for personal information
first.

## Organizer: serve the bundle

`site/` contains the production website. Asset URLs are relative, so serve its
contents from any directory of an HTTPS static host. `docs/verification.md`
covers publishing to GitHub Pages. Share the main link, the skirmish links for
the round, the revision in `build.json`, a participant code, the return
address, and these instructions and the report template. Keep `build.json`
alongside the original bundle so reports can identify the exact artifact. The
JSON lists SHA-256 hashes and byte counts for every bundled file except
itself.

Append these queries to the main link for the skirmishes.

```text
Circle: ?skirmish=circle-arc&player=west&difficulty=normal&ai=east:arc-skirmish
ARC:    ?skirmish=arc-arc&player=west&difficulty=normal&ai=east:arc-skirmish
```

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
