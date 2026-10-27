import { expect, test } from "./fixtures";
import { forEachProfile, MOUSE_AND_PHONE_PROFILES } from "./profiles";
import { WEBKIT } from "./tags";
import {
  MUSIC_ASSETS,
  SOUND_ASSETS,
  soundLoops,
} from "../src/content/audio-assets";

test(
  "the browser decodes every audio asset",
  { tag: WEBKIT },
  async ({ page }) => {
    await page.goto("/assets/audio/index.html");
    const decoded = await page.evaluate(async () => {
      const context = new OfflineAudioContext(2, 1, 32_000);
      const result = [];
      for (const audio of document.querySelectorAll("audio")) {
        const response = await fetch(audio.src);
        if (!response.ok) throw new Error(`Cannot fetch ${audio.src}`);
        const buffer = await context.decodeAudioData(
          await response.arrayBuffer(),
        );
        result.push({
          id: audio.id,
          seconds: buffer.duration,
          channels: buffer.numberOfChannels,
          loop: audio.loop,
        });
      }
      return result;
    });
    expect(decoded).toHaveLength(
      Object.keys(MUSIC_ASSETS).length + Object.keys(SOUND_ASSETS).length,
    );
    for (const asset of decoded) {
      const music = Object.prototype.hasOwnProperty.call(
        MUSIC_ASSETS,
        asset.id,
      );
      const definition = music
        ? MUSIC_ASSETS[asset.id as keyof typeof MUSIC_ASSETS]
        : SOUND_ASSETS[asset.id as keyof typeof SOUND_ASSETS];
      expect(asset.seconds).toBeCloseTo(definition.seconds, 4);
      expect(asset.channels).toBe(music ? 2 : 1);
      expect(asset.loop).toBe(
        music || soundLoops(asset.id as keyof typeof SOUND_ASSETS),
      );
    }
  },
);

forEachProfile(MOUSE_AND_PHONE_PROFILES, (profile) => {
  test(
    "audio audition plays music and cues together and stops",
    { tag: WEBKIT },
    async ({ page }) => {
      await page.goto("/assets/audio/index.html");
      const press = async (selector: string) => {
        const button = page.locator(selector);
        if (profile.touch) await button.tap();
        else await button.click();
      };
      const playing = (id: string) =>
        page
          .locator(`#${id}`)
          .evaluate(
            (audio: HTMLAudioElement) => !audio.paused && audio.currentTime > 0,
          );
      await press('[data-play="unquiet-frontier"]');
      await expect.poll(() => playing("unquiet-frontier")).toBe(true);
      await expect(page.locator("audio#unquiet-frontier")).toHaveJSProperty(
        "muted",
        true,
      );
      await press('[data-play="victory"]');
      await expect.poll(() => playing("victory")).toBe(true);
      expect(await playing("unquiet-frontier")).toBe(true);
      await press('[data-play="harvester-engine"]');
      await expect.poll(() => playing("harvester-engine")).toBe(true);
      await press('[data-play="harvester-work"]');
      await expect.poll(() => playing("harvester-work")).toBe(true);
      expect(await playing("harvester-engine")).toBe(true);
      expect(await playing("unquiet-frontier")).toBe(true);
      await press('[data-play="unit-trained"]');
      await expect.poll(() => playing("unit-trained")).toBe(true);
      expect(await playing("harvester-work")).toBe(true);
      await press('[data-play="beneath-the-ridge"]');
      await expect.poll(() => playing("beneath-the-ridge")).toBe(true);
      expect(await playing("unquiet-frontier")).toBe(false);
      await press("#stop");
      expect(
        await page
          .locator("audio")
          .evaluateAll((players) =>
            players.every((player) => (player as HTMLAudioElement).paused),
          ),
      ).toBe(true);
      await expect(page.locator("#status")).toBeEmpty();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    },
  );
});
