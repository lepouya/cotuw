import { startSimulationLoop } from "../src/simulation/loop";
import { describe, expect, test, vi } from "vitest";
import { ECONOMY_ACTOR_DEFINITIONS } from "../src/content/economy-scenario";
import { createActor } from "../src/simulation/actor";
import { createTilePlacedActor } from "../src/simulation/placement";
import { distance } from "../src/simulation/world";
import { createMissionState } from "../src/simulation/mission";
import { createMissionSimulation } from "../src/simulation/mission";
import { OccupancyGrid } from "../src/simulation/occupancy";
import {
  defineScenario,
  deserializeMission,
  serializeMission,
} from "../src/simulation/scenario";
import { TerrainGrid } from "../src/simulation/terrain";
import { createTerrainMoveBehavior } from "../src/simulation/terrain-movement";
import { exploredScenarioState } from "./helpers/scenario";

import type { Actor, ActorDefinition } from "../src/simulation/actor";
import type { MissionState } from "../src/simulation/mission";
import type { ScenarioUnit } from "../src/simulation/scenario";

const TICK_SECONDS = 0.1;
const definitions = ECONOMY_ACTOR_DEFINITIONS;
const wolfTerritory = definitions.find(({ id }) => id === "wolf")!.territory!;
const mapOptions = {
  width: 40,
  height: 20,
  tileSize: 1,
  terrainTypeIds: ["plain", "path", "rough", "water"],
};

const contentMap = new TerrainGrid(mapOptions);
/** The world position of a tile center. */
const at = (x: number, z: number) => contentMap.tileCenter(x, z);
/** Content with one definition's fields replaced. */
const withChanges = (id: string, changes: Partial<ActorDefinition>) =>
  definitions.map((definition) =>
    definition.id === id ? { ...definition, ...changes } : definition,
  );

function scenario(units: ScenarioUnit[]) {
  return defineScenario({
    id: "combat-test",
    tileSize: 1,
    playerFaction: "arc",
    terrainTypeIds: mapOptions.terrainTypeIds,
    terrain: contentMap.terrainState(),
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
  edit?: (state: MissionState) => void,
  state?: MissionState,
  content: readonly ActorDefinition[] = definitions,
  idleUpdate = () => {},
  defeatOnDestruction: string[] = [],
) {
  const map = new TerrainGrid(mapOptions);
  const occupancy = new OccupancyGrid(map);
  const initial = state ?? exploredScenarioState(scenario(units), content);
  edit?.(initial);
  const simulation = createMissionSimulation({
    state: initial,
    defeatOnDestruction,
    definitions: content,
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
      ["idle", { handleCommand: () => false, update: idleUpdate }],
    ]),
  });
  return { simulation, map, occupancy };
}

const unit = (
  actorId: string,
  definitionId: string,
  x: number,
  z: number,
): ScenarioUnit => ({ actorId, definitionId, tile: { x, z } });

function runUntil(
  simulation: ReturnType<typeof fixture>["simulation"],
  done: () => boolean,
  seconds = 60,
) {
  for (let tick = 0; tick < seconds / TICK_SECONDS && !done(); tick++)
    simulation.tick();
}

