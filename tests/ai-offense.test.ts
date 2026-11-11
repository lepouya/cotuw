import { expect, test } from "vitest";

import { ARC_AI_TUNING, BASE_CONTENT } from "./helpers/content";
import { createActor } from "../src/simulation/actor";
import { offense } from "../src/simulation/ai-offense";
import { TerrainGrid } from "../src/simulation/terrain";

import type { ActorDefinition } from "../src/simulation/actor";
import type { MissionCommand } from "../src/simulation/command";
import type { AiConcernContext } from "../src/simulation/director";
import type { ActorSighting } from "../src/simulation/observations";

function fixture(count = 6) {
  const home = { x: 10, z: 10 };
  const target = { x: 80, z: 80 };
  const units = Array.from({ length: count }, (_, index) =>
    createActor({
      id: `unit-${index}`,
      definitionId: "arc-trooper",
      owner: "own",
      worldPosition: home,
    }),
  );
  const barracks = {
    ...createActor({
      id: "barracks",
      definitionId: "arc-field-barracks",
      owner: "own",
      worldPosition: home,
    }),
    tilePlacement: { origin: { x: 8, z: 8 }, quarterTurns: 0 },
    rallyPoint: home,
  };
  const observations: ActorSighting[] = [
    {
      actorId: "income",
      definitionId: "arc-materials-refinery",
      owner: "enemy",
      worldPosition: target,
      tilePlacement: { origin: { x: 80, z: 80 }, quarterTurns: 0 },
      tick: 0,
    },
  ];
  const definitions = new Map(
    BASE_CONTENT.actors.map((definition) => [definition.id, definition]),
  );
  const issued: MissionCommand[] = [];
  const claims = new Set<string>();
  const memory: Record<string, unknown> = {};
  const relation = { enemy: "hostile" };
  const context = {
    tick: 3000,
    tickSeconds: 0.1,
    posture: "pressuring",
    tuning: ARC_AI_TUNING,
    terrain: new TerrainGrid({
      width: 100,
      height: 100,
      tileSize: 1,
      terrainTypeIds: ["plain"],
    }),
    definitions,
    memory,
    rejections: [],
    claim: (id: string) => {
      if (!claims.has(id) && claims.size >= 6) return false;
      claims.add(id);
      return true;
    },
    release: (id: string) => claims.delete(id),
    issue: (command: MissionCommand) => {
      issued.push(command);
      return true;
    },
    requestPosture: () => true,
    view: {
      actors: () => ({
        own: [barracks, ...units],
        ownMobile: units,
        shown: [],
      }),
      ownMobileActor: (id: string) => units.find((unit) => unit.id === id),
      isMobile: () => true,
      offlineIds: () => new Set(),
      relationTo: ({ owner }: { owner: string }) =>
        owner === "enemy" ? relation.enemy : "own",
      knowledge: { observations: { actors: observations } },
    },
  } as unknown as AiConcernContext;
  return {
    context,
    definitions,
    observations,
    target,
    memory,
    units,
    claims,
    relation,
  };
}

test("remembered armed buildings count as defenders even after reports age", () => {
  const { context, definitions, observations, target, memory } = fixture();
  const tower: ActorDefinition = {
    ...definitions.get("arc-materials-refinery")!,
    id: "tower",
    weapon: { ...definitions.get("arc-trooper")!.weapon!, damage: 1000 },
  };
  definitions.set(tower.id, tower);
  observations.push({
    ...observations[0]!,
    actorId: "tower",
    definitionId: tower.id,
    worldPosition: target,
  });
  offense(context);
  expect(memory.operations).toBeUndefined();
  observations.pop();
  offense(context);
  expect(memory.operations).toMatchObject([
    { kind: "raid", targetId: "income" },
  ]);
});

test("force quotas select the units closest to home before claiming them", () => {
  const { context, units, memory, claims } = fixture(8);
  units[0]!.worldPosition = { x: 90, z: 90 };
  units[1]!.worldPosition = { x: 90, z: 90 };
  offense(context);
  expect(memory.operations).toMatchObject([
    { units: ["unit-2", "unit-3", "unit-4", "unit-5"] },
  ]);
  expect([...claims]).toEqual(["unit-2", "unit-3", "unit-4", "unit-5"]);
});

test("the profile controls opening grace and raid commitment", () => {
  const { context, memory } = fixture();
  const tuning = {
    ...context.tuning,
    offense: {
      ...context.tuning.offense,
      graceSeconds: 310,
      raid: { ...context.tuning.offense.raid, minUnits: 5 },
    },
  };
  offense({ ...context, tuning, tick: 3099 });
  expect(memory.operations).toBeUndefined();
  offense({ ...context, tuning, tick: 3100 });
  expect(memory.operations).toMatchObject([
    { kind: "raid", units: ["unit-0", "unit-1", "unit-2", "unit-3", "unit-4"] },
  ]);
});

test("a target whose owner stops being hostile cancels its operation", () => {
  const { context, memory, relation, units } = fixture();
  offense(context);
  expect(memory.operations).toMatchObject([
    { kind: "raid", phase: "assemble" },
  ]);
  // Away from home, so the group heads back instead of disbanding at once.
  for (const unit of units) unit.worldPosition = { x: 50, z: 50 };
  relation.enemy = "neutral";
  offense(context);
  expect(memory.operations).toMatchObject([
    { kind: "raid", phase: "return", outcome: "cancelled" },
  ]);
});
