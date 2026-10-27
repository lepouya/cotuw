import {
  growthCandidates,
  growthHeadquarters,
  growthWorkerFor,
} from "./growth";
import {
  assignGroupDestinations,
  separateMobileActors,
} from "./group-movement";
import {
  evaluateTraining as evaluateUnitTraining,
  trainableUnitIds,
  validateProductionDefinitions,
} from "./production";
import type { BuildingActivity, TrainingEvaluation } from "./production";
import type { TrainUnitCommand } from "./command";
import { clampToBounds, isFinitePosition, withinBounds } from "./world";
import { clearCombatOrders, deepFreeze } from "./actor";
import {
  ACTOR_ORDER_KINDS,
  isCommandOf,
  isMissionCommand,
  isQueuedOrder,
} from "./command";
import { tileKey } from "./grid";
import { isOccupancyLayer, OccupancyGrid } from "./occupancy";
import {
  createSupportResolver,
  disconnectedBuildings,
  supportsPosition,
  validateSupportDefinition,
} from "./support";
import { TerrainGrid } from "./terrain";
import {
  attackRejection,
  guardController,
  startAttack,
  wreckTiles,
  noteAttackMoveRoute,
  updateCombat,
  validateCombatActor,
  validateCombatDefinition,
  validateWrecks,
  WRECK_SECONDS,
} from "./combat";
import type { AttackEvent, Wreck } from "./combat";
import { secondsToTicks } from "./clock";
import {
  leashAllows,
  createTerritoryController,
  createWildlifeState,
  validateWildlife,
} from "./territory";
import type { WildlifeState } from "./territory";
import {
  evaluateObjectives,
  recordObjectiveDestruction,
  validateObjectives,
} from "./objectives";
import type {
  MissionResult,
  ObjectiveDefinition,
  ObjectiveState,
  ObjectiveView,
} from "./objectives";
import { resolveNavigationDestination } from "./navigation";
import {
  createFog,
  createOwnerVision,
  isValidFogState,
  validateVisionDefinition,
} from "./vision";
import {
  applyEconomyCommand as applyEconomy,
  enrollWorker,
  activeSites,
  economySites,
  interruptWorker,
  workerHasOrder,
  canAfford,
  chargeCost,
  costAmount,
  refundCost,
  PRODUCTION_QUEUE_LIMIT,
  refineryOccupied,
  removeEconomyActor,
  saleRefund,
  updateEconomy,
  validateEconomyDefinitions,
  validateEconomyState,
} from "./economy";
import type { EconomyState, EconomyView } from "./economy";
import {
  createTilePlacedActor,
  evaluateFootprint,
  footprintPlacementFor,
  isMobileActor,
  isTilePlacedActor,
  isValidTilePlacement,
  tilePlacedPose,
  validatePlacementDefinition,
} from "./placement";

import type {
  Actor,
  ActorBehavior,
  ActorDefinition,
  ActorRenderState,
  QueuedOrder,
  RouteBounds,
} from "./actor";
import type {
  AttackMoveCommand,
  GroupAttackMoveCommand,
  ActorRemovalCommand,
  AppliedActorCommand,
  CommandOutcome,
  EconomyCommand,
  GroupMoveCommand,
  MissionCommand,
  MoveCommand,
  ScheduledCommand,
} from "./command";
import type { NavigatingActor } from "./group-movement";
import type { FootprintPlacement } from "./occupancy";
import type {
  ActorPlacement,
  PlacementEvaluation,
  PlacementReason,
} from "./placement";
import type { SupportView } from "./support";
import type { TerrainState } from "./terrain";
import {
  createRelations,
  playerFactionOf,
  validateOwners,
  validateRelationships,
} from "./ownership";
import type {
  Detectable,
  Owner,
  OwnerRelationship,
  Relations,
} from "./ownership";
import { fireEvents, validateEvents } from "./events";
import type { MissionEventDefinition } from "./events";
import {
  isCount,
  isId,
  isIdList,
  isNonnegative,
  isPositive,
  isRecord,
} from "./validation";
import type { FogState, FogView } from "./vision";
import type { WorldBounds, WorldPosition } from "./world";

/** Actor state that behaviors must leave unchanged. */
type ActorIdentity = Pick<
  Actor,
  "id" | "definitionId" | "owner" | "tilePlacement" | "occupancyLayer"
>;

function actorIdentity(actor: Actor): ActorIdentity {
  return {
    id: actor.id,
    definitionId: actor.definitionId,
    owner: actor.owner,
    occupancyLayer: actor.occupancyLayer,
    tilePlacement: actor.tilePlacement && structuredClone(actor.tilePlacement),
  };
}

function sameTilePlacement(
  left: Actor["tilePlacement"],
  right: Actor["tilePlacement"],
): boolean {
  return (
    left === right ||
    (left !== undefined &&
      right !== undefined &&
      left.origin.x === right.origin.x &&
      left.origin.z === right.origin.z &&
      left.quarterTurns === right.quarterTurns)
  );
}

/** Actor changes a tick stages before committing them. */
type WorkingActors = {
  actors: Actor[];
  actorsById: Map<string, Actor>;
  usedIds: Set<string>;
  retiredIds: string[];
  lifecycleChanges: number;
  activity: BuildingActivity[];
  economy?: EconomyState;
  wildlife: WildlifeState;
  wrecks: Wreck[];
  objectives: ObjectiveState[];
};

/** The authoritative, serializable state of one playable mission. */
export type MissionState = {
  /** Ticks completed so far, which is also the number of the next tick. */
  tick: number;
  actors: Actor[];
  /** Commands for the next tick, in submission order. */
  commands: ScheduledCommand[];
  /** IDs that cannot be assigned again during this mission. */
  retiredActorIds: string[];
  /** The mission's simulation terrain; absent until the first snapshot. */
  terrain?: TerrainState;
  economy?: EconomyState;
  /** The player's explored terrain; absent when the whole map is known. */
  fog?: FogState;
  scenarioId?: string;
  /** Participants that control actors, in authored order. */
  owners: Owner[];
  /** The owner the player controls, whose exploration the fog records. */
  playerOwner: string;
  /** Pairs that are allied or hostile; every other pair is neutral. */
  relationships: OwnerRelationship[];
  /** One-time events that have fired, in firing order. */
  firedEvents: string[];
  /** Remains of destroyed actors, oldest first. */
  wrecks: Wreck[];
  /** Wolf alerts; each wolf's own state lives on its actor. */
  wildlife: WildlifeState;
  /** Progress for the authored objectives, which also decide the result. */
  objectives: ObjectiveState[];
  /** Scenario popups the player dismissed; the simulation only keeps them. */
  dismissedPopups?: string[];
};

/** Defaults to one factionless player owner, as in free construction. */
export function createMissionState(
  actors: readonly Actor[],
  owners: readonly Owner[] = [{ id: "player" }],
  playerOwner = owners[0]!.id,
): MissionState {
  return {
    tick: 0,
    actors: [...actors],
    commands: [],
    retiredActorIds: [],
    owners: structuredClone([...owners]),
    playerOwner,
    relationships: [],
    firedEvents: [],
    wrecks: [],
    wildlife: createWildlifeState(),
    objectives: [],
  };
}

export type MissionSimulationOptions = {
  /** Copied so later caller mutations cannot change the mission. */
  state: MissionState;
  /** Executable behaviors that definitions name by `behaviorId`. */
  behaviorRegistry: ReadonlyMap<string, ActorBehavior>;
  bounds: WorldBounds;
  definitions: readonly ActorDefinition[];
  tickSeconds: number;
  /**
   * Terrain the mission owns and changes only through terrain commands. Terrain
   * in `state` replaces it after validation. Dispose the previous mission
   * before assigning this world to another mission.
   */
  map?: TerrainGrid;
  /**
   * Footprints on `map`, rebuilt from the mission's tile-placed actors and
   * changed only by the mission. Footprint definitions require it.
   */
  occupancy?: OccupancyGrid;
  /** Matches `state.objectives`; a failed objective ends the mission. */
  objectives?: readonly ObjectiveDefinition[];
  /** Authored mission logic; `state.firedEvents` records its progress. */
  events?: readonly MissionEventDefinition[];
};

