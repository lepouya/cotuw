import {
  hasOwn,
  isCount,
  isId,
  isNonnegative,
  isPositive,
  isRecord,
} from "../simulation/validation";

/** All playback shares this voice budget. */
export const AUDIO_VOICE_LIMIT = 24;
const MAX_STEP_DELAY = 60;
const MAX_SEQUENCE_STEPS = AUDIO_VOICE_LIMIT;

export type AudioClip = { url: string; loop: boolean };

export type AudioCue = {
  /** Variants play in rotation; they all loop or all play once. */
  clips: readonly string[];
  gain: number;
  /** Real seconds before a one-shot cue can start again. */
  cooldown: number;
  voices: number;
  priority: number;
  /** World cues fade out at this range; player feedback and music omit it. */
  range?: number;
  /** World gain multiplier for unselected objects; defaults to one. */
  unselectedGain?: number;
};

export type AudioStep = { cue: string; at?: number };

/** Named event sequences and state loops; an empty sequence is silent. */
export type AudioBindings = {
  events?: Readonly<Record<string, readonly AudioStep[]>>;
  loops?: Readonly<Record<string, string | null>>;
};

export type AudioContent = {
  clips: Readonly<Record<string, AudioClip>>;
  cues: Readonly<Record<string, AudioCue>>;
  /** Global player feedback, emitted without an object. */
  events: NonNullable<AudioBindings["events"]>;
  /** Object bindings that apply where a definition names no override. */
  defaults?: AudioBindings;
  music?: { default: string; combat?: string; holdSeconds: number };
};

type Invalid = (problem: string) => Error;

/** Whether a validated cue's clips loop. */
export const cueLoops = (audio: AudioContent, cue: string) =>
  audio.clips[audio.cues[cue]!.clips[0]!]!.loop;

export function validateAudioContent(
  audio: AudioContent,
  invalid: Invalid,
): void {
  if (
    !isRecord(audio) ||
    !isRecord(audio.clips) ||
    !isRecord(audio.cues) ||
    !isRecord(audio.events)
  )
    throw invalid("needs audio clips, cues, and events");
  for (const [id, clip] of Object.entries(audio.clips))
    if (
      !isId(id) ||
      !isRecord(clip) ||
      !isId(clip.url) ||
      typeof clip.loop !== "boolean"
    )
      throw invalid(`gives audio clip "${id}" an invalid URL or loop flag`);
  for (const [id, cue] of Object.entries(audio.cues)) {
    if (
      !isId(id) ||
      !isRecord(cue) ||
      !Array.isArray(cue.clips) ||
      !cue.clips.length ||
      cue.clips.some((clip) => !isId(clip) || !hasOwn(audio.clips, clip)) ||
      new Set(cue.clips.map((clip) => audio.clips[clip]!.loop)).size !== 1
    )
      throw invalid(`gives audio cue "${id}" unknown or mixed loop clips`);
    if (
      !isNonnegative(cue.gain) ||
      cue.gain > 1 ||
      !isNonnegative(cue.cooldown) ||
      !isCount(cue.voices) ||
      cue.voices < 1 ||
      cue.voices > AUDIO_VOICE_LIMIT ||
      !isCount(cue.priority) ||
      (cue.range !== undefined && !isPositive(cue.range)) ||
      (cue.unselectedGain !== undefined &&
        (cue.range === undefined ||
          !isNonnegative(cue.unselectedGain) ||
          cue.unselectedGain > 1))
    )
      throw invalid(`gives audio cue "${id}" an invalid mix policy`);
  }
  validateAudioBindings({ events: audio.events }, audio, invalid, "events");
  if (audio.defaults !== undefined)
    validateAudioBindings(audio.defaults, audio, invalid, "defaults");
  const music = audio.music;
  if (
    music !== undefined &&
    (!isRecord(music) ||
      !isNonnegative(music.holdSeconds) ||
      [music.default, music.combat ?? music.default].some(
        (id) =>
          !isId(id) ||
          !hasOwn(audio.cues, id) ||
          !cueLoops(audio, id) ||
          audio.cues[id]!.range !== undefined,
      ))
  )
    throw invalid("needs looping audio cues without range for music");
}

/** Checks one owner's bindings against the pack's cues. */
export function validateAudioBindings(
  bindings: AudioBindings,
  audio: AudioContent | undefined,
  invalid: Invalid,
  owner: string,
): void {
  if (!audio) throw invalid(`assigns ${owner} audio without audio content`);
  const isCue = (id: unknown, loop: boolean) =>
    isId(id) && hasOwn(audio.cues, id) && cueLoops(audio, id) === loop;
  const validStep = (step: unknown) =>
    isRecord(step) &&
    isCue(step.cue, false) &&
    (step.at === undefined ||
      (isNonnegative(step.at) && step.at <= MAX_STEP_DELAY));
  if (!isRecord(bindings)) throw invalid(`gives ${owner} invalid audio`);
  const { events = {}, loops = {} } = bindings;
  if (
    !isRecord(events) ||
    !isRecord(loops) ||
    Object.entries(events).some(
      ([name, steps]) =>
        !isId(name) ||
        !Array.isArray(steps) ||
        steps.length > MAX_SEQUENCE_STEPS ||
        !steps.every(validStep),
    ) ||
    Object.entries(loops).some(
      ([name, cue]) => !isId(name) || (cue !== null && !isCue(cue, true)),
    )
  )
    throw invalid(`gives ${owner} unknown audio cues or invalid sequences`);
}
