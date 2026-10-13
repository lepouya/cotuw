import { expect, test } from "@playwright/test";
import { MissionDriver } from "./mission-driver";
import { PROFILES } from "./profiles";
import { activate } from "./prototype-helpers";

declare global {
  interface Window {
    audioStarts: { duration: number; loop: boolean; stopped: boolean }[];
    audioDecoded: number;
    audioVoiceGains: (GainNode | undefined)[];
  }
}

for (const profile of PROFILES) {
  test.describe(`audio controls with ${profile.name}`, () => {
    test.use({ viewport: profile.viewport, hasTouch: profile.touch });
    test("master, sound, and music preferences persist through restart and reload", async ({
      page,
    }, info) => {
      await page.goto("/");
      await expect(page.locator("#game-canvas")).toHaveAttribute(
        "data-terrain-ready",
        "true",
      );
      await activate(page.locator("#open-menu"), profile.touch);
      await expect(page.locator("#audio-status")).toHaveAttribute(
        "data-audio-state",
        "ready",
      );
      await expect(page.locator("#audio-master-volume")).toHaveValue("50");
      for (const bus of ["master", "sound", "music"]) {
        const slider = page.locator(`#audio-${bus}-volume`);
        await slider.scrollIntoViewIfNeeded();
        const box = (await slider.boundingBox())!;
        const x = box.x + box.width * 0.25;
        const y = box.y + box.height / 2;
        if (profile.touch) await page.touchscreen.tap(x, y);
        else await page.mouse.click(x, y);
        expect(Number(await slider.inputValue())).toBeLessThan(40);
        const mute = page.locator(`#audio-${bus}-mute`);
        await expect(mute).toHaveAccessibleName(
          `Mute ${bus === "master" ? "all audio" : bus}`,
        );
        await expect(mute).toHaveText("");
        await expect(mute.locator("svg")).toBeVisible();
        await activate(mute, profile.touch);
        await expect(mute).toHaveAttribute(
          "title",
          `Unmute ${bus === "master" ? "all audio" : bus}`,
        );
        await expect(page.locator(`#audio-${bus}-mute`)).toHaveAttribute(
          "aria-pressed",
          "true",
        );
      }
      const saved = await page.evaluate(() =>
        localStorage.getItem("cotuw.audio.settings"),
      );
      await info.attach(`audio-${profile.name}`, {
        body: await page.screenshot(),
        contentType: "image/png",
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await activate(page.locator("#restart-mission"), profile.touch);
      await page.reload();
      await expect(page.locator("#game-canvas")).toHaveAttribute(
        "data-terrain-ready",
        "true",
      );
      await activate(page.locator("#open-menu"), profile.touch);
      expect(
        await page.evaluate(() => localStorage.getItem("cotuw.audio.settings")),
      ).toBe(saved);
      for (const bus of ["master", "sound", "music"])
        await expect(page.locator(`#audio-${bus}-mute`)).toHaveAttribute(
          "aria-pressed",
          "true",
        );
    });
  });
}

test("committed gameplay drives music, training, machinery, doors, and pause cleanup", async ({
  page,
}) => {
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
  const mission = new MissionDriver(page, false, false);
  await mission.opening();
  expect(await page.evaluate(() => window.audioStarts)).toEqual([]);
  await mission.press("#open-menu");
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.audioStarts.some((v) => v.loop && v.duration === 48),
      ),
    )
    .toBe(true);
  await expect.poll(() => page.evaluate(() => window.audioDecoded)).toBe(20);
  await mission.press("#resume-mission");
  await mission.place("refinery", 12, 49, "Support Network");
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
    await page.evaluate((index) => window.audioStarts[index]!.stopped, working),
  ).toBe(false);
  await mission.select("Harvester");
  await expect.poll(gain).toBeGreaterThan(selectedGain * 0.9);
  await mission.materials(100);
  await mission.place("barracks", 16, 54);
  await mission.materials(45);
  await mission.press("#train-trooper");
  await mission.advance(6);
  const starts = await page.evaluate(() => window.audioStarts);
  for (const duration of [0.25, 0.9, 1.4, 0.8])
    expect(
      starts
        .filter((v) => !v.loop)
        .map((v) => Math.round(v.duration * 1000) / 1000),
    ).toContain(duration);
  expect(starts.some((v) => v.loop && v.duration === 4)).toBe(true);
  await mission.press("#open-menu");
  expect(
    await page.evaluate(() =>
      window.audioStarts.filter(
        (v) => v.loop && v.duration === 4 && !v.stopped,
      ),
    ),
  ).toEqual([]);
  expect(
    await page.evaluate(() =>
      window.audioStarts.filter(
        (v) => v.loop && v.duration === 48 && !v.stopped,
      ),
    ),
  ).toHaveLength(1);
  await page.locator("#exit-mission").click();
  expect(
    await page.evaluate(() =>
      window.audioStarts.filter((v) => v.loop && !v.stopped),
    ),
  ).toEqual([]);
});

