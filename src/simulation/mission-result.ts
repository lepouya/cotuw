import type { ObjectiveResult } from "./objectives";
import type { SkirmishResult } from "./skirmish";

export type MissionResult = ObjectiveResult | SkirmishResult;

export const isSkirmishResult = (
  result: MissionResult,
): result is SkirmishResult => "eliminatedOwners" in result;

/** Campaign victories allow free play; skirmish verdicts always end play. */
export const missionEnded = (result: MissionResult | undefined): boolean =>
  !!result && (result.kind === "defeat" || isSkirmishResult(result));
