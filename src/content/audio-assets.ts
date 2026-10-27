// Authored inventory shared by the offline generators and audition page.
export const AUDIO_SAMPLE_RATE = 32_000;

export const SOUND_ASSETS = {
  "command-accepted": { seconds: 0.25, label: "Command accepted" },
  "command-invalid": { seconds: 0.38, label: "Invalid action" },
  "rifle-1": { seconds: 0.65, label: "Trooper rifle · variant 1" },
  "rifle-2": { seconds: 0.65, label: "Trooper rifle · variant 2" },
  "rifle-3": { seconds: 0.65, label: "Trooper rifle · variant 3" },
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

export const audioAssetUrl = (id: SoundId | MusicId) =>
  `/assets/audio/${id}.wav`;
