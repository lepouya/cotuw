import { expect, test } from "./fixtures";
import { MissionDriver } from "./mission-driver";
import { forEachProfile, PROFILES } from "./profiles";
import {
  activate,
  attachScreenshot,
  collectPageErrors,
  expectTerrainReady,
  openOpening,
  pressPoint,
  startOpening,
  withoutApp,
} from "./page-helpers";
import { WEBKIT } from "./tags";

import type { createAudioMixer } from "../src/audio/mixer";
import type { AudioEmitter, createAudioScene } from "../src/audio/scene";

declare global {
  interface Window {
    audioStarts: { duration: number; loop: boolean; stopped: boolean }[];
    audioDecoded: number;
    audioVoiceGains: (GainNode | undefined)[];
    audioSequenceHarness: {
      scene: ReturnType<typeof createAudioScene>;
      device: ReturnType<typeof createAudioMixer>;
      starts: number[];
      emitter: AudioEmitter;
      readonly ready: boolean;
      readonly loopStarts: number;
    };
  }
}

test(
  "automation silences speaker output and preserves offline rendering",
  { tag: WEBKIT },
  async ({ page }) => {
    await withoutApp(page);
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const context = new AudioContext();
      const outputs: GainNode[] = [];
      const createGain = context.createGain.bind(context);
      context.createGain = () => {
        const node = createGain();
        outputs.push(node);
        return node;
      };
      const source = context.createOscillator();
      const destination = source.connect(context.destination);
      source.disconnect(context.destination);
      source.connect(context.destination);
      const gains = outputs.map((node) => node.gain.value);
      await context.close();

      const offline = new OfflineAudioContext(1, 128, 8_000);
      const constant = offline.createConstantSource();
      constant.offset.value = 0.25;
      constant.connect(offline.destination);
      constant.start();
      const rendered = await offline.startRendering();
      return {
        gains,
        destinationPreserved: destination === context.destination,
        sample: rendered.getChannelData(0)[0],
      };
    });
    expect(result).toEqual({
      gains: [0],
      destinationPreserved: true,
      sample: 0.25,
    });
  },
);

forEachProfile(PROFILES, (profile) => {
  test(
    "master, sound, and music preferences persist through restart and reload",
    { tag: WEBKIT },
    async ({ page }, info) => {
      await openOpening(page, profile.touch);
      await expectTerrainReady(page);
      await activate(page.locator("#open-menu"), profile.touch);
      await expect(page.locator("#menu-audio")).toBeHidden();
      await activate(page.locator("#open-options"), profile.touch);
      await expect(page.locator("#audio-status")).toHaveAttribute(
        "data-audio-state",
        "ready",
      );
      await expect(page.locator("#audio-master-volume")).toHaveValue("50");
      for (const bus of ["master", "sound", "music"]) {
        const slider = page.locator(`#audio-${bus}-volume`);
        await slider.scrollIntoViewIfNeeded();
        const box = (await slider.boundingBox())!;
        await pressPoint(
          page,
          { x: box.x + box.width * 0.25, y: box.y + box.height / 2 },
          profile.touch,
        );
        expect(Number(await slider.inputValue())).toBeLessThan(40);
        const mute = page.locator(`#audio-${bus}-mute`);
        const label = bus === "master" ? "all audio" : bus;
        await expect(mute).toHaveAccessibleName(`Mute ${label}`);
        await expect(mute).toHaveText("");
        await expect(mute.locator("svg")).toBeVisible();
        await activate(mute, profile.touch);
        await expect(mute).toHaveAttribute("title", `Unmute ${label}`);
        await expect(mute).toHaveAttribute("aria-pressed", "true");
      }
      const saved = await page.evaluate(() =>
        localStorage.getItem("cotuw.audio.settings"),
      );
      await attachScreenshot(page, info, `audio-${profile.name}`);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await activate(page.locator("#cancel-options"), profile.touch);
      await expect(page.locator("#menu-audio")).toBeHidden();
      await activate(page.locator("#restart-mission"), profile.touch);
      await page.reload();
      await startOpening(page, profile.touch);
      await expectTerrainReady(page);
      await activate(page.locator("#open-menu"), profile.touch);
      expect(
        await page.evaluate(() => localStorage.getItem("cotuw.audio.settings")),
      ).toBe(saved);
      for (const bus of ["master", "sound", "music"])
        await expect(page.locator(`#audio-${bus}-mute`)).toHaveAttribute(
          "aria-pressed",
          "true",
        );
    },
  );
});

