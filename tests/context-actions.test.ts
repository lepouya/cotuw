import { expect, test } from "vitest";

import { contextActionKinds } from "../src/render/command-input";

const state = (selectedIds: string[], options = {}) => ({
  selectedIds,
  movers: selectedIds.filter((id) => id.startsWith("unit")),
  boxMode: false,
  additive: false,
  canAttack: (id: string) => id === "wolf",
  canMove: (id: string) => id.startsWith("unit"),
  ...options,
});

test("the primary action comes first and the menu adds alternatives", () => {
  expect(
    contextActionKinds({ actorId: "wolf", ground: true }, state(["unit-1"])),
  ).toEqual(["attack", "select"]);
  expect(
    contextActionKinds({ actorId: "wolf", ground: true }, state([])),
  ).toEqual(["select"]);
  expect(
    contextActionKinds({ actorId: "unit-1", ground: true }, state(["unit-1"])),
  ).toEqual(["select", "remove"]);
  expect(
    contextActionKinds({ actorId: "unit-2", ground: true }, state(["unit-1"])),
  ).toEqual(["select", "add"]);
  expect(
    contextActionKinds(
      { actorId: "unit-1", ground: true },
      state(["unit-1", "unit-2"]),
    ),
  ).toEqual(["select", "remove"]);
  expect(
    contextActionKinds(
      { actorId: "unit-2", ground: true },
      state(["unit-1"], { additive: true }),
    ),
  ).toEqual(["add"]);
  expect(
    contextActionKinds(
      { actorId: "barracks", ground: true },
      state(["unit-1"]),
    ),
  ).toEqual(["select"]);
});

test("paused inspection offers selection without simulation commands", () => {
  const paused = state(["unit-1"], { canCommand: false });
  expect(contextActionKinds({ actorId: "wolf", ground: true }, paused)).toEqual(
    ["select"],
  );
  expect(contextActionKinds({ ground: true }, paused)).toEqual(["clear"]);
});

test("ground targets move a selection or clear a stationary one", () => {
  expect(contextActionKinds({ ground: true }, state(["unit-1"]))).toEqual([
    "move",
    "attack-move",
  ]);
  expect(
    contextActionKinds({ ground: true }, state(["unit-1"], { boxMode: true })),
  ).toEqual(["clear"]);
  expect(contextActionKinds({ ground: true }, state(["barracks"]))).toEqual([
    "clear",
  ]);
  expect(contextActionKinds({ ground: true }, state([]))).toEqual([]);
  expect(contextActionKinds({ ground: false }, state(["unit-1"]))).toEqual([]);
});
