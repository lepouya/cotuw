import { expect } from "vitest";
import { createScenarioState } from "../../src/simulation/scenario";
import {
  balanceOf,
  depositedBy,
  stockpileOf,
} from "../../src/simulation/stockpiles";
import type { EconomyView } from "../../src/simulation/economy";
import type { Resource } from "../../src/simulation/resources";
import type { Stockpile } from "../../src/simulation/stockpiles";
import type {
  MissionSimulation,
  MissionState,
} from "../../src/simulation/mission";

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
  return {
    ...state,
    fog: { explored: "1".repeat(state.fog!.explored.length) },
  };
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
