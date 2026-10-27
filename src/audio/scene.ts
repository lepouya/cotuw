import { AUDIO_VOICE_LIMIT, musicForFaction } from "../content/audio";
import type {
  AudioBindings,
  AudioContent,
  AudioCue,
  AudioStep,
} from "../content/audio";
import type { AudioMixer, AudioVoice } from "./mixer";
import type { WorldPosition } from "../simulation/world";
import { compareIds } from "../simulation/actor";

const WORLD_LOOP_LIMIT = 12;
const MAX_PAN = 0.8;
const PENDING_STEP_LIMIT = AUDIO_VOICE_LIMIT * 4;
const MAX_STEP_LATENESS_MS = 250;

export type AudioEmitter = {
  id: string;
  definitionId: string;
  position: Readonly<WorldPosition>;
  audible: boolean;
  states: readonly string[];
};

type Playing = {
  voice: AudioVoice;
  cueId: string;
  cue: AudioCue;
  emitterId?: string;
  /** Present for loops the scene keeps alive while they stay desired. */
  loopKey?: string;
};

type Wanted = { cueId: string; emitter?: AudioEmitter; music?: boolean };

type Resolved = {
  events: ReadonlyMap<string, readonly AudioStep[]>;
  loops: ReadonlyMap<string, string | null>;
};

type PendingStep = {
  cue: AudioCue;
  emitterId?: string;
  timer: ReturnType<typeof setTimeout>;
};

/** The lowest-priority item below a priority, which a new cue may replace. */
const lowestBelow = <T extends { cue: AudioCue }>(
  items: Iterable<T>,
  priority: number,
) => {
  let lowest: T | undefined;
  for (const item of items)
    if (
      item.cue.priority < priority &&
      (!lowest || item.cue.priority < lowest.cue.priority)
    )
      lowest = item;
  return lowest;
};

const resolve = (
  bindings: AudioBindings | undefined,
  fallback?: Resolved,
): Resolved => ({
  events: new Map([
    ...(fallback?.events ?? []),
    ...Object.entries(bindings?.events ?? {}),
  ]),
  loops: new Map([
    ...(fallback?.loops ?? []),
    ...Object.entries(bindings?.loops ?? {}),
  ]),
});

