import { expect, test } from "vitest";
import { contextualMoveCommands } from "../src/ui/contextual-move";
import {
  createCultivationSite,
  createCultivatorState,
} from "../src/simulation/cultivation";
import {
  createHarvesterState,
  workersForSite,
} from "../src/simulation/economy";
import type { EconomyState } from "../src/simulation/economy";

import type { GroupMoveCommand, MoveCommand } from "../src/simulation/command";

const workers = new Set(["h1", "h2"]);
const target = { x: 1, z: 2 };

test.each([
  { siteId: "materials", workerId: "harvester", otherId: "cultivator" },
  { siteId: "lifebloom", workerId: "cultivator", otherId: "harvester" },
])(
  "mixed gathering capabilities select compatible workers at $siteId",
  ({ siteId, workerId, otherId }) => {
    const economy: EconomyState = {
      materials: 0,
      depositedMaterials: 0,
      sites: [
        {
          id: "materials",
          name: "Materials",
          tile: { x: 1, z: 1 },
          initialMaterials: 100,
          remainingMaterials: 100,
        },
      ],
      loot: [],
      harvesters: [createHarvesterState("harvester", "refinery")],
      production: [],
      cultivation: {
        lifebloom: 0,
        depositedLifebloom: 0,
        sites: [
          createCultivationSite("lifebloom", "Lifebloom", { x: 2, z: 1 }),
        ],
        workers: [createCultivatorState("cultivator")],
      },
    };
    const command: GroupMoveCommand = {
      kind: "group-move",
      actorIds: [workerId, otherId, "trooper"],
      target,
      queued: true,
    };
    expect(
      contextualMoveCommands(
        command,
        new Set(workersForSite(economy, siteId).map(({ actorId }) => actorId)),
        siteId,
      ),
    ).toEqual([
      { kind: "gather", actorId: workerId, siteId, queued: true },
      {
        kind: "group-move",
        actorIds: [otherId, "trooper"],
        target,
        queued: true,
      },
    ]);
    expect(workersForSite(economy, "missing")).toEqual([]);
  },
);

test("ground moves and groups without Harvesters retain their orders", () => {
  const command: GroupMoveCommand = {
    kind: "group-move",
    actorIds: ["t1", "t2"],
    target,
  };
  expect(contextualMoveCommands(command, workers, "ore")).toEqual([command]);
  const move: MoveCommand = { kind: "move", actorId: "h1", target };
  expect(contextualMoveCommands(move, workers)).toEqual([move]);
  expect(contextualMoveCommands(move, workers, "ore")).toEqual([
    { kind: "gather", actorId: "h1", siteId: "ore" },
  ]);
});

test("mixed groups gather with every Harvester while other units keep formation", () => {
  const command: GroupMoveCommand = {
    kind: "group-move",
    actorIds: ["h1", "h2", "t1", "t2"],
    target,
  };
  expect(contextualMoveCommands(command, workers, "ore")).toEqual([
    { kind: "gather", actorId: "h1", siteId: "ore" },
    { kind: "gather", actorId: "h2", siteId: "ore" },
    { kind: "group-move", actorIds: ["t1", "t2"], target },
  ]);
  expect(command.actorIds).toEqual(["h1", "h2", "t1", "t2"]);
  expect(
    contextualMoveCommands(
      { ...command, actorIds: ["h1", "t1"] },
      workers,
      "ore",
    ),
  ).toEqual([
    { kind: "gather", actorId: "h1", siteId: "ore" },
    { kind: "move", actorId: "t1", target },
  ]);
});
