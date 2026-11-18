import { expect, test } from "vitest";

import { ARC_AI_TUNING, BASE_CONTENT } from "./helpers/content";
import { createActor } from "../src/simulation/actor";
import { offense } from "../src/simulation/ai-offense";
import { launchOperation } from "../src/simulation/ai-operations";
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
  const reassigned = new Set<string>();
  const providers: typeof units = [];
  const memory: Record<string, unknown> = {};
  const relation = { enemy: "hostile" };
  const hostiles: ReturnType<typeof createActor>[] = [];
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
    claimed: () => [...claims],
    claim: (id: string) => {
      if (reassigned.has(id)) return false;
      const provider = providers.some((actor) => actor.id === id);
      if (!provider && !claims.has(id) && claims.size >= 6) return false;
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
        own: [barracks, ...units, ...providers],
        ownMobile: [...units, ...providers],
        shown: hostiles,
      }),
      ownMobileActor: (id: string) =>
        [...units, ...providers].find((unit) => unit.id === id),
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
    reassigned,
    providers,
    issued,
    relation,
    hostiles,
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

/** A raid out of four of six units, its advance under way. */
function raidOut() {
  const setup = fixture();
  offense(setup.context);
  const [operation] = setup.memory.operations as {
    phase: string;
    units: string[];
  }[];
  for (const unit of setup.units)
    if (operation!.units.includes(unit.id))
      unit.worldPosition = { x: 60, z: 60 };
  operation!.phase = "advance";
  return { ...setup, operation: operation! };
}

const raiders = (count: number) =>
  Array.from({ length: count }, (_, index) =>
    createActor({
      id: `raider-${index}`,
      definitionId: "arc-trooper",
      owner: "enemy",
      worldPosition: { x: 12, z: 12 },
    }),
  );

test("a crisis home cannot meet recalls an uncommitted operation", () => {
  const { context, operation, hostiles } = raidOut();
  hostiles.push(...raiders(3));
  offense({ ...context, posture: "defending" });
  expect(operation).toMatchObject({ phase: "return", outcome: "recalled" });
});

test("a crisis home can meet leaves operations running", () => {
  const { context, operation, hostiles } = raidOut();
  hostiles.push(...raiders(1));
  offense({ ...context, posture: "defending" });
  expect(operation.phase).toBe("advance");
});

test("an assembling operation recalled at home clears its orders and records the recall", () => {
  const { context, memory, issued, hostiles } = fixture();
  offense(context);
  hostiles.push(...raiders(3));
  offense({ ...context, posture: "defending", tick: context.tick + 1 });
  expect(memory.operations).toMatchObject([
    { phase: "return", outcome: "recalled" },
  ]);
  expect(issued).toContainEqual({
    kind: "group-move",
    actorIds: ["unit-0", "unit-1", "unit-2", "unit-3"],
    target: { x: 10, z: 10 },
  });
});

test("force taken by local defense counts toward the crisis response", () => {
  const { context, operation, hostiles, claims, reassigned, units } = raidOut();
  const id = operation.units[0]!;
  claims.delete(id);
  reassigned.add(id);
  units.find((unit) => unit.id === id)!.worldPosition = { x: 12, z: 12 };
  hostiles.push(...raiders(2));
  offense({ ...context, posture: "defending" });
  expect(operation.phase).toBe("advance");
  expect(operation.units).not.toContain(id);
});

test("simultaneous operations assign each provider to only one group", () => {
  const { context, memory, units, providers, target, claims } = fixture(10);
  const rally = units[0]!.worldPosition;
  providers.push(
    createActor({
      id: "medic",
      definitionId: "arc-medic",
      owner: "own",
      worldPosition: rally,
    }),
  );
  memory.operations = (["raid", "attack"] as const).map((kind, index) => {
    const members = units.slice(index * 5, index * 5 + 5).map(({ id }) => id);
    members.forEach((id) => claims.add(id));
    return launchOperation(context, {
      id: kind,
      kind,
      phase: "assemble",
      target,
      targetId: "income",
      rally,
      units: members,
    });
  });
  offense(context);
  expect(memory.operations).toMatchObject([
    { id: "raid", support: ["medic"] },
    { id: "attack" },
  ]);
  expect(
    (memory.operations as { support?: string[] }[])[1]!.support,
  ).toBeUndefined();
});

test("an engaged operation near its target continues through a crisis", () => {
  const { context, operation, hostiles, units, target } = raidOut();
  hostiles.push(...raiders(3));
  for (const unit of units)
    if (operation.units.includes(unit.id)) {
      unit.worldPosition = { ...target };
      unit.combat = {
        attack: { targetId: "income", lastKnown: target },
      } as typeof unit.combat;
    }
  offense({ ...context, posture: "recovering" });
  expect(operation.phase).toBe("advance");
});
