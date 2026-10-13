import { expect, test, vi } from "vitest";
import { createAudioMixer, DEFAULT_AUDIO_SETTINGS } from "../src/audio/mixer";

function device() {
  const param = () => ({
    setTargetAtTime: vi.fn(),
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    cancelAndHoldAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  });
  const node = () => ({
    connect: vi.fn((destination: unknown) => destination),
    disconnect: vi.fn(),
  });
  const gains: ReturnType<typeof gain>[] = [];
  const sources: ReturnType<typeof source>[] = [];
  const pans: ReturnType<typeof pan>[] = [];
  function gain(): ReturnType<typeof node> & {
    gain: ReturnType<typeof param>;
  } {
    const value = { ...node(), gain: param() };
    gains.push(value);
    return value;
  }
  function pan(): ReturnType<typeof node> & { pan: ReturnType<typeof param> } {
    const value = { ...node(), pan: param() };
    pans.push(value);
    return value;
  }
  function source(): ReturnType<typeof node> & {
    buffer: null;
    loop: boolean;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    onended: (() => void) | null;
  } {
    const value = {
      ...node(),
      buffer: null,
      loop: false,
      start: vi.fn(),
      stop: vi.fn(),
      onended: null as (() => void) | null,
    };
    sources.push(value);
    return value;
  }
  const context = {
    currentTime: 7,
    state: "suspended",
    destination: {},
    createGain: vi.fn(gain),
    createStereoPanner: vi.fn(pan),
    createBufferSource: vi.fn(source),
    decodeAudioData: vi.fn(async () => ({ duration: 4 })),
    resume: vi.fn(async () => {
      context.state = "running";
    }),
    close: vi.fn(async () => {
      context.state = "closed";
    }),
  };
  const createContext = vi.fn(() => context as unknown as AudioContext);
  const fetchBytes = vi.fn(async () => new ArrayBuffer(4));
  return { context, createContext, fetchBytes, gains, sources, pans };
}
const options = {
  bus: "sound" as const,
  loop: true,
  gain: 0.5,
  pan: 0.2,
};
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

test("master controls both buses, preserves their levels, and initializes saved settings", async () => {
  const backend = device();
  const mixer = createAudioMixer(backend);
  const settings = structuredClone(DEFAULT_AUDIO_SETTINGS);
  settings.master = { volume: 0.25, muted: false };
  mixer.setSettings(settings);
  await mixer.unlock();
  const [master, sound, music] = backend.gains;
  expect(master!.gain.setValueAtTime).toHaveBeenCalledWith(0.25, 7);
  expect(master!.connect).toHaveBeenCalledWith(backend.context.destination);
  expect(sound!.connect).toHaveBeenCalledWith(master);
  expect(music!.connect).toHaveBeenCalledWith(master);
  expect(sound!.gain.setValueAtTime).toHaveBeenCalledWith(0.7, 7);
  expect(music!.gain.setValueAtTime).toHaveBeenCalledWith(0.4, 7);
  settings.master.muted = true;
  mixer.setSettings(settings);
  expect(master!.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 7, 0.02);
  settings.master.muted = false;
  mixer.setSettings(settings);
  expect(master!.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.25, 7, 0.02);
  expect(sound!.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.7, 7, 0.02);
  expect(music!.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.4, 7, 0.02);
  mixer.dispose();
});

