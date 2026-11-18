import { defense } from "./ai-defense";
import { trainForces } from "./ai-forces";
import { offense } from "./ai-offense";
import { recovery } from "./ai-recovery";
import { repair } from "./ai-repair";
import { scouting } from "./ai-scouting";
import { ARC_CONCERNS } from "./arc-concerns";

import type { AiConcern } from "./director";

/** The concerns content-pack AI profiles may name. */
export const BUILT_IN_AI_CONCERNS: ReadonlyMap<string, AiConcern> = new Map([
  ...ARC_CONCERNS,
  ["defense", defense],
  ["forces", trainForces],
  ["offense", offense],
  ["recovery", recovery],
  ["repair", repair],
  ["scouting", scouting],
]);
