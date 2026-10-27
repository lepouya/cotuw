import { Matrix, NullEngine, Scene, Vector3 } from "@babylonjs/core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { TerrainMap } from "../src/map";
import { createBuildingPlacement } from "../src/render/building-placement";
import {
  createMissionSimulation,
  createMissionState,
} from "../src/simulation/mission";
import { OccupancyGrid } from "../src/simulation/occupancy";
import { createTilePlacedActor } from "../src/simulation/placement";

import type { PickingInfo } from "@babylonjs/core";
import type { Actor, ActorDefinition } from "../src/simulation/actor";
import type { MissionState } from "../src/simulation/mission";

const definition: ActorDefinition = {
  id: "store",
  behaviorId: "idle",
  footprint: {
    layer: "surface",
    blocksMovement: true,
    occupiedTiles: [
      { x: 0, z: 0 },
      { x: 1, z: 0 },
    ],
  },
  placement: { terrainTypeIds: ["plain"], maxSlope: 1 },
};

class ElementStub extends EventTarget {
  disabled = false;
  textContent = "";
  dataset: Record<string, string> = {};
  getBoundingClientRect() {
    return { left: 0, top: 0 };
  }
  click() {
    this.dispatchEvent(new Event("click"));
  }
}

function pointer(target: EventTarget, type: string) {
  const event = new Event(type);
  Object.assign(event, {
    button: 0,
    clientX: 10,
    clientY: 10,
    pointerId: 1,
    pointerType: "mouse",
  });
  target.dispatchEvent(event);
}

function fixture(
  actors: Actor[] = [],
  retiredIds: string[] = [],
  saved?: MissionState,
) {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const map = new TerrainMap({ width: 8, height: 8, tileSize: 1 });
  const state = createMissionState(actors);
  state.retiredActorIds = retiredIds;
  const simulation = createMissionSimulation({
    state: saved ?? state,
    map,
    occupancy: new OccupancyGrid(map),
    bounds: map.worldBounds,
    definitions: [definition],
    tickSeconds: 1,
    behaviorRegistry: new Map([
      ["idle", { handleCommand: () => false, update: () => {} }],
    ]),
  });
  const canvas = new ElementStub();
  const controls = {
    build: new ElementStub(),
    rotate: new ElementStub(),
    confirm: new ElementStub(),
    cancel: new ElementStub(),
    status: new ElementStub(),
  };
  let pickedTile = { x: 1, z: 1 };
  const pick = vi.spyOn(scene, "pick").mockImplementation(() => {
    const point = map.tileCenter(pickedTile.x, pickedTile.z);
    return {
      hit: true,
      pickedPoint: new Vector3(point.x, 0, point.z),
    } as PickingInfo;
  });
  vi.spyOn(scene, "getTransformMatrix").mockReturnValue(Matrix.Identity());
  const onPlaced = vi.fn();
  const placement = createBuildingPlacement(
    canvas as unknown as HTMLCanvasElement,
    scene,
    map,
    simulation,
    {
      appearances: new Map([
        [definition.id, { height: 0.3, color: [0.2, 0.4, 0.6] }],
      ]),
      buildings: [
        {
          definition,
          name: "Store",
          build: controls.build as unknown as HTMLButtonElement,
        },
      ],
      controls: controls as unknown as Parameters<
        typeof createBuildingPlacement
      >[4]["controls"],
      onPlaced,
      onStart: () => {},
    },
  );
  const begin = () => {
    controls.build.click();
    pointer(canvas, "pointermove");
    placement.update();
  };
  return {
    map,
    scene,
    simulation,
    canvas,
    controls,
    placement,
    onPlaced,
    begin,
    pick,
    pickTile: (x: number, z: number) => {
      pickedTile = { x, z };
    },
    dispose: () => {
      placement.dispose();
      simulation.dispose();
      engine.dispose();
    },
  };
}

let current: ReturnType<typeof fixture> | undefined;
beforeEach(() => {
  vi.stubGlobal("window", new EventTarget());
});
afterEach(() => {
  current?.dispose();
  current = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("placement skips existing and retired actor IDs after restoring a mission", () => {
  const map = new TerrainMap({ width: 8, height: 8, tileSize: 1 });
  const actor = createTilePlacedActor(
    map,
    definition,
    {
      actorId: "store-1",
      origin: { x: 4, z: 4 },
    },
    "player",
  );
  current = fixture([actor], ["store-2"]);
  current.begin();
  expect(current.canvas.dataset.placementStatus).toBe("valid");
  current.controls.confirm.click();
  for (const outcome of current.simulation.tick())
    current.placement.onOutcome(outcome);
  expect(current.onPlaced).toHaveBeenCalledWith("store-3");
  expect(current.simulation.actorById("store-3")).toBeDefined();
  expect(current.simulation.snapshot().retiredActorIds).toEqual(["store-2"]);
});

test("tick-time rejection survives a later valid evaluation until placement changes", () => {
  current = fixture();
  current.begin();
  current.controls.confirm.click();
  current.simulation.spawnActor(
    createTilePlacedActor(
      current.map,
      definition,
      {
        actorId: "blocker",
        origin: { x: 1, z: 1 },
      },
      "player",
    ),
  );
  for (const outcome of current.simulation.tick())
    current.placement.onOutcome(outcome);
  expect(current.controls.status.textContent).toContain("Another structure");
  current.simulation.removeActor("blocker");
  current.placement.update();
  expect(current.canvas.dataset.placementStatus).toBe("valid");
  expect(current.controls.status.textContent).toContain("Another structure");
  current.controls.rotate.click();
  expect(current.controls.status.textContent).toContain("Store ready");
});

test("placement avoids IDs held by restored pending placement commands", () => {
  const original = fixture();
  original.simulation.submitCommand({
    kind: "place-actor",
    actorId: "store-1",
    definitionId: definition.id,
    origin: { x: 4, z: 4 },
  });
  const saved = original.simulation.snapshot();
  original.dispose();
  current = fixture([], [], saved);
  current.begin();
  current.controls.confirm.click();
  const outcomes = current.simulation.tick();
  expect(outcomes.map(({ accepted }) => accepted)).toEqual([true, true]);
  current.placement.onOutcome(outcomes[0]);
  expect(current.onPlaced).not.toHaveBeenCalled();
  current.placement.onOutcome(outcomes[1]);
  expect(current.onPlaced).toHaveBeenCalledWith("store-2");
  expect(current.simulation.actors).toHaveLength(2);
});

test("terrain changes repick a stationary pointer without redundant picking", () => {
  current = fixture();
  current.begin();
  expect(current.canvas.dataset.placementOrigin).toBe("1,1");
  current.pick.mockClear();
  current.placement.update();
  expect(current.pick).not.toHaveBeenCalled();
  current.pickTile(2, 1);
  current.map.editTerrain({ heights: [{ x: 1, z: 1, height: 0.1 }] });
  current.placement.update();
  expect(current.pick).toHaveBeenCalledTimes(1);
  expect(current.canvas.dataset.placementOrigin).toBe("2,1");
});

test("faults clear the preview and prevent further placement", () => {
  current = fixture();
  current.begin();
  expect(
    current.scene.getTransformNodeByName(
      "tile-placed-actor-building-preview-root",
    ),
  ).not.toBeNull();
  current.placement.fault();
  expect(
    current.scene.getTransformNodeByName(
      "tile-placed-actor-building-preview-root",
    ),
  ).toBeNull();
  expect(current.controls.build.disabled).toBe(true);
  expect(current.controls.confirm.disabled).toBe(true);
  current.controls.build.click();
  expect(current.placement.active).toBe(false);
});
