import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

import {
  AUDIO_SAMPLE_RATE,
  MUSIC_ASSETS,
  SOUND_ASSETS,
  audioAssetUrl,
  soundLoops,
  soundPeak,
} from "../src/content/audio-assets";

const entries = [
  ...Object.entries(SOUND_ASSETS).map(([id, asset]) => ({
    id,
    ...asset,
    channels: 1,
    peak: soundPeak(id as keyof typeof SOUND_ASSETS),
    loop: soundLoops(id as keyof typeof SOUND_ASSETS),
  })),
  ...Object.entries(MUSIC_ASSETS).map(([id, asset]) => ({
    id,
    ...asset,
    channels: 2,
    peak: 0.28,
    loop: true,
  })),
];

test.each(entries)("$id is a usable PCM asset with mix headroom", (asset) => {
  const bytes = readFileSync(`public/assets/audio/${asset.id}.wav`);
  const frames = Math.round(asset.seconds * AUDIO_SAMPLE_RATE);
  expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
  expect(bytes.toString("ascii", 8, 16)).toBe("WAVEfmt ");
  expect(bytes.readUInt32LE(4)).toBe(bytes.length - 8);
  expect(bytes.readUInt32LE(16)).toBe(16);
  expect(bytes.readUInt16LE(20)).toBe(1);
  expect(bytes.readUInt16LE(22)).toBe(asset.channels);
  expect(bytes.readUInt32LE(24)).toBe(AUDIO_SAMPLE_RATE);
  expect(bytes.readUInt32LE(28)).toBe(AUDIO_SAMPLE_RATE * asset.channels * 2);
  expect(bytes.readUInt16LE(32)).toBe(asset.channels * 2);
  expect(bytes.readUInt16LE(34)).toBe(16);
  expect(bytes.toString("ascii", 36, 40)).toBe("data");
  expect(bytes.readUInt32LE(40)).toBe(frames * asset.channels * 2);
  expect(bytes.length).toBe(44 + frames * asset.channels * 2);

  let peak = 0;
  let energy = 0;
  let dc = 0;
  for (let offset = 44; offset < bytes.length; offset += 2) {
    const value = bytes.readInt16LE(offset) / 32767;
    peak = Math.max(peak, Math.abs(value));
    energy += value * value;
    dc += value;
  }
  const samples = frames * asset.channels;
  expect(peak).toBeCloseTo(asset.peak, 4);
  expect(Math.sqrt(energy / samples)).toBeGreaterThan(0.01);
  expect(Math.abs(dc / samples)).toBeLessThan(0.001);
  for (let channel = 0; channel < asset.channels; channel++) {
    const first = bytes.readInt16LE(44 + channel * 2);
    const last = bytes.readInt16LE(
      bytes.length - (asset.channels - channel) * 2,
    );
    if (!asset.loop) {
      expect(first).toBe(0);
      expect(last).toBe(0);
    } else {
      // The seam follows the neighboring slopes without adding a step.
      const next = bytes.readInt16LE(44 + (asset.channels + channel) * 2);
      const before = bytes.readInt16LE(
        bytes.length - (2 * asset.channels - channel) * 2,
      );
      const slope = (next - first + last - before) / 2;
      expect(Math.abs(first - last - slope) / 32767).toBeLessThan(0.015);
    }
  }
});

test("the audition page offers every asset without autoplay", () => {
  const page = readFileSync("public/assets/audio/index.html", "utf8");
  for (const id of Object.keys(SOUND_ASSETS) as (keyof typeof SOUND_ASSETS)[])
    expect(page).toContain(`src="${audioAssetUrl(id)}"`);
  for (const id of Object.keys(MUSIC_ASSETS) as (keyof typeof MUSIC_ASSETS)[])
    expect(page).toContain(`src="${audioAssetUrl(id)}"`);
  expect(page).not.toContain("autoplay");
});
