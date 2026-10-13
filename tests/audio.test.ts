import { afterEach, expect, test, vi } from "vitest";
import { createAudioScene } from "../src/audio/scene";
import { createMissionAudio } from "../src/audio/mission";
import { parseContentPack } from "../src/content/content-pack";
import { readAudioSettings } from "../src/ui/audio-controls";
import { DEFAULT_AUDIO_SETTINGS } from "../src/audio/mixer";
import { BASE_CONTENT } from "./helpers/content";
import type { AudioMixer } from "../src/audio/mixer";
import type { AudioContent } from "../src/content/audio";
import type { AudioEmitter } from "../src/audio/scene";
import type { MissionSimulation } from "../src/simulation/mission";

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
});

function device() {
  let now = 10;
  let ready = true;
  const listeners = new Set<() => void>();
  const calls: {
    url: string;
    options: Parameters<AudioMixer["play"]>[1];
    ended: boolean;
  }[] = [];
  const mixer: AudioMixer = {
    now: () => now,
    isLoaded: () => ready,
    preload: vi.fn(),
    play: (url, options) => {
      if (!ready) return;
      const call = { url, options, ended: false };
      calls.push(call);
      return {
        get ended() {
          return call.ended;
        },
        stop: () => {
          call.ended = true;
        },
        setMix: (gain, pan) => {
          call.options.gain = gain;
          call.options.pan = pan;
        },
      };
    },
    onReady: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    mixer,
    calls,
    listeners,
    time: (value: number) => {
      now = value;
    },
    ready: (value: boolean) => {
      ready = value;
      for (const listener of listeners) listener();
    },
  };
}
const emitter = (changes: Partial<AudioEmitter> = {}): AudioEmitter => ({
  id: "worker",
  definitionId: "arc-harvester",
  position: { x: 0, z: 0 },
  audible: true,
  states: ["moving"],
  ...changes,
});
function setup() {
  const backend = device();
  const focus = { x: 0, z: 0 };
  const scene = createAudioScene(
    BASE_CONTENT.audio,
    BASE_CONTENT.presentation,
    backend.mixer,
    () => focus,
  );
  return { ...backend, scene, focus };
}
test("state loops resume when buffers arrive, without replaying past events", () => {
  const { scene, ready, calls } = setup();
  ready(false);
  scene.sync([emitter()]);
  scene.emit("command.accepted");
  expect(calls).toHaveLength(0);
  ready(true);
  expect(calls.map((call) => call.url)).toEqual(
    expect.arrayContaining([
      "/assets/audio/harvester-engine.wav",
      "/assets/audio/unquiet-frontier.wav",
    ]),
  );
  expect(calls.some((call) => call.url.includes("command"))).toBe(false);
  scene.update();
  expect(calls).toHaveLength(2);
});
test("hidden, paused, removed, and distant emitters release their loops", () => {
  const { scene, calls, focus } = setup();
  scene.sync([emitter()]);
  const engine = () =>
    calls.filter((call) => call.url.includes("engine") && !call.ended);
  expect(engine()).toHaveLength(1);
  focus.x = 100;
  scene.update();
  expect(engine()).toHaveLength(0);
  focus.x = 0;
  scene.update();
  expect(engine()).toHaveLength(1);
  scene.sync([emitter({ audible: false })]);
  expect(engine()).toHaveLength(0);
  scene.sync([emitter()]);
  scene.setActive(false);
  expect(engine()).toHaveLength(0);
  expect(
    calls.filter((call) => call.url.includes("frontier") && !call.ended),
  ).toHaveLength(1);
  scene.setActive(true);
  expect(engine()).toHaveLength(1);
  scene.sync([]);
  expect(engine()).toHaveLength(0);
});
test("selection mixes work loops without restarting or changing other cues", () => {
  const { scene, calls } = setup();
  const worker = emitter({ states: ["working"], position: { x: 9, z: 0 } });
  const moving = emitter({ id: "other", states: ["moving"] });
  scene.sync([worker, moving]);
  const work = calls.find((call) => call.url.includes("harvester-work"))!;
  const engine = calls.find((call) => call.url.includes("engine"))!;
  const music = calls.find((call) => call.options.bus === "music")!;
  const quiet = work.options.gain;
  const engineGain = engine.options.gain;
  const musicGain = music.options.gain;
  expect(quiet).toBeCloseTo(0.4 * 0.8 ** 2 * 0.15);
  scene.setSelection([worker.id, moving.id]);
  expect(work.options.gain).toBeCloseTo(quiet / 0.15);
  expect(work.options.pan).toBeCloseTo(0.2);
  expect(engine.options.gain).toBe(engineGain);
  expect(music.options.gain).toBe(musicGain);
  scene.setSelection([]);
  expect(work.options.gain).toBeCloseTo(quiet);
  expect(work.ended).toBe(false);
  expect(calls).toHaveLength(3);
  scene.setActive(false);
  scene.setSelection([worker.id]);
  expect(calls).toHaveLength(3);
  expect(work.ended).toBe(true);
  scene.setActive(true);
  expect(
    calls.filter(
      (call) => !call.ended && call.url.includes("harvester-work"),
    )[0]!.options.gain,
  ).toBeCloseTo(quiet / 0.15);
  scene.dispose();
  scene.setSelection([]);
  expect(calls.filter((call) => !call.ended)).toHaveLength(0);
});
test("world sequences cancel on fog loss and global player alerts remain audible", () => {
  vi.useFakeTimers();
  const { scene, calls } = setup();
  const building = emitter({
    definitionId: "arc-materials-refinery",
    states: [],
  });
  scene.sync([building]);
  scene.emit("activity.delivery", building);
  expect(calls.filter((call) => call.url.includes("door"))).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(1);
  scene.sync([{ ...building, audible: false }]);
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(3000);
  expect(calls.filter((call) => call.url.includes("door"))).toHaveLength(1);
  expect(calls.find((call) => call.url.includes("door"))!.ended).toBe(true);
  scene.emit("activity.delivery", { ...building, audible: false });
  scene.emit("alert");
  expect(calls.some((call) => call.url.endsWith("/alert.wav"))).toBe(true);
  scene.dispose();
});
test("combat variants and event bursts obey cooldown and voice limits", () => {
  const { scene, calls, time } = setup();
  const trooper = emitter({ definitionId: "arc-trooper", states: [] });
  scene.sync([trooper]);
  for (let i = 0; i < 20; i++) scene.emit("attack", trooper);
  expect(calls.filter((call) => call.url.includes("rifle"))).toHaveLength(1);
  for (let i = 1; i < 10; i++) {
    time(10 + i);
    scene.emit("attack", trooper);
  }
  expect(
    calls.filter((call) => call.url.includes("rifle")).map((call) => call.url),
  ).toEqual([
    "/assets/audio/rifle-1.wav",
    "/assets/audio/rifle-2.wav",
    "/assets/audio/rifle-3.wav",
    "/assets/audio/rifle-1.wav",
  ]);
});
test("custom action and state names need only data bindings", () => {
  const backend = device();
  const scene = createAudioScene(
    BASE_CONTENT.audio,
    {
      crane: {
        audio: {
          events: { lift: [{ cue: "refinery-door-open" }] },
          loops: { lifting: "harvester-work" },
        },
      },
    },
    backend.mixer,
    () => ({ x: 0, z: 0 }),
  );
  const crane = emitter({ definitionId: "crane", states: ["lifting"] });
  scene.sync([crane]);
  scene.emit("lift", crane);
  scene.emit("constructor", crane);
  expect(backend.calls.map((call) => call.url)).toContain(
    "/assets/audio/harvester-work.wav",
  );
  expect(backend.calls.map((call) => call.url)).toContain(
    "/assets/audio/refinery-door-open.wav",
  );
  scene.dispose();
  backend.ready(true);
  expect(backend.calls.every((call) => call.ended)).toBe(true);
  expect(backend.listeners.size).toBe(0);
});
test("object bindings inherit pack defaults and can silence them", () => {
  const backend = device();
  const scene = createAudioScene(
    BASE_CONTENT.audio,
    {
      crane: {},
      silent: { audio: { events: { damage: [] } } },
    },
    backend.mixer,
    () => ({ x: 0, z: 0 }),
  );
  const crane = emitter({ id: "crane", definitionId: "crane", states: [] });
  const silent = emitter({ id: "silent", definitionId: "silent", states: [] });
  scene.sync([crane, silent]);
  scene.emit("damage", silent);
  expect(backend.calls).toHaveLength(1);
  scene.emit("damage", crane);
  expect(backend.calls.map((call) => call.url)).toContain(
    "/assets/audio/damage-1.wav",
  );
});
test("full voice budgets replace the lowest-priority one-shot", () => {
  const backend = device();
  const cue = { clips: ["a"], gain: 1, cooldown: 0, voices: 24 };
  const content: AudioContent = {
    clips: { a: { url: "a", loop: false } },
    cues: {
      low: { ...cue, priority: 1 },
      lowest: { ...cue, priority: 0 },
      high: { ...cue, priority: 2 },
    },
    events: {
      low: [{ cue: "low" }],
      lowest: [{ cue: "lowest" }],
      high: [{ cue: "high" }],
    },
  };
  const scene = createAudioScene(content, {}, backend.mixer, () => ({
    x: 0,
    z: 0,
  }));
  for (let i = 0; i < 24; i++) scene.emit(i === 12 ? "lowest" : "low");
  scene.emit("lowest");
  expect(backend.calls).toHaveLength(24);
  scene.emit("high");
  expect(backend.calls).toHaveLength(25);
  expect(backend.calls.filter((call) => call.ended)).toEqual([
    backend.calls[12],
  ]);
});
test("music switches without leaving the previous track running", () => {
  const { scene, calls } = setup();
  scene.update();
  scene.setMusic(true);
  scene.setMusic(false);
  expect(calls.filter((call) => !call.ended).map((call) => call.url)).toEqual([
    "/assets/audio/unquiet-frontier.wav",
  ]);
  expect(calls.every((call) => call.options.bus === "music")).toBe(true);
});

