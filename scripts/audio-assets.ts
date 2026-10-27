// Original synthesis and composition; no recordings or instrument samples.
import {
  AUDIO_SAMPLE_RATE,
  MUSIC_ASSETS,
  SOUND_ASSETS,
  audioAssetUrl,
  soundLoops,
  soundPeak,
} from "../src/content/audio-assets.ts";

import type { MusicId, SoundId } from "../src/content/audio-assets.ts";

const TAU = Math.PI * 2;
const RATE = AUDIO_SAMPLE_RATE;
type Mix = { channels: Float64Array[]; loop: boolean };

function mix(seconds: number, stereo = false, loop = false): Mix {
  return {
    channels: Array.from(
      { length: stereo ? 2 : 1 },
      () => new Float64Array(Math.round(seconds * RATE)),
    ),
    loop,
  };
}

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state / 0x1_0000_0000) * 2 - 1;
  };
}

function voice(
  target: Mix,
  start: number,
  seconds: number,
  sample: (time: number) => number,
  pan = 0,
) {
  const offset = Math.round(start * RATE);
  const frames = target.channels[0]!.length;
  const gains =
    target.channels.length === 1
      ? [1]
      : [Math.sqrt((1 - pan) / 2), Math.sqrt((1 + pan) / 2)];
  for (let i = 0; i < Math.round(seconds * RATE); i++) {
    const position = offset + i;
    if (!target.loop && position >= frames) break;
    const value = sample(i / RATE);
    for (const [channel, samples] of target.channels.entries())
      samples[position % frames]! += value * gains[channel]!;
  }
}

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
const sine = (frequency: number, time: number) =>
  Math.sin(TAU * frequency * time);

function note(
  target: Mix,
  start: number,
  midi: number,
  seconds: number,
  level: number,
  pan = 0,
) {
  const frequency = hz(midi);
  voice(
    target,
    start,
    seconds,
    (t) => {
      const envelope =
        Math.min(1, t / 0.006) *
        Math.exp((-5 * t) / seconds) *
        Math.min(1, (seconds - t) / 0.03);
      return (
        level *
        envelope *
        (sine(frequency, t) + 0.22 * sine(frequency * 2.003, t))
      );
    },
    pan,
  );
}

function thump(target: Mix, start: number, level: number) {
  voice(target, start, 0.5, (t) => {
    const phase = TAU * (52 * t + (95 / 32) * (1 - Math.exp(-32 * t)));
    return level * Math.min(1, t / 0.003) * Math.exp(-14 * t) * Math.sin(phase);
  });
}

function noise(
  target: Mix,
  start: number,
  seconds: number,
  level: number,
  seed: number,
  brightness: number,
  pan = 0,
) {
  const next = random(seed);
  let low = 0;
  let bass = 0;
  voice(
    target,
    start,
    seconds,
    (t) => {
      low += brightness * (next() - low);
      bass += 0.004 * (low - bass);
      return (
        (low - bass) *
        level *
        Math.min(1, t / 0.002) *
        Math.exp((-8 * t) / seconds) *
        Math.min(1, (seconds - t) / 0.02)
      );
    },
    pan,
  );
}

function echo(target: Mix, seconds: number, amount: number, repeats: number) {
  for (const [channel, samples] of target.channels.entries()) {
    const dry = samples.slice();
    for (let repeat = 1; repeat <= repeats; repeat++) {
      const offset = Math.round((seconds + channel * 0.013) * RATE * repeat);
      const gain = amount ** repeat;
      for (let i = 0; i < dry.length; i++) {
        const position = i + offset;
        if (!target.loop && position >= dry.length) break;
        samples[position % dry.length]! += dry[i]! * gain;
      }
    }
  }
}

