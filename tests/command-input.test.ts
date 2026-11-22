import { afterEach, expect, test, vi } from "vitest";

import { createCommandInput } from "../src/render/command-input";

import type { Scene } from "@babylonjs/core";
import type {
  CommandInputOptions,
  ContextAction,
} from "../src/render/command-input";

const inputs: { dispose: () => void }[] = [];
afterEach(() => {
  for (const input of inputs.splice(0)) input.dispose();
  vi.unstubAllGlobals();
});

function fixture(
  options: Pick<
    CommandInputOptions,
    "service" | "sameTypeInView" | "siteAt"
  > = {},
) {
  const host = new EventTarget();
  const document = Object.assign(new EventTarget(), {
    defaultView: host,
    querySelector: () => null,
    createElement: () => ({
      hidden: true,
      style: {},
      setAttribute: () => {},
      remove: () => {},
    }),
    body: { append: () => {} },
  });
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", host);
  const canvas = Object.assign(new EventTarget(), {
    ownerDocument: document,
    focus: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  });
  const visible = new Set(["unit-1", "unit-2", "wolf", "sentry", "relay"]);
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
      canIssueAttack: (id) =>
        visible.has(id) && (id.startsWith("unit") || id === "sentry"),
      canSelect: (id) => visible.has(id),
      canAttack: (id) => id === "wolf" && visible.has(id),
      canCommand: () => playing,
      submitCommand,
      ...options,
      onContextMenu: (_x, _y, next) => {
        actions = next;
      },
    },
  );
  inputs.push(input);
  const menu = (actorId?: string, shiftKey = false) => {
    picked = actorId;
    for (const type of ["pointerdown", "pointerup"])
      canvas.dispatchEvent(
        Object.assign(new Event(type), {
          button: 2,
          shiftKey,
          clientX: 10,
          clientY: 10,
          pointerId: 1,
        }),
      );
    return (kind: ContextAction["kind"]) =>
      actions.find((action) => action.kind === kind)!;
  };
  /** A primary click at a time in milliseconds. */
  const click = (
    actorId: string | undefined,
    timeStamp: number,
    shiftKey = false,
    end = "pointerup",
  ) => {
    picked = actorId;
    for (const type of ["pointerdown", end]) {
      const event = Object.assign(new Event(type), {
        button: 0,
        shiftKey,
        clientX: 10,
        clientY: 10,
        pointerId: 1,
        pointerType: "mouse",
      });
      Object.defineProperty(event, "timeStamp", { value: timeStamp });
      canvas.dispatchEvent(event);
    }
  };
  return {
    input,
    menu,
    click,
    clickElsewhere: () => document.dispatchEvent(new Event("pointerdown")),
    keyDown: (repeat = false) =>
      document.dispatchEvent(Object.assign(new Event("keydown"), { repeat })),
    visible,
    submitCommand,
    pause: () => {
      playing = false;
    },
  };
}

test("delayed movement uses only the surviving members of its selection", () => {
  const { input, menu, visible, submitCommand } = fixture();
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
});

test("site selection is replaced by actor selection and cleared by empty batches", () => {
  const { input, click, menu } = fixture({ siteAt: () => "grove" });
  input.select("relay");
  click(undefined, 100);
  expect(input.selectedSiteId).toBe("grove");
  expect(input.selectedActorIds).toEqual([]);
  input.selectMany([], true);
  expect(input.selectedSiteId).toBe("grove");
  input.selectMany([]);
  expect(input.selectedSiteId).toBeUndefined();
  menu()("select-site").run();
  click("unit-1", 200);
  expect(input.selectedSiteId).toBeUndefined();
  expect(input.selectedActorIds).toEqual(["unit-1"]);
});

test("a selected sentry attacks without movement or queued mobile orders", () => {
  const { input, menu, submitCommand } = fixture();
  input.select("sentry");
  input.setQueueMode(true);
  menu("wolf")("attack").run();
  expect(submitCommand).toHaveBeenCalledExactlyOnceWith({
    kind: "attack",
    actorId: "sentry",
    targetId: "wolf",
  });
  expect(menu()("move")).toBeUndefined();
  input.select("relay");
  expect(menu("wolf")("attack")).toBeUndefined();
});

test("delayed actions cannot select or attack a target that leaves vision", () => {
  const { input, menu, visible, submitCommand } = fixture();
  input.select("unit-1");
  const action = menu("wolf");
  visible.delete("wolf");
  action("attack").run();
  action("select").run();
  expect(submitCommand).not.toHaveBeenCalled();
  expect(input.selectedActorIds).toEqual(["unit-1"]);
});

test("pausing invalidates a movement action already shown", () => {
  const { input, menu, pause, submitCommand } = fixture();
  input.select("unit-1");
  const action = menu()("move");
  pause();
  action.run();
  expect(submitCommand).not.toHaveBeenCalled();
  expect(input.stop()).toBe(0);
});