describe("combat", () => {
  test("every unit and building has health; only Troopers and wolves are armed", () => {
    expect(definitions.filter((definition) => !definition.health)).toEqual([]);
    expect(
      definitions
        .filter((definition) => definition.weapon)
        .map((definition) => definition.id),
    ).toEqual(["arc-trooper", "wolf", "alpha-wolf"]);
  });

  test("one idle Trooper engages and defeats a lone wolf deterministically", () => {
    const units = [
      unit("trooper", "arc-trooper", 12, 10),
      unit("wolf", "wolf", 19, 10),
    ];
    const run = () => {
      const { simulation } = fixture(units);
      const hits: string[] = [];
      runUntil(simulation, () => {
        hits.push(...simulation.attacks.map((hit) => hit.attackerId));
        return !simulation.actorById("wolf");
      });
      return { simulation, hits };
    };
    const { simulation, hits } = run();
    expect(simulation.actorById("wolf")).toBeUndefined();
    expect(hits.filter((id) => id === "trooper")).toHaveLength(10);
    expect(hits).toContain("wolf");
    const trooper = simulation.actorById("trooper")!;
    // Units aim by facing; only buildings keep a separate aim.
    expect(trooper.combat?.aimFacing).toBeUndefined();
    expect(trooper.health).toBeGreaterThan(0);
    expect(trooper.health).toBeLessThan(100);
    expect(simulation.wrecks).toEqual([
      expect.objectContaining({ actorId: "wolf", definitionId: "wolf" }),
    ]);
    expect(simulation.snapshot().retiredActorIds).toContain("wolf");
    expect(run().simulation.snapshot()).toEqual(simulation.snapshot());

    // Corpses clear after their time.
    runUntil(simulation, () => simulation.wrecks.length === 0, 61);
    expect(simulation.wrecks).toEqual([]);
  });

  test("Scouts cannot attack, and targets must be detected hostiles", () => {
    const { simulation } = fixture([
      unit("scout", "arc-scout", 8, 10),
      unit("trooper", "arc-trooper", 9, 10),
      unit("wolf", "wolf", 35, 10),
    ]);
    const outcome = (actorId: string, targetId: string) => {
      simulation.submitCommand({ kind: "attack", actorId, targetId });
      const [result] = simulation.tick();
      return result!.reason ?? result!.accepted;
    };
    expect(outcome("scout", "wolf")).toBe("unarmed");
    expect(outcome("trooper", "scout")).toBe("invalid-target");
    expect(outcome("trooper", "wolf")).toBe("undetected");
    expect(outcome("trooper", "missing")).toBe("invalid-target");
  });

  test("an explicit attack pursues; a move order cancels it", () => {
    const { simulation } = fixture([
      unit("scout", "arc-scout", 30, 10),
      unit("trooper", "arc-trooper", 12, 10),
      unit("wolf", "wolf", 30, 14),
    ]);
    simulation.submitCommand({
      kind: "attack",
      actorId: "trooper",
      targetId: "wolf",
    });
    expect(simulation.tick()[0]!.accepted).toBe(true);
    simulation.tick();
    expect(simulation.actorById("trooper")!.movement).toBeDefined();
    simulation.submitCommand({
      kind: "move",
      actorId: "trooper",
      target: at(5, 10),
    });
    simulation.tick();
    expect(simulation.actorById("trooper")!.combat?.attack).toBeUndefined();
  });

  test("a wolf leashes home when its quarry escapes, then regenerates", () => {
    const { simulation } = fixture(
      [unit("scout", "arc-scout", 24, 10), unit("wolf", "wolf", 29, 10)],
      (state) => {
        const wolf = state.actors.find(({ id }) => id === "wolf")!;
        wolf.health = 60;
      },
    );
    simulation.tick();
    expect(simulation.actorById("wolf")!.combat?.attack?.targetId).toBe(
      "scout",
    );
    simulation.submitCommand({
      kind: "move",
      actorId: "scout",
      target: at(5, 17),
    });
    runUntil(
      simulation,
      () => !!simulation.actorById("wolf")!.combat?.returning,
    );
    const wolf = simulation.actorById("wolf")!;
    expect(wolf.combat?.attack).toBeUndefined();
    runUntil(
      simulation,
      () => simulation.actorById("wolf")!.health === undefined,
    );
    const healed = simulation.actorById("wolf")!;
    expect(healed.health).toBeUndefined();
    expect(healed.territory).toEqual(
      expect.objectContaining({ home: at(29, 10) }),
    );
    expect(
      Math.hypot(
        healed.worldPosition.x - at(29, 10).x,
        healed.worldPosition.z - at(29, 10).z,
      ),
    ).toBeLessThanOrEqual(1);
  });

  test("destroyed buildings leave debris that blocks placement until it clears", () => {
    const { simulation } = fixture([], (state) => {
      state.economy!.materials = 1000;
      state.actors.push(
        Object.assign(
          createActor({
            id: "wolf",
            definitionId: "wolf",
            worldPosition: at(7, 3),
          }),
          {
            territory: { home: at(7, 3) },
          },
        ) as Actor,
      );
      const cc = state.actors.find(({ id }) => id === "cc")!;
      cc.health = 8;
    });
    runUntil(simulation, () => !simulation.actorById("cc"));
    expect(simulation.wrecks).toEqual([
      expect.objectContaining({
        actorId: "cc",
        tilePlacement: expect.anything(),
      }),
    ]);
    const placement = {
      actorId: "rebuilt",
      definitionId: "arc-command-center-prototype",
      origin: { x: 2, z: 2 },
    };
    expect(simulation.evaluatePlacement(placement)).toMatchObject({
      accepted: false,
      reason: "debris",
    });
    const destroyedTick = simulation.wrecks[0]!.tick;
    runUntil(simulation, () => simulation.wrecks.length === 0, 61);
    // Clears exactly on time, so previews agree with the next tick.
    expect(simulation.completedTicks - destroyedTick).toBe(60 / TICK_SECONDS);
    const cleared = simulation.evaluatePlacement(placement);
    expect(cleared.accepted || cleared.reason).not.toBe("debris");
  });

  test("selling scales the half-cost refund by remaining health", () => {
    const { simulation } = fixture([], (state) => {
      state.economy!.materials = 0;
      // 150 × 1640 / 2000 is exactly 123, which dividing first misses.
      state.actors.find(({ id }) => id === "cc")!.health = 1640;
    });
    simulation.submitCommand({ kind: "sell-actor", actorId: "cc" });
    simulation.tick();
    expect(simulation.economy!.materials).toBe(123);
  });

  test("an old hit does not reveal an attacker outside personal sight", () => {
    const { simulation } = fixture(
      [unit("trooper", "arc-trooper", 20, 10), unit("wolf", "wolf", 29, 10)],
      (state) => {
        state.tick = 100;
        const wolf = state.actors.find(({ id }) => id === "wolf")!;
        // It fought recently, but the Trooper's hit is long past.
        wolf.combat = {
          activeTick: 99,
          lastHit: { attackerId: "trooper", tick: 10 },
        };
      },
    );
    simulation.tick();
    expect(simulation.actorById("wolf")!.combat?.attack).toBeUndefined();
  });

  test("blocked routes leave actors free to engage", () => {
    const blockedRoute = (target: { x: number; z: number }) => ({
      target,
      destination: target,
      reachedTarget: false,
      blocked: true,
      waypoints: [],
      waypointIndex: 0,
      occupancyLayer: "surface" as const,
    });
    const { simulation } = fixture(
      [
        unit("trooper", "arc-trooper", 12, 10),
        unit("scout", "arc-scout", 23, 10),
        unit("wolf", "wolf", 18, 10),
      ],
      (state) => {
        const trooper = state.actors.find(({ id }) => id === "trooper")!;
        trooper.movement = blockedRoute(at(5, 10));
        const wolf = state.actors.find(({ id }) => id === "wolf")!;
        wolf.territory = { home: at(29, 10) };
        wolf.combat = { returning: { point: at(29, 10) } };
        wolf.movement = blockedRoute(at(29, 10));
      },
    );
    simulation.tick();
    expect(simulation.actorById("wolf")!.combat?.returning).toBeUndefined();
    expect(simulation.actorById("wolf")!.combat?.attack?.targetId).toBe(
      "scout",
    );
    expect(simulation.actorById("trooper")!.combat?.attack?.targetId).toBe(
      "wolf",
    );
  });

  test("armed actors without a guard rule still answer an attacker in range", () => {
    const { simulation } = fixture(
      [unit("trooper", "arc-trooper", 12, 10), unit("wolf", "wolf", 13, 10)],
      undefined,
      undefined,
      withChanges("arc-trooper", { guard: undefined }),
    );
    const attackers = new Set<string>();
    runUntil(
      simulation,
      () => {
        for (const hit of simulation.attacks) attackers.add(hit.attackerId);
        return attackers.has("trooper");
      },
      3,
    );
    expect(attackers).toEqual(new Set(["wolf", "trooper"]));
    expect(simulation.actorById("trooper")!.combat?.attack).toBeUndefined();
  });

  test("seeing any footprint tile detects a building", () => {
    // The Command Center covers tiles 2-3 on each axis; its center point lies
    // on the corner of tile (4, 4), which this short sight cannot reach.
    const { simulation } = fixture(
      [unit("wolf", "wolf", 1, 1)],
      undefined,
      undefined,
      withChanges("wolf", { vision: { radius: 2.5 } }),
    );
    const cc = simulation.actorById("cc")!;
    expect(simulation.sees("wildlife", cc.worldPosition)).toBe(false);
    expect(simulation.detects("wildlife", cc)).toBe(true);
  });

  test("without a player faction, as in the sandbox, every faction sees everything", () => {
    const map = new TerrainGrid(mapOptions);
    const { simulation } = fixture([], undefined, {
      ...createMissionState([
        createActor({
          id: "trooper",
          definitionId: "arc-trooper",
          worldPosition: at(2, 2),
        }),
        Object.assign(
          createActor({
            id: "wolf",
            definitionId: "wolf",
            worldPosition: at(35, 15),
          }),
          { territory: { home: at(35, 15) } },
        ),
      ]),
      terrain: map.terrainState(),
    });
    expect(simulation.detects("arc", simulation.actorById("wolf")!)).toBe(true);
    expect(
      simulation.detects("wildlife", simulation.actorById("trooper")!),
    ).toBe(true);
  });

  test("a saved fight continues exactly as an uninterrupted one", () => {
    const units = [
      unit("trooper", "arc-trooper", 12, 10),
      unit("wolf", "wolf", 19, 10),
    ];
    const { simulation } = fixture(units);
    for (let tick = 0; tick < 30; tick++) simulation.tick();
    const saved = deserializeMission(
      serializeMission(simulation.snapshot(), TICK_SECONDS),
      scenario(units),
      TICK_SECONDS,
    );
    const { simulation: restored } = fixture(units, undefined, saved);
    expect(restored.actorById("wolf")!.combat?.attack?.targetId).toBe(
      "trooper",
    );
    for (let tick = 0; tick < 100; tick++) {
      simulation.tick();
      restored.tick();
    }
    expect(restored.snapshot()).toEqual(simulation.snapshot());
  });
});