function wav(target: Mix, peak: number): Uint8Array {
  const channels = target.channels.length;
  const frames = target.channels[0]!.length;
  let maximum = 0;
  for (const samples of target.channels)
    for (let i = 0; i < frames; i++) {
      // One-shots settle to silence; loops preserve their periodic tails.
      if (!target.loop)
        samples[i]! *= Math.min(1, (frames - 1 - i) / (RATE * 0.02));
      maximum = Math.max(maximum, Math.abs(samples[i]!));
    }
  const bytes = new Uint8Array(44 + frames * channels * 2);
  const view = new DataView(bytes.buffer);
  const tag = (offset: number, text: string) =>
    [...text].forEach((character, i) =>
      view.setUint8(offset + i, character.charCodeAt(0)),
    );
  tag(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  tag(36, "data");
  view.setUint32(40, bytes.length - 44, true);
  const scale = maximum ? (peak * 32767) / maximum : 0;
  for (let frame = 0; frame < frames; frame++)
    for (let channel = 0; channel < channels; channel++)
      view.setInt16(
        44 + (frame * channels + channel) * 2,
        Math.round(target.channels[channel]![frame]! * scale),
        true,
      );
  return bytes;
}

function harvesterLoop(target: Mix, drilling: boolean) {
  const seconds = target.channels[0]!.length / RATE;
  const next = random(drilling ? 701 : 702);
  // Integer cycles keep the textured machinery bed periodic at the seam.
  const partials = Array.from({ length: 48 }, () => ({
    frequency:
      Math.round(
        ((drilling ? 160 : 25) + (next() + 1) * (drilling ? 1100 : 240)) *
          seconds,
      ) / seconds,
    phase: next() * Math.PI,
  }));
  voice(target, 0, seconds, (t) => {
    let texture = 0;
    for (const partial of partials)
      texture += Math.sin(TAU * partial.frequency * t + partial.phase);
    if (drilling) {
      const load = 0.8 + 0.2 * sine(0.5, t);
      const cutter = Math.sin(TAU * 145 * t + 1.2 * sine(23, t));
      return (
        load *
        (0.32 * cutter +
          0.14 * sine(290, t) +
          0.055 * texture * (0.7 + 0.3 * sine(8, t)))
      );
    }
    const motor = Math.sin(TAU * 52 * t + 0.2 * sine(6, t));
    return (
      (0.72 + 0.1 * sine(2, t) + 0.08 * sine(7, t)) *
        (0.48 * motor + 0.18 * sine(104, t) + 0.07 * sine(208, t)) +
      0.025 * texture
    );
  });
}

function refineryDoor(target: Mix, closing: boolean) {
  // Match the model's 0.45-second door travel, then let the latch decay.
  const travel = 0.45;
  voice(target, 0, travel, (t) => {
    const phase =
      TAU * ((closing ? 190 : 130) * t + (closing ? -65 : 65) * t * t);
    return (
      Math.sin((Math.PI * t) / travel) ** 2 *
      (0.38 * Math.sin(phase) + 0.13 * Math.sin(phase * 2.7)) *
      (0.75 + 0.25 * sine(35, t))
    );
  });
  for (let i = 0; i < 5; i++)
    noise(target, i * 0.08, 0.1, 0.35, (closing ? 820 : 810) + i, 0.3);
  noise(target, closing ? travel : 0, 0.18, 0.8, closing ? 832 : 831, 0.4);
  thump(target, closing ? travel : 0, closing ? 0.48 : 0.22);
  note(target, travel, closing ? 44 : 56, 0.3, 0.2);
}

function rifle(target: Mix, variant: number) {
  thump(target, 0, 0.7);
  noise(target, 0, 0.18, 2, 100 + variant, 0.7);
  noise(target, 0.035, 0.4, 0.4, 200 + variant, 0.09);
  note(target, 0.008, 58 + variant, 0.16, 0.2);
  echo(target, 0.085, 0.16, 2);
}

function damage(target: Mix, variant: number) {
  thump(target, 0, 0.9);
  noise(target, 0, 0.27, 1.2, 400 + variant, 0.28);
  note(target, 0.003, 49 + variant * 3, 0.28, 0.3);
}

function livingFocus(target: Mix, variant: number) {
  const frequency = hz(76 + variant * 2);
  voice(target, 0, 0.65, (t) => {
    const bloom = Math.min(1, t / 0.035) * Math.exp(-7 * t);
    const phase = TAU * frequency * t + 3 * Math.exp(-16 * t);
    return (
      bloom *
      (0.55 * Math.sin(phase) +
        0.2 * Math.sin(phase * 1.5) +
        0.12 * sine(frequency * 2.01, t))
    );
  });
  noise(target, 0.02, 0.19, 0.2, 920 + variant, 0.08);
  note(target, 0.07, 88 + variant * 2, 0.5, 0.16);
  echo(target, 0.095, 0.22, 2);
}

function pluck(
  target: Mix,
  start: number,
  midi: number,
  level: number,
  pan: number,
) {
  const frequency = hz(midi);
  voice(
    target,
    start,
    2.6,
    (t) => {
      let string = 0;
      for (let partial = 1; partial <= 7; partial++)
        string +=
          (sine(frequency * partial, t) *
            Math.exp(-(1.8 + partial * 1.2) * t)) /
          partial ** 1.4;
      return (
        level * Math.min(1, t / 0.004) * Math.min(1, (2.6 - t) / 0.05) * string
      );
    },
    pan,
  );
}

function woodenBeat(target: Mix, start: number, level: number, seed: number) {
  voice(
    target,
    start,
    0.42,
    (t) =>
      level *
      Math.min(1, t / 0.007) *
      Math.exp(-15 * t) *
      (sine(145, t) + 0.35 * sine(385, t) + 0.1 * sine(730, t)),
  );
  noise(target, start, 0.09, level * 0.4, seed, 0.18);
}

/** A rising or falling phrase over an optional sustained chord. */
function phrase(
  target: Mix,
  notes: readonly number[],
  seconds: number,
  chord: readonly number[] = [],
) {
  notes.forEach((midi, index) =>
    note(target, index * 0.22, midi, seconds, 0.4),
  );
  for (const midi of chord) note(target, 0, midi, 3.8, 0.2);
  echo(target, 0.21, 0.3, 3);
}

// Every sound ID needs a recipe, so the type checker rejects a missing one.
const SOUND_RECIPES: Record<SoundId, (target: Mix) => void> = {
  "command-accepted": (target) => {
    note(target, 0, 81, 0.12, 0.6);
    note(target, 0.065, 88, 0.16, 0.45);
  },
  "command-invalid": (target) => {
    note(target, 0, 62, 0.16, 0.5);
    note(target, 0.12, 57, 0.23, 0.5);
  },
  "rifle-1": (target) => rifle(target, 1),
  "rifle-2": (target) => rifle(target, 2),
  "rifle-3": (target) => rifle(target, 3),
  "circle-cast-1": (target) => livingFocus(target, 1),
  "circle-cast-2": (target) => livingFocus(target, 2),
  "circle-cultivation": (target) => {
    for (const [start, midi] of [
      [0, 72],
      [1.3, 79],
      [3.1, 76],
      [5.4, 81],
      [6.7, 74],
    ])
      pluck(target, start!, midi!, 0.16, 0);
    // Wrapped swells keep the loop seamless without a machine-like drone.
    for (const start of [0.6, 4.8]) {
      voice(
        target,
        start,
        3.2,
        (t) =>
          Math.sin((Math.PI * t) / 3.2) ** 2 *
          (0.07 * sine(392, t) + 0.035 * sine(588, t)),
      );
      noise(target, start, 2.4, 0.09, 741 + start * 10, 0.15);
    }
    echo(target, 0.17, 0.18, 2);
  },
  "circle-growth": (target) => {
    for (const [start, midi] of [
      [0, 60],
      [1.1, 67],
      [2.7, 62],
    ])
      pluck(target, start!, midi!, 0.18, 0);
    voice(
      target,
      0,
      4,
      (t) =>
        Math.sin((Math.PI * t) / 4) ** 2 *
        (0.09 * sine(294, t) + 0.04 * sine(440, t)),
    );
    noise(target, 0.4, 2.8, 0.1, 830, 0.12);
  },
  "living-hit": (target) => {
    noise(target, 0, 0.27, 0.5, 940, 0.12);
    voice(
      target,
      0,
      0.4,
      (t) =>
        Math.min(1, t / 0.012) *
        Math.exp(-14 * t) *
        (0.25 * sine(174, t) + 0.12 * sine(348, t)),
    );
    note(target, 0.025, 83, 0.35, 0.08);
  },
  "wolf-attack": (target) => {
    voice(target, 0, 0.55, (t) => {
      const phase = TAU * (125 * t - 55 * t * t);
      return (
        Math.sin((Math.PI * t) / 0.55) ** 2 *
        (Math.sin(phase + 1.4 * Math.sin(phase * 0.5)) +
          0.3 * Math.sin(phase * 2))
      );
    });
    noise(target, 0.08, 0.55, 0.6, 309, 0.12);
    noise(target, 0.38, 0.12, 0.8, 310, 0.45);
  },
  "damage-1": (target) => damage(target, 1),
  "damage-2": (target) => damage(target, 2),
  alert: (target) => {
    for (const start of [0, 0.32]) {
      note(target, start, 81, 0.25, 0.5);
      note(target, start + 0.12, 74, 0.3, 0.4);
    }
    echo(target, 0.13, 0.15, 2);
  },
  "objective-complete": (target) => phrase(target, [74, 77, 81, 86], 1.1),
  victory: (target) =>
    phrase(target, [62, 69, 74, 77, 81, 86], 2.6, [38, 45, 50]),
  defeat: (target) => phrase(target, [62, 61, 57, 50], 2.6, [38, 44, 50]),
  "training-start": (target) => {
    noise(target, 0, 0.16, 0.3, 710, 0.24);
    note(target, 0.02, 57, 0.3, 0.4);
    note(target, 0.16, 62, 0.55, 0.45);
    echo(target, 0.1, 0.18, 2);
  },
  "unit-trained": (target) => {
    [69, 74, 81].forEach((midi, index) =>
      note(target, index * 0.12, midi, 0.85, 0.4),
    );
    echo(target, 0.12, 0.22, 2);
  },
  "harvester-work": (target) => harvesterLoop(target, true),
  "harvester-engine": (target) => harvesterLoop(target, false),
  "refinery-door-open": (target) => refineryDoor(target, false),
  "refinery-door-close": (target) => refineryDoor(target, true),
};

export function buildSound(id: SoundId): Uint8Array {
  const target = mix(SOUND_ASSETS[id].seconds, false, soundLoops(id));
  SOUND_RECIPES[id](target);
  return wav(target, soundPeak(id));
}

export function buildMusic(id: MusicId): Uint8Array {
  const { seconds, tension, arrangement } = MUSIC_ASSETS[id];
  const organic = arrangement === "organic";
  const target = mix(seconds, true, true);
  const beat = 60 / 80;
  // Six-second chords form a sixteen-bar D-minor phrase at 80 BPM.
  const chords = [
    [38, 53, 57, 64],
    [34, 53, 57, 60],
    [41, 53, 57, 60],
    [36, 55, 60, 62],
    [38, 53, 57, 64],
    [34, 53, 60, 65],
    [43, 53, 58, 62],
    [33, 52, 57, 64],
  ];
  chords.forEach((chord, index) => {
    chord.forEach((midi, degree) => {
      const frequency = hz(midi);
      const pan = [-0.2, -0.75, 0.65, 0.2][degree]!;
      const breath = random(1100 + index * 4 + degree);
      let air = 0;
      voice(
        target,
        index * 6,
        8.5,
        (t) => {
          const envelope = Math.sin((Math.PI * t) / 8.5) ** 2;
          if (organic) {
            air += 0.07 * (breath() - air);
            const phase = TAU * frequency * t + 0.035 * sine(4.8, t);
            return (
              envelope *
              (degree === 0 ? 0.1 : 0.055) *
              (Math.sin(phase) +
                0.2 * Math.sin(phase * 2) +
                0.07 * Math.sin(phase * 3) +
                0.12 * air)
            );
          }
          return (
            envelope *
            (degree === 0 ? 0.16 : 0.1) *
            (sine(frequency, t) +
              0.3 * sine(frequency * 1.002, t) +
              (tension ? 0.18 : 0.08) * sine(frequency * 2, t))
          );
        },
        pan,
      );
    });
    const motif = tension ? [1, 2, 1, 3, 2, 1, 3, 2] : [2, 3, 1, 2];
    motif.forEach((degree, step) => {
      const start = index * 6 + step * (tension ? beat : beat * 2);
      if (organic) {
        pluck(
          target,
          start,
          chord[degree]! + 12,
          tension ? 0.12 : 0.14,
          step % 2 ? 0.5 : -0.5,
        );
        if (tension && step % 2 === 0)
          pluck(target, start + beat / 2, chord[(degree % 3) + 1]!, 0.065, 0.2);
        return;
      }
      note(
        target,
        start,
        chord[degree]! + 12,
        2.2,
        tension ? 0.07 : 0.09,
        step % 2 ? 0.55 : -0.55,
      );
    });
    if (organic) {
      woodenBeat(target, index * 6, tension ? 0.14 : 0.055, 1200 + index);
      if (tension)
        for (const step of [2, 4, 5, 7])
          woodenBeat(
            target,
            index * 6 + step * beat,
            step === 4 ? 0.1 : 0.045,
            1240 + index * 8 + step,
          );
      return;
    }
    thump(target, index * 6, tension ? 0.2 : 0.1);
    if (tension) {
      thump(target, index * 6 + beat * 4, 0.13);
      for (const step of [2, 5, 7])
        noise(
          target,
          index * 6 + step * beat,
          0.18,
          0.13,
          500 + index * 8 + step,
          0.6,
          step % 2 ? 0.5 : -0.5,
        );
    } else {
      noise(target, index * 6 + beat * 6, 0.5, 0.09, 600 + index, 0.12, 0.45);
    }
  });
  // Wrap dry voices and echo tails across the boundary for continuous loops.
  echo(target, beat * 0.75, 0.34, 4);
  return wav(target, 0.28);
}

export function buildAudioPreview(): Uint8Array {
  const entries = (bus: "music" | "machine" | "cue") => {
    const music = bus === "music";
    return Object.entries(music ? MUSIC_ASSETS : SOUND_ASSETS)
      .filter(
        ([id]) => music || soundLoops(id as SoundId) === (bus === "machine"),
      )
      .map(
        ([id, asset]) => `<article>
<h3>${asset.label}</h3>
${"description" in asset ? `<p>${asset.description}</p>` : ""}
<button type="button" data-play="${id}">Play ${asset.label}</button>
<p>${asset.seconds} seconds${bus !== "cue" ? " · loop" : ""}</p>
<audio id="${id}" data-bus="${bus}" controls preload="none"${bus !== "cue" ? " loop" : ""}
  aria-label="${asset.label}" src="${audioAssetUrl(id as SoundId | MusicId)}"></audio>
<a href="${audioAssetUrl(id as SoundId | MusicId)}" download>Download WAV</a>
</article>`,
      )
      .join("\n");
  };
  return new TextEncoder().encode(`<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Unquiet World · Audio audition</title>
<style>
body { color: #dde8ea; background: #101c23; font: 16px system-ui;
  max-width: 960px; margin: auto; padding: 24px; }
h1, h2, h3 { font-weight: 600; } p { line-height: 1.5; }
section { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px; } article { background: #1a2b35; padding: 16px; border-radius: 8px; }
audio { width: 100%; min-height: 48px; display: block; margin-bottom: 12px; }
a { color: #9fe1e5; display: inline-block; padding: 8px 0; }
button { font: inherit; padding: 12px 20px; cursor: pointer; margin-bottom: 12px; }
</style>
<h1>Unquiet World · Audio audition</h1>
<p>ARC synths and Circle plucked strings, breathy woodwinds, and wooden percussion.
Original synthesized audio. Music repeats every 48 seconds at 80 BPM.
Play machinery and cues over either track to compare the mix.</p>
<button type="button" id="stop">Stop all</button>
<p id="status" role="status"></p>
<h2>Background music</h2><section>${entries("music")}</section>
<h2>Machinery loops</h2><section>${entries("machine")}</section>
<h2>Gameplay cues</h2><section>${entries("cue")}</section>
<script>
const players = [...document.querySelectorAll('audio')];
for (const button of document.querySelectorAll('[data-play]')) {
  button.addEventListener('click', () => {
    document.querySelector('#status').textContent = '';
    document.getElementById(button.dataset.play).play().catch(() => {
      document.querySelector('#status').textContent = 'Playback unavailable. Download the WAV to listen.';
    });
  });
}
for (const player of players) {
  player.volume = player.dataset.bus === 'music' ? 0.4 :
    player.dataset.bus === 'machine' ? 0.55 : 0.7;
  player.addEventListener('play', () => {
    for (const other of players)
      if (other !== player && player.dataset.bus !== 'machine' &&
          other.dataset.bus === player.dataset.bus) other.pause();
  });
}
document.querySelector('#stop').addEventListener('click', () => {
  for (const player of players) { player.pause(); player.currentTime = 0; }
});
</script>
</html>`);
}
