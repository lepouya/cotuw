import { describe, expect, test } from "vitest";
import { ECONOMY_ACTOR_DEFINITIONS } from "./helpers/content";
import { exploredScenarioState, playerOwners } from "./helpers/scenario";
import { createMissionSimulation } from "../src/simulation/mission";
import { isMissionCommand } from "../src/simulation/command";
import { OccupancyGrid } from "../src/simulation/occupancy";
import { defineScenario } from "../src/simulation/scenario";
import { parseMission, serializeMission } from "../src/simulation/mission-file";
import { TerrainGrid } from "../src/simulation/terrain";
import { createTerrainMoveBehavior } from "../src/simulation/terrain-movement";
import { distance } from "../src/simulation/world";

import type { MissionState } from "../src/simulation/mission";
import type { ScenarioUnit } from "../src/simulation/scenario";
import type { WorldPosition } from "../src/simulation/world";

const TICK_SECONDS = 0.1;
const mapOptions = {
  width: 40,
  height: 20,
  tileSize: 1,
  terrainTypeIds: ["plain", "path", "rough", "water"],
};
const at = (x: number, z: number) =>
  new TerrainGrid(mapOptions).tileCenter(x, z);
const unit = (
  actorId: string,
  definitionId: string,
  x: number,
  z: number,
): ScenarioUnit => ({ actorId, definitionId, tile: { x, z } });

function scenario(units: ScenarioUnit[]) {
  return defineScenario({
    id: "queue-test",
    tileSize: 1,
    ...playerOwners("arc"),
    terrainTypeIds: mapOptions.terrainTypeIds,
    terrain: new TerrainGrid(mapOptions).terrainState(),
    buildings: [
      {
        actorId: "cc",
        definitionId: "arc-command-center-prototype",
        origin: { x: 2, z: 2 },
      },
    ],
    units,
    materials: 0,
    sites: [],
    loot: [],
  });
}

function fixture(
  units: ScenarioUnit[],
  state?: MissionState,
  edit?: (state: MissionState) => void,
) {
  const map = new TerrainGrid(mapOptions);
  const occupancy = new OccupancyGrid(map);
  const initial =
    state ?? exploredScenarioState(scenario(units), ECONOMY_ACTOR_DEFINITIONS);
  edit?.(initial);
  return createMissionSimulation({
    state: initial,
    definitions: ECONOMY_ACTOR_DEFINITIONS,
    map,
    occupancy,
    tickSeconds: TICK_SECONDS,
    bounds: map.worldBounds,
    behaviorRegistry: new Map([
      [
        "terrain-move",
        createTerrainMoveBehavior(map, occupancy, [
          {
            id: "surface-ground",
            maxSlope: 0.75,
            slopeCostAtLimit: 2,
            terrainCosts: { plain: 1, path: 0.8, rough: 2.25, water: null },
          },
        ]),
      ],
      ["idle", { handleCommand: () => false, update: () => {} }],
    ]),
  });
}

const scouts = [unit("a", "arc-scout", 8, 10), unit("b", "arc-scout", 8, 12)];

