import { evaluateObjectives } from "./simulation/objectives";
import { formatElapsed } from "./ui/top-bar";

import type { MissionFile, SavePolicy } from "./simulation/mission-file";
import type { MissionResult, ObjectiveView } from "./simulation/objectives";

const CHECKPOINT_SECONDS = 5 * 60;

type MissionStatus = { faulted: boolean; result?: MissionResult };
type PolicyMission = Pick<MissionFile, "scenario" | "state" | "save">;

/**
 * One mission's save rules. Autosave methods return the autosave name when
 * one is due.
 */
export type SaveRules = {
  canSave: (status: MissionStatus) => boolean;
  /** Due once the mission has started and any opening menu is shown. */
  atStart: () => string | undefined;
  afterTick: (tick: number, result?: MissionResult) => string | undefined;
  onObjectives: (objectives: readonly ObjectiveView[]) => string | undefined;
};

const none = () => undefined;

const POLICIES: Record<
  SavePolicy,
  (mission: PolicyMission, tickSeconds: number) => SaveRules
> = {
  objectives: (mission) => {
    // Only completions after the mission starts autosave.
    const completed = new Set(
      evaluateObjectives(
        mission.scenario.objectives ?? [],
        mission.state.objectives,
      )
        .views.filter(({ status }) => status === "complete")
        .map(({ id }) => id),
    );
    return {
      // Rolling saves would otherwise replace good progress with a lost mission.
      canSave: ({ faulted, result }) => !faulted && result?.kind !== "defeat",
      atStart: none,
      afterTick: none,
      onObjectives: (objectives) => {
        const fresh = objectives.filter(
          ({ id, status }) => status === "complete" && !completed.has(id),
        );
        for (const { id } of fresh) completed.add(id);
        return fresh.length
          ? `Autosave: ${fresh[fresh.length - 1].label}`
          : undefined;
      },
    };
  },
  skirmish: (mission, tickSeconds) => {
    const checkpointTicks = Math.round(CHECKPOINT_SECONDS / tickSeconds);
    const decided = !!evaluateObjectives(
      mission.scenario.objectives ?? [],
      mission.state.objectives,
    ).result;
    return {
      canSave: ({ faulted }) => !faulted,
      // A loaded save is not a fresh match start.
      atStart: () =>
        mission.state.tick === 0 && !mission.save && !decided
          ? "Autosave: Match start"
          : undefined,
      // A tick that ends the match keeps the previous checkpoint.
      afterTick: (tick, result) =>
        !result && tick > 0 && tick % checkpointTicks === 0
          ? `Autosave: ${formatElapsed(tick * tickSeconds)}`
          : undefined,
      onObjectives: none,
    };
  },
};

/** The rules of the mission's scenario save policy, objectives by default. */
export function createSaveRules(
  mission: PolicyMission,
  tickSeconds: number,
): SaveRules {
  return POLICIES[mission.scenario.savePolicy ?? "objectives"](
    mission,
    tickSeconds,
  );
}
