import { createBarracksDetails } from "./barracks";
import { createCommandCenterDetails } from "./command-center";
import { createHarvesterAppearance } from "./harvester";
import { createRefineryDetails } from "./refinery";
import { createWolfAppearance } from "./wolf";

import type { Scene } from "@babylonjs/core";
import type { ActorAppearance } from "./actor";
import type { TilePlacedActorDetailsFactory } from "./tile-placed-actor-view";

export type BuiltinModelOptions = {
  scale?: number;
  reducedMotion: () => boolean;
};

/** Procedural stand-ins that content names by ID until assets replace them. */
export const BUILTIN_ACTOR_MODELS: Readonly<
  Record<
    string,
    (scene: Scene, options: BuiltinModelOptions) => ActorAppearance
  >
> = {
  harvester: (scene, { reducedMotion, scale }) =>
    createHarvesterAppearance(scene, reducedMotion, scale),
  wolf: (scene, { reducedMotion, scale }) =>
    createWolfAppearance(scene, reducedMotion, scale),
};

/** Articulated building parts that content names by ID. */
export const BUILTIN_BUILDING_DETAILS: Readonly<
  Record<string, TilePlacedActorDetailsFactory>
> = {
  barracks: createBarracksDetails,
  "command-center": createCommandCenterDetails,
  refinery: createRefineryDetails,
};
