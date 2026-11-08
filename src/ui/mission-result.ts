import { isSkirmishResult } from "../simulation/mission-result";
import type { MissionResult } from "../simulation/mission-result";
import type { SkirmishResult } from "../simulation/skirmish";

export const SIMULATION_STOPPED =
  "Simulation stopped. Restart or load a mission from the menu.";

/** Player-facing text and menu actions for a mission result. */
type ResultPresentation = {
  title: string;
  description: string;
  /** Compact top bar line. */
  summary: string;
  /** What the player can do next. */
  directive: string;
  /** Offers continued play. */
  continueLabel?: string;
  canInspect?: boolean;
  /** Why orders are unavailable; absent when play can continue. */
  blocker?: string;
};

const SKIRMISH_VERDICTS: Record<
  SkirmishResult["kind"],
  { title: string; reason: string }
> = {
  victory: {
    title: "Victory",
    reason: "Your opponent has no completed base buildings left.",
  },
  defeat: {
    title: "Defeat",
    reason: "You have no completed base buildings left.",
  },
  draw: {
    title: "Draw",
    reason: "Neither side has completed base buildings left.",
  },
};

export function presentResult(
  result: MissionResult,
  objectiveLabel?: (id: string) => string | undefined,
): ResultPresentation {
  if (isSkirmishResult(result)) {
    const { title, reason } = SKIRMISH_VERDICTS[result.kind];
    return {
      title,
      description: `${reason} The battlefield is frozen for inspection.`,
      summary: title,
      directive:
        "Match ended. Inspect the battlefield, restart, or load a saved match.",
      canInspect: true,
      blocker: "Match ended.",
    };
  }
  if (result.kind === "victory")
    return {
      title: "Victory",
      description:
        "All victory objectives are complete. Continue exploring in free play, or restart the mission.",
      summary: "Victory · free play",
      directive: "Victory secured. Continue exploring in free play.",
      continueLabel: "Continue free play",
    };
  const objective = objectiveLabel?.(result.objectiveId);
  return {
    title: "Defeat",
    description: objective
      ? `Objective failed: ${objective}. The mission is paused.`
      : "A mandatory objective failed. The mission is paused.",
    summary: "Mission failed",
    directive: "Mission ended in defeat. Restart or load a saved mission.",
    blocker: "Mission ended in defeat.",
  };
}
