import {
  assignGroupDestinations,
  separateMobileActors,
} from "./group-movement";
import {
  evaluateTraining as evaluateUnitTraining,
  validateProductionDefinitions,
} from "./production";
import type { TrainingEvaluation } from "./production";
import type { TrainUnitCommand } from "./command";
import { clampToBounds, isFinitePosition, withinBounds } from "./world";
import { clearCombatOrders, deepFreeze } from "./actor";
import {
  ACTOR_ORDER_KINDS,
  ACTOR_REMOVAL_KINDS,
  ECONOMY_COMMAND_KINDS,
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
  createVision,
  isValidFogState,
  validateVisionDefinition,
  visionSources,
} from "./vision";
import {
  applyEconomyCommand,
  createHarvesterState,
  materialsCost,
  PRODUCTION_QUEUE_LIMIT,
  refineryOccupied,
  removeEconomyActor,
  saleMaterialsRefund,
  updateEconomy,
  validateEconomyDefinitions,
  validateEconomyState,
} from "./economy";
import type { EconomyState, EconomyView, HarvesterState } from "./economy";
import {
  createTilePlacedActor,
  evaluateFootprint,
  footprintPlacementFor,
  isMobileActor,
  isTilePlacedActor,
  isValidTilePlacement,
  occupiedTilesFor,
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
import { playerRelation } from "./faction";
import { isId, isIdList } from "./validation";
import type { FogState, FogView, Vision } from "./vision";
import type { WorldBounds, WorldPosition } from "./world";

/** Actor state that behaviors must leave unchanged. */
type ActorIdentity = Pick<Actor, "id" | "definitionId" | "tilePlacement">;

function actorIdentity(actor: Actor): ActorIdentity {
  return {
    id: actor.id,
    definitionId: actor.definitionId,
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
  /** The faction whose vision the fog records. */
  playerFaction?: string;
  /** Remains of destroyed actors, oldest first. */
  wrecks: Wreck[];
  /** Wolf alerts; each wolf's own state lives on its actor. */
  wildlife: WildlifeState;
  /** Progress for the authored objectives, which also decide the result. */
  objectives: ObjectiveState[];
  /** Scenario popups the player dismissed; the simulation only keeps them. */
  dismissedPopups?: string[];
};

export function createMissionState(actors: readonly Actor[]): MissionState {
  return {
    tick: 0,
    actors: [...actors],
    commands: [],
    retiredActorIds: [],
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
  readonly playerFaction: string | undefined;
  /** Hits resolved during the latest tick. */
  readonly attacks: readonly AttackEvent[];
  readonly wrecks: readonly Wreck[];
  /** A defeat ends the mission; play continues after victory. */
  readonly result: MissionResult | undefined;
  readonly objectives: readonly ObjectiveView[];
  /** Whether a faction currently sees any tile of the actor. */
  detects: (
    faction: string | undefined,
    actor: Pick<ActorRenderState, "worldPosition" | "definitionId"> &
      Partial<Pick<ActorRenderState, "id" | "tilePlacement">>,
  ) => boolean;
  /** Whether a faction currently sees the tile under a point. */
  sees: (faction: string | undefined, point: WorldPosition) => boolean;
  /** A copy of an actor's state, or `undefined` when it does not exist. */
  actorById: (id: string) => Actor | undefined;
  /** Checks the same placement constraints used when commands are applied. */
  evaluatePlacement: (placement: ActorPlacement) => PlacementEvaluation;
  /** Checks paid queue capacity, or free exits in the construction sandbox. */
  evaluateTraining: (command: TrainUnitCommand) => TrainingEvaluation;
  evaluateRallyPoint: (actorId: string, target: WorldPosition) => boolean;
  /** Lowest `${prefix}${n}` not used or queued; previews do not reserve it. */
  unusedActorId: (prefix: string) => string;
  /** Queues a command for the next tick and returns that tick's number. */
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
}: MissionSimulationOptions): MissionSimulation {
  if (!Number.isFinite(tickSeconds) || tickSeconds <= 0) {
    throw new RangeError(
      "Simulation tick seconds must be a positive finite number.",
    );
  }
  ensureValidBounds(bounds);
  if (occupancy && (!map || !occupancy.isForTerrain(map))) {
    throw new RangeError("Mission occupancy must belong to its terrain map.");
  }
  if (!Number.isSafeInteger(initialState.tick) || initialState.tick < 0) {
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
        !Number.isSafeInteger(scheduled.tick) ||
        scheduled.tick < 0 ||
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
  if (
    state.playerFaction !== undefined &&
    (typeof state.playerFaction !== "string" || !state.playerFaction)
  )
    throw new RangeError("Mission state has an invalid player faction.");
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
  const supportFor = createSupportResolver(definitionsById);
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
  const ensureRunning = () => {
    if (disposed) throw new Error("Mission simulation is disposed.");
    if (faulted) throw new Error("Mission simulation is faulted.");
  };
  const ensureMutable = () => {
    ensureRunning();
    if (ended()) throw new Error("The mission has ended.");
  };
  const definitionFor = (actor: Actor): ActorDefinition =>
    definitionsById.get(actor.definitionId)!;
  const behaviorFor = (actor: Actor): ActorBehavior =>
    behaviorsById.get(definitionFor(actor).behaviorId)!;
  const ensureValidActor = (actor: Actor) => {
    if (
      typeof actor.id !== "string" ||
      actor.id.length === 0 ||
      !definitionsById.has(actor.definitionId)
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
        construction.paidMaterials !== materialsCost(definition) ||
        !Number.isSafeInteger(construction.completedTicks) ||
        construction.completedTicks < 0 ||
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
      !sameTilePlacement(actor.tilePlacement, before.tilePlacement)
    ) {
      throw new RangeError(
        `Actor ${before.id} changed its identity or placement.`,
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
      typeof actorId !== "string" ||
      actorId.length === 0 ||
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
    const actor = createTilePlacedActor(map, definition, placement);
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
      if (economy.materials < materialsCost(definition))
        return { ...reject("insufficient-materials"), tiles: evaluation.tiles };
      const resources = new Set(
        [
          ...economy.sites.filter((site) => site.remainingMaterials > 0),
          ...economy.loot.filter((loot) => !loot.collected),
        ].map((resource) => tileKey(resource.tile)),
      );
      if (evaluation.tiles.some((tile) => resources.has(tileKey(tile))))
        return { ...reject("resource-site"), tiles: evaluation.tiles };
      if (
        definition.support &&
        !supportsPosition(supportFor(actors), actor.worldPosition)
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
    return evaluation;
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
      if (economy.materials < materialsCost(definition))
        return { accepted: false, reason: "insufficient-materials" };
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
  const rallyUnitIds = (actor: Actor | undefined) =>
    actor && isTilePlacedActor(actor)
      ? definitionFor(actor).production?.unitDefinitionIds
      : undefined;
  const evaluateRallyPoint = (
    producer: Actor | undefined,
    target: WorldPosition,
  ) => {
    const unitIds = rallyUnitIds(producer);
    if (
      !map ||
      !occupancy ||
      !unitIds ||
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
  const playerFaction = state.playerFaction;
  const relation = (faction: string | undefined) =>
    playerRelation(playerFaction, faction);
  // Other factions keep no exploration memory, only current vision.
  const factionVision = new Map<string, Vision>();
  if (map && fog && playerFaction !== undefined)
    for (const { faction } of definitionsById.values())
      if (
        faction !== undefined &&
        relation(faction) !== "own" &&
        !factionVision.has(faction)
      )
        factionVision.set(faction, createVision(map));
  const updateFog = () => {
    const support = state.economy && supportFor(state.actors);
    const byFaction = new Map<string | undefined, Actor[]>();
    for (const actor of state.actors) {
      const faction = definitionFor(actor).faction;
      const key = relation(faction) === "own" ? playerFaction : faction;
      const bucket = byFaction.get(key) ?? [];
      bucket.push(actor);
      byFaction.set(key, bucket);
    }
    const sources = (faction: string | undefined) =>
      visionSources(
        byFaction.get(faction) ?? [],
        definitionsById,
        support,
        map!,
      );
    fog?.update(sources(playerFaction));
    for (const [faction, vision] of factionVision)
      vision.update(sources(faction));
  };
  updateFog();
  /** Without a map or fog, a faction sees everything. */
  const visionOf = (faction: string | undefined) =>
    !fog || playerFaction === undefined
      ? undefined
      : relation(faction) === "own"
        ? fog
        : factionVision.get(faction!);
  const sees = (faction: string | undefined, point: WorldPosition) => {
    const vision = visionOf(faction);
    if (!vision) return true;
    const tile = map!.tileAtWorldPosition(point.x, point.z);
    return vision.isVisible(tile.x, tile.z);
  };
  const detects: MissionSimulation["detects"] = (faction, actor) => {
    const vision = visionOf(faction);
    if (!vision) return true;
    const definition = definitionsById.get(actor.definitionId);
    return actor.tilePlacement && definition?.footprint
      ? occupiedTilesFor(
          {
            id: actor.id ?? "",
            definitionId: actor.definitionId,
            tilePlacement: actor.tilePlacement,
          },
          definition,
        ).some(({ x, z }) => vision.isVisible(x, z))
      : sees(faction, actor.worldPosition);
  };
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

  /** Mobile actors whose behavior exposes navigation queries. */
  const navigatingActor = (actor: Actor): NavigatingActor | undefined => {
    const definition = definitionFor(actor);
    if (!isMobileActor(actor, definition)) return undefined;
    const grid = behaviorFor(actor).navigationGrid?.(actor, definition);
    return grid && { actor, definition, grid };
  };
  const interruptHarvesting = (actor: Actor, economy?: EconomyState) => {
    const worker = economy?.harvesters.find(
      (worker) => worker.actorId === actor.id,
    );
    if (!worker) return;
    worker.phase = worker.refineryId ? "idle" : "unassigned";
    delete worker.targetSiteId;
    delete worker.activeSiteId;
    delete worker.retryNavigationVersion;
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
      interruptHarvesting(actor, working.economy);
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
    !!economy?.harvesters.some(
      ({ actorId, phase }) =>
        actorId === actor.id && HARVEST_TRIP_PHASES.includes(phase),
    );
  const queuedOrderOf = (
    command: ActorOrderCommand,
    requestedTarget?: WorldPosition,
  ): QueuedOrder | undefined => {
    switch (command.kind) {
      case "move":
      case "attack-move":
        if (!isFinitePosition(command.target)) return undefined;
        return {
          kind: command.kind,
          target: clampToBounds(command.target, worldBounds),
          ...(requestedTarget && { requestedTarget: { ...requestedTarget } }),
        };
      case "attack":
        return isId(command.targetId)
          ? { kind: "attack", targetId: command.targetId }
          : undefined;
      case "gather":
        return isId(command.siteId)
          ? { kind: "gather", siteId: command.siteId }
          : undefined;
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
          : order?.kind === "gather" && !definition.harvesting
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
    if (
      !isFinitePosition(command.target) ||
      !Array.isArray(command.actorIds) ||
      command.actorIds.length === 0 ||
      !command.actorIds.every((id) => typeof id === "string" && id.length > 0)
    ) {
      return [
        {
          tick,
          command: structuredClone(command),
          accepted: false,
        } as CommandOutcome,
      ];
    }
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
  const applyCommand = (
    command: Exclude<MissionCommand, GroupMoveCommand | GroupAttackMoveCommand>,
    tick: number,
    working: WorkingActors,
  ): CommandOutcome => {
    if (!isCommandOf(command, ACTOR_ORDER_KINDS))
      return executeCommand(command, tick, working);
    return (
      sequence(command, queuedOrderOf(command), tick, working) ??
      replaceQueue(executeCommand(command, tick, working), working)
    );
  };
  const executeCommand = (
    command: Exclude<MissionCommand, GroupMoveCommand | GroupAttackMoveCommand>,
    tick: number,
    working: WorkingActors,
  ): CommandOutcome => {
    if (command.kind === "set-rally-point") {
      const applied = structuredClone(command);
      const actor = working.actorsById.get(applied.actorId);
      const accepted =
        applied.target === undefined
          ? !!rallyUnitIds(actor)
          : evaluateRallyPoint(actor, applied.target);
      if (accepted) {
        if (applied.target) actor!.rallyPoint = { ...applied.target };
        else delete actor!.rallyPoint;
      }
      return { tick, command: applied, accepted };
    }
    if (command.kind === "terrain") {
      const edit = structuredClone(command);
      if (!map || !map.isValidTerrainEdit(edit)) {
        return { tick, command: edit, accepted: false };
      }
      map.editTerrain(edit);
      return { tick, command: edit, accepted: true };
    }
    if (command.kind === "place-actor") {
      const applied = structuredClone(command);
      const evaluation = evaluatePlacement(
        applied,
        working.actors,
        working.usedIds,
        working.economy,
        debrisTiles,
      );
      if (!evaluation.accepted) {
        return {
          tick,
          command: applied,
          accepted: false,
          reason: evaluation.reason,
        };
      }
      occupancy!.place(evaluation.footprint);
      if (working.economy) {
        const definition = definitionFor(evaluation.actor);
        const cost = materialsCost(definition);
        working.economy.materials -= cost;
        evaluation.actor.construction = {
          paidMaterials: cost,
          completedTicks: 0,
          totalTicks: secondsToTicks(
            definition.constructionSeconds,
            tickSeconds,
          ),
        };
      }
      stageActor(working, evaluation.actor);
      return { tick, command: applied, accepted: true };
    }
    if (command.kind === "train-unit") {
      const applied = structuredClone(command);
      const evaluation = evaluateTraining(
        applied,
        working.actors,
        working.usedIds,
        working.economy,
      );
      if (!evaluation.accepted) {
        return {
          tick,
          command: applied,
          accepted: false,
          reason: evaluation.reason,
        };
      }
      if (working.economy) {
        const definition = definitionsById.get(applied.definitionId)!;
        const cost = materialsCost(definition);
        working.economy.materials -= cost;
        working.economy.production.push({
          actorId: applied.actorId,
          producerId: applied.producerId,
          definitionId: applied.definitionId,
          paidMaterials: cost,
          completedTicks: 0,
          totalTicks: secondsToTicks(definition.trainingSeconds, tickSeconds),
          exitBlocked: false,
        });
        working.usedIds.add(applied.actorId);
      } else if ("actor" in evaluation) {
        stageProducedActor(working, evaluation.actor, applied.producerId);
      }
      return { tick, command: applied, accepted: true };
    }
    if (isCommandOf(command, ECONOMY_COMMAND_KINDS)) {
      const applied = structuredClone(command);
      if (!working.economy)
        return {
          tick,
          command: applied,
          accepted: false,
        } as CommandOutcome<EconomyCommand>;
      const site =
        applied.kind === "gather" &&
        working.economy.sites.find((site) => site.id === applied.siteId);
      // Undiscovered sites are unknown to the player.
      const reason =
        site && fog && !fog.isExplored(site.tile.x, site.tile.z)
          ? "missing-site"
          : applyEconomyCommand(
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
    }
    if (isCommandOf(command, ACTOR_REMOVAL_KINDS)) {
      const applied = structuredClone(command);
      const outcome = (accepted: boolean) =>
        ({
          tick,
          command: applied,
          accepted,
        }) as CommandOutcome<ActorRemovalCommand>;
      const actor = working.actorsById.get(applied.actorId);
      if (!actor) {
        return outcome(false);
      }
      if (
        command.kind === "sell-actor" &&
        (!working.economy || !isTilePlacedActor(actor) || actor.construction)
      )
        return outcome(false);
      if (
        command.kind === "cancel-construction" &&
        (!working.economy || !actor.construction)
      )
        return outcome(false);
      if (working.economy) {
        if (command.kind === "cancel-construction")
          working.economy.materials += actor.construction!.paidMaterials;
        if (command.kind === "sell-actor") {
          const definition = definitionFor(actor);
          working.economy.materials += saleMaterialsRefund(actor, definition);
        }
      }
      retire(working, actor);
      return outcome(true);
    }
    if (command.kind === "attack") {
      const applied = structuredClone(command);
      const actor = working.actorsById.get(applied.actorId);
      const target = working.actorsById.get(applied.targetId);
      const reason = attackRejection(actor, target, {
        definitions: definitionsById,
        detects,
      });
      if (!reason) {
        startAttack(actor!, target!);
        interruptHarvesting(actor!, working.economy);
      }
      return {
        tick,
        command: applied,
        accepted: !reason,
        ...(reason && { reason }),
      };
    }
    if (command.kind === "move" || command.kind === "attack-move") {
      if (!isFinitePosition(command.target))
        return {
          tick,
          command: structuredClone(command),
          accepted: false,
        } as CommandOutcome;
      // Rebuilt so a submitted move cannot carry mission-only fields.
      const applied: MoveCommand | AttackMoveCommand = {
        kind: command.kind,
        actorId: command.actorId,
        target: clampToBounds(command.target, worldBounds),
      };
      return applyMove(applied, tick, working);
    }
    const applied = structuredClone(command);
    return { tick, command: applied, accepted: handle(working, applied) };
  };

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
    playerFaction,
    get attacks() {
      return attacks;
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
    detects,
    sees,
    actorById: (id) => {
      const actor = actorsById.get(id);
      return actor && structuredClone(actor);
    },
    evaluatePlacement: (placement) =>
      evaluatePlacement(
        structuredClone(placement),
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
      state.commands.push({
        tick: state.tick,
        command: structuredClone(command),
      });
      if (command.kind === "place-actor" || command.kind === "train-unit")
        queuedActorIds.add(command.actorId);
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
      state = {
        ...state,
        actors: freezeActors([...state.actors, register(copy, state.actors)]),
      };
      if (state.economy && definitionFor(copy).harvesting) {
        state = {
          ...state,
          economy: deepFreeze({
            ...structuredClone(state.economy),
            harvesters: [
              ...state.economy.harvesters,
              createHarvesterState(copy.id),
            ],
          }),
        };
      }
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
      if (map) {
        snapshot.terrain = map.terrainState();
      }
      if (fog) snapshot.fog = fog.state();
      return snapshot;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      releaseTerrainRule?.();
      fog?.dispose();
      for (const vision of factionVision.values()) vision.dispose();
    },
    tick: () => {
      ensureRunning();
      if (ended()) return [];
      const due = state.commands.filter(({ tick }) => tick <= state.tick);
      const terrainBefore =
        map && due.some(({ command }) => command.kind === "terrain")
          ? map.terrainState()
          : undefined;
      const versionBefore = map?.navigationChanges.version;
      try {
        const working = stageWorking();
        const outcomes = due.flatMap(({ command }) =>
          command.kind === "group-move" || command.kind === "group-attack-move"
            ? applyGroupMove(command, state.tick, working)
            : [applyCommand(command, state.tick, working)],
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
        const defeated = resultOf(working.objectives)?.kind === "defeat";
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
              playerFaction,
              explored: ({ x, z }) => fog?.isExplored(x, z) ?? true,
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
            });

          separateMobileActors(
            working.actors.flatMap((actor) => {
              const mover = navigatingActor(actor);
              return mover ? [mover] : [];
            }),
            tickSeconds,
            previousPositions,
            ({ actor, definition }, point) =>
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
        actorsById = new Map(committedActors.map((actor) => [actor.id, actor]));
        usedActorIds = working.usedIds;
        if (due.length > 0) queuedActorIds = queuedCreationIds();
        actorVersion += working.lifecycleChanges;
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
    (order.kind !== "gather" || (hasEconomy && !!definition.harvesting))
  );
}

/** Harvester phases that keep it busy before its queued orders. */
const HARVEST_TRIP_PHASES: readonly HarvesterState["phase"][] = [
  "travelling",
  "gathering",
  "returning",
];

type ActorOrderCommand = Extract<
  MissionCommand,
  { kind: (typeof ACTOR_ORDER_KINDS)[number] }
>;

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
    if (
      definition.movement &&
      (!Number.isFinite(definition.movement.speed) ||
        definition.movement.speed < 0)
    ) {
      throw new RangeError(
        `Actor definition ${definition.id} has an invalid movement speed.`,
      );
    }
    if (
      definition.movement?.radius !== undefined &&
      (!Number.isFinite(definition.movement.radius) ||
        definition.movement.radius <= 0)
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
