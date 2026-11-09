import { expect } from "vitest";

import { MOVEMENT_PROFILES } from "./content";
import { createActor } from "../../src/simulation/actor";
import { createMissionSimulation } from "../../src/simulation/mission";
import {
  parseMission,
  serializeMission,
} from "../../src/simulation/mission-file";
import { OccupancyGrid } from "../../src/simulation/occupancy";
import { createScenarioState } from "../../src/simulation/scenario";
import {
  balanceOf,
  depositedBy,
  stockpileOf,
} from "../../src/simulation/stockpiles";
import { createTerrainMoveBehavior } from "../../src/simulation/terrain-movement";

import type { ActorBehavior } from "../../src/simulation/actor";
import type {
  CommandIssuer,
  MissionCommand,
} from "../../src/simulation/command";
import type { EconomyView } from "../../src/simulation/economy";
import type { MissionScenario } from "../../src/simulation/mission-file";
import type { Resource } from "../../src/simulation/resources";
import type { Stockpile } from "../../src/simulation/stockpiles";
import type {
  MissionSimulation,
  MissionSimulationOptions,
  MissionState,
} from "../../src/simulation/mission";
import type { TerrainGrid } from "../../src/simulation/terrain";
import type { WorldPosition } from "../../src/simulation/world";

/**
 * Wires a simulation as `createSessionSimulation` does, with the state, tick
 * length, and idle update a rule test chooses. Changing the returned `movement`
 * changes the behavior the simulation runs.
 */
export function startMission(
  map: TerrainGrid,
  {
    idleUpdate = () => {},
    ...options
  }: Omit<
    MissionSimulationOptions,
    "behaviorRegistry" | "bounds" | "map" | "occupancy"
  > & { idleUpdate?: ActorBehavior["update"] },
) {
  const occupancy = new OccupancyGrid(map);
  const movement = createTerrainMoveBehavior(map, occupancy, MOVEMENT_PROFILES);
  const simulation = createMissionSimulation({
    ...options,
    map,
    occupancy,
    bounds: map.worldBounds,
    behaviorRegistry: new Map([
      ["terrain-move", movement],
      ["idle", { handleCommand: () => false, update: idleUpdate }],
    ]),
  });
  return { simulation, map, occupancy, movement };
}

/** A running simulation's state after a round trip through its mission file. */
export const savedState = (
  scenario: MissionScenario,
  sim: Pick<MissionSimulation, "snapshot" | "tickSeconds">,
) =>
  parseMission(
    serializeMission(scenario, sim.snapshot(), sim.tickSeconds),
    sim.tickSeconds,
  ).state;

/** The player owns one faction's actors; wolves belong to hostile wildlife. */
export function playerOwners(faction: string) {
  return {
    owners: [
      { id: "player", faction },
      { id: "wildlife", faction: "wildlife" },
    ],
    playerOwner: "player",
    relationships: [
      {
        owners: ["player", "wildlife"] as [string, string],
        relationship: "hostile" as const,
      },
    ],
  };
}

/** Starts fully explored, so fog does not limit placement in these tests. */
export function exploredScenarioState(
  ...args: Parameters<typeof createScenarioState>
): MissionState {
  const state = createScenarioState(...args);
  return { ...state, fog: exploredFog(state) };
}

/** Fog in which every owner has explored the whole map. */
export const exploredFog = ({
  owners,
  terrain,
}: Pick<MissionState, "owners" | "terrain">) => ({
  explored: Object.fromEntries(
    owners.map(({ id }) => [id, "1".repeat(terrain!.width * terrain!.height)]),
  ),
});

/** Adds a unit to a running mission, the player's by default. */
export function spawnUnit(
  sim: MissionSimulation,
  id: string,
  definitionId: string,
  worldPosition: WorldPosition,
  owner = "player",
) {
  sim.spawnActor(createActor({ id, definitionId, owner, worldPosition }));
}

/** An actor in state that a test is still arranging. */
export const actorIn = (state: Pick<MissionState, "actors">, actorId: string) =>
  state.actors.find(({ id }) => id === actorId)!;

/** Submits one command and returns its outcome from the next tick. */
export function command(
  sim: MissionSimulation,
  value: MissionCommand,
  issuer: CommandIssuer = { owner: sim.playerOwner },
) {
  sim.submitCommand(value, issuer);
  return sim.tick()[0]!;
}

export function advanceTicks(sim: MissionSimulation, ticks: number) {
  for (let tick = 0; tick < ticks; tick++) sim.tick();
}

export function advanceSeconds(sim: MissionSimulation, seconds: number) {
  for (let tick = 0; tick < Math.round(seconds / sim.tickSeconds); tick++)
    sim.tick();
}

/** Ticks until `predicate` holds, failing after `seconds` of mission time. */
export function untilSeconds(
  sim: MissionSimulation,
  predicate: () => boolean,
  seconds = 300,
) {
  for (let tick = 0; tick < seconds / sim.tickSeconds && !predicate(); tick++)
    sim.tick();
  expect(predicate()).toBe(true);
}

/** A scenario's starting stockpile for one owner. */
export const stockpiles = (
  amount: number,
  resource: Resource = "materials",
  owner = "player",
): Stockpile[] => [{ resource, owners: [owner], amount }];

type EconomyHolder = {
  readonly economy?: EconomyView;
  readonly playerOwner: string;
};

/** An owner's balance, the player's by default; zero when not held. */
export const balance = (
  state: EconomyHolder,
  resource: Resource = "materials",
  owner = state.playerOwner,
) => balanceOf(state.economy!, owner, resource) ?? 0;

/** Resources an owner's workers delivered, the player's by default. */
export const deposited = (
  state: EconomyHolder,
  resource: Resource = "materials",
  owner = state.playerOwner,
) => depositedBy(state.economy!, owner, resource);

/** Replaces an owner's balance in mutable state before simulation. */
export function setBalance(
  state: MissionState,
  amount: number,
  resource: Resource = "materials",
  owner = state.playerOwner,
) {
  const stockpile = stockpileOf(state.economy!, owner, resource);
  if (stockpile) stockpile.amount = amount;
  else state.economy!.stockpiles.push(...stockpiles(amount, resource, owner));
}
