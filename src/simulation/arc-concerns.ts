// ARC build plan: Materials income and army producers.
import { compareIds } from "./actor";
import {
  affords,
  armyProducer,
  definitionOf,
  headquarters,
  isOnline,
  isUsable,
  ownBuildings,
  place,
  rosterBuildings,
  stepToward,
  train,
} from "./ai-planning";
import { refineryOccupied } from "./production";
import { distance } from "./world";

import type { ActorDefinition } from "./actor";
import type { AiConcern, AiConcernContext } from "./director";
import type { TerrainView } from "./terrain";
import type { WorldPosition } from "./world";

/** Initial tuning: Refineries once the base is established. */
const DEVELOPING_REFINERIES = 3;
/** Initial tuning: a second producer once income reaches this many workers. */
const SECOND_PRODUCER_WORKERS = 3;

/**
 * Sighted sites last seen with Materials, nearest to `point` first. Gather
 * orders need explored sites, so unscouted deposits wait for scouting.
 */
function sitesNear(
  context: AiConcernContext,
  terrain: TerrainView,
  point: WorldPosition,
) {
  return (context.view.economy()?.sites ?? [])
    .filter((site) => site.remainingMaterials > 0)
    .map((site) => ({
      site,
      position: terrain.tileCenter(site.tile.x, site.tile.z),
    }))
    .sort(
      (a, b) =>
        distance(point, a.position) - distance(point, b.position) ||
        compareIds(a.site.id, b.site.id),
    );
}

/** Postures that build only the essential base, before growing it. */
const restoring = ({ posture }: AiConcernContext) =>
  posture === "establishing" || posture === "recovering";

const harvesterOf = (context: AiConcernContext, refinery: ActorDefinition) =>
  context.definitions.get(refinery.refinery!.harvesterDefinitionId)!;

/**
 * Builds Refineries beside known Materials, staffs each with a Harvester, and
 * keeps Harvesters gathering. Establishing and recovering keep one Refinery;
 * other postures grow to several. Savings return to the pool once every Refinery is staffed.
 * Harvesters of offline Refineries move to open ones.
 */
export const arcIncome: AiConcern = (context) => {
  const { terrain } = context;
  const economy = context.view.economy();
  if (!economy || !terrain) return;
  const refineries = ownBuildings(
    context,
    (definition) => !!definition.refinery,
  ).filter((refinery) => isOnline(context, refinery));
  // Planning reads committed state, so reserve assignments within this turn.
  const occupied = new Set(
    refineries
      .filter(({ id }) => refineryOccupied(economy, id))
      .map(({ id }) => id),
  );
  let unstaffed = false;
  for (const worker of [...economy.harvesters].sort((a, b) =>
    compareIds(a.actorId, b.actorId),
  )) {
    if (!refineries.some(({ id }) => id === worker.refineryId)) {
      const open = refineries.find(
        (refinery) => isUsable(context, refinery) && !occupied.has(refinery.id),
      );
      if (
        open &&
        context.issue({
          kind: "assign-refinery",
          actorId: worker.actorId,
          refineryId: open.id,
        })
      )
        occupied.add(open.id);
      else unstaffed = true;
    } else if (worker.phase === "idle" || worker.phase === "depleted") {
      const refinery = refineries.find(({ id }) => id === worker.refineryId);
      const [nearest] = refinery
        ? sitesNear(context, terrain, refinery.worldPosition)
        : [];
      if (nearest)
        context.issue({
          kind: "gather",
          actorId: worker.actorId,
          siteId: nearest.site.id,
        });
    }
  }
  for (const refinery of refineries)
    if (
      isUsable(context, refinery) &&
      !occupied.has(refinery.id) &&
      train(
        context,
        refinery,
        harvesterOf(context, definitionOf(context, refinery)),
      )
    )
      occupied.add(refinery.id);
  const wanted = restoring(context) ? 1 : DEVELOPING_REFINERIES;
  if (
    refineries.length >= wanted &&
    refineries.every((refinery) => occupied.has(refinery.id))
  ) {
    context.releaseFunds();
    return;
  }
  const home = headquarters(context);
  const [definition] = rosterBuildings(context, (d) => !!d.refinery);
  if (
    !home ||
    !definition ||
    refineries.length >= wanted ||
    refineries.some((refinery) => refinery.construction) ||
    // Wait until the Refinery can also be staffed, unless a Harvester waits.
    !affords(
      context,
      definition,
      ...(unstaffed ? [] : [harvesterOf(context, definition)]),
    )
  )
    return;
  const [target] = sitesNear(context, terrain, home.worldPosition);
  if (target)
    place(
      context,
      terrain,
      definition,
      stepToward(terrain, target.position, home.worldPosition, 3),
    );
};

/**
 * Builds army producers once income exists, away from the Materials. Savings
 * return to the pool once the posture's producers exist.
 */
export const arcProduction: AiConcern = (context) => {
  const { terrain } = context;
  const economy = context.view.economy();
  const home = headquarters(context);
  if (!economy || !home || !terrain) return;
  const army = armyProducer(context);
  const producers = ownBuildings(context, army).filter((producer) =>
    isOnline(context, producer),
  );
  const planned = restoring(context) ? 1 : 2;
  if (producers.length >= planned) {
    context.releaseFunds();
    return;
  }
  const hasIncome =
    economy.harvesters.length > 0 ||
    economy.production.some(
      (job) => context.definitions.get(job.definitionId)?.harvesting,
    );
  // Saves for the second producer until income can sustain it.
  const wanted =
    economy.harvesters.length < SECOND_PRODUCER_WORKERS ? 1 : planned;
  const [definition] = rosterBuildings(context, army);
  if (
    !definition ||
    !hasIncome ||
    producers.length >= wanted ||
    producers.some((producer) => producer.construction)
  )
    return;
  const [site] = sitesNear(context, terrain, home.worldPosition);
  place(
    context,
    terrain,
    definition,
    stepToward(terrain, home.worldPosition, site?.position, -6),
  );
};

export const ARC_CONCERNS: ReadonlyMap<string, AiConcern> = new Map([
  ["arc-income", arcIncome],
  ["arc-production", arcProduction],
]);
