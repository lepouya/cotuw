import { expect, test } from "vitest";

import { createUnitControls } from "../src/ui/unit-controls";

import type {
  CommandOutcome,
  MoveCommand,
  StopCommand,
} from "../src/simulation/command";

function fixture() {
  const movementStatus = { textContent: "" } as HTMLElement;
  const controls = createUnitControls(
    {
      boxMode: false,
      additiveMode: false,
      setBoxMode: () => {},
      setAdditiveMode: () => {},
      stop: () => 0,
      select: () => {},
    },
    { movementStatus },
    { enabled: () => true, changed: () => {} },
  );
  return { controls, movementStatus };
}

const move: CommandOutcome<MoveCommand> = {
  tick: 0,
  command: { kind: "move", actorId: "unit", target: { x: 4, z: 0 } },
  accepted: true,
  reachedTarget: true,
};
const stop: CommandOutcome<StopCommand> = {
  tick: 0,
  command: { kind: "stop", actorId: "unit" },
  accepted: true,
};

test("move feedback reports each receipt's reachability without actor state", () => {
  const { controls, movementStatus } = fixture();
  expect(
    controls.onOutcomes([
      { ...move, reachedTarget: false },
      move,
      { ...move, accepted: false, reachedTarget: undefined },
    ]),
  ).toBe("partial");
  expect(movementStatus.textContent).toBe(
    "2 move orders accepted · 1 blocked destination · 1 unit unable to move.",
  );
  controls.dispose();
});

test("stop receipts do not hide move feedback in the same tick", () => {
  const { controls, movementStatus } = fixture();
  for (const outcomes of [
    [stop, move],
    [move, stop],
  ]) {
    expect(controls.onOutcomes(outcomes)).toBe("accepted");
    expect(movementStatus.textContent).toBe(
      "1 move order accepted · 1 stop order accepted.",
    );
  }
  controls.onOutcomes([stop]);
  expect(movementStatus.textContent).toBe("Selected units stopped.");
  controls.dispose();
});

test("a rejected stop does not replace feedback for a rejected move", () => {
  const { controls, movementStatus } = fixture();
  expect(
    controls.onOutcomes([
      { ...move, accepted: false },
      { ...stop, accepted: false },
    ]),
  ).toBe("unreachable");
  expect(movementStatus.textContent).toBe(
    "0 move orders accepted · 1 unit unable to move.",
  );
  controls.dispose();
});
