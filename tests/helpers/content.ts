import { currentContentPack } from "../../src/content/packs";

/** The bundled base content, as tests author missions from it. */
export const BASE_CONTENT = currentContentPack("base");
export const ARC_ACTOR_DEFINITIONS = BASE_CONTENT.actors.filter(
  ({ faction }) => faction === "arc",
);
export const MOVEMENT_PROFILES = BASE_CONTENT.movementProfiles;
const { plans, ...sharedTuning } = BASE_CONTENT.aiProfiles!.find(
  ({ id }) => id === "arc-skirmish",
)!.tuning;
/**
 * The standard ARC skirmish profile's shared tuning, for concern contexts and
 * test profiles. Profiles must list a concern to carry its plan.
 */
export const ARC_AI_TUNING = sharedTuning;
/** The standard ARC skirmish profile's plan sections, by concern. */
export const ARC_AI_PLANS = plans!;
