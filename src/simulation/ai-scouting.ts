// Faction-neutral scouting: finds authored sites and refreshes stale reports.
import { compareIds, healthOf, isScoutUnit } from "./actor";
import {
  definitionOf,
  headquarters,
  isAvoided,
  isAvoidedList,
  isStaleReport,
  recentAvoided,
  rosterBuildings,
  staleReportTicks,
  train,
  usableBuildings,
} from "./ai-planning";
import { secondsToTicks } from "./clock";
import { tileKey } from "./grid";
import {
  hasOwn,
  isCount,
  isId,
  isNonnegative,
  isOneOf,
  isRecord,
} from "./validation";
import { distance, isFinitePosition } from "./world";

import type { Avoided } from "./ai-planning";
import type { AiConcern, AiConcernContext } from "./director";
import type { ActorRenderState } from "./actor";
import type { TileCoord } from "./grid";
import type { TerrainView } from "./terrain";
import type { WorldPosition } from "./world";

/** Initial tuning: the wait before replacing a lost scout. */
export const SCOUT_REPLACEMENT_SECONDS = 60;
/** Tiles around danger or an unreachable target that scouting skips a while. */
const AVOID_TILES = 10;
/** A failed retreat waits before trying the home route again. */
const RETREAT_RETRY_SECONDS = 5;
/** Initial tuning: spacing of the map points an otherwise idle scout sweeps. */
const SWEEP_TILES = 20;

/** A place worth seeing: never sighted, or last seen at `tick`. */
type Report = {
  kind: "site" | "building" | "area";
  id: string;
  position: WorldPosition;
  tick?: number;
};

type ScoutGoal = (
  | Pick<Report, "kind" | "id" | "position">
  | { kind: "retreat"; position: WorldPosition }
) & { issued?: true; retryTick?: number };

export type ScoutMemory = {
  /** The scout alive or in production. */
  scoutId?: string;
  goal?: ScoutGoal;
  /** Last-seen health, to notice new damage; absent while undamaged. */
  health?: number;
  /** No replacement trains before this tick. */
  replaceTick?: number;
  /** Where the scout met damage or could not reach, and when. */
  avoid?: Avoided[];
  /** When each sweep point, by tile key, was last in view. */
  swept?: Record<string, number>;
};

/** The scout unit with the widest vision that a roster producer trains. */
function scoutDefinition(context: AiConcernContext) {
  return rosterBuildings(context, (definition) => !!definition.production)
    .flatMap((producer) =>
      producer.production!.unitDefinitionIds.flatMap((id) => {
        const unit = context.definitions.get(id);
        return unit && isScoutUnit(unit) ? [unit] : [];
      }),
    )
    .sort(
      (a, b) => b.vision!.radius - a.vision!.radius || compareIds(a.id, b.id),
    )[0];
}

/** Evenly spaced tiles across the map. */
const sweepTiles = (terrain: TerrainView): TileCoord[] =>
  Array.from({ length: Math.ceil(terrain.width / SWEEP_TILES) }, (_, column) =>
    Array.from(
      { length: Math.ceil(terrain.height / SWEEP_TILES) },
      (_, row) => ({
        x: Math.min(column * SWEEP_TILES + SWEEP_TILES / 2, terrain.width - 1),
        z: Math.min(row * SWEEP_TILES + SWEEP_TILES / 2, terrain.height - 1),
      }),
    ),
  ).flat();

/**
 * Authored sites never sighted, then sites and enemy buildings not seen for
 * the stale interval, oldest first. Units move, so their reports are for
 * operations rather than scouting. Stale sweep points are a fallback, so
 * buildings raised out of sight are found even while reports are avoided.
 */
function scoutingReports(
  context: AiConcernContext,
  terrain: TerrainView,
  swept: Readonly<Record<string, number>>,
  tiles: readonly TileCoord[],
): Report[] {
  const { sites, observations } = context.view.knowledge;
  const isStale = (tick: number | undefined) => isStaleReport(context, tick);
  const seen = new Map(observations.sites.map((site) => [site.siteId, site]));
  const reports = [
    ...sites.map((site) => ({
      kind: "site" as const,
      id: site.id,
      position: terrain.tileCenter(site.tile.x, site.tile.z),
      tick: seen.get(site.id)?.tick,
    })),
    ...observations.actors
      .filter((actor) => !!actor.tilePlacement)
      .map((actor) => ({
        kind: "building" as const,
        id: actor.actorId,
        position: actor.worldPosition,
        tick: actor.tick,
      })),
  ].filter((report) => isStale(report.tick));
  return [
    ...reports,
    ...tiles
      .map((tile) => ({
        kind: "area" as const,
        id: tileKey(tile),
        position: terrain.tileCenter(tile.x, tile.z),
        tick: hasOwn(swept, tileKey(tile)) ? swept[tileKey(tile)] : undefined,
      }))
      .filter((report) => isStale(report.tick)),
  ];
}

/**
 * Keeps one scout exploring: unsighted authored sites nearest first, then
 * stale reports, then sweeps of the map. A damaged scout retreats home and
 * avoids that area for the stale interval; a lost one is replaced at normal
 * cost after a delay.
 */
export const scouting: AiConcern = (context) => {
  const { terrain, tick } = context;
  if (!terrain) return;
  const memory = context.memory as ScoutMemory;
  const avoid = recentAvoided(memory.avoid, tick, staleReportTicks(context));
  memory.avoid = avoid;
  const tiles = sweepTiles(terrain);
  for (const tile of tiles)
    if (context.view.knowledge.seesTile(tile))
      (memory.swept ??= {})[tileKey(tile)] = tick;
  const scout = fieldScout(context, memory, avoid);
  if (scout) explore(context, terrain, scout, memory, avoid, tiles);
  if (!avoid.length) delete memory.avoid;
};

