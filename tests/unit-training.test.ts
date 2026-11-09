import { expect, test, vi } from "vitest";

import {
  createMissionSimulation,
  createMissionState,
} from "../src/simulation/mission";
import { OccupancyGrid } from "../src/simulation/occupancy";
import { createTilePlacedActor } from "../src/simulation/placement";
import { TerrainGrid } from "../src/simulation/terrain";
import { createUnitTraining } from "../src/ui/unit-training";
import { trainableUnitIds } from "../src/simulation/production";

import type { ActorDefinition } from "../src/simulation/actor";
import type { MissionState } from "../src/simulation/mission";

class ElementStub extends EventTarget {
  disabled = false;
  textContent = "";
  title = "";
  click() {
    this.dispatchEvent(new Event("click"));
  }
}
const definitions: ActorDefinition[] = [
  {
    id: "trooper",
    behaviorId: "idle",
    movement: { speed: 4, profileId: "ground" },
  },
  {
    id: "scout",
    behaviorId: "idle",
    movement: { speed: 7, profileId: "ground" },
  },
  {
    id: "producer",
    behaviorId: "idle",
    production: { unitDefinitionIds: ["scout"] },
    footprint: {
      layer: "surface",
      occupiedTiles: [{ x: 0, z: 0 }],
      blocksMovement: true,
    },
    placement: { terrainTypeIds: ["plain"], maxSlope: 1 },
  },
];
function fixture(retiredIds: string[] = [], saved?: MissionState) {
  const map = new TerrainGrid({ width: 12, height: 12, tileSize: 1 });
  const state = createMissionState(
    ["one", "two"].map((actorId, index) =>
      createTilePlacedActor(
        map,
        definitions[2],
        {
          actorId,
          origin: { x: 2 + index * 4, z: 2 },
        },
        "player",
      ),
    ),
  );
  state.retiredActorIds = retiredIds;
  const simulation = createMissionSimulation({
    state: saved ?? state,
    map,
    occupancy: new OccupancyGrid(map),
    bounds: map.worldBounds,
    definitions,
    tickSeconds: 1 / 60,
    behaviorRegistry: new Map([
      [
        "idle",
        {
          handleCommand: () => false,
          update: () => {},
          canStandAt: () => true,
        },
      ],
    ]),
  });
  const trooper = new ElementStub();
  const scout = new ElementStub();
  const status = new ElementStub();
  let selected = "one";
  let paused = false;
  let placing = false;
  const controller = createUnitTraining(
    simulation,
    simulation.viewOf(simulation.playerOwner),
    {
      train: [
        {
          definitionId: "trooper",
          button: trooper as unknown as HTMLButtonElement,
        },
        {
          definitionId: "scout",
          button: scout as unknown as HTMLButtonElement,
        },
      ],
      productionStatus: status as unknown as HTMLElement,
    },
    {
      names: new Map([
        ["trooper", "Trooper"],
        ["scout", "Scout"],
      ]),
      roles: () => ({
        supportHub: "Command Center",
        refinery: "Refinery",
        harvester: "Harvester",
      }),
      selectedActorId: () => selected,
      unitDefinitionIds: () =>
        trainableUnitIds(
          simulation.actorById(selected),
          new Map(definitions.map((definition) => [definition.id, definition])),
        ),
      enabled: () => !paused && !placing,
      paused: () => paused,
    },
  );
  const tick = () => {
    for (const outcome of simulation.tick()) controller.onOutcome(outcome);
    controller.refresh();
  };
  return {
    simulation,
    controller,
    scout,
    trooper,
    status,
    tick,
    setBlocked: (state: { paused?: boolean; placing?: boolean }) => {
      paused = state.paused ?? false;
      placing = state.placing ?? false;
      controller.refresh();
    },
    select: (id: string) => {
      selected = id;
      controller.refresh();
    },
  };
}

test("availability follows the selected producer's roster instead of the first unit button", () => {
  const { controller, trooper, scout, status } = fixture();
  controller.refresh();
  expect(trooper.disabled).toBe(true);
  expect(scout.disabled).toBe(false);
  expect(status.textContent).toContain("Train a unit");
});

test("a selection without production cannot inherit errors from unrelated unit types", () => {
  const { simulation, select, status } = fixture();
  const evaluate = vi.spyOn(
    simulation.viewOf(simulation.playerOwner),
    "evaluateTraining",
  );
  select("missing");
  expect(evaluate).not.toHaveBeenCalled();
  expect(status.textContent).toContain("Select a production building");
});