test.each([
  (pack: any) => {
    pack.audio.cues.rifle.clips = ["constructor"];
  },
  (pack: any) => {
    pack.audio.cues.rifle.gain = 2;
  },
  ...[-0.1, 1.1, null, "0.2"].map((value) => (pack: any) => {
    pack.audio.cues["harvester-work"].unselectedGain = value;
  }),
  (pack: any) => {
    pack.audio.cues["victory"].unselectedGain = 0.2;
  },
  (pack: any) => {
    pack.audio.cues.rifle.voices = 25;
  },
  (pack: any) => {
    pack.audio.clips["rifle-1"].loop = true;
  },
  (pack: any) => {
    pack.audio.music.default = "rifle";
  },
  (pack: any) => {
    pack.presentation["arc-harvester"].audio.loops.moving = "damage";
  },
  (pack: any) => {
    pack.presentation["arc-harvester"].audio.events = {
      bad: [{ cue: "harvester-work" }],
    };
  },
  (pack: any) => {
    pack.audio.defaults.loops = { moving: "damage" };
  },
  (pack: any) => {
    pack.presentation["arc-materials-refinery"].audio.events[
      "activity.delivery"
    ][1].at = -1;
  },
])(
  "content validation rejects invalid audio references and policies %i",
  (edit) => {
    const pack: any = structuredClone(BASE_CONTENT);
    edit(pack);
    expect(() =>
      parseContentPack(
        JSON.stringify({ ...pack, format: "cotuw-content", formatVersion: 1 }),
      ),
    ).toThrow(/audio/i);
  },
);
test("old content packs remain silent and valid", () => {
  const pack: any = structuredClone(BASE_CONTENT);
  delete pack.audio;
  for (const presentation of Object.values(pack.presentation) as any[])
    delete presentation.audio;
  expect(
    parseContentPack(
      JSON.stringify({ ...pack, format: "cotuw-content", formatVersion: 1 }),
    ).audio,
  ).toBeUndefined();
});
test("invalid saved volume preferences fall back safely", () => {
  for (const source of [
    null,
    "bad",
    "null",
    '{"sound":{"volume":2,"muted":false}}',
  ])
    expect(readAudioSettings(source)).toEqual(DEFAULT_AUDIO_SETTINGS);
  const value = {
    master: { volume: 0.3, muted: true },
    sound: { volume: 0.2, muted: true },
    music: { volume: 0, muted: false },
  };
  expect(readAudioSettings(JSON.stringify(value))).toEqual(value);
  for (const master of [
    null,
    { volume: -1, muted: false },
    { volume: 1, muted: "false" },
  ])
    expect(readAudioSettings(JSON.stringify({ ...value, master }))).toEqual(
      DEFAULT_AUDIO_SETTINGS,
    );
});
test("committed observations group commands, baseline loads, and queue starts", () => {
  const scene = {
    sync: vi.fn(),
    emit: vi.fn(),
    setMusic: vi.fn(),
  } as unknown as ReturnType<typeof createAudioScene>;
  const simulation = {
    actors: [
      {
        id: "b",
        definitionId: "barracks",
        occupancyLayer: "surface",
        worldPosition: { x: 0, z: 0 },
        facing: 0,
      },
    ],
    economy: {
      harvesters: [],
      production: [{ producerId: "b", actorId: "one", completedTicks: 3 }],
    },
    wrecks: [],
    attacks: [],
    buildingActivity: [],
    objectives: [{ id: "goal", status: "complete" }],
    result: { kind: "victory" },
    completedTicks: 100,
    tickSeconds: 1 / 60,
  } as unknown as MissionSimulation;
  const adapter = createMissionAudio(
    scene,
    simulation,
    { owns: () => true, shows: () => true },
    8,
  );
  expect(scene.emit).not.toHaveBeenCalled();
  adapter.observe(
    Array.from({ length: 5 }, (_, i) => ({
      tick: 100,
      command: { kind: "stop" as const, actorId: String(i) },
      accepted: true,
    })),
  );
  expect(scene.emit).toHaveBeenCalledTimes(1);
  expect(scene.emit).toHaveBeenCalledWith("command.accepted");
  scene.emit = vi.fn();
  (simulation as any).economy.production.push({
    producerId: "b",
    actorId: "two",
    completedTicks: 0,
  });
  adapter.observe();
  expect(scene.emit).not.toHaveBeenCalled();
  (simulation as any).economy.production = [
    { producerId: "b", actorId: "two", completedTicks: 1 },
  ];
  adapter.observe();
  expect(scene.emit).toHaveBeenCalledWith(
    "production.start",
    expect.objectContaining({ id: "b" }),
  );
  scene.emit = vi.fn();
  adapter.observe();
  expect(scene.emit).not.toHaveBeenCalled();
});

