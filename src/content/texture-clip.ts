// Texture clip data and timing, independent of rendering and simulation.
import {
  isCount,
  isOneOf,
  isPositive,
  isRecord,
} from "../simulation/validation";

export const CLIP_PLAYBACK_MODES = ["loop", "ping-pong", "once"] as const;
export type ClipPlayback = (typeof CLIP_PLAYBACK_MODES)[number];

/** A frame sequence over a sprite sheet laid out as a grid of equal cells. */
export type TextureClip = {
  columns: number;
  rows: number;
  /** Cells in play order, numbered row by row from the top left. */
  frames: readonly { cell: number; seconds: number }[];
  /** Ping-pong plays back without repeating the end frames; once holds the last. */
  playback: ClipPlayback;
};

/** Throws when a clip's layout, frames, or playback mode is invalid. */
export function validateTextureClip(id: string, clip: unknown): void {
  const invalid = () => new RangeError(`Texture clip "${id}" is invalid.`);
  if (
    !isRecord(clip) ||
    !isCount(clip.columns) ||
    !isCount(clip.rows) ||
    clip.columns === 0 ||
    clip.rows === 0 ||
    !isOneOf(CLIP_PLAYBACK_MODES, clip.playback) ||
    !Array.isArray(clip.frames) ||
    clip.frames.length === 0
  )
    throw invalid();
  const cells = clip.columns * clip.rows;
  if (!Number.isSafeInteger(cells)) throw invalid();
  for (const frame of clip.frames)
    if (
      !isRecord(frame) ||
      !isCount(frame.cell) ||
      frame.cell >= cells ||
      !isPositive(frame.seconds)
    )
      throw invalid();
  if (!Number.isFinite(clipDuration(clip as TextureClip))) throw invalid();
}

/** Frame indices in the order one cycle plays them. */
function playOrder({ frames, playback }: TextureClip): number[] {
  const forward = frames.map((_, index) => index);
  return playback === "ping-pong"
    ? [...forward, ...forward.slice(1, -1).reverse()]
    : forward;
}

/** Compiles timing once so playback allocates nothing per rendered frame. */
export function compileTextureClip(clip: TextureClip) {
  const order = playOrder(clip);
  let duration = 0;
  const ends = order.map((index) => (duration += clip.frames[index]!.seconds));
  const frameAt = (seconds: number): number => {
    if (clip.playback === "once" && seconds >= duration)
      return order[order.length - 1]!;
    const wrapped = seconds % duration;
    const time =
      clip.playback === "once"
        ? Math.max(seconds, 0)
        : wrapped < 0
          ? wrapped + duration
          : wrapped;
    let low = 0;
    let high = ends.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (time < ends[middle]!) high = middle;
      else low = middle + 1;
    }
    return order[low]!;
  };
  return { duration, frameAt };
}

/** Seconds in one cycle, including the last frame's hold. */
export function clipDuration(clip: TextureClip): number {
  return compileTextureClip(clip).duration;
}

/** The index into `clip.frames` showing `seconds` after playback started. */
export function clipFrameAt(clip: TextureClip, seconds: number): number {
  return compileTextureClip(clip).frameAt(seconds);
}

/** A cell's pixel rectangle in a sheet of the given size. */
export function clipCellRect(
  clip: Pick<TextureClip, "columns" | "rows">,
  cell: number,
  sheet: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const width = sheet.width / clip.columns;
  const height = sheet.height / clip.rows;
  return {
    x: (cell % clip.columns) * width,
    y: Math.floor(cell / clip.columns) * height,
    width,
    height,
  };
}