/** Owns deterministic fixed-step updates and commands for one mission state. */
export type MissionSimulation = {
  /** Copies of the state the renderer needs. They cannot change the mission. */
  readonly actors: readonly ActorRenderState[];
  /** Changes when actors are spawned or removed. */
  readonly actorVersion: number;
  readonly completedTicks: number;
  readonly tickSeconds: number;
  readonly economy: EconomyView | undefined;
  readonly support: SupportView | undefined;
  /** Explored and visible terrain; absent when the whole map is known. */
  readonly fog: FogView | undefined;
  readonly owners: readonly Owner[];
  readonly playerOwner: string;
  /** The player owner's faction, for labels, prices, and music. */
  readonly playerFaction: string | undefined;
  /** Hits resolved during the latest tick. */
  readonly attacks: readonly AttackEvent[];
  /** Unit exits and cargo deliveries during the latest tick. */
  readonly buildingActivity: readonly BuildingActivity[];
  readonly wrecks: readonly Wreck[];
  /** A defeat ends the mission; play continues after victory. */
  readonly result: MissionResult | undefined;
  readonly objectives: readonly ObjectiveView[];
  /** Current relationship rules; events replace the view when they change. */
  readonly relations: Relations;
  /** Whether an owner currently sees any tile of the actor. */
  detects: (owner: string, actor: Detectable) => boolean;
  /** Whether an owner currently sees the tile under a point. */
  sees: (owner: string, point: WorldPosition) => boolean;
  /** A copy of an actor's state, or `undefined` when it does not exist. */
  actorById: (id: string) => Actor | undefined;
  /** Checks the same placement constraints used when commands are applied. */
  evaluatePlacement: (placement: ActorPlacement) => PlacementEvaluation;
  /** Checks paid queue capacity, or free exits in the construction sandbox. */
  evaluateTraining: (command: TrainUnitCommand) => TrainingEvaluation;
  evaluateRallyPoint: (actorId: string, target: WorldPosition) => boolean;
  /** The nearest candidate that can reach and tend unfinished growth. */
  tendWorker: (
    buildingId: string,
    workerIds: readonly string[],
  ) => string | undefined;
  /** Lowest `${prefix}${n}` not used or queued; previews do not reserve it. */
  unusedActorId: (prefix: string) => string;
  /** Queues a command for the next tick; non-object submissions throw. */
  submitCommand: (command: MissionCommand) => number;
  /** Adds a copy of the actor, validated like the initial state. */
  spawnActor: (actor: Actor) => void;
  /** Returns whether an actor with this ID existed. */
  removeActor: (id: string) => boolean;
  /** A deep copy of the current state and terrain, for saves and replays. */
  snapshot: () => MissionState;
  /** Stops updates and releases terrain rules before replacing the mission. */
  dispose: () => void;
  /**
   * Applies queued commands, then advances every actor by one tick. Outcomes
   * carry each command as applied, with move targets clamped to the bounds.
   * Group moves report one move outcome per unique actor ID, in ID order.
   */
  tick: () => CommandOutcome[];
};