test("plain training buttons expose pending and unavailable explanations", () => {
  const { controller, scout, trooper, tick } = fixture();
  controller.refresh();
  expect(trooper.title).toContain("cannot train");
  scout.click();
  expect(scout.title).toContain("confirmed");
  tick();
  expect(scout.title).toBe("");
});

test("training skips retired IDs and prevents a second pending request", () => {
  const { simulation, controller, scout, trooper, status, tick } = fixture([
    "trained-unit-1",
  ]);
  scout.click();
  expect(simulation.snapshot().commands[0].command).toMatchObject({
    actorId: "trained-unit-2",
    producerId: "one",
  });
  expect(status.textContent).toBe("Training Scout…");
  expect(scout.disabled).toBe(true);
  trooper.click();
  scout.click();
  expect(simulation.snapshot().commands).toHaveLength(1);
  tick();
  expect(simulation.actorById("trained-unit-2")?.definitionId).toBe("scout");
  expect(scout.disabled).toBe(false);
  controller.dispose();
  scout.click();
  expect(simulation.snapshot().commands).toHaveLength(0);
});

test("blocking training preserves pending orders and reports the current session condition", () => {
  const { simulation, controller, scout, status, tick, setBlocked } = fixture();
  scout.click();
  setBlocked({ paused: true, placing: true });
  expect(status.textContent).toBe("Resume the mission to train units.");
  expect(scout.title).toBe(status.textContent);
  scout.click();
  expect(simulation.snapshot().commands).toHaveLength(1);
  setBlocked({});
  expect(scout.disabled).toBe(true);
  expect(status.textContent).toBe("Training Scout…");
  tick();
  expect(scout.disabled).toBe(false);
  setBlocked({ placing: true });
  expect(status.textContent).toBe(
    "Finish or cancel the current building placement.",
  );
  scout.click();
  expect(simulation.snapshot().commands).toEqual([]);
  setBlocked({ paused: true });
  controller.fault();
  expect(status.textContent).toContain("Simulation stopped");
  expect(scout.disabled).toBe(true);
  setBlocked({});
  expect(scout.disabled).toBe(true);
});

test("success feedback belongs to its producer and cannot leak into another selection", () => {
  const { scout, status, tick, select } = fixture();
  scout.click();
  tick();
  expect(status.textContent).toContain("Scout ready");
  select("two");
  expect(status.textContent).toContain("Train a unit");
  select("one");
  expect(status.textContent).toContain("Scout ready");
});

test("restored pending training keeps its ID and cannot complete a new request", () => {
  const original = fixture();
  original.simulation.submitCommand(
    {
      kind: "train-unit",
      actorId: "trained-unit-1",
      producerId: "two",
      definitionId: "scout",
    },
    { owner: original.simulation.playerOwner },
  );
  const saved = original.simulation.snapshot();
  original.controller.dispose();
  original.simulation.dispose();
  const { simulation, controller, scout, status } = fixture([], saved);
  scout.click();
  expect(
    simulation
      .snapshot()
      .commands.map(({ command }) =>
        command.kind === "train-unit" ? command.actorId : undefined,
      ),
  ).toEqual(["trained-unit-1", "trained-unit-2"]);
  const outcomes = simulation.tick();
  expect(outcomes.map(({ accepted }) => accepted)).toEqual([true, true]);
  controller.onOutcome(outcomes[0]);
  controller.refresh();
  expect(status.textContent).toBe("Training Scout…");
  controller.onOutcome(outcomes[1]);
  controller.refresh();
  expect(status.textContent).toContain("Scout ready");
  expect(simulation.actorById("trained-unit-2")?.definitionId).toBe("scout");
});

test("tick-time rejection clears pending work and faulting disables every training action", () => {
  const { simulation, controller, scout, trooper, status, tick, select } =
    fixture();
  simulation.submitCommand(
    { kind: "remove-actor", actorId: "one" },
    { owner: simulation.playerOwner },
  );
  scout.click();
  tick();
  expect(status.textContent).toContain("Select a production building");
  select("two");
  expect(scout.disabled).toBe(false);
  controller.fault();
  expect(scout.disabled).toBe(true);
  expect(trooper.disabled).toBe(true);
  expect(status.textContent).toContain("Simulation stopped");
  scout.click();
  expect(simulation.snapshot().commands).toHaveLength(0);
});
