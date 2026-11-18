import { expect, test } from "vitest";

import { ARC_AI_PLANS, BASE_CONTENT } from "./helpers/content";
import { createActor } from "../src/simulation/actor";
import { repair } from "../src/simulation/ai-repair";
import { repairCharge } from "../src/simulation/repair";

import type { Actor } from "../src/simulation/actor";
import type { MissionCommand } from "../src/simulation/command";
import type { AiConcernContext } from "../src/simulation/director";

const definitions = new Map(BASE_CONTENT.actors.map((d) => [d.id, d]));
const PLAN = ARC_AI_PLANS.repair!;

const building = (id: string, definitionId: string, healthShare = 1) => {
  const maximum = definitions.get(definitionId)!.health!;
  return {
    ...createActor({
      id,
      definitionId,
      owner: "own",
      worldPosition: { x: 10, z: 10 },
    }),
    tilePlacement: { origin: { x: 8, z: 8 }, quarterTurns: 0 },
    ...(healthShare < 1 && { health: maximum * healthShare }),
  } as Actor;
};

function fixture(buildings: Actor[], funds = 1000) {
  const issued: MissionCommand[] = [];
  const kept: unknown[] = [];
  const context = {
    definitions,
    plan: PLAN,
    funds: () => funds,
    releaseFunds: (keep?: unknown) => kept.push(keep),
    issue: (command: MissionCommand) => {
      issued.push(command);
      return true;
    },
    view: {
      actors: () => ({ own: buildings }),
      offlineIds: () => new Set(["offline"]),
      economy: () => ({}),
    },
  } as unknown as AiConcernContext;
  return { context, issued, kept };
}

test("repair starts with the headquarters, then the most damaged", () => {
  const { context, issued } = fixture([
    building("barracks", "arc-field-barracks", 0.2),
    building("refinery", "arc-materials-refinery", 0.1),
    building("hq", "arc-command-center-prototype", 0.7),
    building("light", "arc-sentry-turret", 0.9),
  ]);
  repair(context);
  expect(issued).toEqual([{ kind: "repair", actorId: "hq" }]);
});

test("lightly damaged, offline, and already repairing buildings wait", () => {
  const hq = building("hq", "arc-command-center-prototype");
  const offline = building("offline", "arc-field-barracks", 0.2);
  const light = building("light", "arc-field-barracks", 0.9);
  const { context, issued } = fixture([hq, offline, light]);
  repair(context);
  expect(issued).toEqual([]);
  const repairing = building("repairing", "arc-materials-refinery", 0.2);
  repairing.repair = { priority: 1, queuedTick: 0 } as Actor["repair"];
  const busy = fixture([
    hq,
    repairing,
    building("refinery", "arc-materials-refinery", 0.2),
  ]);
  repair(busy.context);
  expect(busy.issued).toEqual([]);
});

test("repair reserves its full price until its payments are due", () => {
  const barracks = building("barracks", "arc-field-barracks", 0.5);
  const definition = definitions.get("arc-field-barracks")!;
  const price = repairCharge(definition.health! / 2, definition);
  const poor = fixture(
    [building("hq", "arc-command-center-prototype"), barracks],
    price - 1,
  );
  repair(poor.context);
  expect(poor.issued).toEqual([]);
  expect(poor.kept).toEqual([]);
  const funded = fixture(
    [building("hq", "arc-command-center-prototype"), barracks],
    price + 10,
  );
  repair(funded.context);
  expect(funded.issued).toEqual([{ kind: "repair", actorId: "barracks" }]);
  expect(funded.kept).toEqual([{ materials: price }]);
  barracks.repair = {
    priority: 1,
    queuedTick: 0,
    missingHealth: definition.health! / 2,
    completedSteps: 1,
    paidCost: 1,
  };
  repair(funded.context);
  expect(funded.issued).toHaveLength(1);
  expect(funded.kept[1]).toEqual({ materials: price - 1 });
});

test("repair yields the infrastructure slot to waiting construction", () => {
  const hq = building("hq", "arc-command-center-prototype", 0.5);
  hq.repair = {
    priority: 1,
    queuedTick: 0,
    active: true,
  } as Actor["repair"];
  const blueprint = building("blueprint", "arc-sentry-turret");
  hq.headquartersId = hq.id;
  blueprint.headquartersId = hq.id;
  const construction = {
    priority: 2,
    queuedTick: 1,
    paidCost: 75,
    completedTicks: 0,
    totalTicks: 80,
  } as NonNullable<Actor["construction"]>;
  blueprint.construction = construction;
  const { context, issued } = fixture([hq, blueprint]);
  repair(context);
  expect(issued).toEqual([{ kind: "cancel-repair", actorId: "hq" }]);
  blueprint.headquartersId = "another-hq";
  const elsewhere = fixture([hq, blueprint]);
  repair(elsewhere.context);
  expect(elsewhere.issued).toEqual([]);
  // Active construction holds the slot; repair waits without cancelling.
  construction.active = true;
  delete hq.repair;
  const active = fixture([hq, blueprint]);
  repair(active.context);
  expect(active.issued).toEqual([]);
});