describe("combat edge cases", () => {
  test("guards stop an engagement at the target's current chase boundary", () => {
    const content = withChanges("arc-trooper", {
      guard: { acquisitionRadius: 7, chaseRadius: 3 },
    }).map((definition) =>
      definition.id === "wolf"
        ? { ...definition, weapon: undefined, territory: undefined }
        : definition,
    );
    const { simulation } = fixture(
      [unit("trooper", "arc-trooper", 12, 10), unit("wolf", "wolf", 16, 10)],
      (state) => {
        state.actors.find(({ id }) => id === "trooper")!.combat = {
          attack: { targetId: "wolf", lastKnown: at(14, 10), post: at(12, 10) },
        };
      },
      undefined,
      content,
    );
    simulation.tick();
    expect(simulation.actorById("trooper")!.combat?.attack).toBeUndefined();
    expect(simulation.attacks).toEqual([]);
  });

  test.each([false, true])(
    "hidden destruction preserves the last-known search, Attack Move=%s",
    (aggressive) => {
      const content = withChanges("arc-trooper", {
        guard: undefined,
        vision: undefined,
      }).map((definition) =>
        definition.id === "wolf"
          ? { ...definition, territory: undefined }
          : definition,
      );
      const units = [
        unit("trooper", "arc-trooper", 12, 10),
        unit("scout", "arc-scout", 30, 10),
        unit("wolf", "wolf", 30, 14),
      ];
      const { simulation } = fixture(units, undefined, undefined, content);
      simulation.submitCommand({
        kind: "attack",
        actorId: "trooper",
        targetId: "wolf",
      });
      simulation.tick();
      const lastKnown =
        simulation.actorById("trooper")!.combat!.attack!.lastKnown;
      simulation.removeActor("scout");
      const state = simulation.snapshot();
      state.actors = state.actors.filter(({ id }) => id !== "wolf");
      state.retiredActorIds.push("wolf");
      state.wrecks.push({
        actorId: "wolf",
        definitionId: "wolf",
        worldPosition: at(35, 14),
        facing: 0,
        tick: state.tick - 1,
      });
      if (aggressive)
        state.actors.find(({ id }) => id === "trooper")!.attackMove = {
          target: at(32, 4),
        };
      const restored = fixture(units, undefined, state, content).simulation;
      restored.tick();
      expect(restored.actorById("trooper")!.combat?.attack?.targetId).toBe(
        "wolf",
      );
      runUntil(restored, () => !restored.actorById("trooper")!.combat?.attack);
      expect(
        distance(restored.actorById("trooper")!.worldPosition, lastKnown),
      ).toBeLessThanOrEqual(1.5);
      if (aggressive) {
        runUntil(restored, () => !restored.actorById("trooper")!.attackMove);
        expect(restored.actorById("trooper")!.worldPosition).toEqual(at(32, 4));
      }
    },
  );

  test("blocked guard returns survive saves and retry after navigation changes", () => {
    const units = [unit("trooper", "arc-trooper", 12, 10)];
    const { simulation } = fixture(units, (state) => {
      for (let z = 0; z < 20; z++)
        state.terrain!.tiles[z * 40 + 10].typeId = "water";
      state.actors.find(({ id }) => id === "trooper")!.combat = {
        attack: {
          targetId: "dead-wolf",
          lastKnown: at(12, 10),
          post: at(5, 10),
        },
      };
    });
    runUntil(
      simulation,
      () => !!simulation.actorById("trooper")!.combat?.returning?.blocked,
    );
    expect(simulation.actorById("trooper")!.combat?.returning).toMatchObject({
      point: at(5, 10),
      blocked: { at: at(5, 10) },
    });
    const saved = deserializeMission(
      serializeMission(simulation.snapshot(), TICK_SECONDS),
      scenario(units),
      TICK_SECONDS,
    );
    const { simulation: restored } = fixture(units, undefined, saved);
    for (const run of [simulation, restored]) {
      run.submitCommand({
        kind: "terrain",
        tiles: [{ x: 10, z: 10, terrain: { typeId: "plain" } }],
      });
      runUntil(run, () => !run.actorById("trooper")!.combat?.returning);
      expect(
        distance(run.actorById("trooper")!.worldPosition, at(5, 10)),
      ).toBeLessThanOrEqual(1);
    }
    expect(restored.snapshot()).toEqual(simulation.snapshot());
  });

  test.each(["stop", "move", "attack"] as const)(
    "%s replaces a guard's pending return",
    (kind) => {
      const { simulation } = fixture(
        [unit("trooper", "arc-trooper", 12, 10), unit("wolf", "wolf", 18, 10)],
        (state) => {
          state.actors.find(({ id }) => id === "trooper")!.combat = {
            returning: { point: at(5, 10) },
          };
        },
      );
      simulation.submitCommand(
        kind === "attack"
          ? { kind, actorId: "trooper", targetId: "wolf" }
          : kind === "move"
            ? { kind, actorId: "trooper", target: at(5, 10) }
            : { kind, actorId: "trooper" },
      );
      simulation.tick();
      expect(
        simulation.actorById("trooper")!.combat?.returning,
      ).toBeUndefined();
    },
  );

  test("wolf pursuit cannot use detours beyond the leash, including after terrain edits", () => {
    const content = withChanges("wolf", {
      territory: { ...wolfTerritory, leashRadius: 6 },
    });
    const { simulation } = fixture(
      [unit("scout", "arc-scout", 24, 10), unit("wolf", "wolf", 29, 10)],
      undefined,
      undefined,
      content,
    );
    simulation.tick();
    expect(simulation.actorById("wolf")!.movement).toBeDefined();
    simulation.submitCommand({
      kind: "terrain",
      tiles: Array.from({ length: 18 }, (_, index) => ({
        x: 27,
        z: index + 1,
        terrain: { typeId: "water" },
      })),
    });
    for (let tick = 0; tick < 80; tick++) {
      simulation.tick();
      const wolf = simulation.actorById("wolf")!;
      expect(
        distance(wolf.worldPosition, wolf.territory!.home),
      ).toBeLessThanOrEqual(6);
    }
    expect(simulation.actorById("wolf")!.combat?.attack).toBeUndefined();
    expect(simulation.actorById("wolf")!.territory?.failedTargets).toEqual([
      expect.objectContaining({ targetId: "scout" }),
    ]);
    simulation.submitCommand({
      kind: "terrain",
      tiles: [{ x: 27, z: 10, terrain: { typeId: "plain" } }],
    });
    simulation.tick();
    expect(
      simulation.actorById("wolf")!.combat?.attack?.blocked,
    ).toBeUndefined();
    expect(simulation.actorById("wolf")!.movement).toBeDefined();
  });

  test.each([true, false])(
    "armed buildings fire without changing their placement (blocking=%s)",
    (blocksMovement) => {
      const original = definitions.find(
        ({ id }) => id === "arc-command-center-prototype",
      )!;
      const content = withChanges(original.id, {
        weapon: {
          damage: 10,
          damageType: "kinetic",
          range: 6,
          cooldownSeconds: 1,
        },
        footprint: { ...original.footprint!, blocksMovement },
      });
      const { simulation } = fixture(
        [unit("wolf", "wolf", 6, 3)],
        undefined,
        undefined,
        content,
      );
      const facing = simulation.actorById("cc")!.facing;
      simulation.submitCommand({
        kind: "attack",
        actorId: "cc",
        targetId: "wolf",
      });
      expect(simulation.tick()[0]!.accepted).toBe(true);
      expect(simulation.attacks).toContainEqual(
        expect.objectContaining({ attackerId: "cc" }),
      );
      expect(simulation.actorById("cc")!.facing).toBe(facing);
      expect(simulation.actorById("cc")!.combat?.aimFacing).not.toBe(facing);
      expect(simulation.actorById("cc")!.movement).toBeUndefined();
    },
  );

  test("simultaneous lethal hits both land before destruction", () => {
    const content = withChanges("wolf", { territory: undefined });
    const { simulation } = fixture(
      [unit("trooper", "arc-trooper", 12, 10), unit("wolf", "wolf", 13, 10)],
      (state) => {
        const trooper = state.actors.find(({ id }) => id === "trooper")!;
        const wolf = state.actors.find(({ id }) => id === "wolf")!;
        trooper.health = 8;
        wolf.health = 10;
        wolf.worldPosition.x = trooper.worldPosition.x + 0.8;
      },
      undefined,
      content,
    );
    for (const [actorId, targetId] of [
      ["trooper", "wolf"],
      ["wolf", "trooper"],
    ])
      simulation.submitCommand({ kind: "attack", actorId, targetId });
    simulation.tick();
    expect(simulation.attacks.map(({ attackerId }) => attackerId)).toEqual([
      "trooper",
      "wolf",
    ]);
    expect(simulation.actorById("trooper")).toBeUndefined();
    expect(simulation.actorById("wolf")).toBeUndefined();
    expect(simulation.wrecks.map(({ actorId }) => actorId)).toEqual([
      "trooper",
      "wolf",
    ]);
  });

  test.each(["footprint", "terrain", "unit"] as const)(
    "%s handles line of fire correctly",
    (obstacle) => {
      const content = withChanges("wolf", { territory: undefined });
      const { simulation } = fixture(
        [
          unit("trooper", "arc-trooper", 12, 10),
          unit("wolf", "wolf", 18, 10),
          unit("scout", "arc-scout", 20, 10),
        ],
        (state) => {
          if (obstacle === "footprint")
            state.actors.push(
              createTilePlacedActor(
                contentMap,
                definitions.find(
                  ({ id }) => id === "arc-command-center-prototype",
                )!,
                {
                  actorId: "blocker",
                  origin: { x: 15, z: 9 },
                },
              ),
            );
          if (obstacle === "terrain")
            for (let z = 0; z <= 20; z++)
              state.terrain!.heights[z * 41 + 15] = 3;
          if (obstacle === "unit")
            state.actors.push(
              createActor({
                id: "middle",
                definitionId: "arc-scout",
                worldPosition: at(15, 10),
              }),
            );
        },
        undefined,
        content,
      );
      simulation.submitCommand({
        kind: "attack",
        actorId: "trooper",
        targetId: "wolf",
      });
      expect(simulation.tick()[0]!.accepted).toBe(true);
      expect(
        simulation.attacks.some(({ attackerId }) => attackerId === "trooper"),
      ).toBe(obstacle === "unit");
    },
  );

  test("a hidden explicit target is searched for only at its last-known position", () => {
    const content = withChanges("arc-trooper", {
      guard: undefined,
      vision: undefined,
    }).map((definition) =>
      definition.id === "wolf"
        ? { ...definition, territory: undefined }
        : definition,
    );
    const { simulation } = fixture(
      [
        unit("trooper", "arc-trooper", 12, 10),
        unit("scout", "arc-scout", 30, 10),
        unit("wolf", "wolf", 30, 14),
      ],
      undefined,
      undefined,
      content,
    );
    simulation.submitCommand({
      kind: "attack",
      actorId: "trooper",
      targetId: "wolf",
    });
    simulation.tick();
    const lastKnown =
      simulation.actorById("trooper")!.combat!.attack!.lastKnown;
    simulation.removeActor("scout");
    simulation.submitCommand({
      kind: "move",
      actorId: "wolf",
      target: at(35, 14),
    });
    runUntil(
      simulation,
      () => !simulation.actorById("trooper")!.combat?.attack,
    );
    expect(
      distance(simulation.actorById("trooper")!.worldPosition, lastKnown),
    ).toBeLessThanOrEqual(1);
    expect(simulation.attacks).toEqual([]);
    expect(simulation.actorById("trooper")!.movement).toBeUndefined();
  });

  test("producer destruction discards paid work and preserves surviving cargo", () => {
    const { simulation } = fixture(
      [
        unit("wolf-a", "wolf", 11, 6),
        unit("wolf-b", "wolf", 5, 4),
        unit("worker", "arc-harvester", 12, 8),
      ],
      (state) => {
        for (const [id, definitionId, x] of [
          ["refinery", "arc-materials-refinery", 8],
          ["barracks", "arc-field-barracks", 5],
        ] as const) {
          const building = createTilePlacedActor(
            contentMap,
            definitions.find((definition) => definition.id === definitionId)!,
            { actorId: id, origin: { x, z: 5 } },
          );
          building.health = 8;
          state.actors.push(building);
        }
        state.economy!.harvesters = [
          {
            actorId: "worker",
            refineryId: "refinery",
            cargo: 37,
            gatherProgress: 0,
            phase: "returning",
          },
        ];
        state.economy!.production = [
          {
            actorId: "paid-scout",
            producerId: "barracks",
            definitionId: "arc-scout",
            paidMaterials: 20,
            completedTicks: 0,
            totalTicks: 30,
            exitBlocked: false,
          },
        ];
      },
    );
    simulation.submitCommand({
      kind: "attack",
      actorId: "wolf-a",
      targetId: "refinery",
    });
    simulation.submitCommand({
      kind: "attack",
      actorId: "wolf-b",
      targetId: "barracks",
    });
    simulation.tick();
    expect(simulation.actorById("refinery")).toBeUndefined();
    expect(simulation.actorById("barracks")).toBeUndefined();
    expect(simulation.economy!.production).toEqual([]);
    expect(simulation.economy!.materials).toBe(0);
    expect(simulation.snapshot().retiredActorIds).toContain("paid-scout");
    expect(simulation.economy!.harvesters[0]).toMatchObject({
      cargo: 37,
      phase: "unassigned",
    });
    expect(simulation.economy!.harvesters[0].refineryId).toBeUndefined();
    expect(simulation.actorById("worker")!.movement).toBeUndefined();
  });

  test("a behavior fault rolls back combat damage, deaths, and wrecks", () => {
    const { simulation } = fixture(
      [unit("trooper", "arc-trooper", 12, 10), unit("wolf", "wolf", 18, 10)],
      (state) => {
        state.actors.find(({ id }) => id === "wolf")!.health = 10;
      },
      undefined,
      definitions,
      () => {
        throw new Error("behavior fault");
      },
    );
    const before = simulation.snapshot();
    expect(() => simulation.tick()).toThrow("behavior fault");
    expect(simulation.snapshot()).toEqual(before);
    expect(simulation.wrecks).toEqual([]);
    expect(simulation.attacks).toEqual([]);
  });
});

