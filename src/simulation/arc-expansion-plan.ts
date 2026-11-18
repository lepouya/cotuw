// ARC expansion: Relay chains and Refineries at remote Materials deposits.
import { compareIds } from "./actor";
import {
  affords,
  connectedNodes,
  harvesterOf,
  headquarters,
  hostileBuildings,
  isGrowing,
  isOnline,
  isPlacementMemory,
  isRelay,
  isUsable,
  knownDefenders,
  ownBuildings,
  place,
  rosterBuildings,
  stepToward,
} from "./ai-planning";
import { visibleHostiles } from "./ai-operations";
import { isPositiveCount, isShare } from "./ai-tuning";
import { plannedConcern } from "./director";
import { refineryOccupied } from "./production";
import { isCount, isIdList, isNonnegative } from "./validation";
import { distance } from "./world";

import type { Building, PlacementMemory } from "./ai-planning";
import type { AiConcernContext } from "./director";
import type { MaterialsSite } from "./harvesting";
import type { TerrainView } from "./terrain";
import type { WorldPosition } from "./world";

type ExpansionPlan = {
  /** Staffed Refineries the base needs before its first expansion. */
  readonly startRefineries: number;
  /** Expansions held at once. */
  readonly limit: number;
  readonly refineries: number;
  /** Worked deposits below this share of their Materials prompt another. */
  readonly depletedShare: number;
  /** Sites this near one another form one deposit. */
  readonly depositTiles: number;
  /** Known hostiles this near a deposit rule it out. */
  readonly enemyTiles: number;
  /** Relays one new expansion may need. */
  readonly maxRelays: number;
  /** A Refinery's distance from its deposit, toward headquarters. */
  readonly siteStepTiles: number;
};

type ExpansionMemory = PlacementMemory & {
  /** Each expansion's deposit, named by its first site ID. */
  deposits?: string[];
};

type SiteLocation = Pick<MaterialsSite, "id" | "tile">;

/** Nearby authored sites with last-seen yields, named by the first site ID. */
type Deposit = {
  id: string;
  sites: readonly SiteLocation[];
  center: WorldPosition;
  remaining: number;
  initial: number;
};

/** Groups sites by authored location so sightings cannot change deposit IDs. */
export function depositsOf(
  locations: readonly SiteLocation[],
  sites: readonly MaterialsSite[],
  terrain: TerrainView,
  tiles: number,
): Deposit[] {
  const groups: SiteLocation[][] = [];
  for (const site of [...locations].sort((a, b) => compareIds(a.id, b.id))) {
    const near = groups.filter((group) =>
      group.some(
        ({ tile }) =>
          Math.max(
            Math.abs(tile.x - site.tile.x),
            Math.abs(tile.z - site.tile.z),
          ) <= tiles,
      ),
    );
    const [first, ...rest] = near;
    if (!first) groups.push([site]);
    else {
      first.push(site, ...rest.flat());
      for (const merged of rest) groups.splice(groups.indexOf(merged), 1);
    }
  }
  const observed = new Map(sites.map((site) => [site.id, site]));
  return groups.map((group) => {
    const positions = group.map(({ tile }) =>
      terrain.tileCenter(tile.x, tile.z),
    );
    return {
      id: group[0]!.id,
      sites: group,
      center: {
        x: positions.reduce((sum, { x }) => sum + x, 0) / positions.length,
        z: positions.reduce((sum, { z }) => sum + z, 0) / positions.length,
      },
      remaining: group.reduce(
        (sum, { id }) => sum + (observed.get(id)?.remainingMaterials ?? 0),
        0,
      ),
      initial: group.reduce(
        (sum, { id }) => sum + (observed.get(id)?.initialMaterials ?? 0),
        0,
      ),
    };
  });
}

/** The deposit nearest `point`. */
const nearestDeposit = (deposits: readonly Deposit[], point: WorldPosition) =>
  [...deposits].sort(
    (a, b) =>
      distance(a.center, point) - distance(b.center, point) ||
      compareIds(a.id, b.id),
  )[0];

