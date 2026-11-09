import { wreckDebris } from "./combat";
import { tileKey } from "./grid";
import { OccupancyGrid } from "./occupancy";
import { cached } from "./owner-view";
import {
  createTilePlacedActor,
  footprintPlacementFor,
  isTilePlacedActor,
} from "./placement";

import type { Actor, ActorBehavior, ActorDefinition } from "./actor";
import type { NavigationGrid } from "./navigation";
import type { OccupancyView } from "./occupancy";
import type {
  ObservedActor,
  OwnerRuleChecks,
  OwnerRuleSource,
} from "./owner-view";
import type { RuleChecks, RuleWorld } from "./rule-checks";
import type { TerrainGrid } from "./terrain";

type ScopedContent = {
  map?: TerrainGrid;
  definitions: ReadonlyMap<string, ActorDefinition>;
  behaviors: ReadonlyMap<string, ActorBehavior>;
};

/** Rules read construction progress, never payment. */
const unpaid = (
  construction: Omit<NonNullable<Actor["construction"]>, "paidCost">,
) => ({
  ...construction,
  paidCost: 0,
});

const ruleActor = (actor: ObservedActor): Actor => ({
  id: actor.id,
  definitionId: actor.definitionId,
  owner: actor.owner,
  worldPosition: actor.worldPosition,
  facing: actor.facing,
  occupancyLayer: actor.occupancyLayer,
  ...(actor.tilePlacement && { tilePlacement: actor.tilePlacement }),
  ...(actor.construction && { construction: unpaid(actor.construction) }),
});

/**
 * Footprints the owner knows. Discards navigation changes, since a preview must
 * not disturb live routes. Shown actors precede memories, newest first;
 * conflicting older footprints are stale and discarded.
 */
function knownOccupancy(
  map: TerrainGrid,
  actors: readonly Actor[],
  definitions: ScopedContent["definitions"],
) {
  const occupancy = new OccupancyGrid(map, { record: () => {} });
  return {
    actors: actors.filter(
      (actor) =>
        !isTilePlacedActor(actor) ||
        occupancy.place(
          footprintPlacementFor(actor, definitions.get(actor.definitionId)!),
        ),
    ),
    occupancy,
  };
}

/** The behaviors' movement rules over known occupancy, with their own caches. */
function knownBehaviors(
  behaviors: ScopedContent["behaviors"],
  occupancy: OccupancyView | undefined,
) {
  const grids = new Map<NavigationGrid, NavigationGrid>();
  return new Map(
    [...behaviors].map(([id, behavior]): [string, ActorBehavior] => [
      id,
      {
        ...behavior,
        navigationGrid:
          behavior.navigationGrid &&
          ((actor, definition, bounds) => {
            const live = behavior.navigationGrid!(actor, definition, bounds);
            let grid = grids.get(live);
            if (!grid) {
              grid = live.withOccupancy(occupancy!);
              grids.set(live, grid);
            }
            return grid;
          }),
      },
    ]),
  );
}

/** Advisory rule checks answered solely from an owner's public projection. */
export function createOwnerRuleChecks(
  source: OwnerRuleSource,
  checks: RuleChecks,
  { map, definitions, behaviors }: ScopedContent,
): OwnerRuleChecks {
  const { knowledge } = source;
  const world = cached(
    () =>
      [
        source.actors(),
        source.economy(),
        knowledge.observations,
        source.wrecks(),
        source.support(),
      ] as const,
    ([{ shown, shownById }, economy, memory, wrecks, support]): RuleWorld => {
      // Mobile sightings are historical positions, so they cannot block a route.
      const remembered = [...memory.actors]
        .sort((a, b) => b.tick - a.tick)
        .flatMap((seen): Actor[] => {
          if (!seen.tilePlacement || shownById.has(seen.actorId)) return [];
          const actor = createTilePlacedActor(
            // Validation ties sighted placements to a map.
            map!,
            definitions.get(seen.definitionId)!,
            { actorId: seen.actorId, ...seen.tilePlacement },
            seen.owner,
          );
          return [
            seen.construction
              ? { ...actor, construction: unpaid(seen.construction) }
              : actor,
          ];
        });
      const candidates = [...shown.map(ruleActor), ...remembered];
      const { actors, occupancy } = map
        ? knownOccupancy(map, candidates, definitions)
        : { actors: candidates, occupancy: undefined };
      // Authored locations stay reserved until Materials are known depleted.
      const depleted = new Set<string>(
        economy?.sites
          .filter(({ remainingMaterials }) => remainingMaterials === 0)
          .map(({ id }) => id),
      );
      return {
        actors,
        usedIds: new Set([
          ...actors.map(({ id }) => id),
          ...memory.actors.map(({ actorId }) => actorId),
          ...(economy?.production.map(({ actorId }) => actorId) ?? []),
        ]),
        occupancy,
        behaviors: knownBehaviors(behaviors, occupancy),
        debris: wreckDebris(wrecks, definitions),
        economy:
          economy && support
            ? {
                view: economy,
                support,
                resourceTiles: new Set(
                  [
                    ...knowledge.sites.filter(({ id }) => !depleted.has(id)),
                    ...economy.loot,
                  ].map(({ tile }) => tileKey(tile)),
                ),
              }
            : undefined,
      };
    },
  );
  return {
    placement: (placement) =>
      checks.placement(placement, knowledge.owner, world()),
    training: (command) => checks.training(command, world()),
    rallyPoint: (id, target) =>
      checks.rallyPoint(
        world().actors.find((actor) => actor.id === id),
        target,
        world(),
      ),
    tendWorker: (id, workerIds) => checks.tendWorker(id, workerIds, world()),
  };
}