scouting.validateMemory = (memory) => {
  const { goal } = memory;
  return (
    (memory.scoutId === undefined || isId(memory.scoutId)) &&
    (memory.health === undefined || isNonnegative(memory.health)) &&
    (memory.replaceTick === undefined || isCount(memory.replaceTick)) &&
    isAvoidedList(memory.avoid) &&
    (memory.swept === undefined ||
      (isRecord(memory.swept) && Object.values(memory.swept).every(isCount))) &&
    (goal === undefined ||
      (isRecord(goal) &&
        isOneOf(["site", "building", "area", "retreat"], goal.kind) &&
        (goal.kind === "retreat" || isId(goal.id)) &&
        isFinitePosition(goal.position) &&
        (goal.issued === undefined || goal.issued === true) &&
        (goal.retryTick === undefined || isCount(goal.retryTick))))
  );
};

/** Trains or replaces the scout, returning it only while claimed. */
function fieldScout(
  context: AiConcernContext,
  memory: ScoutMemory,
  avoid: Avoided[],
) {
  const { tick } = context;
  const economy = context.view.economy();
  if (!economy) return;
  const scout = context.view.ownMobileActor(memory.scoutId);
  if (scout) {
    context.releaseFunds();
    return context.claim(scout.id) ? scout : undefined;
  }
  if (memory.scoutId) {
    if (economy.production.some(({ actorId }) => actorId === memory.scoutId))
      return;
    const refused = context.rejections.some(
      ({ command }) =>
        command.kind === "train-unit" && command.actorId === memory.scoutId,
    );
    if (!refused) {
      if (memory.goal && memory.goal.kind !== "retreat")
        avoid.push({ ...memory.goal.position, tick });
      memory.replaceTick =
        tick + secondsToTicks(SCOUT_REPLACEMENT_SECONDS, context.tickSeconds);
    }
    for (const key of ["scoutId", "goal", "health"] as const)
      delete memory[key];
  }
  const unit = scoutDefinition(context);
  if (!unit) {
    context.releaseFunds();
    return;
  }
  // Saves for the scout before its producer exists and through any delay.
  if (tick < (memory.replaceTick ?? 0)) return;
  const [producer] = usableBuildings(
    context,
    (definition) =>
      !!definition.production?.unitDefinitionIds.includes(unit.id),
  );
  if (!producer) return;
  const actorId = train(context, producer, unit);
  if (actorId) {
    memory.scoutId = actorId;
    delete memory.replaceTick;
  }
}

/** Retreats after new damage, otherwise heads for the next report. */
function explore(
  context: AiConcernContext,
  terrain: TerrainView,
  scout: ActorRenderState,
  memory: ScoutMemory,
  avoid: Avoided[],
  tiles: readonly TileCoord[],
) {
  const { tick } = context;
  const fullHealth = definitionOf(context, scout).health ?? 0;
  const hit = healthOf(scout, fullHealth) < healthOf(memory, fullHealth);
  if (scout.health === undefined) delete memory.health;
  else memory.health = scout.health;
  if (hit && memory.goal?.kind !== "retreat") {
    avoid.push({ ...scout.worldPosition, tick });
    delete memory.goal;
    const home = headquarters(context)?.worldPosition;
    if (home) memory.goal = { kind: "retreat", position: { ...home } };
    else {
      context.issue({ kind: "stop", actorId: scout.id });
      return;
    }
  }
  const range = AVOID_TILES * terrain.tileSize;
  const reports = scoutingReports(context, terrain, memory.swept ?? {}, tiles);
  const goal = memory.goal;
  const refused = context.rejections.some(
    ({ command }) => command.kind === "move" && command.actorId === scout.id,
  );
  if (
    goal &&
    goal.kind !== "retreat" &&
    !reports.some(({ kind, id }) => kind === goal.kind && id === goal.id)
  )
    delete memory.goal;
  else if (goal?.issued) {
    if (scout.movement && !scout.movement.blocked && !refused) return;
    if (goal.kind === "retreat" && (refused || scout.movement?.blocked)) {
      delete goal.issued;
      goal.retryTick =
        tick + secondsToTicks(RETREAT_RETRY_SECONDS, context.tickSeconds);
    } else {
      // Arriving without refreshing a report also confirms a failed approach.
      if (goal.kind !== "retreat") avoid.push({ ...goal.position, tick });
      delete memory.goal;
    }
  }
  if (!memory.goal) {
    const [next] = reports
      .filter(({ position }) => !isAvoided(avoid, position, range))
      .sort(
        (a, b) =>
          Number(a.kind === "area") - Number(b.kind === "area") ||
          (a.tick ?? -1) - (b.tick ?? -1) ||
          distance(scout.worldPosition, a.position) -
            distance(scout.worldPosition, b.position) ||
          compareIds(a.id, b.id) ||
          compareIds(a.kind, b.kind),
      );
    if (next)
      memory.goal = {
        kind: next.kind,
        id: next.id,
        // Copied, since memory must not share saved observation objects.
        position: { ...next.position },
      };
  }
  const next = memory.goal;
  if (next && tick >= (next.retryTick ?? 0)) {
    if (
      context.issue({ kind: "move", actorId: scout.id, target: next.position })
    ) {
      next.issued = true;
      delete next.retryTick;
    }
  } else if (scout.movement) context.issue({ kind: "stop", actorId: scout.id });
}