test("blocked audio leaves the production mission playable", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
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
  const mission = new MissionDriver(page, false, false);
  await mission.opening();
  await mission.press("#open-menu");
  await expect(page.locator("#audio-status")).toHaveAttribute(
    "data-audio-state",
    "blocked",
  );
  await mission.press("#resume-mission");
  await mission.place("refinery", 12, 49, "Support Network");
  await expect(page.locator("#train-harvester")).toBeEnabled();
  expect(errors).toEqual([]);
});

for (const nativeHold of [true, false]) {
  test(`missing variants, repeated sequences, and fades work with gain hold ${nativeHold}`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let missingRequests = 0;
    await page.route("/assets/audio/unavailable.wav", (route) => {
      missingRequests++;
      return route.fulfill({ status: 404 });
    });
    await page.route(
      (url) => url.pathname === "/src/main.ts",
      (route) =>
        route.fulfill({
          contentType: "text/javascript",
          body: 'import "/src/styles.css";',
        }),
    );
    if (!nativeHold)
      await page.addInitScript(() => {
        Reflect.set(AudioParam.prototype, "cancelAndHoldAtTime", undefined);
      });
    await page.goto("/");
    await page.evaluate(async () => {
      const mixerPath: string = "/src/audio/mixer.ts";
      const scenePath: string = "/src/audio/scene.ts";
      const { createAudioMixer } = (await import(
        mixerPath
      )) as typeof import("../src/audio/mixer");
      const { createAudioScene } = (await import(
        scenePath
      )) as typeof import("../src/audio/scene");
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
            "missing-hum": { url: "/assets/audio/unavailable.wav", loop: true },
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
        audible: true,
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
      document.getElementById("open-menu")!.addEventListener("click", () => {
        void device.unlock();
      });
      Reflect.set(window, "audioSequenceHarness", {
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
      });
    });
    await page.locator("#open-menu").click();
    await expect
      .poll(() =>
        page.evaluate(
          () => Reflect.get(window, "audioSequenceHarness").loopStarts,
        ),
      )
      .toBe(1);
    // The first notification unlocks the device; this response ensures decoding.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const harness = Reflect.get(window, "audioSequenceHarness");
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
      const { scene, emitter } = Reflect.get(window, "audioSequenceHarness");
      scene.sync([{ ...emitter, position: { x: 10, z: 0 } }]);
      scene.emit("pattern");
    });
    await expect
      .poll(() =>
        page.evaluate(
          () => Reflect.get(window, "audioSequenceHarness").starts.length,
        ),
      )
      .toBe(3);
    const times: number[] = await page.evaluate(() => {
      const { scene, device, starts } = Reflect.get(
        window,
        "audioSequenceHarness",
      );
      scene.setActive(false);
      scene.dispose();
      device.dispose();
      return starts;
    });
    expect(times[1]! - times[0]!).toBeGreaterThan(350);
    expect(times[2]! - times[1]!).toBeGreaterThan(350);
    expect(missingRequests).toBe(1);
    expect(errors).toEqual([]);
  });
}
