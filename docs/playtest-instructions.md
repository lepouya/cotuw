# ARC playtest

Play Citadels of the Unquiet World as Anomaly Response Command (ARC): first
its introduction if you are new to RTS games, then a skirmish against a
computer opponent that builds its own base. This is an early RTS prototype.
You do not need prior RTS experience.

## Before playing

- Play on your own using the in-game guidance.
- Open the organizer's links in a current desktop browser. Record the build
  revision supplied with the links in each report.
- Set aside about 75 minutes, or about 45 if you skip the introduction. A
  skirmish aims for 15 to 25 minutes of game time; learning, pauses, and
  feedback take longer. You may stop at any time.
- Complete one copy of `playtest-report.md` for each mission you attempt.
  Record your operating system, browser and version, input method, and prior
  RTS experience in each.
- If you have played another build, use a fresh browser profile or private
  window for this session. Save data and preferences are stored per browser
  origin. Private-window saves disappear when that window closes, so export
  saves before closing it.
- Keep notes as you play. The game's top bar shows elapsed game time; note it
  beside anything confusing, surprising, or broken.

## Introduction

Play this if you have no or occasional RTS experience; otherwise skip it.

Open the supplied main link as given, without a `?level=` parameter. Choose
**New mission**, keep **Normal** difficulty, then choose **Anomaly Response
Command**. Play at your own pace.

## Skirmish

Open the supplied skirmish link as given. It starts you in the west base on
Normal difficulty against an ARC opponent in the east. Both sides begin with
a Command Center and enough Materials to build a Refinery and Harvester.

Build an economy, base, and army. Win by destroying all completed enemy
Command Centers, Materials Refineries, Field Barracks, and Sentry Turrets.
The opponent scouts, raids, attacks, and rebuilds what it loses. Try expanding
to other deposits, defending, repairing, rebuilding after losses, and using
support units. **Restart** in the menu replays the same match.

Play until the match ends or you choose to stop. To export a save, open the
menu, choose **Save**, name the save, and choose **Export file**. Export a
save when the match ends and whenever a bug occurs and the menu is available.

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
covers publishing to GitHub Pages. Share the main and skirmish links, the
revision in `build.json`, a participant code, the return address, and these
instructions and the report template. Keep `build.json` alongside the
original bundle so reports can identify the exact artifact. The JSON lists
SHA-256 hashes and byte counts for every bundled file except itself.

Append this query to the main link for the ARC skirmish.

```text
?skirmish=arc-arc&player=west&difficulty=normal&ai=east:arc-skirmish
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
