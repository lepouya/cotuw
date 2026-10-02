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
import { isOccupancyLayer, OccupancyGrid } from "./occupancy";
import { TerrainGrid } from "./terrain";
import {
  createTilePlacedActor,
  evaluateFootprint,
  footprintPlacementFor,
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
} from "./actor";
import type {
  ActorCommand,
  CommandOutcome,
  MissionCommand,
  ScheduledCommand,
} from "./command";
import type { FootprintPlacement } from "./occupancy";
import type {
  ActorPlacement,
  PlacementEvaluation,
  PlacementReason,
} from "./placement";
import type { TerrainState } from "./terrain";
import type { WorldBounds } from "./world";

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
};

export function createMissionState(actors: readonly Actor[]): MissionState {
  return {
    tick: 0,
    actors: [...actors],
    commands: [],
    retiredActorIds: [],
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
};

/** Owns deterministic fixed-step updates and commands for one mission state. */
export type MissionSimulation = {
  /** Copies of the state the renderer needs. They cannot change the mission. */
  readonly actors: readonly ActorRenderState[];
  /** Changes when actors are spawned or removed. */
  readonly actorVersion: number;
  readonly completedTicks: number;
  readonly tickSeconds: number;
  /** A copy of an actor's state, or `undefined` when it does not exist. */
  actorById: (id: string) => Actor | undefined;
  /** Checks the same placement constraints used when commands are applied. */
  evaluatePlacement: (placement: ActorPlacement) => PlacementEvaluation;
  /** Checks production and free exits against the current committed state. */
  evaluateTraining: (command: TrainUnitCommand) => TrainingEvaluation;
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
   * Group moves report one move outcome per unique actor ID.
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
  if (!Number.isInteger(initialState.tick) || initialState.tick < 0) {
    throw new RangeError("Mission state tick must be a non-negative integer.");
  }

  let state = structuredClone(initialState);
  if (new Set(state.retiredActorIds).size !== state.retiredActorIds.length) {
    throw new Error("Mission state contains duplicate retired actor IDs.");
  }
  const savedTerrain = state.terrain;
  const restoringSnapshot = savedTerrain !== undefined;
  if (savedTerrain && !map) {
    throw new Error("Mission state has terrain but no map to restore.");
  }
  delete state.terrain;
  const worldBounds = { ...bounds };
  const behaviorsById = new Map(behaviorRegistry);
  const definitionsById = indexDefinitions(
    structuredClone(definitions),
    behaviorsById,
    map,
    occupancy,
  );
  validateProductionDefinitions(definitionsById, behaviorsById, map);
  let actorsById = new Map<string, Actor>();
  let usedActorIds = new Set(state.retiredActorIds);
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
    const target = actor.movement?.target;
    if (
      target &&
      (!isFinitePosition(target) || !withinBounds(target, worldBounds))
    ) {
      throw new RangeError(`Actor ${actor.id} has an invalid move target.`);
    }
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
  const register = (actor: Actor): Actor => {
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
    const committed = deepFreeze(actor);
    actorsById.set(committed.id, committed);
    usedActorIds.add(committed.id);
    return committed;
  };
  state.actors = freezeActors(state.actors.map(register));

  const evaluatePlacement = (
    placement: ActorPlacement,
    actors: Iterable<Actor>,
    usedIds: ReadonlySet<string>,
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
  ): TrainingEvaluation => {
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
    if (evaluation.accepted) {
      try {
        ensureValidActor(evaluation.actor);
      } catch {
        return { accepted: false, reason: "invalid-actor" };
      }
    }
    return evaluation;
  };
  const stageActor = (working: WorkingActors, actor: Actor) => {
    working.actors.push(actor);
    working.actorsById.set(actor.id, actor);
    working.usedIds.add(actor.id);
    working.lifecycleChanges += 1;
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

  const applyCommand = (
    command: MissionCommand,
    tick: number,
    working: WorkingActors,
  ): CommandOutcome | CommandOutcome[] => {
    if (command.kind === "group-move") {
      if (
        !isFinitePosition(command.target) ||
        !Array.isArray(command.actorIds) ||
        !command.actorIds.every(
          (id) => typeof id === "string" && id.length > 0,
        ) ||
        command.actorIds.length === 0
      ) {
        return { tick, command: structuredClone(command), accepted: false };
      }
      const target = clampToBounds(command.target, worldBounds);
      const ids = [...new Set(command.actorIds)].sort();
      const movers = ids.flatMap((id) => {
        const actor = working.actorsById.get(id);
        if (!actor || !definitionFor(actor).movement) return [];
        const grid = behaviorFor(actor).navigationGrid?.(
          actor,
          definitionFor(actor),
        );
        return grid ? [{ actor, definition: definitionFor(actor), grid }] : [];
      });
      const assignments = new Map(
        assignGroupDestinations(
          movers,
          working.actors.map((actor) => ({
            actor,
            definition: definitionFor(actor),
          })),
          target,
        ).map((assignment) => [assignment.command.actorId, assignment]),
      );
      return ids.flatMap((actorId) => {
        const assignment = assignments.get(actorId);
        if (!assignment?.assigned)
          return [
            {
              tick,
              command: { kind: "move" as const, actorId, target },
              accepted: false,
            },
          ];
        return applyCommand(assignment.command, tick, working);
      });
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
      stageActor(working, evaluation.actor);
      return { tick, command: applied, accepted: true };
    }
    if (command.kind === "train-unit") {
      const applied = structuredClone(command);
      const evaluation = evaluateTraining(
        applied,
        working.actors,
        working.usedIds,
      );
      if (!evaluation.accepted) {
        return {
          tick,
          command: applied,
          accepted: false,
          reason: evaluation.reason,
        };
      }
      stageActor(working, evaluation.actor);
      return { tick, command: applied, accepted: true };
    }
    if (command.kind === "remove-actor") {
      const applied = structuredClone(command);
      const actor = working.actorsById.get(applied.actorId);
      if (!actor) {
        return { tick, command: applied, accepted: false };
      }
      if (isTilePlacedActor(actor)) {
        occupancy!.remove(actor.id);
      }
      working.actorsById.delete(actor.id);
      working.actors.splice(working.actors.indexOf(actor), 1);
      working.retiredIds.push(actor.id);
      working.lifecycleChanges += 1;
      return { tick, command: applied, accepted: true };
    }
    const handle = (applied: ActorCommand) => {
      const actor = working.actorsById.get(applied.actorId);
      if (!actor) return false;
      const before = actorIdentity(actor);
      const accepted = behaviorFor(actor).handleCommand(
        actor,
        definitionFor(actor),
        applied,
      );
      validateUpdate(actor, before);
      return accepted;
    };
    if (command.kind === "move") {
      if (
        !isFinitePosition(command.target) ||
        (command.requestedTarget !== undefined &&
          !isFinitePosition(command.requestedTarget))
      )
        return { tick, command: structuredClone(command), accepted: false };
      const applied = {
        ...command,
        target: clampToBounds(command.target, worldBounds),
        ...(command.requestedTarget && {
          requestedTarget: clampToBounds(command.requestedTarget, worldBounds),
        }),
      };
      return { tick, command: applied, accepted: handle(applied) };
    }
    const applied = structuredClone(command);
    return { tick, command: applied, accepted: handle(applied) };
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
    actorById: (id) => {
      const actor = actorsById.get(id);
      return actor && structuredClone(actor);
    },
    evaluatePlacement: (placement) =>
      evaluatePlacement(structuredClone(placement), state.actors, usedActorIds),
    evaluateTraining: (command) =>
      evaluateTraining(structuredClone(command), state.actors, usedActorIds),
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
      ensureRunning();
      state.commands.push({
        tick: state.tick,
        command: structuredClone(command),
      });
      if (command.kind === "place-actor" || command.kind === "train-unit")
        queuedActorIds.add(command.actorId);
      return state.tick;
    },
    spawnActor: (actor) => {
      ensureRunning();
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
        actors: freezeActors([...state.actors, register(copy)]),
      };
      // Registered first, so a rejected actor never leaves occupancy behind.
      if (footprint) {
        occupancy!.place(footprint);
      }
      actorVersion += 1;
    },
    removeActor: (id) => {
      ensureRunning();
      const actor = actorsById.get(id);
      if (!actor) {
        return false;
      }
      if (isTilePlacedActor(actor)) {
        occupancy!.remove(id);
      }
      actorsById.delete(id);
      state = {
        ...state,
        actors: freezeActors(
          state.actors.filter((candidate) => candidate !== actor),
        ),
        retiredActorIds: [...state.retiredActorIds, id],
      };
      actorVersion += 1;
      return true;
    },
    snapshot: () => {
      const snapshot = structuredClone(state);
      if (map) {
        snapshot.terrain = map.terrainState();
      }
      return snapshot;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      releaseTerrainRule?.();
    },
    tick: () => {
      ensureRunning();
      const due = state.commands.filter(({ tick }) => tick <= state.tick);
      const terrainBefore =
        map && due.some(({ command }) => command.kind === "terrain")
          ? map.terrainState()
          : undefined;
      const navigationVersion = map?.navigationChanges.version;
      try {
        const actors = state.actors.map((actor) => structuredClone(actor));
        const working: WorkingActors = {
          actors,
          actorsById: new Map(actors.map((actor) => [actor.id, actor])),
          usedIds: new Set(usedActorIds),
          retiredIds: [...state.retiredActorIds],
          lifecycleChanges: 0,
        };
        const outcomes = due.flatMap(({ command }) =>
          applyCommand(command, state.tick, working),
        );

        const previousPositions = new Map(
          working.actors.map((actor) => [actor.id, { ...actor.worldPosition }]),
        );
        for (const actor of working.actors) {
          const before = actorIdentity(actor);
          behaviorFor(actor).update(actor, definitionFor(actor), tickSeconds);
          // Rounding in a behavior's motion must not carry an actor off the map.
          if (isFinitePosition(actor.worldPosition)) {
            actor.worldPosition = clampToBounds(
              actor.worldPosition,
              worldBounds,
            );
          }
          validateUpdate(actor, before);
        }

        separateMobileActors(
          working.actors.flatMap((actor) => {
            const definition = definitionFor(actor);
            if (!definition.movement?.radius) return [];
            const grid = behaviorFor(actor).navigationGrid?.(actor, definition);
            return grid ? [{ actor, definition, grid }] : [];
          }),
          tickSeconds,
          previousPositions,
        );
        for (const actor of working.actors)
          validateUpdate(
            actor,
            actorIdentity(actorsById.get(actor.id) ?? actor),
          );

        const committedActors = freezeActors(
          working.actors.map((actor) => deepFreeze(actor)),
        );
        state = {
          ...state,
          tick: state.tick + 1,
          actors: committedActors,
          retiredActorIds: working.retiredIds,
          commands: state.commands.filter(({ tick }) => tick > state.tick),
        };
        actorsById = new Map(committedActors.map((actor) => [actor.id, actor]));
        usedActorIds = working.usedIds;
        if (due.length > 0) queuedActorIds = queuedCreationIds();
        actorVersion += working.lifecycleChanges;
        return outcomes;
      } catch (error) {
        faulted = true;
        // Return the world to the last committed tick, so no partial terrain or
        // footprint state stays published.
        if (map) {
          if (terrainBefore) map.restoreTerrainState(terrainBefore);
          if (occupancy) rebuildOccupancy();
          map.navigationChanges.restart(navigationVersion!);
        }
        throw error;
      }
    },
  };
}

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
    deepFreeze(definition);
    behaviorRegistry
      .get(definition.behaviorId)!
      .validateDefinition?.(definition);
    definitionsById.set(definition.id, definition);
  }
  return definitionsById;
}

/** Prevents callers from mutating state published after a committed tick. */
function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
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
