import { currentContentPack } from "../../src/content/packs";

/** The bundled base content, as tests author missions from it. */
export const BASE_CONTENT = currentContentPack("base");
export const ARC_ACTOR_DEFINITIONS = BASE_CONTENT.actors.filter(
  ({ faction }) => faction === "arc",
);
export const MOVEMENT_PROFILES = BASE_CONTENT.movementProfiles;