describe("queued orders", () => {
  test("queued moves wait behind the current order and run in sequence", () => {
    const simulation = fixture(scouts);
    const route = [at(14, 10), at(14, 15), at(20, 15)];
    simulation.submitCommand({ kind: "move", actorId: "a", target: route[0]! });
    for (const target of route.slice(1))
      simulation.submitCommand({
        kind: "move",
        actorId: "a",
        target,
        queued: true,
      });
    const outcomes = simulation.tick();
    expect(outcomes.map(({ accepted }) => accepted)).toEqual([
      true,
      true,
      true,
    ]);
    expect(outcomes.map((outcome) => outcome.queued)).toEqual([
      undefined,
      true,
      true,
    ]);
    expect(simulation.actorById("a")!.orders).toEqual([
      { kind: "move", target: route[1] },
      { kind: "move", target: route[2] },
    ]);
    // Each order starts only once the actor has reached the previous target.
    const reached: WorldPosition[] = [];
    let remaining = 2;
    for (let tick = 0; tick < 400; tick++) {
      simulation.tick();
      const actor = simulation.actorById("a")!;
      const left = actor.orders?.length ?? 0;
      if (left < remaining) {
        reached.push(route[2 - remaining]!);
        // The next order starts that tick, so it has moved one step on.
        expect(
          distance(actor.worldPosition, route[2 - remaining]!),
        ).toBeLessThanOrEqual(7 * TICK_SECONDS + 1e-9);
        remaining = left;
      }
      if (!actor.movement && !actor.orders) break;
    }
    expect(reached).toEqual(route.slice(0, 2));
    expect(
      distance(simulation.actorById("a")!.worldPosition, route[2]!),
    ).toBeLessThan(0.1);
  });

  test("an idle actor starts a queued order at once", () => {
    const simulation = fixture(scouts);
    simulation.submitCommand({
      kind: "move",
      actorId: "a",
      target: at(14, 10),
      queued: true,
    });
    const [outcome] = simulation.tick();
    expect(outcome!.queued).toBeUndefined();
    expect(simulation.actorById("a")!.movement).toBeDefined();
    expect(simulation.actorById("a")!.orders).toBeUndefined();
  });

  test.each(["move", "stop"] as const)(
    "an unqueued %s replaces the current order and clears the queue",
    (kind) => {
      const simulation = fixture(scouts);
      simulation.submitCommand({
        kind: "move",
        actorId: "a",
        target: at(14, 10),
      });
      simulation.submitCommand({
        kind: "move",
        actorId: "a",
        target: at(14, 15),
        queued: true,
      });
      simulation.tick();
      simulation.submitCommand(
        kind === "stop"
          ? { kind, actorId: "a" }
          : { kind, actorId: "a", target: at(8, 15) },
      );
      simulation.tick();
      expect(simulation.actorById("a")!.orders).toBeUndefined();
    },
  );

  test("a rejected unqueued order keeps the current order and queue", () => {
    const simulation = fixture(scouts);
    simulation.submitCommand({
      kind: "move",
      actorId: "a",
      target: at(14, 10),
    });
    simulation.submitCommand({
      kind: "move",
      actorId: "a",
      target: at(14, 15),
      queued: true,
    });
    simulation.tick();
    simulation.submitCommand({ kind: "gather", actorId: "a", siteId: "none" });
    const [outcome] = simulation.tick();
    expect(outcome!.accepted).toBe(false);
    expect(simulation.actorById("a")!.movement).toBeDefined();
    expect(simulation.actorById("a")!.orders).toEqual([
      { kind: "move", target: at(14, 15) },
    ]);
  });

  test("a queued attack starts after the move ahead of it", () => {
    const simulation = fixture([
      unit("trooper", "arc-trooper", 8, 10),
      // The Scout detects the wolf from beyond the wolf's own sight.
      unit("scout", "arc-scout", 20, 10),
      unit("wolf", "wolf", 30, 10),
    ]);
    simulation.submitCommand({
      kind: "move",
      actorId: "trooper",
      target: at(12, 14),
    });
    simulation.submitCommand({
      kind: "attack",
      actorId: "trooper",
      targetId: "wolf",
      queued: true,
    });
    simulation.tick();
    expect(simulation.actorById("trooper")!.combat?.attack).toBeUndefined();
    for (let tick = 0; tick < 200; tick++) {
      simulation.tick();
      if (!simulation.actorById("trooper")!.orders) break;
    }
    const trooper = simulation.actorById("trooper")!;
    expect(distance(trooper.worldPosition, at(12, 14))).toBeLessThan(0.5);
    expect(trooper.combat?.attack?.targetId).toBe("wolf");
  });

  test("queues refuse orders the actor can never carry out", () => {
    const simulation = fixture(scouts);
    simulation.submitCommand({
      kind: "move",
      actorId: "a",
      target: at(14, 10),
    });
    simulation.submitCommand({
      kind: "attack",
      actorId: "a",
      targetId: "b",
      queued: true,
    });
    simulation.submitCommand({
      kind: "gather",
      actorId: "a",
      siteId: "site",
      queued: true,
    });
    const [, attack, gather] = simulation.tick();
    expect([attack!.accepted, gather!.accepted]).toEqual([false, false]);
    expect(attack!.reason).toBe("unarmed");
    expect(gather!.reason).toBe("invalid-harvester");
    expect(simulation.actorById("a")!.orders).toBeUndefined();
  });

  test("a queued group move gives each busy member its own slot", () => {
    const simulation = fixture(scouts);
    simulation.submitCommand({
      kind: "group-move",
      actorIds: ["a", "b"],
      target: at(14, 11),
    });
    simulation.submitCommand({
      kind: "group-move",
      actorIds: ["a", "b"],
      target: at(20, 11),
      queued: true,
    });
    simulation.tick();
    const [a, b] = ["a", "b"].map((id) => simulation.actorById(id)!.orders);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a![0]).not.toEqual(b![0]);
  });

  test("a rejected queued target gives way to the following order", () => {
    const simulation = fixture([unit("trooper", "arc-trooper", 8, 10)]);
    simulation.submitCommand({
      kind: "move",
      actorId: "trooper",
      target: at(12, 10),
    });
    simulation.submitCommand({
      kind: "attack",
      actorId: "trooper",
      targetId: "missing",
      queued: true,
    });
    simulation.submitCommand({
      kind: "move",
      actorId: "trooper",
      target: at(12, 14),
      queued: true,
    });
    for (let tick = 0; tick < 200; tick++) simulation.tick();
    expect(simulation.actorById("trooper")!.orders).toBeUndefined();
    expect(
      distance(simulation.actorById("trooper")!.worldPosition, at(12, 14)),
    ).toBeLessThan(0.1);
  });

  test("a blocked combat return gives way to a queued move", () => {
    const simulation = fixture(
      [unit("trooper", "arc-trooper", 8, 10)],
      undefined,
      (state) => {
        const actor = state.actors.find(({ id }) => id === "trooper")!;
        actor.combat = {
          returning: {
            point: at(12, 10),
            blocked: { at: at(12, 10), navigationVersion: 0 },
          },
        };
        actor.orders = [{ kind: "move", target: at(8, 14) }];
      },
    );
    simulation.tick();
    expect(simulation.actorById("trooper")!.orders).toBeUndefined();
    expect(simulation.actorById("trooper")!.combat?.returning).toBeUndefined();
    expect(simulation.actorById("trooper")!.movement?.target).toEqual(
      at(8, 14),
    );
  });

  test("Gather cannot queue in a mission without an economy", () => {
    const simulation = fixture(
      [unit("worker", "arc-harvester", 8, 10)],
      undefined,
      (state) => {
        delete state.economy;
      },
    );
    simulation.submitCommand({
      kind: "move",
      actorId: "worker",
      target: at(12, 10),
    });
    simulation.submitCommand({
      kind: "gather",
      actorId: "worker",
      siteId: "missing",
      queued: true,
    });
    const [, outcome] = simulation.tick();
    expect(outcome!.accepted).toBe(false);
    expect(simulation.actorById("worker")!.orders).toBeUndefined();
  });

  test("queues continue exactly after a save", () => {
    const simulation = fixture(scouts);
    simulation.submitCommand({
      kind: "move",
      actorId: "a",
      target: at(14, 10),
    });
    simulation.submitCommand({
      kind: "move",
      actorId: "a",
      target: at(14, 15),
      queued: true,
    });
    for (let tick = 0; tick < 5; tick++) simulation.tick();
    const saved = parseMission(
      serializeMission(scenario(scouts), simulation.snapshot(), TICK_SECONDS),
      TICK_SECONDS,
    ).state;
    const restored = fixture(scouts, saved);
    expect(restored.actorById("a")!.orders).toHaveLength(1);
    for (let tick = 0; tick < 150; tick++) {
      simulation.tick();
      restored.tick();
    }
    expect(restored.snapshot()).toEqual(simulation.snapshot());
  });

  test.each([
    ["empty", []],
    ["malformed", [{ kind: "move" }]],
    ["out of bounds", [{ kind: "move", target: { x: 999, z: 0 } }]],
    [
      "out of bounds group request",
      [{ kind: "move", target: at(10, 10), requestedTarget: { x: 999, z: 0 } }],
    ],
    ["unarmed attack", [{ kind: "attack", targetId: "b" }]],
    ["gather by a Scout", [{ kind: "gather", siteId: "site" }]],
  ])("rejects %s saved queues", (_, orders) => {
    expect(() =>
      fixture(scouts, undefined, (state) => {
        Object.assign(
          state.actors.find(({ id }) => id === "a")!,
          { orders },
        );
      }),
    ).toThrow(/queued orders/);
  });

  test("rejects queues on buildings and queued flags on other commands", () => {
    expect(() =>
      fixture(scouts, undefined, (state) => {
        state.actors.find(({ id }) => id === "cc")!.orders = [
          { kind: "move", target: at(5, 5) },
        ];
      }),
    ).toThrow(/queued orders/);
    expect(
      isMissionCommand({
        kind: "move",
        actorId: "a",
        target: at(1, 1),
        queued: true,
      }),
    ).toBe(true);
    expect(isMissionCommand({ kind: "stop", actorId: "a", queued: true })).toBe(
      false,
    );
  });
});