test("audio stays lazy until a gesture, decodes once, and routes independent buses", async () => {
  const backend = device();
  const mixer = createAudioMixer(backend);
  mixer.preload(["engine", "engine"]);
  expect(backend.createContext).not.toHaveBeenCalled();
  expect(backend.fetchBytes).not.toHaveBeenCalled();
  expect(mixer.isLoaded("engine")).toBe(false);
  expect(mixer.play("engine", options)).toBeUndefined();
  await mixer.unlock();
  await flush();
  mixer.preload(["engine"]);
  expect(backend.fetchBytes).toHaveBeenCalledTimes(1);
  expect(backend.context.decodeAudioData).toHaveBeenCalledTimes(1);
  expect(mixer.isLoaded("engine")).toBe(true);
  backend.context.state = "suspended";
  expect(mixer.isLoaded("engine")).toBe(true);
  await mixer.unlock();
  mixer.setSettings({
    master: { volume: 0.5, muted: false },
    sound: { volume: 0.3, muted: true },
    music: { volume: 0.2, muted: false },
  });
  expect(backend.gains[1]!.gain.setTargetAtTime).toHaveBeenLastCalledWith(
    0,
    7,
    0.02,
  );
  expect(backend.gains[2]!.gain.setTargetAtTime).toHaveBeenLastCalledWith(
    0.2,
    7,
    0.02,
  );
  const voice = mixer.play("engine", options)!;
  expect(backend.sources[0]!.start).toHaveBeenCalledWith(7);
  expect(backend.sources[0]!.loop).toBe(true);
  expect(backend.gains[4]!.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
    1,
    7.08,
  );
  expect(backend.pans[0]!.connect).toHaveBeenCalledWith(backend.gains[1]);
  voice.setMix(0.1, -0.4);
  expect(backend.pans[0]!.pan.setTargetAtTime).toHaveBeenCalledWith(
    -0.4,
    7,
    0.04,
  );
  backend.context.currentTime = 9.04;
  voice.stop();
  voice.stop();
  expect(voice.ended).toBe(true);
  expect(backend.sources[0]!.stop).toHaveBeenCalledTimes(1);
  backend.sources[0]!.onended!();
  expect(backend.sources[0]!.disconnect).toHaveBeenCalledOnce();
  expect(backend.gains[3]!.disconnect).toHaveBeenCalledOnce();
  expect(backend.gains[4]!.disconnect).toHaveBeenCalledOnce();
  expect(backend.pans[0]!.disconnect).toHaveBeenCalledOnce();
  mixer.dispose();
  expect(backend.context.close).toHaveBeenCalledOnce();
  expect(mixer.isLoaded("engine")).toBe(false);
  expect(mixer.play("engine", options)).toBeUndefined();
});

test("blocked resume can retry and failed files do not prevent other playback", async () => {
  const backend = device();
  backend.context.resume.mockRejectedValueOnce(new Error("blocked"));
  backend.fetchBytes.mockRejectedValueOnce(new Error("missing"));
  const mixer = createAudioMixer(backend);
  const status = vi.fn();
  mixer.onStatus(status);
  mixer.preload(["missing", "engine"]);
  await mixer.unlock();
  expect(status).toHaveBeenLastCalledWith("blocked");
  await mixer.unlock();
  await flush();
  expect(status).toHaveBeenCalledWith("unavailable");
  expect(mixer.play("missing", options)).toBeUndefined();
  expect(mixer.isLoaded("missing")).toBe(false);
  expect(mixer.play("engine", options)).toBeDefined();
  mixer.dispose();
});

test("late decodes after disposal do not notify or restore playback", async () => {
  const backend = device();
  let finish!: (buffer: ArrayBuffer) => void;
  backend.fetchBytes.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const mixer = createAudioMixer(backend);
  const ready = vi.fn();
  mixer.onReady(ready);
  mixer.preload(["engine"]);
  await mixer.unlock();
  ready.mockClear();
  mixer.dispose();
  finish(new ArrayBuffer(4));
  await flush();
  expect(ready).not.toHaveBeenCalled();
  expect(backend.context.decodeAudioData).not.toHaveBeenCalled();
  expect(mixer.play("engine", options)).toBeUndefined();
});

test("failed source startup disconnects allocated nodes and reports unavailable", async () => {
  const backend = device();
  const mixer = createAudioMixer(backend);
  mixer.preload(["engine"]);
  await mixer.unlock();
  await flush();
  const original = backend.context.createBufferSource.getMockImplementation()!;
  backend.context.createBufferSource.mockImplementation(() => {
    const source = original();
    source.start.mockImplementation(() => {
      throw new Error("Device lost");
    });
    return source;
  });
  const status = vi.fn();
  mixer.onStatus(status);
  expect(mixer.play("engine", options)).toBeUndefined();
  expect(status).toHaveBeenLastCalledWith("unavailable");
  expect(backend.sources[0]!.disconnect).toHaveBeenCalledOnce();
  expect(backend.gains[3]!.disconnect).toHaveBeenCalledOnce();
  expect(backend.gains[4]!.disconnect).toHaveBeenCalledOnce();
  expect(backend.pans[0]!.disconnect).toHaveBeenCalledOnce();
  mixer.dispose();
});

