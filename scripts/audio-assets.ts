// Original synthesis and composition; no recordings or instrument samples.
export const AUDIO_SAMPLE_RATE = 32_000;

export const SOUND_ASSETS = {
  "command-accepted": { seconds: 0.25, label: "Command accepted" },
  "command-invalid": { seconds: 0.38, label: "Invalid action" },
  "rifle-1": { seconds: 0.65, label: "Trooper rifle · variant 1" },
  "rifle-2": { seconds: 0.65, label: "Trooper rifle · variant 2" },
  "rifle-3": { seconds: 0.65, label: "Trooper rifle · variant 3" },
  "launcher-launch": { seconds: 0.9, label: "Heavy launcher ignition" },
  "launcher-impact": { seconds: 0.7, label: "Heavy launcher impact" },
  "medical-service": {
    seconds: 4,
    label: "Medic airflow",
    loop: true,
    peak: 0.15,
  },
  "mechanical-service": {
    seconds: 4,
    label: "Mechanic servicing",
    loop: true,
    peak: 0.24,
  },
  "circle-cast-1": { seconds: 0.8, label: "Living focus · variant 1" },
  "circle-cast-2": { seconds: 0.8, label: "Living focus · variant 2" },
  "circle-cultivation": {
    seconds: 8,
    label: "Lifebloom cultivation",
    loop: true,
    peak: 0.22,
  },
  "circle-growth": {
    seconds: 4,
    label: "Living construction",
    loop: true,
    peak: 0.3,
  },
  "living-hit": { seconds: 0.5, label: "Living impact" },
  "thornspire-cast": { seconds: 1.1, label: "Thornspire heavy bolt" },
  "ram-strike-1": { seconds: 0.75, label: "Briar Ram strike · variant 1" },
  "ram-strike-2": { seconds: 0.75, label: "Briar Ram strike · variant 2" },
  "living-structure-hit": { seconds: 0.5, label: "Living structure impact" },
  "living-destroyed": { seconds: 2, label: "Living destruction" },
  "healer-service": {
    seconds: 4,
    label: "Healer mending",
    loop: true,
    peak: 0.2,
  },
  "artificer-service": {
    seconds: 4,
    label: "Artificer shaping",
    loop: true,
    peak: 0.22,
  },
  "circle-command-accepted": { seconds: 0.4, label: "Circle order chime" },
  "circle-command-invalid": { seconds: 0.5, label: "Circle invalid chime" },
  "circle-unit-trained": { seconds: 1.6, label: "Circle readiness chime" },
  "circle-production-start": {
    seconds: 1,
    label: "Circle production started",
  },
  "circle-producer-exit": { seconds: 0.9, label: "Living entrance parting" },
  "wolf-attack": { seconds: 0.75, label: "Wolf attack" },
  "damage-1": { seconds: 0.45, label: "Damage · variant 1" },
  "damage-2": { seconds: 0.45, label: "Damage · variant 2" },
  alert: { seconds: 1.1, label: "Player alert" },
  "objective-complete": { seconds: 2.4, label: "Objective complete" },
  victory: { seconds: 4.8, label: "Victory" },
  defeat: { seconds: 4.8, label: "Defeat" },
  "training-start": { seconds: 0.9, label: "Barracks training started" },
  "unit-trained": { seconds: 1.4, label: "Unit trained" },
  "harvester-work": {
    seconds: 4,
    label: "Harvester drilling",
    loop: true,
    peak: 0.42,
  },
  "harvester-engine": {
    seconds: 4,
    label: "Harvester moving engine",
    loop: true,
    peak: 0.38,
  },
  "refinery-door-open": { seconds: 0.8, label: "Refinery garage opening" },
  "refinery-door-close": { seconds: 0.8, label: "Refinery garage closing" },
} as const;

export type SoundId = keyof typeof SOUND_ASSETS;

export function soundLoops(id: SoundId): boolean {
  const asset = SOUND_ASSETS[id];
  return "loop" in asset && asset.loop;
}