/**
 * Takes remote deposits with Relay chains and Refineries while the base is
 * growing, and restores their chains and Refineries in every posture that
 * lists it while no enemies hold or threaten the deposit. A threatened
 * expansion that has lost its Refineries is dropped. Builds one structure at a time; savings
 * return to the pool when nothing is wanted.
 */
export const arcExpansion = plannedConcern<ExpansionPlan>(
  {
    startRefineries: isPositiveCount,
    limit: isPositiveCount,
    refineries: isPositiveCount,
    depletedShare: isShare,
    depositTiles: isNonnegative,
    enemyTiles: isNonnegative,
    maxRelays: isCount,
    siteStepTiles: isNonnegative,
  },
  (context, plan) => {
    const { terrain } = context;
    const memory = context.memory as ExpansionMemory;
    const economy = context.view.economy();
    const home = headquarters(context);
    const [refinery] = rosterBuildings(context, (d) => !!d.refinery);
    const [relay] = rosterBuildings(context, isRelay);
    if (!terrain || !economy || !home || !refinery || !relay) return;
    const deposits = depositsOf(
      context.view.knowledge.sites.filter(
        ({ resource }) => resource === "materials",
      ),
      economy.sites,
      terrain,
      plan.depositTiles,
    );
    const byId = new Map(deposits.map((deposit) => [deposit.id, deposit]));
    const refineries = ownBuildings(context, (d) => !!d.refinery);
    const refineriesByDeposit = new Map<string, Building[]>();
    for (const building of refineries) {
      const deposit = nearestDeposit(deposits, building.worldPosition);
      if (!deposit) continue;
      const buildings = refineriesByDeposit.get(deposit.id) ?? [];
      buildings.push(building);
      refineriesByDeposit.set(deposit.id, buildings);
    }
    const at = (deposit: Deposit) => refineriesByDeposit.get(deposit.id) ?? [];
    const enemyRange = plan.enemyTiles * terrain.tileSize;
    const near =
      (positions: readonly { worldPosition: WorldPosition }[]) =>
      (deposit: Deposit) =>
        positions.some(
          ({ worldPosition }) =>
            distance(worldPosition, deposit.center) <= enemyRange,
        );
    const buildings = hostileBuildings(context);
    // New sites avoid any known enemy; standing ones wait out only present
    // threats, since remembered raiders would stall them for minutes.
    const contested = near([...buildings, ...knownDefenders(context)]);
    const threatened = near([...buildings, ...visibleHostiles(context)]);
    // A threatened expansion without Refineries is lost, freeing its place.
    const held = (memory.deposits ?? []).filter((id) => {
      const deposit = byId.get(id);
      return (
        !!deposit &&
        deposit.remaining > 0 &&
        (at(deposit).length > 0 || !threatened(deposit))
      );
    });
    const anchorOf = (deposit: Deposit) =>
      stepToward(
        terrain,
        deposit.center,
        home.worldPosition,
        plan.siteStepTiles,
      );
    const nodes = connectedNodes(context).filter(
      ({ faction }) => faction === relay.faction,
    );
    const gapFrom = (node: (typeof nodes)[number], point: WorldPosition) =>
      distance(node.center, point) - node.radius;
    const gapAt = (point: WorldPosition) =>
      nodes.reduce(
        (gap, node) => Math.min(gap, gapFrom(node, point)),
        Infinity,
      );
    const unfinished = (deposit: Deposit) => {
      const built = at(deposit);
      return (
        built.length < plan.refineries ||
        built.some((building) => !isOnline(context, building))
      );
    };
    // Restoration waits while enemies hold or threaten the deposit.
    let target = held
      .map((id) => byId.get(id)!)
      .find((deposit) => unfinished(deposit) && !threatened(deposit));
    if (!target && held.length < plan.limit && isGrowing(context)) {
      target = nextDeposit(context, plan, {
        deposits,
        held: held.length,
        refineries,
        ownDeposits: refineriesByDeposit,
        contested,
        inReach: (deposit) =>
          gapAt(anchorOf(deposit)) <= plan.maxRelays * relay.support!.radius,
      });
      if (target) held.push(target.id);
    }
    if (held.length) memory.deposits = held;
    else delete memory.deposits;
    if (!target) {
      context.releaseFunds();
      return;
    }
    // One structure at a time keeps the infrastructure slot and funds free.
    if (
      ownBuildings(
        context,
        (definition) => !!definition.refinery || isRelay(definition),
      ).some((building) => building.construction && isOnline(context, building))
    )
      return;
    // Reconnect the actual footprint, which can lie away from its planned site.
    const offline = at(target).find((building) => !isOnline(context, building));
    const anchor = offline?.worldPosition ?? anchorOf(target);
    const gap = gapAt(anchor);
    if (gap > 0) {
      const node = nodes.sort(
        (a, b) =>
          gapFrom(a, anchor) - gapFrom(b, anchor) ||
          compareIds(a.actorId, b.actorId),
      )[0];
      if (node)
        place(
          context,
          memory,
          terrain,
          relay,
          stepToward(
            terrain,
            node.center,
            anchor,
            Math.min(node.radius - 1, distance(node.center, anchor)) /
              terrain.tileSize,
          ),
          {
            toward: anchor,
            accepts: (position) =>
              distance(position, anchor) - relay.support!.radius < gap,
          },
        );
    } else if (at(target).length < plan.refineries) {
      if (affords(context, refinery, harvesterOf(context, refinery)))
        place(context, memory, terrain, refinery, anchor, {
          accepts: (position) => nearestDeposit(deposits, position) === target,
        });
    } else context.releaseFunds();
  },
);