describe("combat state validation and faction vision", () => {
  test.each(["position", "waypoint"] as const)(
    "rejects a saved route with its %s outside its bounds",
    (field) => {
      expect(() =>
        fixture([unit("wolf", "wolf", 29, 10)], (state) => {
          const wolf = state.actors.find(({ id }) => id === "wolf")!;
          if (field === "position") wolf.worldPosition = at(33, 10);
          wolf.movement = {
            target: at(30, 10),
            bounds: { center: at(29, 10), radius: 2 },
            waypoints: [field === "waypoint" ? at(35, 10) : at(30, 10)],
            waypointIndex: 0,
            destination: at(30, 10),
            reachedTarget: true,
            navigationVersion: 0,
            occupancyLayer: "surface",
          };
        }),
      ).toThrow("invalid route bounds");
    },
  );

  test("rejects null territory state before ticking", () => {
    expect(() =>
      fixture([unit("wolf", "wolf", 29, 10)], (state) => {
        Object.assign(
          state.actors.find(({ id }) => id === "wolf")!,
          {
            territory: null,
          },
        );
      }),
    ).toThrow("invalid territory state");
  });

  test.each([
    {
      name: "last-known position",
      edit: (actor: Actor) => {
        actor.combat = {
          attack: { targetId: "wolf", lastKnown: { x: 1000, z: 1000 } },
        };
      },
    },
    {
      name: "guard post",
      edit: (actor: Actor) => {
        actor.combat = {
          attack: {
            targetId: "wolf",
            lastKnown: at(12, 10),
            post: { x: 1000, z: 1000 },
          },
        };
      },
    },
    {
      name: "blocked chase",
      edit: (actor: Actor) => {
        actor.combat = {
          attack: {
            targetId: "wolf",
            lastKnown: at(12, 10),
            blocked: { at: { x: 1000, z: 1000 }, navigationVersion: 0 },
          },
        };
      },
    },
    {
      name: "return post",
      edit: (actor: Actor) => {
        actor.combat = { returning: { point: { x: 1000, z: 1000 } } };
      },
    },
    {
      name: "blocked return",
      edit: (actor: Actor) => {
        actor.combat = {
          returning: {
            point: at(5, 10),
            blocked: { at: { x: 1000, z: 1000 }, navigationVersion: 0 },
          },
        };
      },
    },
  ])("rejects an out-of-bounds $name before ticking", ({ edit }) => {
    expect(() =>
      fixture([unit("trooper", "arc-trooper", 12, 10)], (state) =>
        edit(state.actors.find(({ id }) => id === "trooper")!),
      ),
    ).toThrow("invalid combat state");
  });

  test("rejects an out-of-bounds territory home", () => {
    expect(() =>
      fixture([unit("wolf", "wolf", 29, 10)], (state) => {
        state.actors.find(({ id }) => id === "wolf")!.territory!.home = {
          x: 1000,
          z: 1000,
        };
      }),
    ).toThrow("invalid territory state");
  });

  test("rejects out-of-bounds remains", () => {
    expect(() =>
      fixture([], (state) => {
        state.retiredActorIds.push("old-wolf");
        state.wrecks.push({
          actorId: "old-wolf",
          definitionId: "wolf",
          worldPosition: { x: 1000, z: 1000 },
          facing: 0,
          tick: 0,
        });
      }),
    ).toThrow("invalid wrecks");
  });

  test.each([undefined, "wildlife", ""])(
    "rejects scenario saves with player faction %s",
    (playerFaction) => {
      const content = scenario([]);
      const state = exploredScenarioState(content, definitions);
      state.playerFaction = playerFaction;
      expect(() =>
        deserializeMission(
          serializeMission(state, TICK_SECONDS),
          content,
          TICK_SECONDS,
        ),
      ).toThrow("player faction");
    },
  );

  test("no-fog missions give all factions full visibility", () => {
    const state = exploredScenarioState(
      scenario([
        unit("trooper", "arc-trooper", 2, 10),
        unit("wolf", "wolf", 35, 15),
      ]),
      definitions,
    );
    delete state.fog;
    delete state.scenarioId;
    const { simulation } = fixture([], undefined, state);
    expect(simulation.detects("arc", simulation.actorById("wolf")!)).toBe(true);
    expect(
      simulation.detects("wildlife", simulation.actorById("trooper")!),
    ).toBe(true);
  });

  test("one vision per faction releases every terrain subscription", () => {
    const original = TerrainGrid.prototype.onChanged;
    let active = 0;
    const spy = vi
      .spyOn(TerrainGrid.prototype, "onChanged")
      .mockImplementation(function (this: TerrainGrid, listener) {
        const release = original.call(this, listener);
        active++;
        return () => {
          active--;
          release();
        };
      });
    try {
      const { simulation } = fixture([], (state) => {
        state.playerFaction = "wildlife";
      });
      expect(spy).toHaveBeenCalledTimes(2);
      simulation.dispose();
      expect(active).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
});

test("contact correction cannot push a fighting wolf beyond its leash", () => {
  const { simulation } = fixture(
    [unit("scout", "arc-scout", 35, 10), unit("wolf", "wolf", 35, 10)],
    (state) => {
      const wolf = state.actors.find(({ id }) => id === "wolf")!;
      wolf.territory!.home = at(29, 10);
      state.actors.find(({ id }) => id === "scout")!.worldPosition.x -= 0.1;
    },
    undefined,
    withChanges("wolf", {
      territory: { ...wolfTerritory, leashRadius: 6 },
    }),
  );
  for (let tick = 0; tick < 4; tick++) {
    simulation.tick();
    const wolf = simulation.actorById("wolf")!;
    expect(
      distance(wolf.worldPosition, wolf.territory!.home),
    ).toBeLessThanOrEqual(6);
  }
  expect(simulation.actorById("scout")!.health).toBeLessThan(40);
});

test("an automatic engagement ends when its target hides and returns to its post", () => {
  const content = withChanges("arc-trooper", { vision: undefined }).map(
    (definition) =>
      definition.id === "wolf"
        ? { ...definition, territory: undefined }
        : definition,
  );
  const { simulation } = fixture(
    [
      unit("trooper", "arc-trooper", 12, 10),
      unit("scout", "arc-scout", 20, 10),
      unit("wolf", "wolf", 18, 10),
    ],
    (state) => {
      state.actors.find(({ id }) => id === "trooper")!.combat = {
        attack: { targetId: "wolf", lastKnown: at(18, 10), post: at(10, 10) },
      };
    },
    undefined,
    content,
  );
  simulation.tick();
  expect(simulation.actorById("wolf")!.health).toBe(90);
  simulation.removeActor("scout");
  simulation.tick();
  const trooper = simulation.actorById("trooper")!;
  expect(trooper.combat?.attack).toBeUndefined();
  expect(trooper.combat?.returning?.point).toEqual(at(10, 10));
  expect(trooper.movement?.target).toEqual(at(10, 10));
  runUntil(
    simulation,
    () => !simulation.actorById("trooper")!.combat?.returning,
  );
  expect(
    distance(simulation.actorById("trooper")!.worldPosition, at(10, 10)),
  ).toBeLessThanOrEqual(1);
  expect(simulation.actorById("wolf")!.health).toBe(90);
});

describe("combat retries and immobile attackers", () => {
  /** A water wall across the whole map at column `x`. */
  const wall = (state: MissionState, x: number) => {
    for (let z = 0; z < mapOptions.height; z++)
      state.terrain!.tiles[z * mapOptions.width + x]!.typeId = "water";
  };

  test("a wolf stranded beyond its leash cannot attack outside its territory", () => {
    const { simulation } = fixture(
      [unit("trooper", "arc-trooper", 11, 10), unit("wolf", "wolf", 11, 10)],
      (state) => {
        // Right beside the wolf, so no route home gets any closer.
        wall(state, 13);
        const trooper = state.actors.find(({ id }) => id === "trooper")!;
        const wolf = state.actors.find(({ id }) => id === "wolf")!;
        wolf.worldPosition.x = trooper.worldPosition.x + 0.8;
        wolf.territory!.home = at(29, 10);
      },
    );
    const attackers = new Set<string>();
    runUntil(
      simulation,
      () => {
        for (const hit of simulation.attacks) attackers.add(hit.attackerId);
        return attackers.has("wolf");
      },
      3,
    );
    expect(attackers.has("wolf")).toBe(false);
    expect(simulation.actorById("wolf")!.combat?.returning?.blocked).toEqual(
      expect.objectContaining({ at: at(29, 10) }),
    );
  });

  test("a guard on a blocked return ignores targets beyond its chase radius", () => {
    const { simulation } = fixture(
      [unit("trooper", "arc-trooper", 12, 10), unit("wolf", "wolf", 17, 10)],
      (state) => {
        wall(state, 10);
        state.actors.find(({ id }) => id === "trooper")!.combat = {
          returning: { point: at(5, 10) },
        };
      },
      undefined,
      withChanges("wolf", { territory: undefined }),
    );
    // It first walks to the wall, the closest reachable point.
    runUntil(
      simulation,
      () => !!simulation.actorById("trooper")!.combat?.returning?.blocked,
      5,
    );
    const blocked = simulation.actorById("trooper")!.combat?.returning?.blocked;
    expect(blocked).toBeDefined();
    for (let tick = 0; tick < 20; tick++) {
      simulation.tick();
      const trooper = simulation.actorById("trooper")!;
      expect(trooper.combat?.attack).toBeUndefined();
      // The retry state survives, so the route is not replanned every tick.
      expect(trooper.combat?.returning?.blocked).toEqual(blocked);
    }
  });

  test("armed buildings give up orders they cannot fire on", () => {
    const original = definitions.find(
      ({ id }) => id === "arc-command-center-prototype",
    )!;
    const { simulation } = fixture(
      [unit("wolf", "wolf", 14, 4)],
      undefined,
      undefined,
      withChanges(original.id, {
        weapon: {
          damage: 10,
          damageType: "kinetic",
          range: 6,
          cooldownSeconds: 1,
        },
      }),
    );
    simulation.submitCommand({
      kind: "attack",
      actorId: "cc",
      targetId: "wolf",
    });
    expect(simulation.tick()[0]!.accepted).toBe(true);
    expect(simulation.actorById("cc")!.combat?.attack).toBeUndefined();
    expect(simulation.attacks).toEqual([]);
  });
});

describe("Attack Move", () => {
  test("engages along the route, resumes, and continues identically after saving", () => {
    const units = [
      unit("trooper", "arc-trooper", 12, 10),
      unit("wolf", "wolf", 23, 10),
    ];
    const { simulation } = fixture(units);
    simulation.submitCommand({
      kind: "attack-move",
      actorId: "trooper",
      target: at(32, 10),
    });
    runUntil(
      simulation,
      () => !!simulation.actorById("trooper")!.combat?.attack,
    );
    const trooper = simulation.actorById("trooper")!;
    expect(trooper.attackMove?.target).toEqual(at(32, 10));
    expect(trooper.combat?.attack?.post).toBeUndefined();
    const saved = deserializeMission(
      serializeMission(simulation.snapshot(), TICK_SECONDS),
      scenario(units),
      TICK_SECONDS,
    );
    const { simulation: restored } = fixture(units, undefined, saved);
    for (let i = 0; i < 300; i++) {
      simulation.tick();
      restored.tick();
      expect(restored.snapshot()).toEqual(simulation.snapshot());
    }
    expect(simulation.actorById("wolf")).toBeUndefined();
    expect(simulation.actorById("trooper")!.worldPosition).toEqual(at(32, 10));
    expect(simulation.actorById("trooper")!.attackMove).toBeUndefined();
  });

  test("groups assign distinct destinations to armed and unarmed units", () => {
    const { simulation } = fixture([
      unit("trooper", "arc-trooper", 12, 10),
      unit("scout", "arc-scout", 12, 12),
    ]);
    simulation.submitCommand({
      kind: "group-attack-move",
      actorIds: ["trooper", "scout", "trooper"],
      target: at(28, 10),
    });
    const outcomes = simulation.tick();
    expect(
      outcomes.map(({ command, accepted }) => [command.kind, accepted]),
    ).toEqual([
      ["attack-move", true],
      ["attack-move", true],
    ]);
    const targets = simulation.actors
      .filter((actor) => actor.attackMove)
      .map((actor) => actor.attackMove!.target);
    expect(targets).toHaveLength(2);
    expect(targets[0]).not.toEqual(targets[1]);
    runUntil(simulation, () =>
      simulation.actors.every((actor) => !actor.attackMove),
    );
    expect(simulation.actors.filter((actor) => actor.movement)).toEqual([]);
  });

  test.each(["move", "stop", "attack"] as const)(
    "%s replaces an interrupted Attack Move",
    (kind) => {
      const { simulation } = fixture([
        unit("trooper", "arc-trooper", 12, 10),
        unit("wolf", "wolf", 18, 10),
      ]);
      simulation.submitCommand({
        kind: "attack-move",
        actorId: "trooper",
        target: at(32, 10),
      });
      simulation.tick();
      expect(simulation.actorById("trooper")!.combat?.attack).toBeDefined();
      simulation.submitCommand(
        kind === "move"
          ? { kind, actorId: "trooper", target: at(5, 10) }
          : kind === "attack"
            ? { kind, actorId: "trooper", targetId: "wolf" }
            : { kind, actorId: "trooper" },
      );
      expect(simulation.tick()[0]!.accepted).toBe(true);
      expect(simulation.actorById("trooper")!.attackMove).toBeUndefined();
    },
  );

  test("a rejected replacement preserves the current aggressive order", () => {
    const { simulation } = fixture([unit("trooper", "arc-trooper", 12, 10)]);
    simulation.submitCommand({
      kind: "attack-move",
      actorId: "trooper",
      target: at(32, 10),
    });
    simulation.tick();
    simulation.submitCommand({
      kind: "attack-move",
      actorId: "trooper",
      target: { x: NaN, z: 0 },
    });
    expect(simulation.tick()[0]!.accepted).toBe(false);
    expect(simulation.actorById("trooper")!.attackMove?.target).toEqual(
      at(32, 10),
    );
  });

  test("detection loss searches only the last-known position and then resumes", () => {
    const content = withChanges("arc-trooper", { vision: undefined }).map(
      (definition) =>
        definition.id === "wolf"
          ? { ...definition, territory: undefined }
          : definition,
    );
    const units = [
      unit("trooper", "arc-trooper", 12, 10),
      unit("scout", "arc-scout", 18, 10),
      unit("wolf", "wolf", 18, 13),
    ];
    const { simulation } = fixture(units, undefined, undefined, content);
    simulation.submitCommand({
      kind: "attack-move",
      actorId: "trooper",
      target: at(30, 5),
    });
    simulation.tick();
    const lastKnown =
      simulation.actorById("trooper")!.combat!.attack!.lastKnown;
    simulation.removeActor("scout");
    simulation.submitCommand({
      kind: "move",
      actorId: "wolf",
      target: at(35, 14),
    });
    runUntil(
      simulation,
      () => !simulation.actorById("trooper")!.combat?.attack,
    );
    expect(
      distance(simulation.actorById("trooper")!.worldPosition, lastKnown),
    ).toBeLessThanOrEqual(1.5);
    expect(simulation.actorById("trooper")!.movement?.target).toEqual(
      at(30, 5),
    );
    runUntil(simulation, () => !simulation.actorById("trooper")!.attackMove);
    expect(simulation.actorById("trooper")!.worldPosition).toEqual(at(30, 5));
    expect(simulation.actorById("wolf")!.health).toBeUndefined();
  });

  test("blocked resumption waits for navigation changes and survives a save", () => {
    const units = [unit("trooper", "arc-trooper", 12, 10)];
    const { simulation } = fixture(units, (state) => {
      for (let z = 0; z < 20; z++)
        state.terrain!.tiles[z * 40 + 10].typeId = "water";
      const trooper = state.actors.find(({ id }) => id === "trooper")!;
      trooper.attackMove = { target: at(5, 10) };
      trooper.combat = { attack: { targetId: "dead", lastKnown: at(12, 10) } };
    });
    runUntil(
      simulation,
      () => !!simulation.actorById("trooper")!.attackMove?.blocked,
    );
    expect(simulation.actorById("trooper")!.attackMove?.blocked).toBeDefined();
    const saved = deserializeMission(
      serializeMission(simulation.snapshot(), TICK_SECONDS),
      scenario(units),
      TICK_SECONDS,
    );
    const { simulation: restored } = fixture(units, undefined, saved);
    for (const sim of [simulation, restored]) {
      sim.submitCommand({
        kind: "terrain",
        tiles: [{ x: 10, z: 10, terrain: { typeId: "plain" } }],
      });
      runUntil(sim, () => !sim.actorById("trooper")!.attackMove);
      expect(sim.actorById("trooper")!.worldPosition).toEqual(at(5, 10));
    }
    expect(restored.snapshot()).toEqual(simulation.snapshot());
  });

  test("a territory heading home abandons its Attack Move", () => {
    const { simulation } = fixture([unit("wolf", "wolf", 20, 10)], (state) => {
      state.actors.find(({ id }) => id === "wolf")!.territory = {
        home: at(16, 10),
      };
    });
    simulation.submitCommand({
      kind: "attack-move",
      actorId: "wolf",
      target: at(35, 10),
    });
    simulation.tick();
    const wolf = simulation.actorById("wolf")!;
    expect(wolf.attackMove).toBeUndefined();
    expect(wolf.combat?.returning?.point).toEqual(at(16, 10));
  });

  test.each([
    null,
    { target: { x: Infinity, z: 0 } },
    { target: at(5, 10), blocked: { at: at(5, 10), navigationVersion: -1 } },
  ])("rejects malformed aggressive state %j", (attackMove) => {
    expect(() =>
      fixture([unit("trooper", "arc-trooper", 12, 10)], (state) => {
        Object.assign(
          state.actors.find(({ id }) => id === "trooper")!,
          { attackMove },
        );
      }),
    ).toThrow("invalid combat state");
  });
});

describe("Command Center defeat", () => {
  test("combat destruction ends the mission before movement or economy and restores frozen", () => {
    const units = [
      unit("wolf", "wolf", 4, 3),
      unit("scout", "arc-scout", 12, 10),
    ];
    const { simulation } = fixture(
      units,
      (state) => {
        state.actors.find(({ id }) => id === "cc")!.health = 1;
      },
      undefined,
      definitions,
      () => {},
      ["cc"],
    );
    simulation.submitCommand({
      kind: "move",
      actorId: "scout",
      target: at(30, 10),
    });
    simulation.tick();
    expect(simulation.result).toEqual({
      kind: "defeat",
      actorId: "cc",
      tick: 0,
    });
    expect(simulation.actorById("scout")!.worldPosition).toEqual(at(12, 10));
    const saved = deserializeMission(
      serializeMission(simulation.snapshot(), TICK_SECONDS),
      scenario(units),
      TICK_SECONDS,
    );
    const { simulation: restored } = fixture(
      units,
      undefined,
      saved,
      definitions,
      () => {},
      ["cc"],
    );
    for (let i = 0; i < 10; i++) {
      simulation.tick();
      restored.tick();
    }
    expect(restored.snapshot()).toEqual(saved);
    expect(simulation.snapshot()).toEqual(saved);
    expect(() =>
      restored.submitCommand({ kind: "stop", actorId: "scout" }),
    ).toThrow("ended");
    for (const sim of [simulation, restored]) {
      expect(() => sim.removeActor("scout")).toThrow("ended");
      expect(() =>
        sim.spawnActor(
          createActor({
            id: "new-scout",
            definitionId: "arc-scout",
            worldPosition: at(15, 10),
          }),
        ),
      ).toThrow("ended");
      expect(sim.snapshot()).toEqual(saved);
    }
    const restarted = fixture(
      units,
      undefined,
      undefined,
      definitions,
      () => {},
      ["cc"],
    ).simulation;
    expect(restarted.result).toBeUndefined();
    expect(restarted.actorById("cc")!.health).toBeUndefined();
    expect(restarted.completedTicks).toBe(0);
  });

  test("ordinary missions retain combat without a defeat rule", () => {
    const { simulation } = fixture([unit("wolf", "wolf", 4, 3)], (state) => {
      state.actors.find(({ id }) => id === "cc")!.health = 1;
    });
    simulation.tick();
    expect(simulation.actorById("cc")).toBeUndefined();
    expect(simulation.result).toBeUndefined();
    simulation.tick();
    expect(simulation.completedTicks).toBe(2);
  });
});

test("aggressive combat is identical with frequent or sparse clock pumps", () => {
  const run = (pumpMilliseconds: number) => {
    const { simulation } = fixture([
      unit("trooper", "arc-trooper", 12, 10),
      unit("wolf", "wolf", 23, 10),
    ]);
    simulation.submitCommand({
      kind: "attack-move",
      actorId: "trooper",
      target: at(32, 10),
    });
    let now = 0;
    const loop = startSimulationLoop(simulation, {
      pumpMilliseconds: 60_000,
      maxCatchUpSeconds: 5,
      now: () => now,
    });
    for (; now < 20_000; now += pumpMilliseconds) loop.advance();
    now = 20_000;
    loop.advance();
    loop.stop();
    return simulation.snapshot();
  };
  expect(run(233)).toEqual(run(5));
});
