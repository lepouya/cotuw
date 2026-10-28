import { compareIds } from "./actor";
import { secondsToTicks } from "./clock";
import {
  isValidTilePlacement,
  occupiedTilesFor,
  tilePlacedPose,
} from "./placement";
import { hasOwn, isCount, isId, isPositive, isRecord } from "./validation";
import { isFinitePosition, withinBounds } from "./world";

import type {
  Actor,
  ActorDefinition,
  ActorRenderState,
  DeepReadonly,
} from "./actor";
import type { Wreck } from "./combat";
import type { EconomyView } from "./economy";
import type { TileCoord } from "./grid";
import type { Resource } from "./resources";
import type { TerrainView } from "./terrain";
import type { FogView } from "./vision";
import type { Detectable } from "./ownership";
import type { WorldBounds, WorldPosition } from "./world";

/** What an owner last saw of another, non-allied owner's actor. */
export type ActorSighting = {
  actorId: string;
  definitionId: string;
  owner: string;
  worldPosition: WorldPosition;
  tilePlacement?: Actor["tilePlacement"];
  /** Absent while undamaged. */
  health?: number;
  /** Visible progress only; payment and queue slots stay private. */
  construction?: { completedTicks: number; totalTicks: number };
  tick: number;
};

/** A resource site's last-seen yield: Materials left or a renewable reserve. */
export type SiteSighting = {
  siteId: string;
  amount: number;
  dormant?: true;
  tick: number;
};

/** Uncollected loot an owner has seen. */
export type LootSighting = { lootId: string; tick: number };

/** One owner's memory, each list in ID order. */
export type Observations = {
  actors: ActorSighting[];
  sites: SiteSighting[];
  loot: LootSighting[];
};

/** Every owner's memory, keyed by owner ID; absent owners saw nothing. */
export type ObservationState = Record<string, Observations>;

/** An authored resource site location, which every owner knows. */
export type SiteLocation = {
  id: string;
  tile: TileCoord;
  resource: Resource;
};

/**
 * What one owner may know beyond its own actors and economy: authored map
 * knowledge, its explored terrain and vision, and its memory of others.
 */
export type OwnerKnowledge = {
  readonly owner: string;
  /** Absent when the whole map is known. */
  readonly fog: FogView | undefined;
  knowsTile: (tile: TileCoord) => boolean;
  seesTile: (tile: TileCoord) => boolean;
  /** Current yields require sightings. */
  readonly sites: readonly SiteLocation[];
  readonly observations: DeepReadonly<Observations>;
};

export const siteLocations = (
  economy: EconomyView | undefined,
): SiteLocation[] => [
  ...(economy?.sites ?? []).map(({ id, tile }) => ({
    id,
    tile: { ...tile },
    resource: "materials" as const,
  })),
  ...(economy?.cultivation?.sites ?? []).map(({ id, tile }) => ({
    id,
    tile: { ...tile },
    resource: "lifebloom" as const,
  })),
];

/**
 * The economy's sites and loot as an owner last saw them: sighted entries
 * only, at their last-seen yields. Other economy state passes through.
 */
export function knownEconomy(
  economy: EconomyView,
  memory: DeepReadonly<Observations>,
): EconomyView {
  const sites = new Map(memory.sites.map((seen) => [seen.siteId, seen]));
  const loot = new Set(memory.loot.map(({ lootId }) => lootId));
  const sighted = <T extends { id: string }>(
    list: readonly T[],
    lastSeen: (site: T, seen: DeepReadonly<SiteSighting>) => T,
  ) =>
    list.flatMap((site) => {
      const seen = sites.get(site.id);
      return seen ? [lastSeen(site, seen)] : [];
    });
  return {
    ...economy,
    sites: sighted(economy.sites, (site, seen) => ({
      ...site,
      remainingMaterials: seen.amount,
    })),
    ...(economy.cultivation && {
      cultivation: {
        ...economy.cultivation,
        sites: sighted(economy.cultivation.sites, (site, seen) => ({
          ...site,
          reserve: seen.amount,
          dormant: !!seen.dormant,
        })),
      },
    }),
    loot: economy.loot
      .filter(({ id }) => loot.has(id))
      .map((cache) => ({ ...cache, collected: false })),
  };
}

/** What owners currently perceive when their memory updates. */
export type ObservationWorld = {
  tick: number;
  actors: readonly ActorRenderState[];
  /** Remains an owner may see, which confirm a unit's destruction. */
  wrecks: readonly Wreck[];
  economy: EconomyView | undefined;
  detects: (owner: string, actor: Detectable) => boolean;
  seesTile: (owner: string, tile: TileCoord) => boolean;
  sharesVision: (left: string, right: string) => boolean;
};

/** One owner's perception while its memory updates. */
type Perception = ObservationWorld & {
  viewer: string;
  /** Owners whose actors it remembers: those it shares no vision with. */
  foreign: (owner: string) => boolean;
  /** Units whose remains it sees, which confirms their destruction. */
  remainsSeen: ReadonlySet<string>;
};