test("production completions use the committed exit participant", () => {
  const { scene, calls } = setup();
  const building = {
    id: "b",
    definitionId: "arc-field-barracks",
    occupancyLayer: "surface",
    worldPosition: { x: 0, z: 0 },
    facing: 0,
  };
  const simulation: any = {
    actors: [building],
    economy: {
      harvesters: [],
      production: [{ actorId: "unit", producerId: "b", completedTicks: 1 }],
    },
    wrecks: [],
    attacks: [],
    buildingActivity: [],
    objectives: [],
    completedTicks: 1,
    tickSeconds: 1 / 60,
  };
  const adapter = createMissionAudio(
    scene,
    simulation,
    { owns: () => true, shows: () => true },
    8,
  );
  simulation.actors = [
    building,
    { ...building, id: "unit", definitionId: "arc-trooper" },
  ];
  simulation.economy.production = [];
  simulation.buildingActivity = [
    { buildingId: "b", kind: "exit", actorId: "unit" },
  ];
  adapter.observe();
  expect(
    calls.filter((call) => call.url.includes("unit-trained")),
  ).toHaveLength(1);
  adapter.observe();
  expect(
    calls.filter((call) => call.url.includes("unit-trained")),
  ).toHaveLength(1);
});

test("instant production still emits training start and completion once", () => {
  const { scene, calls } = setup();
  const building = {
    id: "b",
    definitionId: "arc-field-barracks",
    occupancyLayer: "surface",
    worldPosition: { x: 0, z: 0 },
    facing: 0,
  };
  const simulation: any = {
    actors: [building],
    economy: { harvesters: [], production: [] },
    wrecks: [],
    attacks: [],
    buildingActivity: [],
    objectives: [],
    completedTicks: 1,
    tickSeconds: 1 / 60,
  };
  const adapter = createMissionAudio(
    scene,
    simulation,
    { owns: () => true, shows: () => true },
    8,
  );
  simulation.actors = [
    building,
    { ...building, id: "unit", definitionId: "arc-trooper" },
  ];
  simulation.buildingActivity = [
    { buildingId: "b", kind: "exit", actorId: "unit" },
  ];
  adapter.observe([
    {
      tick: 1,
      accepted: true,
      command: {
        kind: "train-unit",
        actorId: "unit",
        producerId: "b",
        definitionId: "arc-trooper",
      },
    },
  ]);
  expect(
    calls.filter((call) => call.url.includes("training-start")),
  ).toHaveLength(1);
  expect(
    calls.filter((call) => call.url.includes("unit-trained")),
  ).toHaveLength(1);
});