test("partial context initialization closes its resources and can retry", async () => {
  const broken = device();
  const healthy = device();
  broken.context.createGain
    .mockImplementationOnce(broken.context.createGain.getMockImplementation()!)
    .mockImplementationOnce(() => {
      throw new Error("Device unavailable");
    });
  const createContext = vi
    .fn()
    .mockReturnValueOnce(broken.context)
    .mockReturnValue(healthy.context);
  const mixer = createAudioMixer({
    createContext,
    fetchBytes: healthy.fetchBytes,
  });
  const status = vi.fn();
  mixer.onStatus(status);
  mixer.preload(["engine"]);
  await mixer.unlock();
  expect(status).toHaveBeenLastCalledWith("blocked");
  expect(broken.context.close).toHaveBeenCalledOnce();
  expect(broken.gains[0]!.disconnect).toHaveBeenCalledOnce();
  await mixer.unlock();
  await flush();
  expect(status).toHaveBeenLastCalledWith("ready");
  expect(mixer.play("engine", options)).toBeDefined();
  mixer.dispose();
});

test("unchanged mixes preserve the fade and do not accumulate automation", async () => {
  const backend = device();
  const mixer = createAudioMixer(backend);
  mixer.preload(["engine"]);
  await mixer.unlock();
  await flush();
  const voice = mixer.play("engine", options)!;
  for (let i = 0; i < 100; i++) voice.setMix(options.gain, options.pan);
  expect(backend.gains[3]!.gain.setTargetAtTime).not.toHaveBeenCalled();
  expect(backend.pans[0]!.pan.setTargetAtTime).not.toHaveBeenCalled();
  voice.setMix(0.1, options.pan);
  expect(backend.gains[4]!.gain.cancelAndHoldAtTime).not.toHaveBeenCalled();
  expect(backend.pans[0]!.pan.setTargetAtTime).not.toHaveBeenCalled();
  backend.context.currentTime = 9.04;
  voice.stop();
  expect(backend.gains[4]!.gain.cancelAndHoldAtTime).toHaveBeenCalledWith(9.04);
  mixer.dispose();
});

test("device disposal disconnects fading voices without waiting for ended events", async () => {
  const backend = device();
  const mixer = createAudioMixer(backend);
  mixer.preload(["engine"]);
  await mixer.unlock();
  await flush();
  const voice = mixer.play("engine", options)!;
  backend.context.currentTime = 9.04;
  voice.stop();
  mixer.dispose();
  mixer.dispose();
  expect(backend.sources[0]!.disconnect).toHaveBeenCalledOnce();
  expect(backend.gains[3]!.disconnect).toHaveBeenCalledOnce();
  expect(backend.gains[4]!.disconnect).toHaveBeenCalledOnce();
  expect(backend.pans[0]!.disconnect).toHaveBeenCalledOnce();
  expect(backend.context.close).toHaveBeenCalledOnce();
});

test("gain holds also work on devices without cancelAndHoldAtTime", async () => {
  const backend = device();
  const mixer = createAudioMixer(backend);
  mixer.preload(["engine"]);
  await mixer.unlock();
  await flush();
  const voice = mixer.play("engine", options)!;
  const param = backend.gains[4]!.gain;
  backend.context.currentTime = 9.04;
  Reflect.set(param, "cancelAndHoldAtTime", undefined);
  Reflect.set(param, "value", 0.25);
  voice.setMix(0.1, options.pan);
  expect(() => voice.stop()).not.toThrow();
  expect(param.cancelScheduledValues).toHaveBeenLastCalledWith(9.04);
  expect(param.setValueAtTime).toHaveBeenLastCalledWith(0.25, 9.04);
  mixer.dispose();
});