export function createMissionSimulation({
  state: initialState,
  behaviorRegistry,
  bounds,
  definitions,
  tickSeconds,
  map,
  occupancy,
  objectives: authoredObjectives = [],
  events: authoredEvents = [],
}: MissionSimulationOptions): MissionSimulation {
  if (!isPositive(tickSeconds)) {
    throw new RangeError(
      "Simulation tick seconds must be a positive finite number.",
    );
  }
  ensureValidBounds(bounds);
  if (
    map &&
    (!withinBounds({ x: bounds.minX, z: bounds.minZ }, map.worldBounds) ||
      !withinBounds({ x: bounds.maxX, z: bounds.maxZ }, map.worldBounds))
  )
    throw new RangeError("Simulation bounds cannot exceed the terrain map.");
  if (occupancy && (!map || !occupancy.isForTerrain(map))) {
    throw new RangeError("Mission occupancy must belong to its terrain map.");
  }
  if (!isCount(initialState.tick)) {
    throw new RangeError("Mission state tick must be a non-negative integer.");
  }
  // Hand-edited saves reach here, so name the list rather than crash in it.
  if (
    !Array.isArray(initialState.actors) ||
    initialState.actors.some((actor) => typeof actor !== "object" || !actor) ||
    !isIdList(initialState.retiredActorIds)
  )
    throw new RangeError(
      "Mission state needs an actors list and a retiredActorIds list.",
    );

  let state = structuredClone(initialState);
  if (
    !Array.isArray(state.commands) ||
    state.commands.some(
      (scheduled) =>
        !scheduled ||
        !isCount(scheduled.tick) ||
        !isMissionCommand(scheduled.command),
    )
  )
    throw new RangeError("Mission state has invalid queued commands.");
  const objectives = deepFreeze(structuredClone(authoredObjectives));
  validateObjectives(
    objectives,
    state.objectives,
    new Set(state.actors.map(({ id }) => id)),
    new Set(state.retiredActorIds),
    state.tick,
  );
  deepFreeze(state.objectives);
  const objectivesFor = (states: readonly ObjectiveState[]) =>
    deepFreeze(evaluateObjectives(objectives, states));
  const resultOf = (states: readonly ObjectiveState[]) =>
    objectivesFor(states).result;
  const ended = () => resultOf(state.objectives)?.kind === "defeat";
  const savedTerrain = state.terrain;
  const restoringSnapshot = savedTerrain !== undefined;
  if (savedTerrain && !map) {
    throw new Error("Mission state has terrain but no map to restore.");
  }
  delete state.terrain;
  const savedFog = state.fog;
  delete state.fog;
  if (savedFog !== undefined && (!map || !isValidFogState(savedFog, map)))
    throw new RangeError("Mission state has invalid fog.");
  const ownerIds = validateOwners(state.owners, state.playerOwner);
  deepFreeze(state.owners);
  const playerOwner = state.playerOwner;
  validateRelationships(state.relationships, ownerIds);
  deepFreeze(state.relationships);
  const events = deepFreeze(structuredClone(authoredEvents));
  validateEvents(events, state.firedEvents, {
    ownerIds,
    objectiveIds: new Set(objectives.map(({ id }) => id)),
  });
  deepFreeze(state.firedEvents);
  let relations = createRelations(state.relationships);
  const worldBounds = { ...bounds };
  const behaviorsById = new Map(behaviorRegistry);
  const definitionsById = indexDefinitions(
    structuredClone(definitions),
    behaviorsById,
    map,
    occupancy,
  );
  validateProductionDefinitions(definitionsById, behaviorsById, map);
  validateEconomyDefinitions(definitionsById);
  validateWrecks(state.wrecks, {
    map,
    retiredIds: new Set(state.retiredActorIds),
    owners: ownerIds,
    definitions: definitionsById,
    bounds: worldBounds,
    tick: state.tick,
  });
  deepFreeze(state.wrecks);
  if (state.economy)
    validateEconomyState(
      state.economy,
      state.actors,
      definitionsById,
      map,
      tickSeconds,
      state.retiredActorIds,
    );
  if (state.economy) deepFreeze(state.economy);
  const supportResolver = createSupportResolver(definitionsById);
  const supportFor = (actors: readonly Actor[]) =>
    supportResolver(actors, relations.sharesSupport);
  let actorsById = new Map<string, Actor>();
  let usedActorIds = new Set(state.retiredActorIds);
  for (const job of state.economy?.production ?? [])
    usedActorIds.add(job.actorId);
  const queuedCreationIds = () =>
    new Set(
      state.commands.flatMap(({ command }) =>
        command.kind === "place-actor" || command.kind === "train-unit"
          ? [command.actorId]
          : [],
      ),
    );
  let queuedActorIds = queuedCreationIds();
  const nextActorNumbers = new Map<string, number>();
  let actorVersion = 0;
  let faulted = false;
  let disposed = false;
  let ticking = false;
  const ensureRunning = () => {
    if (disposed) throw new Error("Mission simulation is disposed.");
    if (faulted) throw new Error("Mission simulation is faulted.");
  };
  const ensureMutable = () => {
    ensureRunning();
    if (ticking) throw new Error("Mission mutations cannot run during a tick.");
    if (ended()) throw new Error("The mission has ended.");
  };
  const definitionFor = (actor: Actor): ActorDefinition =>
    definitionsById.get(actor.definitionId)!;
  const behaviorFor = (actor: Actor): ActorBehavior =>
    behaviorsById.get(definitionFor(actor).behaviorId)!;
  const ensureValidActor = (actor: Actor) => {
    if (
      !isId(actor.id) ||
      !definitionsById.has(actor.definitionId) ||
      !ownerIds.has(actor.owner)
    ) {
      throw new RangeError("Actor has an invalid identity.");
    }
    const definition = definitionFor(actor);
    if (
      (definition.footprint !== undefined) !==
      (actor.tilePlacement !== undefined)
    ) {
      throw new RangeError(
        `Actor ${actor.id} requires its definition's tile placement.`,
      );
    }
    if (!isFinitePosition(actor.worldPosition)) {
      throw new RangeError(`Actor ${actor.id} has an invalid world position.`);
    }
    if (!withinBounds(actor.worldPosition, worldBounds)) {
      throw new RangeError(`Actor ${actor.id} is outside the world bounds.`);
    }
    if (!Number.isFinite(actor.facing)) {
      throw new RangeError(`Actor ${actor.id} has an invalid facing.`);
    }
    if (!isOccupancyLayer(actor.occupancyLayer)) {
      throw new RangeError(`Actor ${actor.id} has an invalid occupancy layer.`);
    }
    if (isTilePlacedActor(actor)) {
      if (
        !isValidTilePlacement(actor.tilePlacement) ||
        actor.movement !== undefined ||
        actor.occupancyLayer !== definition.footprint!.layer
      ) {
        throw new RangeError(
          `Actor ${actor.id} has an invalid tile placement.`,
        );
      }
      // Footprint definitions require a map.
      const pose = tilePlacedPose(map!, actor, definition);
      if (
        actor.worldPosition.x !== pose.worldPosition.x ||
        actor.worldPosition.z !== pose.worldPosition.z ||
        actor.facing !== pose.facing
      ) {
        throw new RangeError(`Actor ${actor.id} changed its tile-placed pose.`);
      }
    }
    const construction = actor.construction;
    if (
      construction !== undefined &&
      (!construction ||
        !state.economy ||
        !isTilePlacedActor(actor) ||
        construction.paidCost !== costAmount(definition) ||
        !isCount(construction.completedTicks) ||
        construction.totalTicks !==
          secondsToTicks(definition.constructionSeconds, tickSeconds) ||
        construction.completedTicks >= construction.totalTicks)
    )
      throw new RangeError(`Actor ${actor.id} has invalid construction state.`);
    if (
      actor.rallyPoint !== undefined &&
      (!isTilePlacedActor(actor) ||
        !definition.production ||
        !actor.rallyPoint ||
        !isFinitePosition(actor.rallyPoint) ||
        !withinBounds(actor.rallyPoint, worldBounds))
    )
      throw new RangeError(`Actor ${actor.id} has an invalid rally point.`);
    if (
      actor.movement !== undefined &&
      (!actor.movement ||
        !isFinitePosition(actor.movement.target) ||
        !withinBounds(actor.movement.target, worldBounds))
    ) {
      throw new RangeError(`Actor ${actor.id} has an invalid move target.`);
    }
    if (
      actor.orders !== undefined &&
      (!Array.isArray(actor.orders) ||
        actor.orders.length === 0 ||
        !isMobileActor(actor, definition) ||
        !actor.orders.every(
          (order) =>
            isQueuedOrder(order) &&
            canQueueOrder(order, definition, !!state.economy) &&
            (!("target" in order) || withinBounds(order.target, worldBounds)) &&
            (!("requestedTarget" in order) ||
              order.requestedTarget === undefined ||
              withinBounds(order.requestedTarget, worldBounds)),
        ))
    )
      throw new RangeError(`Actor ${actor.id} has invalid queued orders.`);
    validateCombatActor(actor, definition, worldBounds);
    behaviorFor(actor).validateActor?.(actor, definitionFor(actor));
  };
  const validateUpdate = (actor: Actor, before: ActorIdentity) => {
    if (
      actor.id !== before.id ||
      actor.definitionId !== before.definitionId ||
      actor.owner !== before.owner ||
      actor.occupancyLayer !== before.occupancyLayer ||
      !sameTilePlacement(actor.tilePlacement, before.tilePlacement)
    ) {
      throw new RangeError(
        `Actor ${before.id} changed its identity, owner, layer, or placement.`,
      );
    }
    ensureValidActor(actor);
  };
  const register = (actor: Actor, peers?: readonly Actor[]): Actor => {
    if (usedActorIds.has(actor.id)) {
      throw new Error(`Duplicate or retired actor ID: ${actor.id}.`);
    }
    if (!definitionsById.has(actor.definitionId)) {
      throw new Error(
        `Actor ${actor.id} references unknown definition ` +
          `${actor.definitionId}.`,
      );
    }
    // Position and facing follow from a tile placement, so callers need not
    // reproduce them exactly.
    const definition = definitionFor(actor);
    if (
      isTilePlacedActor(actor) &&
      definition.footprint &&
      isValidTilePlacement(actor.tilePlacement)
    ) {
      Object.assign(actor, tilePlacedPose(map!, actor, definition));
    }
    ensureValidActor(actor);
    if (peers)
      validateWildlife(
        state.wildlife,
        [...peers, actor],
        definitionsById,
        state.retiredActorIds,
        worldBounds,
        state.tick,
      );
    const committed = deepFreeze(actor);
    actorsById.set(committed.id, committed);
    usedActorIds.add(committed.id);
    return committed;
  };
  state.actors = freezeActors(state.actors.map((actor) => register(actor)));
  validateWildlife(
    state.wildlife,
    state.actors,
    definitionsById,
    state.retiredActorIds,
    worldBounds,
    state.tick,
  );
  deepFreeze(state.wildlife);

  const evaluatePlacement = (
    placement: ActorPlacement,
    owner: string,
    actors: readonly Actor[],
    usedIds: ReadonlySet<string>,
    economy?: EconomyState,
    debris?: ReadonlySet<string>,
  ): PlacementEvaluation => {
    const reject = (reason: PlacementReason): PlacementEvaluation => ({
      accepted: false,
      reason,
      tiles: [],
    });
    const { actorId, definitionId, origin, quarterTurns = 0 } = placement;
    if (
      !map ||
      !occupancy ||
      !isId(actorId) ||
      !isValidTilePlacement({ origin, quarterTurns })
    ) {
      return reject("invalid-actor");
    }
    if (usedIds.has(actorId)) {
      return reject("used-id");
    }
    const definition = definitionsById.get(definitionId);
    if (!definition) {
      return reject("unknown-definition");
    }
    if (!definition.footprint) {
      return reject("not-placeable");
    }
    const actor = createTilePlacedActor(map, definition, placement, owner);
    let workerId: string | undefined;
    const evaluation = evaluateFootprint(
      map,
      occupancy,
      actor,
      definition,
      actors,
    );
    if (
      evaluation.accepted &&
      fog &&
      evaluation.tiles.some(({ x, z }) => !fog.isExplored(x, z))
    )
      return { ...reject("unexplored"), tiles: evaluation.tiles };
    if (
      evaluation.accepted &&
      debris &&
      evaluation.tiles.some((tile) => debris.has(tileKey(tile)))
    )
      return { ...reject("debris"), tiles: evaluation.tiles };
    if (evaluation.accepted && economy) {
      if (!canAfford(economy, definition))
        return { ...reject("insufficient-resources"), tiles: evaluation.tiles };
      const resources = new Set(
        [
          ...activeSites(economy),
          ...economy.loot.filter((loot) => !loot.collected),
        ].map((resource) => tileKey(resource.tile)),
      );
      if (evaluation.tiles.some((tile) => resources.has(tileKey(tile))))
        return { ...reject("resource-site"), tiles: evaluation.tiles };
      if (definition.growth) {
        if (
          !growthHeadquarters(
            actor,
            actors,
            definitionsById,
            relations.sharesHeadquarters,
          ).length
        )
          return { ...reject("missing-headquarters"), tiles: evaluation.tiles };
        const workerIds = placement.workerIds ?? [];
        if (!growthCandidates(actor, workerIds, actors, definitionsById).length)
          return { ...reject("missing-worker"), tiles: evaluation.tiles };
        const tender = growthWorkerFor(actor, workerIds, actors, {
          definitions: definitionsById,
          behaviors: behaviorsById,
          map,
        });
        if (!tender)
          return { ...reject("unreachable-growth"), tiles: evaluation.tiles };
        workerId = tender.id;
      }
      if (
        definition.support &&
        !supportsPosition(
          supportFor(actors),
          actor.worldPosition,
          { owner, faction: definition.faction },
          relations.sharesSupport,
        )
      )
        return { ...reject("outside-support"), tiles: evaluation.tiles };
    }
    if (evaluation.accepted) {
      try {
        ensureValidActor(actor);
      } catch {
        return { ...reject("invalid-actor"), tiles: evaluation.tiles };
      }
    }
    return evaluation.accepted && workerId
      ? { ...evaluation, workerId }
      : evaluation;
  };

  const evaluateTraining = (
    command: TrainUnitCommand,
    actors: readonly Actor[],
    usedIds: ReadonlySet<string>,
    economy?: EconomyState,
  ): TrainingEvaluation => {
    if (
      economy &&
      disconnectedBuildings(supportFor(actors)).has(command.producerId)
    )
      return { accepted: false, reason: "disconnected" };
    const evaluation = evaluateUnitTraining(command, {
      actors,
      usedIds,
      definitions: definitionsById,
      canStandAt: (unit, tile) =>
        behaviorsById.get(unit.behaviorId)!.canStandAt!(unit, tile),
      map,
      occupancy,
      bounds: worldBounds,
    });
    if (
      economy &&
      (evaluation.accepted || evaluation.reason === "exit-blocked")
    ) {
      const definition = definitionsById.get(command.definitionId)!;
      if (!canAfford(economy, definition))
        return { accepted: false, reason: "insufficient-resources" };
      if (
        economy.production.filter(
          (job) => job.producerId === command.producerId,
        ).length >= PRODUCTION_QUEUE_LIMIT
      )
        return { accepted: false, reason: "queue-full" };
      if (
        definition.harvesting &&
        refineryOccupied(economy, command.producerId)
      )
        return { accepted: false, reason: "refinery-occupied" };
      return { accepted: true, queued: true };
    }
    if (evaluation.accepted && "actor" in evaluation) {
      try {
        ensureValidActor(evaluation.actor);
      } catch {
        return { accepted: false, reason: "invalid-actor" };
      }
    }
    return evaluation;
  };
  const evaluateRallyPoint = (
    producer: Actor | undefined,
    target: WorldPosition,
  ) => {
    const unitIds = trainableUnitIds(producer, definitionsById);
    if (
      !map ||
      !occupancy ||
      !unitIds.length ||
      !target ||
      !isFinitePosition(target) ||
      !withinBounds(target, worldBounds)
    )
      return false;
    const tile = map.tileAtWorldPosition(target.x, target.z);
    return (
      (!fog || fog.isExplored(tile.x, tile.z)) &&
      occupancy.ownerAt(tile.x, tile.z, "surface") === undefined &&
      unitIds.every((id) => {
        const unit = definitionsById.get(id)!;
        return behaviorsById.get(unit.behaviorId)!.canStandAt!(unit, tile);
      })
    );
  };
  /** Takes an actor out of the staged tick without refunds. */
  const retire = (working: WorkingActors, actor: Actor) => {
    if (working.economy) {
      const interrupted = removeEconomyActor(working.economy, actor.id, (id) =>
        working.retiredIds.push(id),
      );
      for (const id of interrupted) delete working.actorsById.get(id)!.movement;
    }
    for (const building of working.actors) {
      const construction = building.construction;
      if (construction?.headquartersId === actor.id) {
        delete construction.headquartersId;
        delete construction.active;
      }
    }
    if (isTilePlacedActor(actor)) {
      occupancy!.remove(actor.id);
    }
    working.actorsById.delete(actor.id);
    working.actors.splice(working.actors.indexOf(actor), 1);
    working.retiredIds.push(actor.id);
    working.lifecycleChanges += 1;
  };
  const stageActor = (working: WorkingActors, actor: Actor) => {
    working.actors.push(actor);
    working.actorsById.set(actor.id, actor);
    working.usedIds.add(actor.id);
    working.lifecycleChanges += 1;
  };
  const stageProducedActor = (
    working: WorkingActors,
    actor: Actor,
    producerId: string,
  ) => {
    const rally = working.actorsById.get(producerId)?.rallyPoint;
    if (rally) moveActor(actor, rally);
    stageActor(working, actor);
    working.activity.push({
      buildingId: producerId,
      kind: "exit",
      actorId: actor.id,
    });
  };
  /** Starts a route for automated work; returns whether it was accepted. */
  const moveActor = (
    actor: Actor,
    target: WorldPosition,
    bounds?: RouteBounds,
  ) =>
    behaviorFor(actor).handleCommand(actor, definitionFor(actor), {
      kind: "move",
      actorId: actor.id,
      target: { ...target },
      ...(bounds && { bounds }),
    });
  /** Copies committed state for changes that commit together. */
  const stageWorking = (): WorkingActors => {
    const actors = state.actors.map((actor) => structuredClone(actor));
    return {
      actors,
      actorsById: new Map(actors.map((actor) => [actor.id, actor])),
      usedIds: new Set(usedActorIds),
      retiredIds: [...state.retiredActorIds],
      lifecycleChanges: 0,
      activity: [],
      economy: state.economy && structuredClone(state.economy),
      wrecks: [...state.wrecks],
      wildlife: structuredClone(state.wildlife),
      objectives: structuredClone(state.objectives),
    };
  };

  // Validate the whole candidate world without publishing edits or losing the
  // live world's navigation history when initialization fails.
  const initialFootprints: FootprintPlacement[] = [];
  if (map && (savedTerrain || occupancy)) {
    const candidateMap = new TerrainGrid({
      width: map.width,
      height: map.height,
      tileSize: map.tileSize,
      terrainTypeIds: [...map.terrainTypeIds],
      createHeight: (x, z) => map.heightAt(x, z),
      createTerrain: (x, z) => map.terrainAt(x, z),
    });
    if (savedTerrain) candidateMap.restoreTerrainState(savedTerrain);
    const candidateOccupancy = new OccupancyGrid(candidateMap);
    for (const actor of state.actors) {
      if (!isTilePlacedActor(actor)) continue;
      // A save keeps units that crossed nonblocking footprints.
      const evaluation = evaluateFootprint(
        candidateMap,
        candidateOccupancy,
        actor,
        definitionFor(actor),
        restoringSnapshot ? undefined : state.actors,
      );
      if (!evaluation.accepted) {
        throw new RangeError(
          `Actor ${actor.id} has invalid placement: ${evaluation.reason}.`,
        );
      }
      candidateOccupancy.place(evaluation.footprint);
      initialFootprints.push(evaluation.footprint);
    }
  }

  /** Places the footprints of committed tile-placed actors. */
  const rebuildOccupancy = () => {
    occupancy!.clear();
    for (const actor of state.actors) {
      if (isTilePlacedActor(actor)) {
        occupancy!.place(footprintPlacementFor(actor, definitionFor(actor)));
      }
    }
  };
  if (occupancy) {
    occupancy.clear();
    for (const footprint of initialFootprints) occupancy.place(footprint);
  }
  if (savedTerrain) map!.restoreTerrainState(savedTerrain);
  if (map && occupancy) {
    const navigationVersion = map.navigationChanges.version;
    // Scenario or restored occupancy is the baseline, not a dynamic change.
    map.navigationChanges.restart(restoringSnapshot ? navigationVersion : 0);
  }
  const releaseTerrainRule =
    map && occupancy
      ? map.addEditRule((edit) => occupancy.allowsTerrainEdit(edit))
      : undefined;
  // Fog requires a map, which the saved-fog check above ensures.
  const fog = savedFog && createFog(map!, savedFog);
  const ownerVision = createOwnerVision({
    map,
    fog,
    owners: state.owners,
    playerOwner,
    definitions: definitionsById,
  });
  const updateFog = () =>
    ownerVision.update(
      state.actors,
      state.economy && supportFor(state.actors),
      relations.sharesVision,
    );
  updateFog();
  const { sees, detects } = ownerVision;
  const wreckTicks = secondsToTicks(WRECK_SECONDS, tickSeconds);
  /** Footprint tiles under building debris, rebuilt when wrecks change. */
  const debrisFor = (wrecks: readonly Wreck[]) =>
    new Set(
      wrecks.flatMap((wreck) =>
        wreckTiles(wreck, definitionsById.get(wreck.definitionId)!).map(
          tileKey,
        ),
      ),
    );
  let debrisTiles = debrisFor(state.wrecks);
  let attacks: readonly AttackEvent[] = [];
  let buildingActivity: readonly BuildingActivity[] = [];

  /** Mobile actors whose behavior exposes navigation queries. */
  const navigatingActor = (actor: Actor): NavigatingActor | undefined => {
    const definition = definitionFor(actor);
    if (!isMobileActor(actor, definition)) return undefined;
    const grid = behaviorFor(actor).navigationGrid?.(actor, definition);
    return grid && { actor, definition, grid };
  };
  const handle = (working: WorkingActors, applied: AppliedActorCommand) => {
    const actor = working.actorsById.get(applied.actorId);
    if (!actor) return false;
    const before = actorIdentity(actor);
    const accepted = behaviorFor(actor).handleCommand(
      actor,
      definitionFor(actor),
      applied,
    );
    if (accepted) {
      clearCombatOrders(actor);
      interruptWorker(actor, working.economy);
    }
    validateUpdate(actor, before);
    return accepted;
  };
  /** Whether an actor is still carrying out an order or a harvest trip. */
  const busy = (actor: Actor, economy: EconomyState | undefined) =>
    (!!actor.movement && !actor.movement.blocked) ||
    (!!actor.attackMove && !actor.attackMove.blocked) ||
    !!actor.combat?.attack ||
    (!!actor.combat?.returning && !actor.combat.returning.blocked) ||
    workerHasOrder(economy, actor.id);
  const queuedOrderOf = (
    command: ActorOrderCommand,
    requestedTarget?: WorldPosition,
  ): QueuedOrder | undefined => {
    switch (command.kind) {
      case "move":
      case "attack-move":
        return {
          kind: command.kind,
          target: clampToBounds(command.target, worldBounds),
          ...(requestedTarget && { requestedTarget: { ...requestedTarget } }),
        };
      case "attack":
        return { kind: "attack", targetId: command.targetId };
      case "gather":
        return { kind: "gather", siteId: command.siteId };
      default:
        return undefined;
    }
  };
  /** Queues a queued order behind a busy actor's current one. */
  const sequence = (
    command: ActorOrderCommand,
    order: QueuedOrder | undefined,
    tick: number,
    working: WorkingActors,
  ): CommandOutcome | undefined => {
    const actor = working.actorsById.get(command.actorId);
    if (!actor || !("queued" in command && command.queued)) return undefined;
    if (!actor.orders && !busy(actor, working.economy)) return undefined;
    const definition = definitionFor(actor);
    // Only checks it can ever carry the order out; the rest waits until then.
    const accepted =
      !!order &&
      isMobileActor(actor, definition) &&
      canQueueOrder(order, definition, !!working.economy);
    if (accepted) (actor.orders ??= []).push(order);
    return {
      tick,
      command: structuredClone(command),
      accepted,
      ...(accepted
        ? { queued: true }
        : order?.kind === "attack" && !definition.weapon
          ? { reason: "unarmed" }
          : order?.kind === "gather" &&
              !definition.harvesting &&
              !definition.cultivation
            ? { reason: "invalid-harvester" }
            : {}),
    } as CommandOutcome;
  };
  // A rejected order leaves the current one and its queue running.
  const replaceQueue = (outcome: CommandOutcome, working: WorkingActors) => {
    if (outcome.accepted && "actorId" in outcome.command)
      delete working.actorsById.get(outcome.command.actorId)?.orders;
    return outcome;
  };
  /** Starts an idle actor's queued orders until one is under way. */
  const startQueuedOrders = (
    actor: Actor,
    tick: number,
    working: WorkingActors,
  ) => {
    while (actor.orders && !busy(actor, working.economy)) {
      const order = actor.orders.shift()!;
      if (!actor.orders.length) delete actor.orders;
      const command = { ...structuredClone(order), actorId: actor.id };
      if (command.kind === "move" || command.kind === "attack-move") {
        const { requestedTarget, ...move } = command;
        applyMove(move, tick, working, requestedTarget);
      } else executeCommand(command, tick, working);
    }
  };
  const applyMove = (
    command: MoveCommand | AttackMoveCommand,
    tick: number,
    working: WorkingActors,
    requestedTarget?: WorldPosition,
  ): CommandOutcome => {
    const accepted = handle(working, {
      ...command,
      kind: "move",
      ...(requestedTarget && { requestedTarget }),
    });
    if (accepted && command.kind === "attack-move") {
      working.actorsById.get(command.actorId)!.attackMove = {
        target: { ...command.target },
        ...(requestedTarget && { requestedTarget: { ...requestedTarget } }),
      };
    }
    return {
      tick,
      command,
      accepted,
      reachedTarget: accepted
        ? requestedTarget
          ? false
          : working.actorsById.get(command.actorId)?.movement?.reachedTarget
        : undefined,
    } as CommandOutcome;
  };
  /** Reports one move outcome per unique actor ID, in ID order. */
  const applyGroupMove = (
    command: GroupMoveCommand | GroupAttackMoveCommand,
    tick: number,
    working: WorkingActors,
  ): CommandOutcome[] => {
    const target = clampToBounds(command.target, worldBounds);
    const ids = [...new Set(command.actorIds)].sort();
    const movers = ids.flatMap((id) => {
      const actor = working.actorsById.get(id);
      const mover = actor && navigatingActor(actor);
      return mover ? [mover] : [];
    });
    const destinations = new Map(
      assignGroupDestinations(
        movers,
        working.actors.map((actor) => ({
          actor,
          definition: definitionFor(actor),
        })),
        target,
        worldBounds,
      ).map((destination) => [destination.actorId, destination]),
    );
    return ids.map((actorId) => {
      const destination = destinations.get(actorId);
      const move: MoveCommand | AttackMoveCommand = {
        kind: command.kind === "group-attack-move" ? "attack-move" : "move",
        actorId,
        target: destination?.target ?? target,
        ...(command.queued && { queued: true }),
      };
      const waiting = sequence(
        move,
        destination && queuedOrderOf(move, destination.requestedTarget),
        tick,
        working,
      );
      if (waiting) return waiting;
      return destination
        ? replaceQueue(
            applyMove(move, tick, working, destination.requestedTarget),
            working,
          )
        : ({ tick, command: move, accepted: false } as CommandOutcome);
    });
  };
  /** Group moves expand into one outcome per member. */
  const applyCommand = (
    command: MissionCommand,
    tick: number,
    working: WorkingActors,
  ): CommandOutcome[] => {
    // Submissions are untrusted; reject what a save could not hold.
    if (!isMissionCommand(command)) {
      const { kind } = command as { kind?: unknown };
      return [
        {
          tick,
          command: structuredClone(command),
          accepted: false,
          ...((kind === "place-actor" || kind === "train-unit") && {
            reason: "invalid-actor",
          }),
        } as CommandOutcome,
      ];
    }
    if (command.kind === "group-move" || command.kind === "group-attack-move")
      return applyGroupMove(command, tick, working);
    if (!isCommandOf(command, ACTOR_ORDER_KINDS))
      return [executeCommand(command, tick, working)];
    return [
      sequence(command, queuedOrderOf(command), tick, working) ??
        replaceQueue(executeCommand(command, tick, working), working),
    ];
  };
  const applyEconomyCommand = (
    command: EconomyCommand,
    tick: number,
    working: WorkingActors,
  ) => {
    const applied = structuredClone(command);
    if (!working.economy)
      return {
        tick,
        command: applied,
        accepted: false,
      } as CommandOutcome<EconomyCommand>;
    const site =
      applied.kind === "gather" &&
      economySites(working.economy).find((site) => site.id === applied.siteId);
    const actor = working.actorsById.get(applied.actorId);
    const reason =
      site && actor && !ownerVision.knowsTile(actor.owner, site.tile)
        ? "missing-site"
        : applyEconomy(
            applied,
            working.economy,
            working.actors,
            definitionsById,
            (id) => working.retiredIds.push(id),
          );
    return {
      tick,
      command: applied,
      accepted: !reason,
      ...(reason && { reason }),
    } as CommandOutcome<EconomyCommand>;
  };
  const applyRemoval = (
    command: ActorRemovalCommand,
    tick: number,
    working: WorkingActors,
  ) => {
    const applied = structuredClone(command);
    const outcome = (accepted: boolean) =>
      ({ tick, command: applied, accepted }) as CommandOutcome;
    const actor = working.actorsById.get(applied.actorId);
    const economy = working.economy;
    if (!actor) return outcome(false);
    if (
      command.kind === "sell-actor" &&
      (!economy || !isTilePlacedActor(actor) || actor.construction)
    )
      return outcome(false);
    if (
      command.kind === "cancel-construction" &&
      (!economy || !actor.construction)
    )
      return outcome(false);
    if (economy && command.kind === "cancel-construction")
      refundCost(economy, definitionFor(actor), actor.construction!.paidCost);
    if (economy && command.kind === "sell-actor")
      refundCost(
        economy,
        definitionFor(actor),
        saleRefund(actor, definitionFor(actor)),
      );
    retire(working, actor);
    return outcome(true);
  };
  const applyMoveCommand = (
    command: MoveCommand | AttackMoveCommand,
    tick: number,
    working: WorkingActors,
  ) => {
    // Rebuilt so a submitted move cannot carry mission-only fields.
    const applied: MoveCommand | AttackMoveCommand = {
      kind: command.kind,
      actorId: command.actorId,
      target: clampToBounds(command.target, worldBounds),
    };
    return applyMove(applied, tick, working);
  };
  /** One handler per single-actor command kind; adding a kind requires one. */
  const handlers: CommandHandlers = {
    "set-rally-point": (command, tick, working) => {
      const applied = structuredClone(command);
      const actor = working.actorsById.get(applied.actorId);
      const accepted =
        applied.target === undefined
          ? trainableUnitIds(actor, definitionsById).length > 0
          : evaluateRallyPoint(actor, applied.target);
      if (accepted) {
        if (applied.target) actor!.rallyPoint = { ...applied.target };
        else delete actor!.rallyPoint;
      }
      return { tick, command: applied, accepted };
    },
    terrain: (command, tick) => {
      const edit = structuredClone(command);
      const accepted = !!map && map.isValidTerrainEdit(edit);
      if (accepted) map.editTerrain(edit);
      return { tick, command: edit, accepted };
    },
    "place-actor": (command, tick, working) => {
      const applied = structuredClone(command);
      // Commands carry no issuing owner yet, so the player places.
      const evaluation = evaluatePlacement(
        applied,
        playerOwner,
        working.actors,
        working.usedIds,
        working.economy,
        debrisTiles,
      );
      if (!evaluation.accepted)
        return {
          tick,
          command: applied,
          accepted: false,
          reason: evaluation.reason,
        };
      const tender = evaluation.workerId
        ? working.actorsById.get(evaluation.workerId)
        : undefined;
      occupancy!.place(evaluation.footprint);
      if (working.economy) {
        const definition = definitionFor(evaluation.actor);
        const cost = chargeCost(working.economy, definition);
        evaluation.actor.construction = {
          paidCost: cost,
          completedTicks: 0,
          totalTicks: secondsToTicks(
            definition.constructionSeconds,
            tickSeconds,
          ),
        };
      }
      stageActor(working, evaluation.actor);
      if (working.economy && definitionFor(evaluation.actor).growth) {
        applyEconomy(
          { kind: "tend", actorId: tender!.id, buildingId: applied.actorId },
          working.economy,
          working.actors,
          definitionsById,
          () => {},
        );
        delete tender!.orders;
      }
      return { tick, command: applied, accepted: true };
    },
    "train-unit": (command, tick, working) => {
      const applied = structuredClone(command);
      const evaluation = evaluateTraining(
        applied,
        working.actors,
        working.usedIds,
        working.economy,
      );
      if (!evaluation.accepted)
        return {
          tick,
          command: applied,
          accepted: false,
          reason: evaluation.reason,
        };
      if (working.economy) {
        const definition = definitionsById.get(applied.definitionId)!;
        const cost = chargeCost(working.economy, definition);
        working.economy.production.push({
          actorId: applied.actorId,
          producerId: applied.producerId,
          definitionId: applied.definitionId,
          paidCost: cost,
          completedTicks: 0,
          totalTicks: secondsToTicks(definition.trainingSeconds, tickSeconds),
          exitBlocked: false,
        });
        working.usedIds.add(applied.actorId);
      } else if ("actor" in evaluation) {
        stageProducedActor(working, evaluation.actor, applied.producerId);
      }
      return { tick, command: applied, accepted: true };
    },
    gather: applyEconomyCommand,
    tend: applyEconomyCommand,
    "assign-refinery": applyEconomyCommand,
    "return-cargo": applyEconomyCommand,
    "cancel-production": applyEconomyCommand,
    "remove-actor": applyRemoval,
    "sell-actor": applyRemoval,
    "cancel-construction": applyRemoval,
    attack: (command, tick, working) => {
      const applied = structuredClone(command);
      const actor = working.actorsById.get(applied.actorId);
      const target = working.actorsById.get(applied.targetId);
      const reason = attackRejection(actor, target, {
        definitions: definitionsById,
        detects,
        hostile: relations.hostile,
      });
      if (!reason) {
        startAttack(actor!, target!);
        interruptWorker(actor!, working.economy);
      }
      return {
        tick,
        command: applied,
        accepted: !reason,
        ...(reason && { reason }),
      };
    },
    move: applyMoveCommand,
    "attack-move": applyMoveCommand,
    stop: (command, tick, working) => {
      const applied = structuredClone(command);
      return { tick, command: applied, accepted: handle(working, applied) };
    },
  };
  const executeCommand = (
    command: SingleCommand,
    tick: number,
    working: WorkingActors,
  ): CommandOutcome =>
    (handlers[command.kind] as CommandHandler<SingleCommand>)(
      command,
      tick,
      working,
    );

  return {
    get actors() {
      return state.actors;
    },
    get actorVersion() {
      return actorVersion;
    },
    get completedTicks() {
      return state.tick;
    },
    tickSeconds,
    get support() {
      return state.economy ? supportFor(state.actors) : undefined;
    },
    get economy() {
      return state.economy;
    },
    get fog() {
      return fog;
    },
    owners: state.owners,
    playerOwner,
    playerFaction: playerFactionOf(state),
    get attacks() {
      return attacks;
    },
    get buildingActivity() {
      return buildingActivity;
    },
    get result() {
      return resultOf(state.objectives);
    },
    get objectives() {
      return objectivesFor(state.objectives).views;
    },
    get wrecks() {
      return state.wrecks;
    },
    get relations() {
      return relations;
    },
    detects,
    sees,
    actorById: (id) => {
      const actor = actorsById.get(id);
      return actor && structuredClone(actor);
    },
    evaluatePlacement: (placement) =>
      evaluatePlacement(
        structuredClone(placement),
        playerOwner,
        state.actors,
        usedActorIds,
        state.economy,
        debrisTiles,
      ),
    evaluateTraining: (command) =>
      evaluateTraining(
        structuredClone(command),
        state.actors,
        usedActorIds,
        state.economy,
      ),
    evaluateRallyPoint: (id, target) =>
      evaluateRallyPoint(actorsById.get(id), target),
    tendWorker: (buildingId, workerIds) => {
      const building = actorsById.get(buildingId);
      if (
        !map ||
        !building?.construction ||
        !definitionFor(building).growth ||
        state.economy?.cultivation?.workers.some(
          (worker) => worker.tendingId === buildingId,
        )
      )
        return undefined;
      return growthWorkerFor(building, workerIds, state.actors, {
        definitions: definitionsById,
        behaviors: behaviorsById,
        map,
      })?.id;
    },
    unusedActorId: (prefix) => {
      let number = nextActorNumbers.get(prefix) ?? 1;
      while (usedActorIds.has(`${prefix}${number}`)) number += 1;
      // Only committed IDs are permanent; rejected queued requests free theirs.
      nextActorNumbers.set(prefix, number);
      while (
        usedActorIds.has(`${prefix}${number}`) ||
        queuedActorIds.has(`${prefix}${number}`)
      )
        number += 1;
      return `${prefix}${number}`;
    },
    submitCommand: (command) => {
      ensureMutable();
      const submitted = structuredClone(command);
      if (!isRecord(submitted))
        throw new RangeError("Mission command must be an object.");
      state.commands.push({
        tick: state.tick,
        command: submitted,
      });
      if (
        isMissionCommand(submitted) &&
        (submitted.kind === "place-actor" || submitted.kind === "train-unit")
      )
        queuedActorIds.add(submitted.actorId);
      return state.tick;
    },
    spawnActor: (actor) => {
      ensureMutable();
      const copy = structuredClone(actor);
      let footprint: FootprintPlacement | undefined;
      if (copy.tilePlacement !== undefined) {
        const evaluation = evaluatePlacement(
          {
            actorId: copy.id,
            definitionId: copy.definitionId,
            ...copy.tilePlacement,
          },
          copy.owner,
          state.actors,
          usedActorIds,
        );
        if (!evaluation.accepted) {
          throw new RangeError(
            `Actor ${copy.id} has invalid placement: ${evaluation.reason}.`,
          );
        }
        footprint = evaluation.footprint;
      }
      const definition = definitionFor(copy);
      let economy = state.economy;
      if (state.economy && (definition.harvesting || definition.cultivation)) {
        economy = structuredClone(state.economy);
        enrollWorker(economy, copy.id, definition);
      }
      state = {
        ...state,
        actors: freezeActors([...state.actors, register(copy, state.actors)]),
        ...(economy && { economy: deepFreeze(economy) }),
      };
      // Registered first, so a rejected actor never leaves occupancy behind.
      if (footprint) {
        occupancy!.place(footprint);
      }
      actorVersion += 1;
      updateFog();
    },
    removeActor: (id) => {
      ensureMutable();
      if (!actorsById.has(id)) {
        return false;
      }
      const working = stageWorking();
      retire(working, working.actorsById.get(id)!);
      state = {
        ...state,
        actors: freezeActors(working.actors.map((actor) => deepFreeze(actor))),
        retiredActorIds: working.retiredIds,
        ...(working.economy && { economy: deepFreeze(working.economy) }),
      };
      actorsById = new Map(state.actors.map((actor) => [actor.id, actor]));
      actorVersion += 1;
      updateFog();
      return true;
    },
    snapshot: () => {
      const snapshot = structuredClone(state);
      // Malformed commands only produce rejections, which loading refuses.
      snapshot.commands = snapshot.commands.filter(({ command }) =>
        isMissionCommand(command),
      );
      if (map) {
        snapshot.terrain = map.terrainState();
      }
      if (fog) snapshot.fog = fog.state();
      return snapshot;
    },
    dispose: () => {
      if (disposed) return;
      if (ticking)
        throw new Error("Mission disposal cannot run during a tick.");
      disposed = true;
      releaseTerrainRule?.();
      ownerVision.dispose();
    },
    tick: () => {
      ensureRunning();
      if (ticking) throw new Error("Mission ticks cannot run recursively.");
      if (ended()) return [];
      const due = state.commands.filter(({ tick }) => tick <= state.tick);
      const terrainBefore =
        map && due.some(({ command }) => command.kind === "terrain")
          ? map.terrainState()
          : undefined;
      const versionBefore = map?.navigationChanges.version;
      ticking = true;
      try {
        const working = stageWorking();
        const outcomes = due.flatMap(({ command }) =>
          applyCommand(command, state.tick, working),
        );
        for (const actor of working.actors)
          startQueuedOrders(actor, state.tick, working);

        const navigationVersion = map?.navigationChanges.version ?? 0;
        const tickAttacks = updateCombat({
          tick: state.tick,
          tickSeconds,
          navigationVersion,
          actors: working.actors,
          controllers: [
            createTerritoryController(working.wildlife),
            guardController,
          ],
          destination: (actor, point, routeBounds) => {
            const grid = behaviorFor(actor).navigationGrid?.(
              actor,
              definitionFor(actor),
              routeBounds,
            );
            if (!grid) return point;
            const resolved = resolveNavigationDestination(
              grid,
              actor.worldPosition,
              point,
            );
            return (
              resolved &&
              (resolved.reachedTarget
                ? point
                : grid.map.tileCenter(resolved.end.x, resolved.end.z))
            );
          },
          wrecks: working.wrecks,
          definitions: definitionsById,
          map,
          occupancy,
          detects,
          hostile: relations.hostile,
          move: moveActor,
          destroy: (actor) => {
            recordObjectiveDestruction(
              objectives,
              working.objectives,
              actor.id,
              state.tick,
            );
            working.wrecks.push({
              actorId: actor.id,
              definitionId: actor.definitionId,
              owner: actor.owner,
              worldPosition: { ...actor.worldPosition },
              facing: actor.facing,
              ...(actor.tilePlacement && {
                tilePlacement: structuredClone(actor.tilePlacement),
              }),
              tick: state.tick,
            });
            retire(working, actor);
          },
        });

        // A defeat freezes motion and the economy where combat left them.
        const verdict = objectivesFor(working.objectives);
        const defeated = verdict.result?.kind === "defeat";
        if (!defeated) {
          const previousPositions = new Map(
            working.actors.map((actor) => [
              actor.id,
              { ...actor.worldPosition },
            ]),
          );
          for (const actor of working.actors) {
            const before = actorIdentity(actor);
            const route = actor.movement;
            behaviorFor(actor).update(actor, definitionFor(actor), tickSeconds);
            noteAttackMoveRoute(actor, route, navigationVersion);
            // Rounding in a behavior's motion must not carry an actor off the map.
            if (isFinitePosition(actor.worldPosition)) {
              actor.worldPosition = clampToBounds(
                actor.worldPosition,
                worldBounds,
              );
            }
            validateUpdate(actor, before);
          }

          if (working.economy)
            updateEconomy(working.economy, {
              actors: working.actors,
              playerOwner,
              sharesHeadquarters: relations.sharesHeadquarters,
              knowsTile: ownerVision.knowsTile,
              definitions: definitionsById,
              behaviors: behaviorsById,
              map: map!,
              tickSeconds,
              move: moveActor,
              evaluateSpawn: ({ actorId, producerId, definitionId }) =>
                evaluateTraining(
                  { kind: "train-unit", actorId, producerId, definitionId },
                  working.actors,
                  new Set([...working.usedIds].filter((id) => id !== actorId)),
                ),
              support: () => supportFor(working.actors),
              spawn: (actor, producerId) =>
                stageProducedActor(working, actor, producerId),
              deliver: (refineryId, actorId) =>
                working.activity.push({
                  buildingId: refineryId,
                  kind: "delivery",
                  actorId,
                }),
            });

          separateMobileActors(
            working.actors.flatMap((actor) => {
              const mover = navigatingActor(actor);
              return mover ? [mover] : [];
            }),
            tickSeconds,
            previousPositions,
            ({ actor, definition }, point) =>
              withinBounds(point, worldBounds) &&
              leashAllows(actor, definition, point),
          );
        }
        for (const actor of working.actors)
          validateUpdate(
            actor,
            actorIdentity(actorsById.get(actor.id) ?? actor),
          );
        if (working.economy)
          validateEconomyState(
            working.economy,
            working.actors,
            definitionsById,
            map,
            tickSeconds,
            working.retiredIds,
          );
        validateWildlife(
          working.wildlife,
          working.actors,
          definitionsById,
          working.retiredIds,
          worldBounds,
          state.tick + 1,
        );
        // Events see the tick's outcome; their changes apply from the next tick.
        const fired =
          defeated || !events.length
            ? undefined
            : fireEvents(events, state, {
                completedTicks: state.tick + 1,
                tickSeconds,
                objectiveStatus: (id) =>
                  verdict.views.find((view) => view.id === id)?.status,
              });
        const previousWrecks = state.wrecks;
        const committedActors = freezeActors(
          working.actors.map((actor) => deepFreeze(actor)),
        );
        state = {
          ...state,
          tick: state.tick + 1,
          actors: committedActors,
          retiredActorIds: working.retiredIds,
          objectives: deepFreeze(working.objectives),
          ...(fired && {
            relationships: deepFreeze(fired.relationships),
            firedEvents: deepFreeze(fired.firedEvents),
          }),
          commands: defeated
            ? []
            : state.commands.filter(({ tick }) => tick > state.tick),
          ...(working.economy && { economy: deepFreeze(working.economy) }),
          wildlife: deepFreeze(working.wildlife),
          // Expiring here keeps previews and the next tick in agreement.
          wrecks: deepFreeze(
            working.wrecks.filter(
              (wreck) => state.tick + 1 - wreck.tick < wreckTicks,
            ),
          ),
        };
        if (
          state.wrecks.length !== previousWrecks.length ||
          state.wrecks.some(
            (wreck, index) => wreck.actorId !== previousWrecks[index]!.actorId,
          )
        )
          debrisTiles = debrisFor(state.wrecks);
        attacks = deepFreeze(tickAttacks);
        buildingActivity = deepFreeze(working.activity);
        actorsById = new Map(committedActors.map((actor) => [actor.id, actor]));
        usedActorIds = working.usedIds;
        if (due.length > 0) queuedActorIds = queuedCreationIds();
        actorVersion += working.lifecycleChanges;
        if (fired) relations = createRelations(state.relationships);
        updateFog();
        return outcomes;
      } catch (error) {
        faulted = true;
        // Return the world to the last committed tick, so no partial terrain or
        // footprint state stays published.
        if (map) {
          if (terrainBefore) map.restoreTerrainState(terrainBefore);
          if (occupancy) rebuildOccupancy();
          map.navigationChanges.restart(versionBefore!);
        }
        throw error;
      } finally {
        ticking = false;
      }
    },
  };
}

