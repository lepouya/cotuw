import { Vector3 } from "@babylonjs/core";
import { weaponReach } from "../simulation/combat";
import { isTilePlacedActor } from "../simulation/placement";
import { healthBarOpacity } from "./health-bars";
import { damageSeverity } from "./damage-effects";

import type { ActorAppearance, ActorAnimationState } from "./actor";
import type { DamagedActor } from "./damage-effects";
import type { HealthBar } from "./health-bars";
import type { RegeneratingActor } from "./regeneration-effects";
import type { ActorDefinition, ActorRenderState } from "../simulation/actor";
import type { ActorPresentation } from "../content/content-pack";
import type { TerrainMap } from "../map";
import type { WorldPosition } from "../simulation/world";

/** Health bars sit this far above unit models and over buildings. */
export const UNIT_BAR_CLEARANCE = 0.3;
/** Clears a construction progress bar below it. */
export const BUILDING_BAR_HEIGHT = 2.9;

export type ExtractedEffects = {
  bars: HealthBar[];
  damaged: DamagedActor[];
  regenerating: RegeneratingActor[];
};

export type EffectContext = {
  definitions: ReadonlyMap<string, ActorDefinition>;
  appearances: ReadonlyMap<string, ActorAppearance>;
  presentationOf: (id: string) => ActorPresentation | undefined;
  shows: (actor: ActorRenderState) => boolean;
  groundPositionOf: (id: string) => WorldPosition | undefined;
  buildingTopHeightOf: (id: string) => number | undefined;
  map: Pick<TerrainMap, "heightAtWorldPosition" | "tileSize">;
  completedTicks: number;
  tickSeconds: number;
  selectedActorIds: readonly string[];
};

/**
 * Extracts visible health bars, damage effects, and regeneration effects for
 * committed actors on the current frame.
 */
export function extractHealthAndDamageEffects(
  actors: readonly ActorRenderState[],
  context: EffectContext,
): ExtractedEffects {
  const {
    definitions,
    appearances,
    presentationOf,
    shows,
    groundPositionOf,
    buildingTopHeightOf,
    map,
    completedTicks,
    tickSeconds,
    selectedActorIds,
  } = context;

  const selected = new Set(selectedActorIds);
  const bars: HealthBar[] = [];
  const damaged: DamagedActor[] = [];
  const regenerating: RegeneratingActor[] = [];

  for (const actor of actors) {
    const maximum = definitions.get(actor.definitionId)?.health;
    if (!maximum || !shows(actor)) continue;
    const fraction = (actor.health ?? maximum) / maximum;
    const placed = isTilePlacedActor(actor);
    const worldPosition = placed
      ? actor.worldPosition
      : (groundPositionOf(actor.id) ?? actor.worldPosition);
    const bounds = appearances.get(actor.definitionId)?.bounds;
    const activeTick = actor.combat?.activeTick;
    const opacity = healthBarOpacity(
      selected.has(actor.id),
      activeTick === undefined
        ? Infinity
        : (completedTicks - activeTick) * tickSeconds,
    );
    if (opacity > 0)
      bars.push({
        actorId: actor.id,
        worldPosition,
        height: placed
          ? BUILDING_BAR_HEIGHT
          : (bounds?.height ?? 1) + UNIT_BAR_CLEARANCE,
        width: placed ? 2 : 0.9,
        fraction,
        opacity,
      });
    const presentation = presentationOf(actor.definitionId);
    const style = presentation?.damageEffect;
    const severity = damageSeverity(fraction);
    const healing =
      presentation?.regenerationEffect &&
      actor.territory?.mode === "regenerating";
    if (!(style && severity) && !healing) continue;
    const { x, z } = worldPosition;
    const ground = map.heightAtWorldPosition(x, z);
    const position = new Vector3(x, ground, z);
    const footprint = definitions.get(actor.definitionId)?.footprint;
    const radius = footprint
      ? (Math.sqrt(footprint.occupiedTiles.length) * map.tileSize) / 2
      : (bounds?.radius ?? 0.5);
    if (healing) regenerating.push({ id: actor.id, position, radius });
    if (style && severity)
      damaged.push({
        id: actor.id,
        style,
        severity,
        position,
        height: placed
          ? (buildingTopHeightOf(actor.id) ?? ground + 1) - ground
          : (bounds?.height ?? 1),
        radius,
      });
  }

  return { bars, damaged, regenerating };
}

/** What a shown mobile actor's appearance reflects from committed state. */
export function actorAnimationState(
  actor: ActorRenderState,
  gathering: ReadonlySet<string>,
  definitions: ReadonlyMap<string, ActorDefinition>,
  shownTarget: ActorRenderState | undefined,
  map: TerrainMap,
): ActorAnimationState {
  const weapon = definitions.get(actor.definitionId)?.weapon;
  return {
    working: gathering.has(actor.id),
    aiming:
      !!weapon &&
      !!shownTarget &&
      weaponReach(actor, shownTarget, definitions, map) <= weapon.range,
    running: actor.territory?.mode === "pursuing",
  };
}