test(
  "committed gameplay drives music, training, machinery, doors, and pause cleanup",
  { tag: WEBKIT },
  async ({ page }) => {
    const requestedAudio = new Set<string>();
    page.on("request", (request) => {
      if (request.url().endsWith(".wav")) requestedAudio.add(request.url());
    });
    await page.addInitScript(() => {
      window.audioStarts = [];
      window.audioDecoded = 0;
      window.audioVoiceGains = [];
      const decode = AudioContext.prototype.decodeAudioData;
      AudioContext.prototype.decodeAudioData = function (bytes: ArrayBuffer) {
        return decode.call(this, bytes).then((buffer) => {
          window.audioDecoded++;
          return buffer;
        });
      };
      const create = AudioContext.prototype.createBufferSource;
      AudioContext.prototype.createBufferSource = function () {
        const source = create.call(this);
        const start = source.start.bind(source);
        const stop = source.stop.bind(source);
        const connect = source.connect;
        let level: GainNode | undefined;
        Reflect.set(source, "connect", (...args: unknown[]) => {
          if (args[0] instanceof GainNode) level = args[0];
          return Reflect.apply(connect, source, args);
        });
        let record: Window["audioStarts"][number] | undefined;
        source.start = (...args) => {
          record = {
            duration: source.buffer!.duration,
            loop: source.loop,
            stopped: false,
          };
          window.audioStarts.push(record);
          window.audioVoiceGains.push(level);
          start(...args);
        };
        source.stop = (...args) => {
          if (record) record.stopped = true;
          stop(...args);
        };
        return source;
      };
    });
    const mission = new MissionDriver(page);
    await mission.opening({ dismissGuide: false });
    // The New mission press unlocks audio, so only music may start yet.
    expect(
      await page.evaluate(() =>
        window.audioStarts.filter(
          (voice) => !voice.loop || voice.duration !== 48,
        ),
      ),
    ).toEqual([]);
    await mission.explanation("Welcome, Commander");
    await mission.press("#open-menu");
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.audioStarts.some(
            (voice) => voice.loop && voice.duration === 48,
          ),
        ),
      )
      .toBe(true);
    await expect
      .poll(() => page.evaluate(() => window.audioDecoded))
      .toBe(requestedAudio.size);
    expect(
      [...requestedAudio].some((url) => /circle-(frontier|ridge)/.test(url)),
    ).toBe(false);
    await mission.press("#resume-mission");
    await mission.place("refinery", 12, 49, { placement: "Support Network" });
    await mission.press("#train-harvester");
    await mission.advance(6);
    await expect(page.locator("#explanation-title")).toHaveText(
      "Harvester Operations",
    );
    expect(
      await page.evaluate(() =>
        window.audioStarts.some(
          (voice) => voice.duration === 1.4 && !voice.stopped,
        ),
      ),
    ).toBe(true);
    await mission.explanation("Harvester Operations");
    await mission.select("Harvester");
    await mission.press(
      '#gather-sites [data-economy-action="gather:near-materials-1"]',
    );
    for (let i = 0; i < 30; i++) {
      if (
        (await page.locator("#harvester-details").textContent())!.includes(
          "Gathering",
        )
      )
        break;
      await mission.advance(1);
    }
    await expect(page.locator("#harvester-details")).toContainText("Gathering");
    const working = await page.evaluate(() =>
      window.audioStarts.findIndex(
        (voice) => voice.loop && voice.duration === 4 && !voice.stopped,
      ),
    );
    expect(working).toBeGreaterThanOrEqual(0);
    const gain = () =>
      page.evaluate(
        (index) => window.audioVoiceGains[index]!.gain.value,
        working,
      );
    await page.waitForTimeout(100);
    const selectedGain = await gain();
    expect(selectedGain).toBeGreaterThan(0);
    await page.locator("#clear-selection").click();
    await expect.poll(gain).toBeLessThan(selectedGain * 0.2);
    expect(
      await page.evaluate(
        (index) => window.audioStarts[index]!.stopped,
        working,
      ),
    ).toBe(false);
    await mission.select("Harvester");
    await expect.poll(gain).toBeGreaterThan(selectedGain * 0.9);
    await mission.materials(100);
    await mission.place("barracks", 16, 54, {
      completion: "Barracks & Training",
    });
    await mission.materials(45);
    await mission.press("#train-trooper");
    await mission.advance(6);
    const starts = await page.evaluate(() => window.audioStarts);
    for (const duration of [0.25, 0.9, 1.4, 0.8])
      expect(
        starts
          .filter((voice) => !voice.loop)
          .map((voice) => Math.round(voice.duration * 1000) / 1000),
      ).toContain(duration);
    expect(starts.some((voice) => voice.loop && voice.duration === 4)).toBe(
      true,
    );
    await mission.press("#open-menu");
    expect(
      await page.evaluate(() =>
        window.audioStarts.filter(
          (voice) => voice.loop && voice.duration === 4 && !voice.stopped,
        ),
      ),
    ).toEqual([]);
    expect(
      await page.evaluate(() =>
        window.audioStarts.filter(
          (voice) => voice.loop && voice.duration === 48 && !voice.stopped,
        ),
      ),
    ).toHaveLength(1);
    await page.locator("#exit-mission").click();
    expect(
      await page.evaluate(() =>
        window.audioStarts.filter((voice) => voice.loop && !voice.stopped),
      ),
    ).toEqual([]);
  },
);

