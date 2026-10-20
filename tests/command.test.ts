import { expect, expectTypeOf, test } from "vitest";

import { isMissionCommand, isOutcomeOf } from "../src/simulation/command";

import type {
  CommandOutcome,
  MoveCommand,
  PlaceActorCommand,
  TrainUnitCommand,
} from "../src/simulation/command";
import type { TrainingReason } from "../src/simulation/production";

test.each([
  { kind: "group-move", actorIds: Array(1), target: { x: 0, z: 0 } },
  { kind: "terrain", heights: Array(1) },
  { kind: "terrain", tiles: Array(1) },
])("commands with sparse arrays cannot be saved: %j", (command) => {
  expect(isMissionCommand(command)).toBe(false);
});

test("outcomes pair each command with its own rejection reasons", () => {
  type Training = Extract<CommandOutcome, { command: TrainUnitCommand }>;
  expectTypeOf<Training>().toEqualTypeOf<CommandOutcome<TrainUnitCommand>>();
  expectTypeOf<{
    tick: number;
    command: TrainUnitCommand;
    accepted: false;
    reason: "unknown-definition";
  }>().not.toExtend<CommandOutcome>();
  expectTypeOf<{
    tick: number;
    command: PlaceActorCommand;
    accepted: false;
    reason: "missing-producer";
  }>().not.toExtend<CommandOutcome>();
  expectTypeOf<{
    tick: number;
    command: MoveCommand;
    accepted: false;
    reason: "exit-blocked";
  }>().not.toExtend<CommandOutcome>();

  const outcome: CommandOutcome = {
    tick: 0,
    command: {
      kind: "train-unit",
      actorId: "unit",
      producerId: "producer",
      definitionId: "scout",
    },
    accepted: false,
    reason: "exit-blocked",
  };
  expect(isOutcomeOf(outcome, "place-actor")).toBe(false);
  expect(isOutcomeOf(outcome, "train-unit")).toBe(true);
  if (isOutcomeOf(outcome, "train-unit")) {
    expectTypeOf(outcome.reason).toEqualTypeOf<TrainingReason | undefined>();
  }
});