test("hidden attacks stay silent while own damage and alerts trigger combat music", () => {
  const { scene, calls, time } = setup();
  const actor = {
    occupancyLayer: "surface",
    worldPosition: { x: 0, z: 0 },
    facing: 0,
  };
  const simulation: any = {
    actors: [
      { ...actor, id: "hidden", definitionId: "wolf" },
      { ...actor, id: "own", definitionId: "arc-harvester" },
    ],
    economy: { harvesters: [], production: [] },
    wrecks: [],
    attacks: [],
    buildingActivity: [],
    objectives: [],
    completedTicks: 0,
    tickSeconds: 1 / 60,
  };
  const owns = (value: { definitionId: string }) =>
    value.definitionId === "arc-harvester";
  const access = { owns, shows: owns };
  const adapter = createMissionAudio(scene, simulation, access, 8);
  simulation.attacks = [{ attackerId: "hidden", targetId: "own" }];
  adapter.observe([], [{ kind: "attack" } as any]);
  expect(calls.some((call) => call.url.includes("wolf-attack"))).toBe(false);
  expect(calls.some((call) => call.url.includes("damage"))).toBe(true);
  expect(calls.some((call) => call.url.endsWith("/alert.wav"))).toBe(true);
  expect(
    calls
      .filter((call) => !call.ended && call.options.bus === "music")
      .map((call) => call.url),
  ).toEqual(["/assets/audio/beneath-the-ridge.wav"]);
  simulation.attacks = [];
  simulation.completedTicks = 481;
  time(19);
  adapter.observe();
  expect(
    calls
      .filter((call) => !call.ended && call.options.bus === "music")
      .map((call) => call.url),
  ).toEqual(["/assets/audio/unquiet-frontier.wav"]);
});

