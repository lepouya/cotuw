import { afterEach, expect, test, vi } from "vitest";
import { createCommandInput } from "../src/render/command-input";

import type { Scene } from "@babylonjs/core";
import type { ContextAction } from "../src/render/command-input";

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const host = new EventTarget();
  const document = {
    defaultView: host,
    querySelector: () => null,
    createElement: () => ({
      hidden: true,
      style: {},
      setAttribute: () => {},
      remove: () => {},
    }),
    body: { append: () => {} },
  };
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", host);
  const canvas = Object.assign(new EventTarget(), {
    ownerDocument: document,
    focus: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  });
  const visible = new Set(["unit-1", "unit-2", "wolf"]);
  let playing = true;
  let picked: string | undefined;
  let actions: readonly ContextAction[] = [];
  const submitCommand = vi.fn();
  const input = createCommandInput(
    canvas as unknown as HTMLCanvasElement,
    {
      pick: () => ({ pickedMesh: picked ? { name: picked } : null }),
    } as unknown as Scene,
    {
      actorIdForMesh: (mesh) => mesh?.name,
      movementTargetForMesh: () => ({ x: 1, z: 2 }),
      actorIdsInRect: () => [],
      canMove: (id) => visible.has(id) && id.startsWith("unit"),
      canSelect: (id) => visible.has(id),
      canAttack: (id) => id === "wolf" && visible.has(id),
      canCommand: () => playing,
      submitCommand,
      onContextMenu: (_x, _y, next) => {
        actions = next;
      },
    },
  );
  const menu = (actorId?: string) => {
    picked = actorId;
    for (const type of ["pointerdown", "pointerup"])
      canvas.dispatchEvent(
        Object.assign(new Event(type), {
          button: 2,
          clientX: 10,
          clientY: 10,
          pointerId: 1,
        }),
      );
    return (kind: ContextAction["kind"]) =>
      actions.find((action) => action.kind === kind)!;
  };
  return {
    input,
    menu,
    visible,
    submitCommand,
    pause: () => {
      playing = false;
    },
  };
}

test("delayed movement uses only the surviving members of its selection", () => {
  const { input, menu, visible, submitCommand } = fixture();
  try {
    input.selectMany(["unit-1", "unit-2"]);
    const move = menu()("move");
    visible.delete("unit-1");
    input.retainSelection((id) => visible.has(id));
    move.run();
    expect(submitCommand).toHaveBeenCalledWith({
      kind: "move",
      actorId: "unit-2",
      target: { x: 1, z: 2 },
    });
    input.select(undefined);
    move.run();
    expect(submitCommand).toHaveBeenCalledTimes(1);
  } finally {
    input.dispose();
  }
});

test("delayed actions cannot select or attack a target that leaves vision", () => {
  const { input, menu, visible, submitCommand } = fixture();
  try {
    input.select("unit-1");
    const action = menu("wolf");
    visible.delete("wolf");
    action("attack").run();
    action("select").run();
    expect(submitCommand).not.toHaveBeenCalled();
    expect(input.selectedActorIds).toEqual(["unit-1"]);
  } finally {
    input.dispose();
  }
});

test("pausing invalidates a movement action already shown", () => {
  const { input, menu, pause, submitCommand } = fixture();
  try {
    input.select("unit-1");
    const action = menu()("move");
    pause();
    action.run();
    expect(submitCommand).not.toHaveBeenCalled();
    expect(input.stop()).toBe(0);
  } finally {
    input.dispose();
  }
});

test("an Add action cannot toggle out a unit selected since the menu opened", () => {
  const { input, menu } = fixture();
  try {
    input.select("unit-1");
    const add = menu("unit-2")("add");
    input.select("unit-2", true);
    add.run();
    expect(input.selectedActorIds).toEqual(["unit-1", "unit-2"]);
  } finally {
    input.dispose();
  }
});
