import { defense } from "./ai-defense";
import { trainForces } from "./ai-forces";
import { incomeDefenses } from "./ai-income-defenses";
import { offense } from "./ai-offense";
import { production } from "./ai-production";
import { recoveryFor } from "./ai-recovery";
import { repair } from "./ai-repair";
import { scouting } from "./ai-scouting";
import { ARC_CONCERNS, arcIncomeRestart } from "./arc-concerns";
import { CIRCLE_CONCERNS, circleIncomeRestart } from "./circle-concerns";

import type { AiConcern } from "./director";

/** The concerns content-pack AI profiles may name. */
export const BUILT_IN_AI_CONCERNS: ReadonlyMap<string, AiConcern> = new Map([
  ...ARC_CONCERNS,
  ...CIRCLE_CONCERNS,
  ["defense", defense],
  ["forces", trainForces],
  ["income-defenses", incomeDefenses],
  ["offense", offense],
  ["production", production],
  [
    "recovery",
    recoveryFor(
      new Map([
        ["arc", arcIncomeRestart],
        ["circle", circleIncomeRestart],
      ]),
    ),
  ],
  ["repair", repair],
  ["scouting", scouting],
]);