test("per-cue budgets hand loops to nearer emitters", () => {
  const { scene, calls, focus } = setup();
  const workers = Array.from({ length: 7 }, (_, i) =>
    emitter({ id: `worker-${i}`, position: { x: i === 6 ? 20 : i, z: 0 } }),
  );
  scene.sync(workers);
  const engines = calls.filter((call) => call.url.includes("engine"));
  expect(engines).toHaveLength(6);
  focus.x = 20;
  scene.update();
  expect(engines[0]!.ended).toBe(true);
  const active = calls.filter(
    (call) => call.url.includes("engine") && !call.ended,
  );
  expect(active).toHaveLength(6);
  expect(
    active.some(
      (call) =>
        call.options.gain ===
        BASE_CONTENT.audio!.cues["harvester-engine"]!.gain,
    ),
  ).toBe(true);
  scene.dispose();
});

test("selected world emitters receive loop slots before nearer unselected ones", () => {
  const { scene, calls } = setup();
  const workers = Array.from({ length: 7 }, (_, i) =>
    emitter({
      id: `worker-${i}`,
      states: ["working"],
      position: { x: i, z: 0 },
    }),
  );
  scene.sync(workers);
  scene.setSelection(["worker-6"]);
  const active = () =>
    calls.filter((call) => !call.ended && call.url.includes("harvester-work"));
  expect(active()).toHaveLength(6);
  expect(active().some((call) => call.options.pan === 6 / 45)).toBe(true);
  scene.setSelection([]);
  expect(active()).toHaveLength(6);
  expect(active().some((call) => call.options.pan === 6 / 45)).toBe(false);
  scene.setSelection(["worker-6"]);
  scene.sync(
    workers.map((worker) => ({ ...worker, audible: worker.id !== "worker-6" })),
  );
  expect(active().some((call) => call.options.pan === 6 / 45)).toBe(false);
  scene.sync(
    workers.map((worker) =>
      worker.id === "worker-6"
        ? { ...worker, position: { x: 100, z: 0 } }
        : worker,
    ),
  );
  expect(active()).toHaveLength(6);
  expect(active().some((call) => call.options.pan === 0.8)).toBe(false);
  scene.dispose();
});

test("missing variants do not silence ready variants or consume their rotation", () => {
  const { scene, mixer, calls, time } = setup();
  const play = mixer.play;
  mixer.play = (url, options) =>
    url.endsWith("rifle-1.wav") ? undefined : play(url, options);
  const unit = emitter({ definitionId: "arc-trooper", states: [] });
  scene.sync([unit]);
  for (let i = 0; i < 3; i++) {
    time(10 + i);
    scene.emit("attack", unit);
  }
  expect(
    calls.filter((call) => call.url.includes("rifle")).map((call) => call.url),
  ).toEqual([
    "/assets/audio/rifle-2.wav",
    "/assets/audio/rifle-3.wav",
    "/assets/audio/rifle-2.wav",
  ]);
  scene.dispose();
});

test("state loops can start with a ready variant while another is unavailable", () => {
  const backend = device();
  const play = backend.mixer.play;
  backend.mixer.play = (url, options) =>
    url === "missing" ? undefined : play(url, options);
  const content: AudioContent = {
    clips: {
      missing: { url: "missing", loop: true },
      ready: { url: "ready", loop: true },
    },
    cues: {
      hum: {
        clips: ["missing", "ready"],
        gain: 1,
        cooldown: 0,
        voices: 1,
        priority: 0,
        range: 45,
      },
    },
    events: {},
    defaults: { loops: { moving: "hum" } },
  };
  const scene = createAudioScene(content, {}, backend.mixer, () => ({
    x: 0,
    z: 0,
  }));
  scene.sync([emitter()]);
  expect(backend.calls.map((call) => call.url)).toEqual(["ready"]);
  scene.update();
  expect(backend.calls).toHaveLength(1);
  scene.dispose();
});

