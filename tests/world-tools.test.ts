import { expect, test, vi } from "vitest";
import { createAttackMoveControls } from "../src/ui/attack-move-controls";
import { createRallyControls } from "../src/ui/rally-controls";
import { createWorldTools } from "../src/ui/world-tools";

const target = { x: 5, z: 3 };

test("pending placement retains the world until it can end", () => {
  const tools = createWorldTools();
  let pending = true;
  tools.activate("placement", () => {
    if (!pending) tools.end("placement");
  });
  expect(tools.activate("rally", () => tools.end("rally"))).toBe(false);
  expect(tools.active).toBe("placement");
  pending = false;
  expect(tools.activate("rally", () => tools.end("rally"))).toBe(true);
  expect(tools.active).toBe("rally");
  expect(tools.cancel()).toBe(true);
});

test("Attack Move finishes immediately after an unqueued target", () => {
  const tools = createWorldTools();
  const submitCommand = vi.fn();
  const movementStatus = { textContent: "" } as HTMLElement;
  let selection = ["trooper"];
  const attackMove = createAttackMoveControls(
    { submitCommand },
    { owner: "player" },
    { movementStatus },
    {
      tools,
      selectedMobileIds: () => selection,
      enabled: () => true,
      onStart: () => {},
      changed: () => {},
    },
  );
  expect(attackMove.start()).toBe(true);
  expect(attackMove.choose(target, true)).toBe(true);
  expect(tools.active).toBe("attackMove");
  expect(attackMove.choose(target)).toBe(true);
  expect(tools.active).toBeUndefined();
  expect(attackMove.choose(target)).toBe(false);
  attackMove.refresh();
  expect(movementStatus.textContent).toBe("Attack Move submitted.");
  expect(attackMove.start()).toBe(true);
  selection = ["scout"];
  expect(attackMove.choose(target)).toBe(false);
  expect(tools.active).toBeUndefined();
  expect(submitCommand).toHaveBeenCalledTimes(2);
});

test("rally targeting does not issue an order for a previous selection", () => {
  const tools = createWorldTools();
  const submitCommand = vi.fn();
  const button = () => new EventTarget() as HTMLButtonElement;
  const rally = {
    section: {} as HTMLElement,
    set: button(),
    clear: button(),
    cancel: button(),
    status: {} as HTMLElement,
  };
  let id = "barracks";
  const controls = createRallyControls(
    { submitCommand },
    { owner: "player", evaluateRallyPoint: () => true },
    { rally },
    {
      tools,
      selectedActor: () => ({ id, definitionId: "barracks" }),
      isProducer: () => true,
      enabled: () => true,
      onStart: () => {},
      changed: () => {},
    },
  );
  rally.set.dispatchEvent(new Event("click"));
  expect(tools.active).toBe("rally");
  id = "other-barracks";
  controls.choose(target);
  expect(tools.active).toBeUndefined();
  expect(submitCommand).not.toHaveBeenCalled();
});
