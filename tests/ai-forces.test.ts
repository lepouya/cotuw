import { expect, test } from "vitest";

import { ARC_AI_PLANS, BASE_CONTENT } from "./helpers/content";
import { createActor } from "../src/simulation/actor";
import { trainForces } from "../src/simulation/ai-forces";
import { depositsOf } from "../src/simulation/arc-expansion-plan";
import { TerrainGrid } from "../src/simulation/terrain";

import type { Actor } from "../src/simulation/actor";
import type { MissionCommand } from "../src/simulation/command";
import type { AiConcernContext } from "../src/simulation/director";
import type { MaterialsSite } from "../src/simulation/harvesting";
import type { ActorSighting } from "../src/simulation/observations";

const definitions = new Map(BASE_CONTENT.actors.map((d) => [d.id, d]));
const terrain = new TerrainGrid({
  width: 40,
  height: 40,
  tileSize: 1,
  terrainTypeIds: ["plain"],
});

const unit = (id: string, definitionId: string) =>
  createActor({
    id,
    definitionId,
    owner: "own",
    worldPosition: terrain.tileCenter(20, 20),
  });

/** Trains one order per turn at a Barracks with every unit it lists. */
function fixture(units: Actor[], sightings: ActorSighting[] = []) {
  const barracks = {
    ...unit("barracks", "arc-field-barracks"),
    tilePlacement: { origin: { x: 18, z: 18 }, quarterTurns: 0 },
    rallyPoint: terrain.tileCenter(25, 25),
  } as Actor;
  const trained: string[] = [];
  const context = {
    terrain,
    definitions,
    plan: { ...ARC_AI_PLANS.forces, queued: 1 },
    funds: () => 1000,
    newActorId: (id: string) => `${id}:${trained.length}`,
    claim: () => true,
    issue: (command: MissionCommand) => {
      if (command.kind === "train-unit") trained.push(command.definitionId);
      return true;
    },
    view: {
      actors: () => ({ own: [barracks, ...units], ownMobile: units }),
      isMobile: () => true,
      offlineIds: () => new Set(),
      ownActor: () => undefined,
      economy: () => ({ production: [], harvesters: [] }),
      evaluateRallyPoint: () => true,
      evaluateTraining: () => ({ accepted: true }),
      relationTo: () => "hostile",
      knowledge: { observations: { actors: sightings } },
    },
  } as unknown as AiConcernContext;
  return {
    next: () => {
      trainForces(context);
      return trained[trained.length - 1];
    },
  };
}

test("training follows the mix, with the heaviest share first", () => {
  const troopers = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      unit(`trooper-${index}`, "arc-trooper"),
    );
  expect(ARC_AI_PLANS.forces!.mix).toEqual({
    "arc-trooper": 4,
    "arc-demolition-trooper": 1,
  });
  expect(fixture([]).next()).toBe("arc-trooper");
  expect(fixture(troopers(3)).next()).toBe("arc-trooper");
  expect(fixture(troopers(4)).next()).toBe("arc-demolition-trooper");
});

test("known static defenses shift training toward Demolition Troopers", () => {
  const army = [
    ...Array.from({ length: 4 }, (_, index) =>
      unit(`trooper-${index}`, "arc-trooper"),
    ),
    unit("demolition-0", "arc-demolition-trooper"),
  ];
  expect(fixture(army).next()).toBe("arc-trooper");
  const turret: ActorSighting = {
    actorId: "turret",
    definitionId: "arc-sentry-turret",
    owner: "enemy",
    worldPosition: terrain.tileCenter(5, 5),
    tilePlacement: { origin: { x: 5, z: 5 }, quarterTurns: 0 },
    tick: 0,
  };
  expect(fixture(army, [turret]).next()).toBe("arc-demolition-trooper");
});

test("providers are trained once enough units need them", () => {
  const army = Array.from({ length: 5 }, (_, index) =>
    unit(`trooper-${index}`, "arc-trooper"),
  );
  expect(ARC_AI_PLANS.forces!.support).toMatchObject({ "arc-medic": 6 });
  expect(fixture(army).next()).not.toBe("arc-medic");
  army.push(unit("demolition-0", "arc-demolition-trooper"));
  expect(fixture(army).next()).toBe("arc-medic");
  army.push(unit("medic-0", "arc-medic"));
  expect(fixture(army).next()).not.toBe("arc-medic");
});

test("nearby sites form one deposit with its total Materials", () => {
  const site = (id: string, x: number, z: number, remaining = 100) =>
    ({
      id,
      name: id,
      tile: { x, z },
      initialMaterials: 100,
      remainingMaterials: remaining,
    }) as MaterialsSite;
  const sites = [
    site("b-1", 31, 30, 0),
    site("a-2", 11, 10),
    site("b-0", 30, 30),
    site("a-1", 10, 10),
    // Joins both groups' neighbors into one chain.
    site("a-3", 13, 10),
  ];
  const deposits = depositsOf(sites, sites, terrain, 2);
  expect(
    deposits.map(({ id, sites, remaining, initial }) => ({
      id,
      sites: sites.map(({ id }) => id).sort(),
      remaining,
      initial,
    })),
  ).toEqual([
    {
      id: "a-1",
      sites: ["a-1", "a-2", "a-3"],
      remaining: 300,
      initial: 300,
    },
    { id: "b-0", sites: ["b-0", "b-1"], remaining: 100, initial: 200 },
  ]);
  const partiallySeen = depositsOf(sites, [sites[1]!], terrain, 2);
  expect(partiallySeen[0]).toMatchObject({
    id: "a-1",
    center: deposits[0]!.center,
    remaining: 100,
    initial: 100,
  });
});