arcExpansion.validateMemory = (memory) =>
  (memory.deposits === undefined || isIdList(memory.deposits)) &&
  isPlacementMemory(memory);

/**
 * The nearest deposit without a Refinery, away from known enemies and within
 * reach, once every usable Refinery is staffed. The first expansion needs
 * `startRefineries`; later ones wait until worked deposits run low.
 */
function nextDeposit(
  context: AiConcernContext,
  plan: ExpansionPlan,
  {
    deposits,
    held,
    refineries,
    ownDeposits,
    contested,
    inReach,
  }: {
    deposits: readonly Deposit[];
    /** Expansions still holding Materials. */
    held: number;
    refineries: ReturnType<typeof ownBuildings>;
    ownDeposits: ReadonlyMap<string, readonly Building[]>;
    contested: (deposit: Deposit) => boolean;
    inReach: (deposit: Deposit) => boolean;
  },
): Deposit | undefined {
  const economy = context.view.economy()!;
  const usable = refineries.filter((building) => isUsable(context, building));
  if (
    usable.length < plan.startRefineries ||
    !usable.every(({ id }) => refineryOccupied(economy, id))
  )
    return;
  const workedSites = new Set(
    economy.harvesters.flatMap(({ targetSiteId }) => targetSiteId ?? []),
  );
  const worked = deposits.filter((deposit) =>
    deposit.sites.some(({ id }) => workedSites.has(id)),
  );
  if (held > 0) {
    const initial = worked.reduce((sum, deposit) => sum + deposit.initial, 0);
    const remaining = worked.reduce(
      (sum, deposit) => sum + deposit.remaining,
      0,
    );
    if (initial > 0 && remaining >= initial * plan.depletedShare) return;
  }
  const home = headquarters(context)!.worldPosition;
  return deposits
    .filter(
      (deposit) =>
        deposit.remaining > 0 &&
        !ownDeposits.has(deposit.id) &&
        !contested(deposit) &&
        inReach(deposit),
    )
    .sort(
      (a, b) =>
        distance(a.center, home) - distance(b.center, home) ||
        compareIds(a.id, b.id),
    )[0];
}
