import { currentContentPack } from "../../src/content/packs";

/** The bundled base content, as tests author missions from it. */
export const BASE_CONTENT = currentContentPack("base");
export const ARC_ACTOR_DEFINITIONS = BASE_CONTENT.actors.filter(
  ({ faction }) => faction === "arc",
);
export const MOVEMENT_PROFILES = BASE_CONTENT.movementProfiles;
/** The standard ARC skirmish profile's tuning, for concern contexts. */
export const ARC_AI_TUNING = BASE_CONTENT.aiProfiles!.find(
  ({ id }) => id === "arc-skirmish",
)!.tuning;
