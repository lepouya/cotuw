# Gameplay audio

Open **Options** on the title screen or in the in-game **Menu** for master,
sound, and music volume sliders and mute icons. Master volume defaults to 50%
and scales both buses without changing their levels.
Preferences are saved on this device, outside mission saves; invalid saved
values restore the defaults. Icon buttons have accessible names, pressed
states, and action tooltips. A click, tap, or key press unlocks playback.
Missing files or blocked audio leave gameplay available. World sounds stop
while paused; music continues. Exiting or replacing a mission releases its
voices. Loading restores current loops without replaying events.

## Content assignments

`src/content/packs/base.json` owns the assignments. Audio is optional, so packs
without it remain silent. The parser validates references and playback policies.

- `audio.clips` maps clip IDs to `{ url, loop }`.
- `audio.cues` maps cue IDs to a list of clip variants and mix policy:
  `gain` from zero to one, `cooldown` in real seconds, `voices` from one to 24,
  and nonnegative integer `priority`. Ready variants play in rotation;
  unavailable variants are skipped. Optional `range` gives the fade distance
  in world units; omit it for player feedback and music.
  Optional `unselectedGain` multiplies world cue gain when its object is not
  selected, from zero to one; it defaults to one and requires `range`.
- `audio.events` maps global event names to sequences of `{ cue, at? }` steps.
  `at` is a delay in real seconds, from zero to 60. Events use one-shot cues
  and contain at most 24 steps. An empty sequence is silent.
- `presentation[definitionId].audio.events` uses the same sequences for object
  events. `audio.loops` maps object state names to looping cue IDs.
- `audio.defaults` holds `events` and `loops` that every object definition
  inherits, including definitions without their own bindings. A definition's
  entry for the same name replaces the default. An empty event sequence or a
  `null` loop binding silences the inherited entry. The base pack assigns
  `damage` here.
- `audio.factions` maps faction IDs to `{ events }`. The player's faction
  replaces the global events it names for the whole mission; other events and
  unknown factions use `audio.events`. The base pack gives Circle players
  chimes for `command.accepted`, `command.invalid`, and `trained`.
- `audio.music` names `default` and optional `combat` cues, plus `holdSeconds`
  of simulation time to retain combat music after visible combat or an attack
  on the player's actors. Music cues loop and have no spatial range.
  Optional `factions` maps faction IDs to `{ default, combat? }` arrangements.
  The player's faction selects its arrangement for the whole mission,
  including loaded saves; unknown factions use the default arrangement.
- Scenes preload the clips used by global and default bindings, the mission's
  actor definitions, and its selected music arrangement. All variants of a
  referenced cue are retained. Other arrangements and unrelated actor cues
  are not requested by that scene.

For example, a future crane can assign sounds without changing the mixer:

```json
{
  "audio": {
    "events": {
      "lift": [{ "cue": "refinery-door-open" }],
      "release": [{ "cue": "refinery-door-close", "at": 0.2 }]
    },
    "loops": { "lifting": "harvester-work" }
  }
}
```

This is the crane's presentation binding; the referenced cues must exist in
its content pack. The crane also inherits the pack's default `damage` cue. New
audio files only need clip and cue entries. Generated assets also need
registration in the [asset inventory](audio-assets.md).

## Runtime boundaries

- `src/audio/mixer.ts` owns browser Web Audio, decoded buffers, device status,
  independent gain buses, panning, and short loop fades. A context is created
  only after trusted input. Unready one-shots are dropped; they never replay
  after loading finishes. `isLoaded(url)` exposes clip readiness independently
  of device suspension. Ready notifications restore current loops. Files that
  fail to load are not refetched. Unchanged mixes do not add automation events.
  Device failures while mixing or stopping a voice release it and report
  unavailable audio without propagating into gameplay.
  Each voice separates its mix level from its fade envelope, so mix changes
  preserve loop fade-ins. Fade-outs hold the current level before retargeting;
  a fallback supports devices without the hold operation. `SILENT_AUDIO` plays
  nothing for sessions without a device.
- `src/audio/scene.ts` resolves arbitrary event and state names. Supply the IDs,
  definition IDs, world positions, and current states of objects the listener
  may hear through `sync`; call `emit(name, emitter)` for an object or
  `emit(name)` for global feedback. Bindings can describe vehicles, buildings,
  props, or other objects.
  Camera focus is the listener position. World gain falls with distance and
  stereo pan follows horizontal displacement. `setSelection(ids)` updates
  selection gain immediately without a simulation tick or loop restart.