/** Named events and states work for actors, props, or future action adapters. */
export function createAudioScene(
  content: AudioContent | undefined,
  bindings: Readonly<Record<string, { audio?: AudioBindings }>>,
  mixer: AudioMixer,
  listener: () => Readonly<WorldPosition>,
  playerFaction?: string,
) {
  const music = musicForFaction(content, playerFaction);
  const cues = new Map(Object.entries(content?.cues ?? {}));
  const global = resolve({ events: content?.events });
  const defaults = resolve(content?.defaults);
  const objects = new Map(
    Object.entries(bindings).map(([id, { audio }]) => [
      id,
      resolve(audio, defaults),
    ]),
  );
  const bindingsOf = (emitter?: AudioEmitter) =>
    emitter ? (objects.get(emitter.definitionId) ?? defaults) : global;
  let emitters = new Map<string, AudioEmitter>();
  let selection = new Set<string>();
  let active = true;
  let disposed = false;
  let musicCue = music?.default;
  const playing: Playing[] = [];
  const pending = new Set<PendingStep>();
  const lastPlay = new Map<string, number>();
  const variants = new Map<string, number>();
  if (content) {
    const usedCues = new Set<string>();
    for (const binding of [global, defaults, ...objects.values()]) {
      for (const steps of binding.events.values())
        for (const step of steps) usedCues.add(step.cue);
      for (const cue of binding.loops.values()) if (cue) usedCues.add(cue);
    }
    if (music) {
      usedCues.add(music.default);
      if (music.combat) usedCues.add(music.combat);
    }
    const urls = new Set<string>();
    for (const id of usedCues)
      for (const clip of cues.get(id)?.clips ?? [])
        urls.add(content.clips[clip]!.url);
    mixer.preload([...urls]);
  }

  /** Nonspatial cues keep their authored gain and center pan. */
  const spatial = (cue: AudioCue, emitter?: AudioEmitter) => {
    if (!emitter || cue.range === undefined) return { gain: cue.gain, pan: 0 };
    const focus = listener();
    const x = emitter.position.x - focus.x;
    const z = emitter.position.z - focus.z;
    const attenuation = Math.max(0, 1 - Math.hypot(x, z) / cue.range);
    return {
      gain:
        cue.gain *
        attenuation ** 2 *
        (selection.has(emitter.id) ? 1 : (cue.unselectedGain ?? 1)),
      pan: Math.max(-MAX_PAN, Math.min(MAX_PAN, x / cue.range)),
    };
  };
  const prune = () => {
    for (let i = playing.length - 1; i >= 0; i--)
      if (playing[i]!.voice.ended) playing.splice(i, 1);
  };
  const start = ({ cueId, emitter, music }: Wanted, loopKey?: string) => {
    const cue = cues.get(cueId);
    if (!content || !cue || disposed) return;
    const world = !!loopKey || cue.range !== undefined;
    if (emitter && ((!active && world) || !emitter.audible)) return;
    const { gain, pan } = spatial(cue, emitter);
    if (!gain) return;
    prune();
    const now = mixer.now();
    if (!loopKey && now - (lastPlay.get(cueId) ?? -Infinity) < cue.cooldown)
      return;
    if (playing.filter((item) => item.cueId === cueId).length >= cue.voices)
      return;
    const full = playing.length >= AUDIO_VOICE_LIMIT;
    // Loops stay; the scene restores them while their state remains.
    const victim = full
      ? lowestBelow(
          playing.filter((item) => !item.loopKey),
          cue.priority,
        )
      : undefined;
    if (full && !victim) return;
    let variant = variants.get(cueId) ?? 0;
    let voice: AudioVoice | undefined;
    // A failed or loading clip must not silence the cue's ready variants.
    for (let attempt = 0; attempt < cue.clips.length; attempt++) {
      const clip = content.clips[cue.clips[variant]!]!;
      variant = (variant + 1) % cue.clips.length;
      if (!mixer.isLoaded(clip.url)) continue;
      voice = mixer.play(clip.url, {
        bus: music ? "music" : "sound",
        loop: clip.loop,
        gain,
        pan,
      });
      if (voice) break;
    }
    if (!voice) return;
    victim?.voice.stop();
    prune();
    variants.set(cueId, variant);
    if (!loopKey) lastPlay.set(cueId, now);
    playing.push({
      voice,
      cueId,
      cue,
      emitterId: world ? emitter?.id : undefined,
      loopKey,
    });
  };
  const cancelStep = (step: PendingStep) => {
    clearTimeout(step.timer);
    pending.delete(step);
  };
  const schedule = (step: AudioStep, emitter?: AudioEmitter) => {
    const cue = cues.get(step.cue);
    if (disposed || !cue || (emitter && !emitter.audible)) return;
    const world = !!emitter && cue.range !== undefined;
    if (world && !active) return;
    if (!step.at) {
      start({ cueId: step.cue, emitter });
      return;
    }
    if (pending.size >= PENDING_STEP_LIMIT) {
      const victim = lowestBelow(pending, cue.priority);
      if (!victim) return;
      cancelStep(victim);
    }
    // Deferred steps acquire voices and cooldowns when due, not at emission.
    const expiresAt = performance.now() + step.at * 1000 + MAX_STEP_LATENESS_MS;
    const task: PendingStep = {
      cue,
      emitterId: world ? emitter!.id : undefined,
      timer: setTimeout(() => {
        pending.delete(task);
        if (performance.now() > expiresAt) return;
        const source = task.emitterId
          ? emitters.get(task.emitterId)
          : undefined;
        if (task.emitterId && !source) return;
        start({ cueId: step.cue, emitter: source });
      }, step.at * 1000),
    };
    pending.add(task);
  };
  /** Selected emitters receive loop slots first, then the nearest others. */
  const desiredLoops = () => {
    const desired = new Map<string, Wanted>();
    if (musicCue) desired.set("music", { cueId: musicCue, music: true });
    if (!active) return desired;
    const focus = listener();
    const audible = [...emitters.values()]
      .filter(
        (emitter) =>
          emitter.audible &&
          emitter.states.some((state) => bindingsOf(emitter).loops.get(state)),
      )
      .map((emitter) => ({
        emitter,
        distance: Math.hypot(
          emitter.position.x - focus.x,
          emitter.position.z - focus.z,
        ),
      }))
      .sort(
        (a, b) =>
          Number(selection.has(b.emitter.id)) -
            Number(selection.has(a.emitter.id)) ||
          a.distance - b.distance ||
          compareIds(a.emitter.id, b.emitter.id),
      );
    let worldLoops = 0;
    const voicesByCue = new Map<string, number>();
    for (const { emitter } of audible) {
      if (worldLoops >= WORLD_LOOP_LIMIT) break;
      for (const state of emitter.states) {
        const cueId = bindingsOf(emitter).loops.get(state);
        const cue = cueId ? cues.get(cueId) : undefined;
        if (!cueId || !cue) continue;
        const count = voicesByCue.get(cueId) ?? 0;
        const key = JSON.stringify([emitter.id, cueId]);
        if (
          desired.has(key) ||
          !cue.clips.some((id) => mixer.isLoaded(content!.clips[id]!.url)) ||
          count >= cue.voices ||
          worldLoops >= WORLD_LOOP_LIMIT ||
          !spatial(cue, emitter).gain
        )
          continue;
        desired.set(key, { cueId, emitter });
        voicesByCue.set(cueId, count + 1);
        worldLoops++;
      }
    }
    return desired;
  };
  const update = () => {
    if (disposed || !content) return;
    prune();
    for (const step of pending)
      if (step.emitterId && (!active || !emitters.get(step.emitterId)?.audible))
        cancelStep(step);
    const desired = desiredLoops();
    for (const item of playing) {
      const emitter = item.emitterId ? emitters.get(item.emitterId) : undefined;
      if (
        (item.loopKey && desired.get(item.loopKey)?.cueId !== item.cueId) ||
        (item.emitterId && (!active || !emitter?.audible))
      )
        item.voice.stop();
      else if (emitter) {
        const mix = spatial(item.cue, emitter);
        if (item.loopKey && !mix.gain) item.voice.stop();
        else item.voice.setMix(mix.gain, mix.pan);
      }
    }
    prune();
    for (const [key, wanted] of desired)
      if (!playing.some((item) => item.loopKey === key)) start(wanted, key);
  };
  const unsubscribe = mixer.onReady(update);
  return {
    /**
     * Plays an object's event, or global feedback without an emitter. Missing
     * assignments are silent; delayed world steps follow their emitter.
     */
    emit: (name: string, emitter?: AudioEmitter) => {
      for (const step of bindingsOf(emitter).events.get(name) ?? [])
        schedule(step, emitter);
    },
    sync: (next: readonly AudioEmitter[]) => {
      if (disposed) return;
      emitters = new Map(next.map((emitter) => [emitter.id, emitter]));
      update();
    },
    /** Selection changes mix levels without waiting for a simulation tick. */
    setSelection: (ids: readonly string[]) => {
      if (disposed) return;
      selection = new Set(ids);
      update();
    },
    /** Inactive scenes keep music but release every world voice. */
    setActive: (next: boolean) => {
      if (next === active) return;
      active = next;
      update();
    },
    setMusic: (combat: boolean) => {
      const next = combat ? (music?.combat ?? music?.default) : music?.default;
      if (next === musicCue) return;
      musicCue = next;
      update();
    },
    /** Follows listener movement and retries loops that could not start. */
    update,
    dispose: () => {
      disposed = true;
      unsubscribe();
      for (const item of playing) item.voice.stop();
      for (const step of pending) cancelStep(step);
      playing.length = 0;
      emitters.clear();
      selection.clear();
    },
  };
}

export type AudioScene = ReturnType<typeof createAudioScene>;
