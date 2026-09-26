import { clampToBounds, isFinitePosition, withinBounds } from "./world";

import type {
  Actor,
  ActorBehavior,
  ActorDefinition,
  ActorRenderState,
} from "./actor";
import type { TerrainMap, TerrainState } from "../map";
import type {
  CommandOutcome,
  MissionCommand,
  ScheduledCommand,
} from "./command";
import type { WorldBounds } from "./world";

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
  return { tick: 0, actors: [...actors], commands: [], retiredActorIds: [] };
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
   * in `state` replaces it, as when loading a save.
   */
  map?: TerrainMap;
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
  /** Queues a command for the next tick and returns that tick's number. */
  submitCommand: (command: MissionCommand) => number;
  /** Adds a copy of the actor, validated like the initial state. */
  spawnActor: (actor: Actor) => void;
  /** Returns whether an actor with this ID existed. */
  removeActor: (id: string) => boolean;
  /** A deep copy of the current state and terrain, for saves and replays. */
  snapshot: () => MissionState;
  /**
   * Applies queued commands, then advances every actor by one tick. Outcomes
   * carry each command as applied, with move targets clamped to the bounds.
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
}: MissionSimulationOptions): MissionSimulation {
  if (!Number.isFinite(tickSeconds) || tickSeconds <= 0) {
    throw new RangeError(
      "Simulation tick seconds must be a positive finite number.",
    );
  }
  ensureValidBounds(bounds);
  if (!Number.isInteger(initialState.tick) || initialState.tick < 0) {
    throw new RangeError("Mission state tick must be a non-negative integer.");
  }

  let state = structuredClone(initialState);
  if (new Set(state.retiredActorIds).size !== state.retiredActorIds.length) {
    throw new Error("Mission state contains duplicate retired actor IDs.");
  }
  const worldBounds = { ...bounds };
  const behaviorsById = new Map(behaviorRegistry);
  const definitionsById = indexDefinitions(
    structuredClone(definitions),
    behaviorsById,
  );
  let actorsById = new Map<string, Actor>();
  const usedActorIds = new Set(state.retiredActorIds);
  let actorVersion = 0;
  const definitionFor = (actor: Actor): ActorDefinition =>
    definitionsById.get(actor.definitionId)!;
  const behaviorFor = (actor: Actor): ActorBehavior =>
    behaviorsById.get(definitionFor(actor).behaviorId)!;
  const ensureValidActor = (actor: Actor) => {
    if (!isFinitePosition(actor.worldPosition)) {
      throw new RangeError(`Actor ${actor.id} has an invalid world position.`);
    }
    if (!withinBounds(actor.worldPosition, worldBounds)) {
      throw new RangeError(`Actor ${actor.id} is outside the world bounds.`);
    }
    if (!Number.isFinite(actor.facing)) {
      throw new RangeError(`Actor ${actor.id} has an invalid facing.`);
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
    ensureValidActor(actor);
    const committed = deepFreeze(actor);
    actorsById.set(committed.id, committed);
    usedActorIds.add(committed.id);
    return committed;
  };
  state.actors = freezeActors(state.actors.map(register));
  if (state.terrain) {
    if (!map) {
      throw new Error("Mission state has terrain but no map to restore.");
    }
    map.restoreTerrainState(state.terrain);
    // The map holds live terrain; snapshots read it back.
    delete state.terrain;
  }

  const applyCommand = (
    command: MissionCommand,
    tick: number,
    workingActorsById: ReadonlyMap<string, Actor>,
  ): CommandOutcome => {
    if (command.kind === "terrain") {
      const edit = structuredClone(command);
      if (!map || !map.isValidTerrainEdit(edit)) {
        return { tick, command: edit, accepted: false };
      }
      map.editTerrain(edit);
      return { tick, command: edit, accepted: true };
    }
    let appliedCommand = structuredClone(command);
    const outcome: CommandOutcome = {
      tick,
      command: appliedCommand,
      accepted: false,
    };
    const actor = workingActorsById.get(command.actorId);
    if (!actor) {
      return outcome;
    }
    if (command.kind === "move") {
      if (!isFinitePosition(command.target)) {
        return outcome;
      }
      appliedCommand = {
        ...command,
        target: clampToBounds(command.target, worldBounds),
      };
      outcome.command = appliedCommand;
    }
    outcome.accepted = behaviorFor(actor).handleCommand(
      actor,
      definitionFor(actor),
      appliedCommand,
    );
    ensureValidActor(actor);
    return outcome;
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
    submitCommand: (command) => {
      state.commands.push({
        tick: state.tick,
        command: structuredClone(command),
      });
      return state.tick;
    },
    spawnActor: (actor) => {
      const copy = structuredClone(actor);
      state = {
        ...state,
        actors: freezeActors([...state.actors, register(copy)]),
      };
      actorVersion += 1;
    },
    removeActor: (id) => {
      const actor = actorsById.get(id);
      if (!actor) {
        return false;
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
    tick: () => {
      const workingActors = state.actors.map((actor) => structuredClone(actor));
      const workingActorsById = new Map(
        workingActors.map((actor) => [actor.id, actor]),
      );
      const outcomes = state.commands
        .filter(({ tick }) => tick <= state.tick)
        .map(({ command }) =>
          applyCommand(command, state.tick, workingActorsById),
        );

      for (const actor of workingActors) {
        behaviorFor(actor).update(actor, definitionFor(actor), tickSeconds);
        // Rounding in a behavior's motion must not carry an actor off the map.
        if (isFinitePosition(actor.worldPosition)) {
          actor.worldPosition = clampToBounds(actor.worldPosition, worldBounds);
        }
        ensureValidActor(actor);
      }

      const committedActors = freezeActors(
        workingActors.map((actor) => deepFreeze(actor)),
      );
      state = {
        tick: state.tick + 1,
        actors: committedActors,
        commands: state.commands.filter(({ tick }) => tick > state.tick),
        retiredActorIds: state.retiredActorIds,
      };
      actorsById = new Map(committedActors.map((actor) => [actor.id, actor]));
      return outcomes;
    },
  };
}

function indexDefinitions(
  definitions: readonly ActorDefinition[],
  behaviorRegistry: ReadonlyMap<string, ActorBehavior>,
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
