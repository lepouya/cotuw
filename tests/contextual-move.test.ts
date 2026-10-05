import { expect, test } from "vitest";
import { contextualMoveCommands } from "../src/ui/contextual-move";

import type { GroupMoveCommand, MoveCommand } from "../src/simulation/command";

const workers = new Set(["h1", "h2"]);
const target = { x: 1, z: 2 };

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
