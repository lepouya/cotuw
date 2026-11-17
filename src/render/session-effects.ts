import { Vector3 } from "@babylonjs/core";
import { weaponReach } from "../simulation/combat";
import { isTilePlacedActor } from "../simulation/placement";
import { BUILDING_BAR_HEIGHT, healthBarOpacity } from "./health-bars";
import { damageSeverity } from "./damage-effects";

import type { ActorAppearance, ActorAnimationState } from "./actor";
import type { DamagedActor } from "./damage-effects";
import type { HealthBar } from "./health-bars";
import type { RegeneratingActor } from "./regeneration-effects";
import type { ServiceEffect } from "./service-effects";
import type { ActorDefinition } from "../simulation/actor";
import type { AttackEvent } from "../simulation/combat";
import type { ObservedActor } from "../simulation/owner-view";
import type { TilePlacedActorState } from "../simulation/placement";
import type { ActorPresentation } from "../content/presentation";
import type { TerrainMap } from "../map";
import type { ServiceActivity } from "../simulation/unit-support";
import type { WorldPosition } from "../simulation/world";

/** Health bars sit this far above unit models and over buildings. */
export const UNIT_BAR_CLEARANCE = 0.3;

export type ExtractedEffects = {
  bars: HealthBar[];
  damaged: DamagedActor[];
  regenerating: RegeneratingActor[];
};

export type EffectContext = {
  definitions: ReadonlyMap<string, ActorDefinition>;
  appearances: ReadonlyMap<string, ActorAppearance>;
  presentationOf: (id: string) => ActorPresentation | undefined;
  groundPositionOf: (id: string) => WorldPosition | undefined;
  buildingTopHeightOf: (actor: TilePlacedActorState) => number | undefined;
  map: Pick<TerrainMap, "heightAtWorldPosition" | "tileSize">;
  completedTicks: number;
  tickSeconds: number;
  selectedActorIds: readonly string[];
};

type DrawnActor = Pick<ObservedActor, "id" | "definitionId" | "tilePlacement">;

/** How high a shown actor is drawn above its ground point. */
function drawnHeight(
  actor: DrawnActor,
  ground: number,
  {
    appearances,
    buildingTopHeightOf,
  }: Pick<EffectContext, "appearances" | "buildingTopHeightOf">,
) {
  return isTilePlacedActor(actor)
    ? (buildingTopHeightOf(actor) ?? ground + 1) - ground
    : (appearances.get(actor.definitionId)?.bounds.height ?? 1);
}

/**
 * Extracts visible health bars, damage effects, and regeneration effects for
 * the committed actors a viewer is shown on the current frame.
 */
export function extractHealthAndDamageEffects(
  actors: readonly ObservedActor[],
  context: EffectContext,
): ExtractedEffects {
  const {
    definitions,
    appearances,
    presentationOf,
    groundPositionOf,
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
    if (!maximum) continue;
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
        height: drawnHeight(actor, ground, context),
        radius,
      });
  }

  return { bars, damaged, regenerating };
}

/** What a shown mobile actor's appearance reflects from committed state. */
export function actorAnimationState(
  actor: ObservedActor,
  gathering: ReadonlySet<string>,
  definitions: ReadonlyMap<string, ActorDefinition>,
  shownTarget: ObservedActor | undefined,
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

export type ShotContext = Pick<
  EffectContext,
  "appearances" | "presentationOf" | "buildingTopHeightOf" | "map"
> & {
  /** Where a building's art is seated; its attack anchor starts there. */
  roofHeightOf: (actor: TilePlacedActorState) => number | undefined;
};

/**
 * A shot leaves the attacker's anchor, turned to its aim, and lands halfway up
 * the target as drawn. An end without a shown actor keeps the default.
 */
export function shotEnds(
  hit: AttackEvent,
  attacker: ObservedActor | undefined,
  target: DrawnActor | undefined,
  context: ShotContext,
): { from?: Vector3; to?: Vector3 } {
  const { map } = context;
  const presentation = context.presentationOf(hit.attackerDefinitionId);
  const anchor =
    presentation?.attackAnchor ?? presentation?.frameEffects?.attack?.anchor;
  let from: Vector3 | undefined;
  if (attacker && anchor) {
    const placed = isTilePlacedActor(attacker);
    const model = presentation?.model;
    const scale = placed
      ? map.tileSize
      : model && "glb" in model
        ? (model.glb.scale ?? 1)
        : (model?.scale ?? 1);
    const [x, y, z] = anchor.map((value) => value * scale) as [
      number,
      number,
      number,
    ];
    const base =
      (placed ? context.roofHeightOf(attacker) : undefined) ??
      map.heightAtWorldPosition(hit.from.x, hit.from.z);
    const heading = attacker.combat?.aimFacing ?? attacker.facing;
    const cos = Math.cos(heading);
    const sin = Math.sin(heading);
    from = new Vector3(
      hit.from.x + x * cos + z * sin,
      base + y,
      hit.from.z + z * cos - x * sin,
    );
  }
  const ground = map.heightAtWorldPosition(hit.to.x, hit.to.z);
  const to =
    target &&
    new Vector3(
      hit.to.x,
      ground + drawnHeight(target, ground, context) / 2,
      hit.to.z,
    );
  return { from, to };
}

/** Service symbols float above each target that a styled provider works on. */
export function extractServiceEffects(
  services: readonly ServiceActivity[],
  shownActor: (id: string) => ObservedActor | undefined,
  {
    appearances,
    presentationOf,
    groundPositionOf,
  }: Pick<EffectContext, "appearances" | "presentationOf" | "groundPositionOf">,
): ServiceEffect[] {
  return services.flatMap(({ providerId, targetId }) => {
    const provider = shownActor(providerId);
    const target = shownActor(targetId);
    const style =
      provider && presentationOf(provider.definitionId)?.serviceEffect;
    if (!target || !style) return [];
    return [
      {
        id: providerId,
        style,
        position: groundPositionOf(targetId) ?? target.worldPosition,
        height:
          (appearances.get(target.definitionId)?.bounds.height ?? 1) +
          UNIT_BAR_CLEARANCE,
      },
    ];
  });
}