- `src/audio/mission.ts` adapts committed mission observations to this
  interface, reading actors, production, work, and remains through
  `viewOf(playerOwner)`. Add new gameplay event or state detection here, after
  a successful tick; simulation code never imports audio. Existing events are
  `attack`, `attack.impact`, `damage`, `destroyed`, `production.start`, and
  `activity.<kind>`. `destroyed` sounds from new remains of an actor shown alive
  in the previous observation. Remains discovered later or restored by loading
  stay silent. `attack.impact` uses the attacker's bindings at the observed
  target's position. Both participants must be visible or shown remains.
  States are `moving`, `working`, `servicing`, `training`, `constructing`, and
  `idle`. `servicing` uses the owner view's active service activity shared with
  animation and target effects. Approaching, blocked, finished, and hidden
  service supplies no active loop state.
  `moving` compares positions between observations; only own actors can use a
  route on first sight, so a newly detected foreign actor has no `moving` loop
  until its next observation. Active construction of any faction uses
  `constructing`, which Circle buildings bind to their growth loop; paused
  construction and disconnected buildings have no active loop states.
  Cultivators use `working` while gathering or actively tending, with the same
  committed worker set used by animation. A finished queue head waiting at a
  blocked exit has no `training` state. Committed building activity identifies
  the produced or delivering unit, so consumers share the same participant.
- Global events are `command.accepted`, `command.invalid`, `trained`, `alert`,
  `objective.complete`, `victory`, `defeat`, and `draw`. The base pack binds
  `draw` to the defeat cue. Command batches produce one response; cue
  cooldowns group repeated combat feedback. Each tick plays the
  most specific player feedback: a mission result replaces objective and alert
  cues, and an objective or training completion replaces the alert for
  routine alerts. High-priority alerts still sound.
- World emitters are the actors and remains the owner view shows, so hidden
  objects never reach the scene. Objects that leave the view lose their voices,
  including scheduled sequence steps. Global alerts for the player's actors
  remain audible. World loops give selected
  audible emitters slots first, then the nearest others, within each cue's
  voice limit and a total budget of 12. Selection never bypasses fog or range.
  Cues without a loaded variant do not reserve loop slots.
  Aliased states share a cue loop on the same object. All playback shares a
  24-voice budget. A higher priority cue replaces the lowest priority one-shot
  below it only after playback succeeds. Mission results outrank routine
  player feedback.
- Each session owns its scene. Pause stops world playback; resume rebuilds
  loops. Nonspatial one-shot feedback remains audible through pause or object
  removal after its visible trigger. Hidden objects cannot trigger it. Disposal
  cancels voices, deferred steps, and ready subscriptions. The application
  mixer reuses decoded assets across mission loads and restarts.

Circle buildings and the Briar Ram take wooden impacts and sound their
destruction. Healers and Artificers loop their own service patterns. Circle
producers sound on `production.start` and `activity.exit`. Harvesters loop
their engine while moving and their machinery while gathering. Work uses a
base gain of 0.4 and an unselected multiplier of 0.15. The training start cue
plays when a job first advances. Refinery delivery and
unit-exit events schedule both doors to match their activity animations. Each
deferred step acquires its voice and cooldown when due, so a sequence can reuse
a cue without reserving future voices. World steps use the emitter's latest
position and visibility. Pause, fog loss, removal, and disposal cancel them.
The pending queue holds at most 96 steps; higher priority steps can replace
lower priority ones, and excess steps are dropped. A step arriving over
250 milliseconds late expires, preventing stale feedback after a browser stall.

## Verification

`tests/audio.test.ts` checks generic assignments, inherited defaults, fog,
cooldowns, voice limits and priority, load baselines, and state transitions.
`tests/audio-mixer.test.ts` checks device unlock, master and bus gains, failure
recovery, decoding, and cleanup.
`e2e/audio.spec.ts` checks actual browser playback, pause and exit,
blocked devices, repeated sequence cues, gain hold fallback, and mouse, phone,
and tablet controls with saved preferences. Chromium and WebKit run through
`npm run check:full`. Asset generation and decoding
checks are described in [audio assets](audio-assets.md).

The macOS Tauri app also receives a manual smoke check for device unlock,
volume and mute controls, and mission restart using its bundled assets.