test("unloaded loop cues do not starve playable loops or restart them on updates", () => {
  const backend = device();
  const loaded = new Set(["ready"]);
  backend.mixer.isLoaded = (url) => loaded.has(url);
  const play = backend.mixer.play;
  backend.mixer.play = (url, options) =>
    loaded.has(url) ? play(url, options) : undefined;
  const cue = { gain: 1, cooldown: 0, voices: 12, priority: 0, range: 45 };
  const content: AudioContent = {
    clips: {
      missing: { url: "missing", loop: true },
      ready: { url: "ready", loop: true },
    },
    cues: {
      missing: { ...cue, clips: ["missing"] },
      ready: { ...cue, clips: ["ready"] },
    },
    events: {},
  };
  const scene = createAudioScene(
    content,
    {
      missing: { audio: { loops: { moving: "missing" } } },
      ready: { audio: { loops: { moving: "ready" } } },
    },
    backend.mixer,
    () => ({ x: 0, z: 0 }),
  );
  const workers = [
    ...Array.from({ length: 12 }, (_, i) =>
      emitter({ id: `missing-${i}`, definitionId: "missing" }),
    ),
    emitter({ id: "ready", definitionId: "ready", position: { x: 1, z: 0 } }),
  ];
  scene.sync(workers);
  expect(backend.calls.map((call) => call.url)).toEqual(["ready"]);
  for (let i = 0; i < 10; i++) scene.update();
  expect(backend.calls).toHaveLength(1);
  loaded.add("missing");
  backend.ready(true);
  expect(
    backend.calls.filter((call) => !call.ended && call.url === "missing"),
  ).toHaveLength(12);
  expect(backend.calls[0]!.ended).toBe(true);
  scene.dispose();
});

test("saturated cues do not consume unused slots for other loop types", () => {
  const { scene, calls } = setup();
  scene.sync([
    ...Array.from({ length: 13 }, (_, i) =>
      emitter({ id: `worker-${i}`, position: { x: i, z: 0 } }),
    ),
    emitter({ id: "drill", states: ["working"], position: { x: 14, z: 0 } }),
  ]);
  expect(calls.filter((call) => call.url.includes("engine"))).toHaveLength(6);
  expect(
    calls.filter((call) => call.url.includes("harvester-work")),
  ).toHaveLength(1);
  scene.dispose();
});

test("state aliases share a loop and changing aliases keeps it running", () => {
  const backend = device();
  const scene = createAudioScene(
    BASE_CONTENT.audio,
    {
      crane: {
        audio: {
          loops: { moving: "harvester-engine", working: "harvester-engine" },
        },
      },
    },
    backend.mixer,
    () => ({ x: 0, z: 0 }),
  );
  const crane = emitter({
    definitionId: "crane",
    states: ["moving", "working", "moving"],
  });
  scene.sync([crane]);
  scene.sync([{ ...crane, states: ["working"] }]);
  expect(
    backend.calls.filter((call) => call.url.includes("engine")),
  ).toHaveLength(1);
  expect(
    backend.calls.filter((call) => call.url.includes("engine"))[0]!.ended,
  ).toBe(false);
  scene.dispose();
});

test("object definitions can explicitly silence an inherited state loop", () => {
  const backend = device();
  const audio = structuredClone(BASE_CONTENT.audio!);
  audio.defaults = { loops: { moving: "harvester-engine" } };
  const scene = createAudioScene(
    audio,
    { silent: { audio: { loops: { moving: null } } } },
    backend.mixer,
    () => ({ x: 0, z: 0 }),
  );
  scene.sync([emitter({ definitionId: "silent" })]);
  expect(backend.calls.some((call) => call.url.includes("engine"))).toBe(false);
  const pack: any = structuredClone(BASE_CONTENT);
  pack.presentation["arc-harvester"].audio.loops.moving = null;
  expect(() => parseContentPack(JSON.stringify(pack))).not.toThrow();
  scene.dispose();
});

test("player readiness feedback survives a popup pause while world sound stops", () => {
  const { scene, calls } = setup();
  const unit = emitter();
  scene.sync([unit]);
  scene.emit("trained", unit);
  scene.setActive(false);
  scene.sync([]);
  const readiness = calls.find((call) => call.url.includes("unit-trained"))!;
  expect(readiness.ended).toBe(false);
  expect(calls.find((call) => call.url.includes("engine"))!.ended).toBe(true);
  scene.dispose();
  expect(readiness.ended).toBe(true);
});