test(
  "blocked audio leaves the production mission playable",
  { tag: WEBKIT },
  async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.addInitScript(() => {
      Reflect.set(
        window,
        "AudioContext",
        class {
          constructor() {
            throw new Error("Audio disabled");
          }
        },
      );
    });
    const mission = new MissionDriver(page);
    await mission.opening();
    await mission.press("#open-menu");
    await expect(page.locator("#audio-status")).toHaveAttribute(
      "data-audio-state",
      "blocked",
    );
    await mission.press("#resume-mission");
    await mission.place("refinery", 12, 49, { placement: "Support Network" });
    await expect(page.locator("#train-harvester")).toBeEnabled();
    expect(errors).toEqual([]);
  },
);

for (const nativeHold of [true, false]) {
  test(
    `missing variants, repeated sequences, and fades work with gain hold ${nativeHold}`,
    { tag: WEBKIT },
    async ({ page }) => {
      const errors = collectPageErrors(page);
      let missingRequests = 0;
      await page.route("/assets/audio/unavailable.wav", (route) => {
        missingRequests++;
        return route.fulfill({ status: 404 });
      });
      await withoutApp(page);
      if (!nativeHold)
        await page.addInitScript(() => {
          Reflect.set(AudioParam.prototype, "cancelAndHoldAtTime", undefined);
        });
      await page.goto("/");
      await page.evaluate(async () => {
        const { createAudioMixer } = await import("/src/audio/mixer.ts");
        const { createAudioScene } = await import("/src/audio/scene.ts");
        const starts: number[] = [];
        let loopStarts = 0;
        const device = createAudioMixer({
          createContext: () => {
            const context = new AudioContext();
            const create = context.createBufferSource.bind(context);
            context.createBufferSource = () => {
              const source = create();
              const start = source.start.bind(source);
              source.start = (...args) => {
                if (source.loop) loopStarts++;
                else starts.push(performance.now());
                start(...args);
              };
              return source;
            };
            return context;
          },
        });
        const cue = { gain: 0.3, cooldown: 0.1, voices: 1, priority: 1 };
        const scene = createAudioScene(
          {
            clips: {
              "missing-beep": {
                url: "/assets/audio/unavailable.wav",
                loop: false,
              },
              "missing-hum": {
                url: "/assets/audio/unavailable.wav",
                loop: true,
              },
              beep: { url: "/assets/audio/command-accepted.wav", loop: false },
              hum: { url: "/assets/audio/command-accepted.wav", loop: true },
            },
            cues: {
              beep: { ...cue, clips: ["missing-beep", "beep"] },
              hum: { ...cue, clips: ["missing-hum", "hum"], range: 30 },
              unavailable: {
                ...cue,
                voices: 12,
                clips: ["missing-hum"],
                range: 30,
              },
            },
            events: {
              pattern: [
                { cue: "beep" },
                { cue: "beep", at: 0.5 },
                { cue: "beep", at: 1 },
              ],
            },
          },
          {
            crane: { audio: { loops: { working: "hum" } } },
            unavailable: { audio: { loops: { working: "unavailable" } } },
          },
          device,
          () => ({ x: 0, z: 0 }),
        );
        const emitter = {
          id: "crane",
          definitionId: "crane",
          position: { x: 1, z: 0 },
          states: ["working"],
        };
        scene.sync([
          emitter,
          ...Array.from({ length: 12 }, (_, i) => ({
            ...emitter,
            id: `unavailable-${i}`,
            definitionId: "unavailable",
            position: { x: 0, z: 0 },
          })),
        ]);
        let ready = false;
        device.onReady(() => {
          ready = true;
        });
        // A real click, since unlocking needs a user gesture.
        const unlock = document.createElement("button");
        unlock.id = "unlock-audio";
        unlock.textContent = "Unlock audio";
        unlock.addEventListener("click", () => {
          void device.unlock();
        });
        document.getElementById("top-bar")!.append(unlock);
        window.audioSequenceHarness = {
          scene,
          device,
          starts,
          emitter,
          get ready() {
            return ready;
          },
          get loopStarts() {
            return loopStarts;
          },
        };
      });
      await page.locator("#unlock-audio").click();
      await expect
        .poll(() => page.evaluate(() => window.audioSequenceHarness.loopStarts))
        .toBe(1);
      // The first notification unlocks; this response ensures decoding.
      await expect
        .poll(() =>
          page.evaluate(() => {
            const harness = window.audioSequenceHarness;
            if (!harness.ready) return false;
            const voice = harness.device.play(
              "/assets/audio/command-accepted.wav",
              { bus: "sound", gain: 0, pan: 0, loop: false },
            );
            if (!voice) return false;
            voice.stop();
            harness.starts.length = 0;
            return true;
          }),
        )
        .toBe(true);
      await page.evaluate(() => {
        const { scene, emitter } = window.audioSequenceHarness;
        scene.sync([{ ...emitter, position: { x: 10, z: 0 } }]);
        scene.emit("pattern");
      });
      await expect
        .poll(() =>
          page.evaluate(() => window.audioSequenceHarness.starts.length),
        )
        .toBe(3);
      const times = await page.evaluate(() => {
        const { scene, device, starts } = window.audioSequenceHarness;
        scene.setActive(false);
        scene.dispose();
        device.dispose();
        return starts;
      });
      expect(times[1] - times[0]).toBeGreaterThan(350);
      expect(times[2] - times[1]).toBeGreaterThan(350);
      expect(missingRequests).toBe(1);
      expect(errors).toEqual([]);
    },
  );
}