export function soundPeak(id: SoundId): number {
  const asset = SOUND_ASSETS[id];
  return "peak" in asset ? asset.peak : 0.72;
}

export const MUSIC_ASSETS = {
  "unquiet-frontier": {
    arrangement: "synth",
    seconds: 48,
    label: "Unquiet Frontier",
    tension: false,
    description: "Exploration: warm pads, glass notes, and a sparse low pulse.",
  },
  "beneath-the-ridge": {
    arrangement: "synth",
    seconds: 48,
    label: "Beneath the Ridge",
    tension: true,
    description:
      "Tension: darker pads, a muted sequence, and restrained drums.",
  },
  "circle-frontier": {
    arrangement: "organic",
    seconds: 48,
    label: "Unquiet Frontier · Circle",
    tension: false,
    description:
      "Exploration: plucked strings, breathy woodwinds, and soft wooden percussion.",
  },
  "circle-ridge": {
    arrangement: "organic",
    seconds: 48,
    label: "Beneath the Ridge · Circle",
    tension: true,
    description:
      "Tension: interwoven strings, airy reeds, and a stronger wood-and-skin pulse.",
  },
} as const;

export type MusicId = keyof typeof MUSIC_ASSETS;

const TAU = Math.PI * 2;
type Mix = { channels: Float64Array[]; loop: boolean };