test("an Add action cannot toggle out a unit selected since the menu opened", () => {
  const { input, menu } = fixture();
  input.select("unit-1");
  const add = menu("unit-2")("add");
  input.select("unit-2", true);
  add.run();
  expect(input.selectedActorIds).toEqual(["unit-1", "unit-2"]);
});

test("Shift or Queue Orders mode queues moves and attacks", () => {
  const { input, menu, submitCommand } = fixture();
  input.select("unit-1");
  menu(undefined, true)("move").run();
  expect(submitCommand).toHaveBeenLastCalledWith({
    kind: "move",
    actorId: "unit-1",
    target: { x: 1, z: 2 },
    queued: true,
  });
  input.setQueueMode(true);
  menu("wolf")("attack").run();
  expect(submitCommand).toHaveBeenLastCalledWith({
    kind: "attack",
    actorId: "unit-1",
    targetId: "wolf",
    queued: true,
  });
  input.setQueueMode(false);
  menu()("move").run();
  expect(submitCommand).toHaveBeenLastCalledWith({
    kind: "move",
    actorId: "unit-1",
    target: { x: 1, z: 2 },
  });
});

test("deselect clears selection and reports whether there was any", () => {
  const { input } = fixture();
  expect(input.deselect()).toBe(false);
  input.select("unit-1");
  expect(input.deselect()).toBe(true);
  expect(input.selectedActorIds).toEqual([]);
});

test("support targeting queues with Shift and yields to Add units mode", () => {
  const run = vi.fn();
  const service = vi.fn(() => ({ label: "Heal", run }));
  const { input, menu } = fixture({ service });
  input.select("unit-1");
  const action = menu("unit-2", true)("service");
  expect(action.label).toBe("Heal");
  expect(service).toHaveBeenCalledWith("unit-2", true);
  action.run();
  expect(run).toHaveBeenCalledTimes(1);
  input.setAdditiveMode(true);
  service.mockClear();
  expect(menu("unit-2")("service")).toBeUndefined();
  expect(service).not.toHaveBeenCalled();
});

test("double clicks select the unit's type in view, adding with Shift", () => {
  const { input, click, keyDown, visible } = fixture({
    sameTypeInView: (id) =>
      id === "unit-1" ? ["unit-1", "unit-3", "hidden-unit"] : [],
  });
  visible.add("unit-3");
  input.select("unit-2");
  click("unit-1", 1000);
  expect(input.selectedActorIds).toEqual(["unit-1"]);
  click("unit-1", 1300);
  // Members the player cannot select are left out.
  expect(input.selectedActorIds).toEqual(["unit-1", "unit-3"]);
  // A third click is an ordinary click again.
  click("unit-1", 1500);
  expect(input.selectedActorIds).toEqual(["unit-1"]);
  input.select("unit-2");
  click("unit-1", 3000, true);
  // A held Shift's key repeats keep the pair; a new key press ends it.
  keyDown(true);
  click("unit-1", 3200, true);
  expect(input.selectedActorIds).toEqual(["unit-1", "unit-2", "unit-3"]);
  // Slow clicks and clicks on different actors stay single clicks.
  input.select(undefined);
  click("unit-1", 5000);
  click("unit-1", 5500);
  click("unit-2", 5600);
  expect(input.selectedActorIds).toEqual(["unit-2"]);
  // Types without matches, such as hostile actors, keep their normal action.
  click("wolf", 6000);
  click("wolf", 6100);
  expect(input.selectedActorIds).toEqual(["unit-2"]);
  click("unit-1", 7000);
  keyDown();
  click("unit-1", 7100);
  expect(input.selectedActorIds).toEqual(["unit-1"]);
});

test("terrain clicks and secondary gestures interrupt double clicks", () => {
  const { input, click, menu } = fixture({
    sameTypeInView: () => ["unit-1", "unit-2"],
  });
  click("unit-1", 1000);
  click(undefined, 1100);
  click("unit-1", 1200);
  expect(input.selectedActorIds).toEqual(["unit-1"]);
  menu("unit-1");
  click("unit-1", 1300);
  expect(input.selectedActorIds).toEqual(["unit-1"]);
});

test("a cancelled pointer interrupts double clicks", () => {
  const { input, click } = fixture({
    sameTypeInView: () => ["unit-1", "unit-2"],
  });
  click("unit-1", 1000);
  click("unit-1", 1100, false, "pointercancel");
  click("unit-1", 1200);
  expect(input.selectedActorIds).toEqual(["unit-1"]);
});

test("sidebar actions interrupt double clicks on command targets", () => {
  const { input, click, clickElsewhere, submitCommand } = fixture({
    service: () => ({
      label: "Heal",
      run: () => submitCommand({ kind: "service" }),
    }),
    sameTypeInView: () => ["unit-2"],
  });
  input.select("unit-1");
  click("unit-2", 1000);
  clickElsewhere();
  click("unit-2", 1200);
  expect(submitCommand).toHaveBeenCalledTimes(2);
  expect(input.selectedActorIds).toEqual(["unit-1"]);
});