function canQueueOrder(
  order: QueuedOrder,
  definition: ActorDefinition,
  hasEconomy: boolean,
): boolean {
  return (
    (order.kind !== "attack" || !!definition.weapon) &&
    (order.kind !== "gather" ||
      (hasEconomy && (!!definition.harvesting || !!definition.cultivation)))
  );
}

type ActorOrderCommand = Extract<
  MissionCommand,
  { kind: (typeof ACTOR_ORDER_KINDS)[number] }
>;

/** A command for one actor or the mission as a whole, rather than a group. */
type SingleCommand = Exclude<
  MissionCommand,
  GroupMoveCommand | GroupAttackMoveCommand
>;

type CommandHandler<C extends SingleCommand> = (
  command: C,
  tick: number,
  working: WorkingActors,
) => CommandOutcome;

type CommandHandlers = {
  [K in SingleCommand["kind"]]: CommandHandler<
    Extract<SingleCommand, { kind: K }>
  >;
};

function indexDefinitions(
  definitions: readonly ActorDefinition[],
  behaviorRegistry: ReadonlyMap<string, ActorBehavior>,
  map: TerrainGrid | undefined,
  occupancy: OccupancyGrid | undefined,
): Map<string, ActorDefinition> {
  const definitionsById = new Map<string, ActorDefinition>();
  for (const definition of definitions) {
    if (definitionsById.has(definition.id)) {
      throw new Error(`Duplicate actor definition ID: ${definition.id}.`);
    }
    if (!behaviorRegistry.has(definition.behaviorId)) {
      throw new Error(
        `Actor definition ${definition.id} uses unknown behavior ` +
          `${definition.behaviorId}.`,
      );
    }
    if (definition.movement && !isNonnegative(definition.movement.speed)) {
      throw new RangeError(
        `Actor definition ${definition.id} has an invalid movement speed.`,
      );
    }
    if (
      definition.movement?.radius !== undefined &&
      !isPositive(definition.movement.radius)
    ) {
      throw new RangeError(
        `Actor definition ${definition.id} has an invalid movement radius.`,
      );
    }
    if (
      (definition.footprint || definition.placement) &&
      (!map || !occupancy)
    ) {
      throw new Error(
        `Actor definition ${definition.id} placement requires a terrain map ` +
          "and occupancy.",
      );
    }
    if (map) {
      validatePlacementDefinition(definition, map);
    }
    validateSupportDefinition(definition);
    validateVisionDefinition(definition);
    validateCombatDefinition(definition);
    deepFreeze(definition);
    behaviorRegistry
      .get(definition.behaviorId)!
      .validateDefinition?.(definition);
    definitionsById.set(definition.id, definition);
  }
  return definitionsById;
}

function freezeActors(actors: Actor[]): Actor[] {
  Object.freeze(actors);
  return actors;
}

function ensureValidBounds({ minX, maxX, minZ, maxZ }: WorldBounds): void {
  if (
    ![minX, maxX, minZ, maxZ].every(Number.isFinite) ||
    minX > maxX ||
    minZ > maxZ
  ) {
    throw new RangeError("Simulation world bounds are invalid.");
  }
}