function mix(seconds: number, stereo = false, loop = false): Mix {
  return {
    channels: Array.from(
      { length: stereo ? 2 : 1 },
      () => new Float64Array(Math.round(seconds * AUDIO_SAMPLE_RATE)),
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
  const offset = Math.round(start * AUDIO_SAMPLE_RATE);
  const frames = target.channels[0]!.length;
  const gains =
    target.channels.length === 1
      ? [1]
      : [Math.sqrt((1 - pan) / 2), Math.sqrt((1 + pan) / 2)];
  for (let i = 0; i < Math.round(seconds * AUDIO_SAMPLE_RATE); i++) {
    const position = offset + i;
    if (!target.loop && position >= frames) break;
    const value = sample(i / AUDIO_SAMPLE_RATE);
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
      const offset = Math.round(
        (seconds + channel * 0.013) * AUDIO_SAMPLE_RATE * repeat,
      );
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
        samples[i]! *= Math.min(
          1,
          (frames - 1 - i) / (AUDIO_SAMPLE_RATE * 0.02),
        );
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
  view.setUint32(24, AUDIO_SAMPLE_RATE, true);
  view.setUint32(28, AUDIO_SAMPLE_RATE * channels * 2, true);
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
  const seconds = target.channels[0]!.length / AUDIO_SAMPLE_RATE;
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

/** Bell-like inharmonic partials for Circle chimes. */
function chime(
  target: Mix,
  start: number,
  midi: number,
  seconds: number,
  level: number,
) {
  const frequency = hz(midi);
  voice(target, start, seconds, (t) => {
    const envelope = Math.min(1, t / 0.004) * Math.min(1, (seconds - t) / 0.03);
    return (
      level *
      envelope *
      (Math.exp((-4 * t) / seconds) * sine(frequency, t) +
        0.35 * Math.exp((-9 * t) / seconds) * sine(frequency * 2.76, t) +
        0.12 * Math.exp((-16 * t) / seconds) * sine(frequency * 5.4, t))
    );
  });
}

/** Short fibrous crackles; denser counts sound like splitting wood. */
function crackle(
  target: Mix,
  start: number,
  seconds: number,
  count: number,
  level: number,
  seed: number,
) {
  const next = random(seed);
  for (let i = 0; i < count; i++) {
    const at = start + ((next() + 1) / 2) * seconds;
    noise(target, at, 0.03 + 0.03 * ((next() + 1) / 2), level, seed + i, 0.6);
  }
}

/** A heavy wooden knock: a low body tone under a bright bark transient. */
function woodKnock(target: Mix, level: number, pitch: number, seed: number) {
  voice(target, 0, 0.5, (t) => {
    const phase = TAU * (pitch * t + (pitch / 20) * (1 - Math.exp(-20 * t)));
    return (
      level *
      Math.min(1, t / 0.003) *
      Math.exp(-11 * t) *
      (Math.sin(phase) + 0.4 * Math.sin(phase * 2.3))
    );
  });
  noise(target, 0, 0.12, level * 0.9, seed, 0.35);
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
  "launcher-launch": (target) => {
    noise(target, 0, 0.4, 0.8, 1101, 0.08);
    voice(
      target,
      0,
      0.6,
      (t) =>
        Math.min(1, t / 0.008) *
        Math.exp(-9 * t) *
        (0.6 * Math.sin(TAU * (100 * t - 45 * t * t)) + 0.2 * sine(180, t)),
    );
    echo(target, 0.11, 0.16, 2);
  },
  "launcher-impact": (target) => {
    thump(target, 0, 0.9);
    noise(target, 0, 0.5, 1, 1102, 0.12);
    note(target, 0.01, 34, 0.5, 0.4);
    echo(target, 0.08, 0.17, 2);
  },
  "medical-service": (target) => {
    const seconds = SOUND_ASSETS["medical-service"].seconds;
    const next = random(319);
    // Spread energy across the band and keep every partial periodic.
    const partials = Array.from({ length: 128 }, (_, index) => ({
      frequency: Math.round((290 + 6 * index + 3 * next()) * seconds) / seconds,
      phase: next() * Math.PI,
      gain: Math.sin((Math.PI * (index + 1)) / 129),
    }));
    voice(target, 0, seconds, (t) => {
      let air = 0;
      for (const { frequency, phase, gain } of partials)
        air += gain * Math.sin(TAU * frequency * t + phase);
      return air;
    });
  },
  "mechanical-service": (target) => {
    voice(
      target,
      0,
      4,
      (t) =>
        0.12 * sine(72, t) +
        (0.5 + 0.5 * Math.cos(TAU * 2 * t)) ** 8 *
          (0.45 * sine(240, t) + 0.2 * sine(690, t) + 0.1 * sine(1110, t)),
    );
  },
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
    ] as const)
      pluck(target, start, midi, 0.16, 0);
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
    ] as const)
      pluck(target, start, midi, 0.18, 0);
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
  "thornspire-cast": (target) => {
    // A deeper, slower bloom of the Sentinel's focus.
    const frequency = hz(57);
    woodenBeat(target, 0, 0.35, 950);
    voice(target, 0, 0.95, (t) => {
      const bloom = Math.min(1, t / 0.06) * Math.exp(-4.5 * t);
      const phase = TAU * frequency * t + 4 * Math.exp(-10 * t);
      return (
        bloom *
        (0.6 * Math.sin(phase) +
          0.25 * Math.sin(phase * 1.5) +
          0.12 * sine(frequency * 3.01, t))
      );
    });
    thump(target, 0.02, 0.35);
    note(target, 0.09, 76, 0.7, 0.12);
    echo(target, 0.13, 0.25, 2);
  },
  "ram-strike-1": (target) => {
    woodKnock(target, 0.9, 70, 960);
    thump(target, 0, 0.6);
    crackle(target, 0.02, 0.3, 9, 0.5, 961);
  },
  "ram-strike-2": (target) => {
    woodKnock(target, 0.9, 62, 970);
    thump(target, 0, 0.6);
    crackle(target, 0.02, 0.35, 11, 0.45, 971);
  },
  "living-structure-hit": (target) => {
    woodKnock(target, 0.55, 120, 980);
    noise(target, 0.01, 0.3, 0.35, 981, 0.12);
    crackle(target, 0.02, 0.15, 4, 0.25, 982);
  },
  "living-destroyed": (target) => {
    woodKnock(target, 0.64, 55, 991);
    for (const [start, duration, level, seed] of [
      [0.045, 0.065, 0.52, 1035],
      [0.14, 0.09, 0.42, 1130],
      [0.29, 0.07, 0.31, 1280],
      [0.44, 0.11, 0.24, 1430],
      [0.57, 0.08, 0.14, 1560],
    ] as const)
      noise(target, start, duration, level, seed, 0.16);
    voice(target, 0.09, 0.43, (t) => {
      const phase = TAU * (82 * t + (120 / 8) * (1 - Math.exp(-8 * t)));
      const envelope = Math.sin((Math.PI * t) / 0.43) ** 2;
      return 0.27 * envelope * (Math.sin(phase) + 0.36 * Math.sin(2 * phase));
    });
    // Fading low resonance as the building's light goes out.
    voice(
      target,
      0.1,
      1.85,
      (t) =>
        Math.min(1, t / 0.08) *
        Math.exp(-2.2 * t) *
        (0.4 * sine(hz(38), t) +
          0.18 * sine(hz(45), t) +
          0.06 * sine(hz(62), t) * Math.exp(-3 * t)),
    );
  },
  "healer-service": (target) => {
    // Overlapping open fifths repeat every second; the period divides the loop.
    for (let beat = 0; beat < 4; beat++) {
      chime(target, beat, beat % 2 ? 81 : 76, 1.6, 0.12);
      chime(target, beat + 0.5, 88, 1.2, 0.05);
    }
    voice(
      target,
      0,
      4,
      (t) => (0.6 + 0.4 * Math.cos(TAU * 0.25 * t)) * 0.06 * sine(hz(64), t),
    );
  },
  "artificer-service": (target) => {
    for (let beat = 0; beat < 8; beat++) {
      woodenBeat(target, beat * 0.5, beat % 2 ? 0.12 : 0.2, 1000 + beat);
      crackle(target, beat * 0.5 + 0.1, 0.2, 2, 0.08, 1010 + beat * 3);
    }
    for (const [start, midi] of [
      [0, 69],
      [2, 72],
    ] as const)
      voice(
        target,
        start,
        2,
        (t) =>
          Math.sin((Math.PI * t) / 2) ** 2 *
          (0.08 * sine(hz(midi), t) + 0.03 * sine(hz(midi + 7), t)),
      );
  },
  "circle-command-accepted": (target) => {
    chime(target, 0, 84, 0.3, 0.5);
    chime(target, 0.06, 91, 0.32, 0.3);
  },
  "circle-command-invalid": (target) => {
    woodenBeat(target, 0, 0.25, 1020);
    chime(target, 0.02, 69, 0.4, 0.4);
    chime(target, 0.12, 63, 0.36, 0.35);
  },
  "circle-unit-trained": (target) => {
    [76, 81, 88].forEach((midi, index) =>
      chime(target, index * 0.13, midi, 1.1, 0.35),
    );
    echo(target, 0.14, 0.22, 2);
  },
  "circle-production-start": (target) => {
    noise(target, 0, 0.6, 0.2, 1030, 0.14);
    pluck(target, 0.03, 62, 0.25, 0);
    chime(target, 0.18, 74, 0.7, 0.2);
  },
  "circle-producer-exit": (target) => {
    // Creaking arches and rustling leaves under a brief violet tone.
    voice(target, 0, 0.5, (t) => {
      const phase = TAU * (90 * t + 40 * t * t);
      return (
        Math.sin((Math.PI * t) / 0.5) ** 2 *
        0.25 *
        (Math.sin(phase) + 0.3 * Math.sin(phase * 3.1))
      );
    });
    noise(target, 0.05, 0.55, 0.22, 1040, 0.18);
    chime(target, 0.12, 79, 0.7, 0.18);
  },
  "wolf-attack": (target) => {
    const breath = random(308);
    let roughness = 0;
    let phase = 0;
    voice(target, 0, 0.45, (t) => {
      roughness += 0.025 * (breath() - roughness);
      const pitch = 80 + 56 * Math.exp(-((t - 0.14) ** 2) / 0.009);
      phase += (TAU * (pitch + 60 * roughness)) / AUDIO_SAMPLE_RATE;
      const swell = Math.min(1, t / 0.045) * Math.exp(-5 * t);
      return (
        0.32 *
        swell *
        Math.min(1, (0.45 - t) / 0.1) *
        (0.35 * Math.sin(phase) +
          0.25 * Math.sin(2 * phase) +
          0.26 * Math.sin(3 * phase) +
          (0.18 + 0.35 * roughness) * Math.sin(5 * phase))
      );
    });
    noise(target, 0.025, 0.38, 0.72, 309, 0.095);
    // A dull jaw impact under the short bite.
    voice(
      target,
      0.17,
      0.12,
      (t) =>
        0.65 *
        Math.min(1, t / 0.004) *
        Math.exp(-43 * t) *
        Math.min(1, (0.12 - t) / 0.02) *
        (sine(145, t) + 0.25 * sine(320, t)),
    );
    noise(target, 0.165, 0.065, 0.7, 310, 0.23);
    noise(target, 0.193, 0.09, 0.36, 311, 0.09);
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

const BEAT = 60 / 80;
// Six-second chords form a sixteen-bar D-minor phrase at 80 BPM.
const CHORDS = [
  [38, 53, 57, 64],
  [34, 53, 57, 60],
  [41, 53, 57, 60],
  [36, 55, 60, 62],
  [38, 53, 57, 64],
  [34, 53, 60, 65],
  [43, 53, 58, 62],
  [33, 52, 57, 64],
];
const PAD_PANS = [-0.2, -0.75, 0.65, 0.2];

/** How a track voices the shared chords. */
type Arrangement = {
  pad: (
    frequency: number,
    root: boolean,
    tension: boolean,
    seed: number,
  ) => { level: number; tone: (time: number) => number };
  /** Plays one step of the chord's figure. */
  motif: (
    target: Mix,
    start: number,
    chord: readonly number[],
    degree: number,
    step: number,
    tension: boolean,
  ) => void;
  percussion: (target: Mix, bar: number, tension: boolean) => void;
};

const ARRANGEMENTS: Record<"synth" | "organic", Arrangement> = {
  synth: {
    pad: (frequency, root, tension) => ({
      level: root ? 0.16 : 0.1,
      tone: (t) =>
        sine(frequency, t) +
        0.3 * sine(frequency * 1.002, t) +
        (tension ? 0.18 : 0.08) * sine(frequency * 2, t),
    }),
    motif: (target, start, chord, degree, step, tension) =>
      note(
        target,
        start,
        chord[degree]! + 12,
        2.2,
        tension ? 0.07 : 0.09,
        step % 2 ? 0.55 : -0.55,
      ),
    percussion: (target, bar, tension) => {
      const start = bar * 6;
      thump(target, start, tension ? 0.2 : 0.1);
      if (!tension) {
        noise(target, start + BEAT * 6, 0.5, 0.09, 600 + bar, 0.12, 0.45);
        return;
      }
      thump(target, start + BEAT * 4, 0.13);
      for (const step of [2, 5, 7])
        noise(
          target,
          start + step * BEAT,
          0.18,
          0.13,
          500 + bar * 8 + step,
          0.6,
          step % 2 ? 0.5 : -0.5,
        );
    },
  },
  organic: {
    pad: (frequency, root, _tension, seed) => {
      const breath = random(seed);
      let air = 0;
      return {
        level: root ? 0.1 : 0.055,
        tone: (t) => {
          air += 0.07 * (breath() - air);
          const phase = TAU * frequency * t + 0.035 * sine(4.8, t);
          return (
            Math.sin(phase) +
            0.2 * Math.sin(phase * 2) +
            0.07 * Math.sin(phase * 3) +
            0.12 * air
          );
        },
      };
    },
    motif: (target, start, chord, degree, step, tension) => {
      pluck(
        target,
        start,
        chord[degree]! + 12,
        tension ? 0.12 : 0.14,
        step % 2 ? 0.5 : -0.5,
      );
      if (tension && step % 2 === 0)
        pluck(target, start + BEAT / 2, chord[(degree % 3) + 1]!, 0.065, 0.2);
    },
    percussion: (target, bar, tension) => {
      const start = bar * 6;
      woodenBeat(target, start, tension ? 0.14 : 0.055, 1200 + bar);
      if (!tension) return;
      for (const step of [2, 4, 5, 7])
        woodenBeat(
          target,
          start + step * BEAT,
          step === 4 ? 0.1 : 0.045,
          1240 + bar * 8 + step,
        );
    },
  },
};

export function buildMusic(id: MusicId): Uint8Array {
  const { seconds, tension, arrangement } = MUSIC_ASSETS[id];
  const { pad, motif, percussion } = ARRANGEMENTS[arrangement];
  const target = mix(seconds, true, true);
  CHORDS.forEach((chord, index) => {
    chord.forEach((midi, degree) => {
      const { level, tone } = pad(
        hz(midi),
        degree === 0,
        tension,
        1100 + index * 4 + degree,
      );
      voice(
        target,
        index * 6,
        8.5,
        (t) => Math.sin((Math.PI * t) / 8.5) ** 2 * level * tone(t),
        PAD_PANS[degree],
      );
    });
    const figure = tension ? [1, 2, 1, 3, 2, 1, 3, 2] : [2, 3, 1, 2];
    figure.forEach((degree, step) =>
      motif(
        target,
        index * 6 + step * (tension ? BEAT : BEAT * 2),
        chord,
        degree,
        step,
        tension,
      ),
    );
    percussion(target, index, tension);
  });
  // Wrap dry voices and echo tails across the boundary for continuous loops.
  echo(target, BEAT * 0.75, 0.34, 4);
  return wav(target, 0.28);
}

export function buildAudioPreview(): Uint8Array {
  type Entry = [
    id: string,
    asset: { seconds: number; label: string; description?: string },
  ];
  const sounds: Entry[] = Object.entries(SOUND_ASSETS);
  const loops = ([id]: Entry) => soundLoops(id as SoundId);
  const entries = (
    bus: "music" | "machine" | "cue",
    assets: readonly Entry[],
  ) =>
    assets
      .map(
        ([id, asset]) => `<article>
<h3>${asset.label}</h3>
${asset.description ? `<p>${asset.description}</p>` : ""}
<button type="button" data-play="${id}">Play ${asset.label}</button>
<p>${asset.seconds} seconds${bus !== "cue" ? " · loop" : ""}</p>
<audio id="${id}" data-bus="${bus}" controls preload="none"${bus !== "cue" ? " loop" : ""}
  aria-label="${asset.label}" src="${id}.wav"></audio>
<a href="${id}.wav" download>Download WAV</a>
</article>`,
      )
      .join("\n");
  return new TextEncoder().encode(`<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Unquiet World · Audio audition</title>
<style>
* { box-sizing: border-box; }
body { color: #e8ecdf; background: linear-gradient(175deg, #102026, #091216);
  font: 15px/1.5 Arial, sans-serif; max-width: 1040px; margin: auto; padding: 24px 16px 40px; }
h1, h2 { color: #f4f0df; font-family: Georgia, "Times New Roman", serif; font-weight: 400; }
h1 { margin: 0 0 8px; font-size: 1.9rem; }
h2 { margin: 28px 0 12px; font-size: 1.25rem; border-bottom: 1px solid #354c4a; padding-bottom: 6px; }
h3 { margin: 0 0 6px; color: #f1e4be; font-size: 0.98rem; font-weight: 600; }
p { margin: 0 0 10px; color: #c4d3cd; }
section { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 270px), 1fr));
  gap: 14px; }
article { background: linear-gradient(160deg, #192f34, #101f24); border: 1px solid #48605c;
  padding: 14px; border-radius: 6px; box-shadow: inset 0 1px rgb(244 240 223 / 6%); }
audio { width: 100%; min-height: 44px; display: block; margin-bottom: 10px; }
a { color: #d8bf89; display: inline-block; padding: 4px 0; font-size: 0.85rem; }
button { min-height: 44px; font: inherit; font-size: 0.85rem; padding: 8px 14px; cursor: pointer;
  margin-bottom: 10px; border: 1px solid #59726c; border-radius: 4px; color: #f4f0df;
  background: #1b3136; }
button:hover { border-color: #b79c63; background: #264348; }
#stop { border-color: #d6b16b; color: #151f1c; background: #d6b16b; font-weight: 700; }
#stop:hover { background: #ead09a; }
.scenes { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0 18px; }
.scenes button { margin-bottom: 0; }
</style>
<h1>Unquiet World · Audio audition</h1>
<p>ARC synths and Circle plucked strings, breathy woodwinds, and wooden percussion.
Original synthesized audio. Music repeats every 48 seconds at 80 BPM.
Play scene mixes or individual loops and cues to compare timing and headroom.</p>
<div class="scenes" role="group" aria-label="Scene audition presets">
<button type="button" id="stop">Stop all</button>
<button type="button" data-scene="arc-base">Scene: ARC base &amp; income</button>
<button type="button" data-scene="circle-base">Scene: Circle base &amp; cultivation</button>
<button type="button" data-scene="battle">Scene: Skirmish battle</button>
<button type="button" data-scene="support">Scene: Support &amp; recovery</button>
<button type="button" data-scene="victory">Scene: Victory phrase</button>
<button type="button" data-scene="defeat">Scene: Defeat phrase</button>
</div>
<p id="status" role="status"></p>
<h2>Background music</h2><section>${entries("music", Object.entries(MUSIC_ASSETS))}</section>
<h2>Machinery loops</h2><section>${entries("machine", sounds.filter(loops))}</section>
<h2>Gameplay cues</h2><section>${entries(
    "cue",
    sounds.filter((sound) => !loops(sound)),
  )}</section>
<script>
const players = [...document.querySelectorAll('audio')];
let sceneTimers = [];
const clearScene = () => {
  for (const timer of sceneTimers) clearTimeout(timer);
  sceneTimers = [];
};
const stopAll = () => {
  clearScene();
  for (const player of players) { player.pause(); player.currentTime = 0; }
};
const trigger = (id) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.currentTime = 0;
  el.play().catch(() => {
    document.querySelector('#status').textContent = 'Playback unavailable. Download the WAV to listen.';
  });
};
const SCENES = {
  'arc-base': ['unquiet-frontier', 'harvester-work', 'harvester-engine', [400, 'refinery-door-open'], [1600, 'training-start'], [3100, 'unit-trained']],
  'circle-base': ['circle-frontier', 'circle-cultivation', 'circle-growth', [500, 'circle-production-start'], [1900, 'circle-producer-exit'], [3200, 'circle-unit-trained']],
  'battle': ['beneath-the-ridge', [200, 'rifle-1'], [650, 'circle-cast-1'], [1150, 'launcher-launch'], [1850, 'launcher-impact'], [2400, 'ram-strike-1'], [3100, 'alert']],
  'support': ['circle-ridge', 'healer-service', 'mechanical-service', [700, 'living-structure-hit'], [1800, 'living-destroyed']],
  'victory': [[0, 'objective-complete'], [1800, 'victory']],
  'defeat': [[0, 'alert'], [1100, 'defeat']],
};
for (const button of document.querySelectorAll('[data-play]')) {
  button.addEventListener('click', () => {
    clearScene();
    document.querySelector('#status').textContent = '';
    document.getElementById(button.dataset.play).play().catch(() => {
      document.querySelector('#status').textContent = 'Playback unavailable. Download the WAV to listen.';
    });
  });
}
for (const button of document.querySelectorAll('[data-scene]')) {
  button.addEventListener('click', () => {
    stopAll();
    document.querySelector('#status').textContent = '';
    for (const step of SCENES[button.dataset.scene] || []) {
      if (Array.isArray(step)) sceneTimers.push(setTimeout(() => trigger(step[1]), step[0]));
      else trigger(step);
    }
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
document.querySelector('#stop').addEventListener('click', stopAll);
</script>
</html>`);
}
