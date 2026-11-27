// Procedural twilight frontier cover art for the title and loading screens.
// Composes modular sky, alpine peaks, mist, faction landmarks, river valley,
// and foreground framing forest into a deterministic PNG.
import { seededRandom } from "./sprite-sheet.ts";
import { renderArcOutpost } from "./title-art/arc-outpost.ts";
import { Canvas, finalizeToPng, Noise2D } from "./title-art/canvas.ts";
import { renderCircleHeartgrove } from "./title-art/circle-heartgrove.ts";
import { renderAlpineBackdrop, renderMistBand } from "./title-art/mountains.ts";
import { renderSky } from "./title-art/sky.ts";
import { renderForegroundForest } from "./title-art/trees.ts";
import {
  renderForegroundOutcrop,
  renderValleyAndRiver,
} from "./title-art/valley-river.ts";

import type { PNG } from "pngjs";

/** Builds the procedural frontier twilight cover art PNG. */
export function buildFrontierTitleArt(): PNG {
  const canvas = new Canvas();
  const noise = new Noise2D(42071);
  const rand = seededRandom(89123);

  // 1. Overcast slate-blue twilight sky with focused warm dusk break.
  renderSky(canvas, noise);

  // 2. Layered alpine mountain ranges, snowfields, forested foothills, and valley mist.
  renderAlpineBackdrop(canvas, noise, rand);

  // 3. Hero faction landmarks: Circle Heartgrove & ARC fortified outpost.
  renderCircleHeartgrove(canvas, noise, rand);
  renderArcOutpost(canvas, noise, rand);

  // 4. Alpine valley meadow, winding whitewater river, boulders, and midground pines.
  renderValleyAndRiver(canvas, noise, rand);

  // Soft low mist hugging the valley floor left of the outpost.
  renderMistBand(
    canvas,
    noise,
    () => 0.61,
    0.055,
    0.22,
    0.55,
    [0.34, 0.46, 0.52],
    0.42,
    29.4,
  );

  // 5. Foreground mossy granite outcrop, ferns, wildflowers, and dark framing pines.
  renderForegroundOutcrop(canvas, noise, rand);
  renderForegroundForest(canvas, noise, rand);

  return finalizeToPng(canvas);
}