/** Saved references a sighting may name. */
type ObservationScope = {
  viewer: string;
  ownerIds: ReadonlySet<string>;
  actorIds: ReadonlySet<string>;
  definitions: ReadonlyMap<string, ActorDefinition>;
  sites: ReadonlyMap<
    string,
    | EconomyView["sites"][number]
    | NonNullable<EconomyView["cultivation"]>["sites"][number]
  >;
  lootIds: ReadonlySet<string>;
  bounds: WorldBounds;
  map: TerrainView | undefined;
  tickSeconds: number;
};

/**
 * How one kind of subject is remembered. A sighting the owner does not
 * refresh stays until `gone` reports the subject seen missing.
 */
type SightingRule<S extends { tick: number }> = {
  id: (sighting: S) => string;
  /** Sightings of every subject the owner perceives now. */
  fresh: (perception: Perception) => S[];
  gone: (sighting: S, perception: Perception) => boolean;
  /** Checks the kind's own fields; IDs, order, and ticks are checked for all. */
  valid: (sighting: S, scope: ObservationScope) => boolean;
};

const actorSighting = (
  actor: ActorRenderState,
  tick: number,
): ActorSighting => ({
  actorId: actor.id,
  definitionId: actor.definitionId,
  owner: actor.owner,
  worldPosition: { ...actor.worldPosition },
  ...(actor.tilePlacement && {
    tilePlacement: structuredClone(actor.tilePlacement),
  }),
  ...(actor.health !== undefined && { health: actor.health }),
  ...(actor.construction && {
    construction: {
      completedTicks: actor.construction.completedTicks,
      totalTicks: actor.construction.totalTicks,
    },
  }),
  tick,
});

function validActorSighting(sighting: ActorSighting, scope: ObservationScope) {
  const definition = scope.definitions.get(sighting.definitionId);
  if (
    !definition ||
    !scope.actorIds.has(sighting.actorId) ||
    !scope.ownerIds.has(sighting.owner) ||
    sighting.owner === scope.viewer ||
    !isFinitePosition(sighting.worldPosition) ||
    !withinBounds(sighting.worldPosition, scope.bounds) ||
    (definition.footprint !== undefined) !==
      (sighting.tilePlacement !== undefined) ||
    (sighting.health !== undefined &&
      (!isPositive(sighting.health) ||
        definition.health === undefined ||
        sighting.health > definition.health))
  )
    return false;
  if (sighting.tilePlacement !== undefined) {
    if (!scope.map || !isValidTilePlacement(sighting.tilePlacement))
      return false;
    const placed = {
      id: sighting.actorId,
      definitionId: sighting.definitionId,
      tilePlacement: sighting.tilePlacement,
    };
    if (
      occupiedTilesFor(placed, definition).some(
        ({ x, z }) => !scope.map!.containsTile(x, z),
      )
    )
      return false;
    const { worldPosition } = tilePlacedPose(scope.map, placed, definition);
    if (
      worldPosition.x !== sighting.worldPosition.x ||
      worldPosition.z !== sighting.worldPosition.z
    )
      return false;
  }
  const { construction } = sighting;
  return (
    construction === undefined ||
    (!!sighting.tilePlacement &&
      isRecord(construction) &&
      isCount(construction.completedTicks) &&
      construction.totalTicks ===
        secondsToTicks(definition.constructionSeconds, scope.tickSeconds) &&
      construction.completedTicks < construction.totalTicks)
  );
}

/** One rule per kind; adding a kind to `Observations` requires one. */
const RULES: {
  [K in keyof Observations]: SightingRule<Observations[K][number]>;
} = {
  actors: {
    id: (sighting) => sighting.actorId,
    fresh: ({ actors, viewer, foreign, detects, tick }) =>
      actors
        .filter((actor) => foreign(actor.owner) && detects(viewer, actor))
        .map((actor) => actorSighting(actor, tick)),
    // Units move, so only remains confirm them gone; buildings stay put.
    gone: (sighting, { viewer, foreign, remainsSeen, detects }) =>
      !foreign(sighting.owner) ||
      remainsSeen.has(sighting.actorId) ||
      (!!sighting.tilePlacement &&
        detects(viewer, {
          id: sighting.actorId,
          definitionId: sighting.definitionId,
          worldPosition: sighting.worldPosition,
          tilePlacement: sighting.tilePlacement,
        })),
    valid: validActorSighting,
  },
  sites: {
    id: (sighting) => sighting.siteId,
    fresh: ({ economy, viewer, seesTile, tick }) => [
      ...(economy?.sites ?? [])
        .filter((site) => seesTile(viewer, site.tile))
        .map((site) => ({
          siteId: site.id,
          amount: site.remainingMaterials,
          tick,
        })),
      ...(economy?.cultivation?.sites ?? [])
        .filter((site) => seesTile(viewer, site.tile))
        .map((site): SiteSighting => ({
          siteId: site.id,
          amount: site.reserve,
          ...(site.dormant && { dormant: true }),
          tick,
        })),
    ],
    // Sites never disappear, so a visible site is always refreshed.
    gone: () => false,
    valid: (sighting, scope) => {
      const site = scope.sites.get(sighting.siteId);
      if (!site || !isCount(sighting.amount)) return false;
      if ("initialMaterials" in site)
        return (
          sighting.amount <= site.initialMaterials &&
          sighting.dormant === undefined
        );
      return (
        sighting.amount <= site.capacity &&
        (sighting.dormant === undefined || sighting.dormant === true) &&
        (sighting.dormant
          ? sighting.amount < site.recoverAt
          : sighting.amount >= site.dormantBelow)
      );
    },
  },
  loot: {
    id: (sighting) => sighting.lootId,
    fresh: ({ economy, viewer, seesTile, tick }) =>
      (economy?.loot ?? [])
        .filter((loot) => !loot.collected && seesTile(viewer, loot.tile))
        .map((loot) => ({ lootId: loot.id, tick })),
    // Validation ties each sighting to the economy's loot.
    gone: (sighting, { economy, viewer, seesTile }) =>
      seesTile(
        viewer,
        economy!.loot.find(({ id }) => id === sighting.lootId)!.tile,
      ),
    valid: (sighting, scope) => scope.lootIds.has(sighting.lootId),
  },
};

