# Audio assets

Run `npm run assets:audio` to regenerate the WAV files and audition page in
`public/assets/audio`. `npm run assets` also includes them. With the development
server running, open `/assets/audio/index.html` to play cues over music and
download files. Playback requires a click or tap. Stop all silences every
player. Starting a second music track pauses the first; starting a second cue
pauses the first cue. Machinery loops can play together with music and cues.
The page also ships in the browser build.

## Inventory

- `command-accepted` and `command-invalid`: short rising and falling synth
  signals for committed command results.
- `rifle-1`, `rifle-2`, and `rifle-3`: percussive rifle reports with different
  seeded noise and metallic overtones.
- `wolf-attack`: a synthesized growl and bite transient.
- `damage-1` and `damage-2`: low impacts with different metallic resonances.
- `alert`: a repeated descending two-note signal.
- `objective-complete`: a short ascending glass-note phrase.
- `victory` and `defeat`: longer resolving and descending phrases.
- `training-start`: a mechanical latch and rising signal when Barracks training
  begins.
- `unit-trained`: a short, bright readiness phrase when a unit finishes
  training.
- `harvester-work`: a four-second loop of loaded drilling and cutter chatter.
- `harvester-engine`: a four-second loop of low engine rumble and moving
  machinery. Work and engine loops have no startup or shutdown transient;
  gameplay playback fades them in and out with the corresponding state.
- `refinery-door-open` and `refinery-door-close`: motor travel, roller rattle,
  and latch sounds. Travel lasts 0.45 seconds to match the Refinery's garage
  animation; each file lasts 0.8 seconds including its tail. The delivery
  animation opens at its start and closes at 2.55 seconds. These cues also suit
  the garage's unit-exit activity.
- `unquiet-frontier`: exploration music with warm pads, glass notes, and a
  sparse low pulse.
- `beneath-the-ridge`: tension music with darker pads, a muted sequence, and
  restrained percussion.

## Source and provenance

- All audio is original procedural synthesis and composition implemented in
  `scripts/audio-assets.ts` for this project. It uses no recordings, sample
  libraries, third-party melodies, pretrained audio models, or external assets.
  The repository's [LICENSE](../LICENSE) applies; no additional attribution or
  sample license is required.
- `src/content/audio-assets.ts` owns IDs, titles, durations, music moods, and
  URLs. Each sound ID needs a recipe in `scripts/audio-assets.ts`; type
  checking rejects a missing one. `scripts/assets.ts` registers the generated
  WAVs and audition HTML. Generator tests compare committed bytes with fresh
  output.
- Files use uncompressed 16-bit little-endian PCM WAV at 32 kHz. Cues are mono
  for world positioning; music is stereo. The complete batch is about
  14 MB, with no encoder or audio package dependency.
- Noise uses explicit seeds. Instruments combine sine oscillators, filtered
  noise, amplitude envelopes, and echoes. Changing a recipe or seed changes
  the committed output after regeneration.
- Both music tracks contain sixteen bars at 80 BPM, lasting exactly 48 seconds.
  Their shared D-minor palette uses slow chord changes. Voices and echo tails
  wrap across the loop boundary, preserving continuous ambience on repeat.
- One-shot cues peak at 0.72 full scale; drilling peaks at 0.42, the engine at
  0.38, and music at 0.28. The audition page starts cue volume at 70%, machinery
  at 55%, and music at 40%. These leave mix headroom but are not final
  gameplay loudness settings. Listening review remains part of tuning.

## Gameplay integration

All cues and both music tracks are assigned through the base content pack.
See [gameplay audio](audio.md) for controls, content bindings, runtime extension
points, and verification. [DESIGN.md](../DESIGN.md#audio) owns the requirements.
