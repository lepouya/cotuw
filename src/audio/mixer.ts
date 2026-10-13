export const AUDIO_BUSES = ["sound", "music"] as const;
export type AudioBus = (typeof AUDIO_BUSES)[number];
export const AUDIO_CHANNELS = ["master", ...AUDIO_BUSES] as const;
type AudioChannel = (typeof AUDIO_CHANNELS)[number];
export type AudioSettings = Record<
  AudioChannel,
  { volume: number; muted: boolean }
>;
export type AudioStatus = "waiting" | "ready" | "blocked" | "unavailable";
export type AudioPlayOptions = {
  bus: AudioBus;
  loop: boolean;
  gain: number;
  pan: number;
};
export type AudioVoice = {
  readonly ended: boolean;
  setMix: (gain: number, pan: number) => void;
  stop: () => void;
};

/** Playback boundary; missing or blocked playback returns no voice. */
export type AudioMixer = {
  now: () => number;
  /** Whether a clip is loaded, even while the device is suspended. */
  isLoaded: (url: string) => boolean;
  preload: (urls: readonly string[]) => void;
  play: (url: string, options: AudioPlayOptions) => AudioVoice | undefined;
  /** Notifies when the device starts or a buffer arrives. */
  onReady: (listener: () => void) => () => void;
};

/** The application-wide device behind the playback boundary. */
export type AudioDevice = AudioMixer & {
  /** Call from trusted input; browsers block audio until then. */
  unlock: () => Promise<void>;
  onStatus: (listener: (status: AudioStatus) => void) => () => void;
  setSettings: (settings: AudioSettings) => void;
  dispose: () => void;
};

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  master: { volume: 0.5, muted: false },
  sound: { volume: 0.7, muted: false },
  music: { volume: 0.4, muted: false },
};

/** Plays nothing, for sessions without an audio device. */
export const SILENT_AUDIO: AudioMixer = {
  now: () => 0,
  isLoaded: () => false,
  preload: () => {},
  play: () => undefined,
  onReady: () => () => {},
};

function holdGain(param: AudioParam, at: number) {
  if (typeof param.cancelAndHoldAtTime === "function") {
    param.cancelAndHoldAtTime(at);
    return;
  }
  // Preserve the current gain when the browser lacks the hold operation.
  const value = param.value;
  param.cancelScheduledValues(at);
  param.setValueAtTime(value, at);
}