type Sighting = Observations[keyof Observations][number];
const KINDS = Object.keys(RULES) as (keyof Observations)[];
const ruleFor = (kind: keyof Observations) =>
  RULES[kind] as SightingRule<Sighting>;

export const createObservations = (): Observations => ({
  actors: [],
  sites: [],
  loot: [],
});

/**
 * Updates one owner's memory from what it perceives now. Sightings keep their
 * last-seen state until the owner sees the subject again or sees it gone.
 */
export function observe(
  memory: DeepReadonly<Observations>,
  viewer: string,
  world: ObservationWorld,
): Observations {
  const perception: Perception = {
    ...world,
    viewer,
    foreign: (owner) => !world.sharesVision(viewer, owner),
    remainsSeen: new Set(
      world.wrecks
        .filter((wreck) => world.detects(viewer, wreck))
        .map(({ actorId }) => actorId),
    ),
  };
  return Object.fromEntries(
    KINDS.map((kind) => {
      const rule = ruleFor(kind);
      const fresh = rule.fresh(perception);
      const refreshed = new Set(fresh.map(rule.id));
      const kept = (memory[kind] as readonly Sighting[]).filter(
        (old) => !refreshed.has(rule.id(old)) && !rule.gone(old, perception),
      );
      return [
        kind,
        [...fresh, ...kept].sort((left, right) =>
          compareIds(rule.id(left), rule.id(right)),
        ),
      ];
    }),
  ) as Observations;
}

/** Updates every owner's memory. */
export const observeAll = (
  state: DeepReadonly<ObservationState>,
  ownerIds: ReadonlySet<string>,
  world: ObservationWorld,
): ObservationState =>
  Object.fromEntries(
    [...ownerIds].map((owner) => [
      owner,
      observe(
        hasOwn(state, owner) ? state[owner]! : createObservations(),
        owner,
        world,
      ),
    ]),
  );

/** Throws unless every owner has well-formed memory of known subjects. */
export function validateObservations(
  state: unknown,
  scope: {
    ownerIds: ReadonlySet<string>;
    actorIds: ReadonlySet<string>;
    definitions: ReadonlyMap<string, ActorDefinition>;
    economy: EconomyView | undefined;
    tick: number;
    bounds: WorldBounds;
    map: TerrainView | undefined;
    tickSeconds: number;
  },
): asserts state is ObservationState {
  const sites = new Map(
    [
      ...(scope.economy?.sites ?? []),
      ...(scope.economy?.cultivation?.sites ?? []),
    ].map((site) => [site.id, site]),
  );
  const lootIds = new Set(scope.economy?.loot.map(({ id }) => id));
  const validList = (
    viewer: string,
    kind: keyof Observations,
    list: unknown,
  ) => {
    const rule = ruleFor(kind);
    let previous: string | undefined;
    return (
      Array.isArray(list) &&
      list.every((sighting: unknown) => {
        if (!isRecord(sighting)) return false;
        const id = rule.id(sighting as Sighting);
        const ordered =
          isId(id) && (previous === undefined || compareIds(previous, id) < 0);
        previous = id;
        return (
          ordered &&
          isCount(sighting.tick) &&
          sighting.tick <= scope.tick &&
          rule.valid(sighting as Sighting, {
            ...scope,
            viewer,
            sites,
            lootIds,
          })
        );
      })
    );
  };
  if (
    !isRecord(state) ||
    !Object.entries(state).every(
      ([viewer, memory]) =>
        scope.ownerIds.has(viewer) &&
        isRecord(memory) &&
        KINDS.every((kind) => validList(viewer, kind, memory[kind])),
    )
  )
    throw new RangeError("Mission state has invalid observations.");
}