test("a missing high-priority clip does not evict an audible voice", () => {
  const backend = device();
  const cue = { clips: ["a"], gain: 1, cooldown: 0, voices: 24 };
  const content: AudioContent = {
    clips: { a: { url: "a", loop: false } },
    cues: { low: { ...cue, priority: 0 }, high: { ...cue, priority: 1 } },
    events: { low: [{ cue: "low" }], high: [{ cue: "high" }] },
  };
  const scene = createAudioScene(content, {}, backend.mixer, () => ({
    x: 0,
    z: 0,
  }));
  for (let i = 0; i < 24; i++) scene.emit("low");
  backend.ready(false);
  scene.emit("high");
  expect(backend.calls.filter((call) => !call.ended)).toHaveLength(24);
  scene.dispose();
});

test("repeated sequence cues acquire voices only when each step is due", () => {
  vi.useFakeTimers();
  const backend = device();
  const content: AudioContent = {
    clips: { a: { url: "a", loop: false } },
    cues: {
      beep: { clips: ["a"], gain: 1, cooldown: 0.1, voices: 1, priority: 1 },
    },
    events: {
      pattern: [
        { cue: "beep" },
        { cue: "beep", at: 0.5 },
        { cue: "beep", at: 1 },
      ],
    },
  };
  const scene = createAudioScene(content, {}, backend.mixer, () => ({
    x: 0,
    z: 0,
  }));
  scene.emit("pattern");
  expect(backend.calls).toHaveLength(1);
  for (const at of [10.5, 11]) {
    backend.calls[backend.calls.length - 1]!.ended = true;
    backend.time(at);
    vi.advanceTimersByTime(500);
  }
  expect(backend.calls).toHaveLength(3);
  scene.dispose();
});

test("world deferred steps use current positions and cancel on pause or disposal", () => {
  vi.useFakeTimers();
  const { scene, calls } = setup();
  const building = emitter({
    definitionId: "arc-materials-refinery",
    states: [],
  });
  scene.sync([building]);
  scene.emit("activity.delivery", building);
  scene.sync([{ ...building, position: { x: 20, z: 0 } }]);
  vi.advanceTimersByTime(2550);
  const close = calls.find((call) => call.url.includes("door-close"))!;
  expect(close.options.pan).toBeGreaterThan(0);
  scene.emit("activity.exit", building);
  expect(vi.getTimerCount()).toBe(1);
  scene.setActive(false);
  expect(vi.getTimerCount()).toBe(0);
  scene.setActive(true);
  scene.emit("activity.exit", building);
  scene.dispose();
  expect(vi.getTimerCount()).toBe(0);
});

test("deferred bursts are bounded and do not replay missing steps on readiness", () => {
  vi.useFakeTimers();
  const backend = device();
  backend.ready(false);
  const content: AudioContent = {
    clips: { a: { url: "a", loop: false } },
    cues: {
      beep: { clips: ["a"], gain: 1, cooldown: 0, voices: 24, priority: 1 },
    },
    events: { pattern: [{ cue: "beep", at: 1 }] },
  };
  const scene = createAudioScene(content, {}, backend.mixer, () => ({
    x: 0,
    z: 0,
  }));
  for (let i = 0; i < 1000; i++) scene.emit("pattern");
  expect(vi.getTimerCount()).toBe(96);
  vi.advanceTimersByTime(1000);
  backend.ready(true);
  expect(backend.calls).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
  scene.dispose();
});

test("mission result cues take priority over a full player-feedback mix", () => {
  const backend = device();
  const audio = structuredClone(BASE_CONTENT.audio!);
  audio.cues = {
    ...audio.cues,
    "command-accepted": {
      ...audio.cues["command-accepted"]!,
      cooldown: 0,
      voices: 24,
    },
  };
  const scene = createAudioScene(audio, {}, backend.mixer, () => ({
    x: 0,
    z: 0,
  }));
  for (let i = 0; i < 24; i++) scene.emit("command.accepted");
  scene.emit("victory");
  expect(backend.calls.some((call) => call.url.includes("victory"))).toBe(true);
  scene.dispose();
});