export function createAudioMixer({
  createContext = () => new AudioContext(),
  fetchBytes = async (url: string) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Audio file unavailable.");
    return response.arrayBuffer();
  },
} = {}): AudioDevice {
  let context: AudioContext | undefined;
  let channels: Record<AudioChannel, GainNode> | undefined;
  let disposed = false;
  let settings = structuredClone(DEFAULT_AUDIO_SETTINGS);
  let status: AudioStatus = "waiting";
  const requested = new Set<string>();
  // Failed files stay here so repeated input does not refetch them.
  const loading = new Set<string>();
  const buffers = new Map<string, AudioBuffer>();
  const voices = new Map<AudioVoice, () => void>();
  const readyListeners = new Set<() => void>();
  const statusListeners = new Set<(status: AudioStatus) => void>();
  const publish = (next: AudioStatus) => {
    if (next === status) return;
    status = next;
    for (const listener of statusListeners) listener(status);
  };
  const changed = () => {
    for (const listener of readyListeners) listener();
  };
  const load = (url: string) => {
    if (!context || loading.has(url) || disposed) return;
    loading.add(url);
    const device = context;
    void fetchBytes(url)
      .then((bytes) => (disposed ? undefined : device.decodeAudioData(bytes)))
      .then((buffer) => {
        if (disposed || !buffer) return;
        buffers.set(url, buffer);
        changed();
      })
      .catch(() => {
        if (!disposed) publish("unavailable");
      });
  };
  const setSettings = (next: AudioSettings) => {
    if (disposed) return;
    settings = structuredClone(next);
    if (!context || !channels) return;
    for (const channel of AUDIO_CHANNELS) {
      const { muted, volume } = settings[channel];
      channels[channel].gain.setTargetAtTime(
        muted ? 0 : volume,
        context.currentTime,
        0.02,
      );
    }
  };
  const subscribe = <T>(listeners: Set<T>, listener: T) => {
    if (disposed) return () => {};
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  return {
    now: () => context?.currentTime ?? 0,
    isLoaded: (url) => !disposed && buffers.has(url),
    preload: (urls) => {
      if (disposed) return;
      for (const url of urls) {
        requested.add(url);
        load(url);
      }
    },
    unlock: async () => {
      if (disposed || context?.state === "running") return;
      try {
        if (!context) {
          const device = createContext();
          const nodes: GainNode[] = [];
          try {
            const gains = Object.fromEntries(
              AUDIO_CHANNELS.map((channel) => {
                const node = device.createGain();
                nodes.push(node);
                const { muted, volume } = settings[channel];
                node.gain.setValueAtTime(
                  muted ? 0 : volume,
                  device.currentTime,
                );
                return [channel, node];
              }),
            ) as Record<AudioChannel, GainNode>;
            for (const bus of AUDIO_BUSES) gains[bus].connect(gains.master);
            gains.master.connect(device.destination);
            context = device;
            channels = gains;
          } catch (error) {
            for (const node of nodes) node.disconnect();
            void device.close().catch(() => {});
            throw error;
          }
        }
        if (context.state !== "running") await context.resume();
        if (disposed) return;
        if (context.state !== "running") {
          publish("blocked");
          return;
        }
        if (status !== "unavailable") publish("ready");
        for (const url of requested) load(url);
        changed();
      } catch {
        if (!disposed) publish("blocked");
      }
    },
    play: (url, options) => {
      const buffer = buffers.get(url);
      if (
        disposed ||
        !context ||
        !channels ||
        context.state !== "running" ||
        !buffer
      )
        return;
      const nodes: AudioNode[] = [];
      try {
        const device = context;
        const source = device.createBufferSource();
        nodes.push(source);
        const gain = device.createGain();
        nodes.push(gain);
        const fade = device.createGain();
        nodes.push(fade);
        const pan = device.createStereoPanner();
        nodes.push(pan);
        source.buffer = buffer;
        source.loop = options.loop;
        const now = device.currentTime;
        gain.gain.setValueAtTime(options.gain, now);
        // Keep the fade independent of volume updates.
        fade.gain.setValueAtTime(options.loop ? 0 : 1, now);
        if (options.loop) fade.gain.linearRampToValueAtTime(1, now + 0.08);
        pan.pan.setValueAtTime(options.pan, now);
        source
          .connect(gain)
          .connect(fade)
          .connect(pan)
          .connect(channels[options.bus]);
        let ended = false;
        let mixedGain = options.gain;
        let mixedPan = options.pan;
        const voice: AudioVoice = {
          get ended() {
            return ended;
          },
          setMix: (value, position) => {
            if (ended) return;
            if (value !== mixedGain) {
              gain.gain.setTargetAtTime(value, device.currentTime, 0.04);
              mixedGain = value;
            }
            if (position !== mixedPan) {
              pan.pan.setTargetAtTime(position, device.currentTime, 0.04);
              mixedPan = position;
            }
          },
          stop: () => {
            if (ended) return;
            ended = true;
            holdGain(fade.gain, device.currentTime);
            fade.gain.setTargetAtTime(0, device.currentTime, 0.01);
            source.stop(device.currentTime + 0.06);
          },
        };
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          ended = true;
          source.onended = null;
          voices.delete(voice);
          for (const node of nodes) node.disconnect();
        };
        source.onended = release;
        source.start(now);
        voices.set(voice, release);
        return voice;
      } catch {
        for (const node of nodes) node.disconnect();
        publish("unavailable");
        return;
      }
    },
    onReady: (listener) => subscribe(readyListeners, listener),
    onStatus: (listener) => {
      listener(status);
      return subscribe(statusListeners, listener);
    },
    setSettings,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const [voice, release] of voices) {
        voice.stop();
        release();
      }
      readyListeners.clear();
      statusListeners.clear();
      buffers.clear();
      void context?.close().catch(() => {});
    },
  };
}