test.each([
  (pack: any) => {
    pack.audio.cues[""] = pack.audio.cues.rifle;
  },
  (pack: any) => {
    pack.audio.clips[""] = pack.audio.clips["rifle-1"];
  },
  (pack: any) => {
    pack.audio.events[""] = [{ cue: "rifle" }];
  },
  (pack: any) => {
    pack.audio.events.long = Array.from({ length: 25 }, () => ({
      cue: "rifle",
      at: 1,
    }));
  },
])("rejects malformed identifiers and excessive sequences %i", (edit) => {
  const pack: any = structuredClone(BASE_CONTENT);
  edit(pack);
  expect(() => parseContentPack(JSON.stringify(pack))).toThrow(/audio/i);
});

test("finished queue heads waiting at an exit do not claim the training state", () => {
  const scene = {
    sync: vi.fn(),
    emit: vi.fn(),
    setMusic: vi.fn(),
  } as unknown as ReturnType<typeof createAudioScene>;
  const simulation: any = {
    actors: [
      {
        id: "b",
        definitionId: "arc-field-barracks",
        occupancyLayer: "surface",
        worldPosition: { x: 0, z: 0 },
        facing: 0,
      },
    ],
    economy: {
      harvesters: [],
      production: [
        {
          actorId: "ready",
          producerId: "b",
          completedTicks: 3,
          totalTicks: 3,
          exitBlocked: true,
        },
        {
          actorId: "queued",
          producerId: "b",
          completedTicks: 0,
          totalTicks: 3,
          exitBlocked: false,
        },
      ],
    },
    wrecks: [],
    attacks: [],
    buildingActivity: [],
    objectives: [],
    completedTicks: 1,
    tickSeconds: 1 / 60,
  };
  const adapter = createMissionAudio(
    scene,
    simulation,
    { owns: () => true, shows: () => true },
    8,
  );
  expect(scene.sync).toHaveBeenLastCalledWith([
    expect.objectContaining({ states: ["idle"] }),
  ]);
  simulation.economy.production.shift();
  simulation.economy.production[0].completedTicks = 1;
  adapter.observe();
  expect(scene.sync).toHaveBeenLastCalledWith([
    expect.objectContaining({ states: ["training"] }),
  ]);
});

test("deferred steps expire after a long browser stall", () => {
  vi.useFakeTimers();
  const clock = vi.spyOn(performance, "now").mockReturnValue(0);
  const backend = device();
  const content: AudioContent = {
    clips: { a: { url: "a", loop: false } },
    cues: {
      beep: { clips: ["a"], gain: 1, cooldown: 0, voices: 1, priority: 1 },
    },
    events: { pattern: [{ cue: "beep", at: 1 }] },
  };
  const scene = createAudioScene(content, {}, backend.mixer, () => ({
    x: 0,
    z: 0,
  }));
  scene.emit("pattern");
  clock.mockReturnValue(1000);
  vi.advanceTimersByTime(1000);
  expect(backend.calls).toHaveLength(1);
  backend.calls[0]!.ended = true;
  scene.emit("pattern");
  clock.mockReturnValue(5000);
  vi.advanceTimersByTime(1000);
  expect(backend.calls).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
  scene.dispose();
  clock.mockRestore();
});

test("specific player feedback replaces routine alerts in the same tick", () => {
  const { scene, calls, time } = setup();
  const building = {
    id: "b",
    definitionId: "arc-field-barracks",
    occupancyLayer: "surface",
    worldPosition: { x: 0, z: 0 },
    facing: 0,
  };
  const simulation: any = {
    actors: [building],
    economy: { harvesters: [], production: [] },
    wrecks: [],
    attacks: [],
    buildingActivity: [],
    objectives: [{ id: "goal", status: "active" }],
    completedTicks: 1,
    tickSeconds: 1 / 60,
  };
  const access = { owns: () => true, shows: () => true };
  const adapter = createMissionAudio(scene, simulation, access, 8);
  const played = () =>
    calls.map((call) => call.url.replace(/^.*\/|\.wav$/g, "")).sort();
  const routine = { priority: "normal", text: "ready" } as const;
  const urgent = { priority: "high", text: "attack" } as const;

  simulation.actors = [building, { ...building, id: "unit" }];
  simulation.buildingActivity = [
    { buildingId: "b", kind: "exit", actorId: "unit" },
  ];
  adapter.observe([], [routine]);
  expect(played()).not.toContain("alert");
  expect(played()).toContain("unit-trained");

  simulation.buildingActivity = [];
  time(20);
  adapter.observe([], [routine, urgent]);
  expect(played()).toContain("alert");

  calls.length = 0;
  time(30);
  simulation.objectives = [{ id: "goal", status: "complete" }];
  simulation.result = { kind: "victory" };
  adapter.observe([], [routine]);
  expect(played()).toEqual(["victory"]);
});
