import { playerOwners, stockpiles } from "./helpers/scenario";
import { describe, expect, test } from "vitest";
import { WILDLIFE_ACTOR_DEFINITIONS } from "./helpers/content";
import { ARC_ACTOR_DEFINITIONS } from "./helpers/content";
import { updateCombat } from "../src/simulation/combat";
import {
  createTerritoryController,
  createTerritoryState,
} from "../src/simulation/territory";
import { createActor } from "../src/simulation/actor";
import { createMissionSimulation } from "../src/simulation/mission";
import { OccupancyGrid } from "../src/simulation/occupancy";
import { TerrainGrid } from "../src/simulation/terrain";
import { createTerrainMoveBehavior } from "../src/simulation/terrain-movement";
import {
  createScenarioState,
  defineScenario,
} from "../src/simulation/scenario";
import { parseMission, serializeMission } from "../src/simulation/mission-file";
import { createFixedStepClock } from "../src/simulation/clock";
import { distance } from "../src/simulation/world";
import type { ActorDefinition } from "../src/simulation/actor";
import type { MissionState } from "../src/simulation/mission";
import type { ScenarioUnit } from "../src/simulation/scenario";

const seconds = 0.1;
const options = {
  width: 40,
  height: 24,
  tileSize: 1,
  terrainTypeIds: ["plain", "path", "rough", "water"],
};
const contentMap = new TerrainGrid(options);
const at = (x: number, z = 12) => contentMap.tileCenter(x, z);
const definitions: readonly ActorDefinition[] = [
  ...ARC_ACTOR_DEFINITIONS,
  ...WILDLIFE_ACTOR_DEFINITIONS,
];
const wolf = definitions.find((definition) => definition.id === "wolf")!;
const unit = (
  id: string,
  x: number,
  definitionId = "wolf",
  z = 12,
): ScenarioUnit => ({
  actorId: id,
  definitionId,
  tile: { x, z },
  ...(definitionId.includes("wolf") && {
    territory: { encounterId: "pack", center: at(20), radius: 18 },
  }),
});
const scenario = (units: ScenarioUnit[]) =>
  defineScenario({
    id: "wolf-ai-test",
    tileSize: 1,
    terrainTypeIds: options.terrainTypeIds,
    terrain: contentMap.terrainState(),
    ...playerOwners("arc"),
    buildings: [],
    units,
    stockpiles: stockpiles(0),
    sites: [],
    loot: [],
  });
const tuning = (
  territory: Partial<NonNullable<ActorDefinition["territory"]>> = {},
  vision = 8,
) =>
  definitions.map((definition) =>
    definition.id === "wolf"
      ? {
          ...definition,
          vision: { radius: vision },
          territory: { ...wolf.territory!, ...territory },
        }
      : definition,
  );

function fixture(
  units: ScenarioUnit[],
  edit?: (state: MissionState) => void,
  content = definitions,
  saved?: MissionState,
) {
  const map = new TerrainGrid(options);
  const occupancy = new OccupancyGrid(map);
  const state = saved ?? createScenarioState(scenario(units), content);
  edit?.(state);
  const simulation = createMissionSimulation({
    state,
    definitions: content,
    map,
    occupancy,
    tickSeconds: seconds,
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
  return simulation;
}
function seedAlert(
  state: MissionState,
  id: number,
  source: string,
  origin = state.actors.find((actor) => actor.id === source)!.worldPosition,
  expiresTick = 200,
) {
  state.wildlife.nextAlertId = Math.max(state.wildlife.nextAlertId, id + 1);
  state.wildlife.alerts.push({
    id,
    origin: { ...origin },
    createdTick: 0,
    expiresTick,
    propagators: [source],
  });
}
const propagators = (simulation: ReturnType<typeof fixture>, id = 1) =>
  simulation.snapshot().wildlife.alerts.find((alert) => alert.id === id)
    ?.propagators;
function tick(simulation: ReturnType<typeof fixture>, count = 1) {
  for (let i = 0; i < count; i++) simulation.tick();
}
function continuation(
  simulation: ReturnType<typeof fixture>,
  units: ScenarioUnit[],
  content = definitions,
  ticks = 12,
) {
  const restored = fixture(
    units,
    undefined,
    content,
    parseMission(
      serializeMission(scenario(units), simulation.snapshot(), seconds),
      seconds,
    ).state,
  );
  expect(restored.snapshot()).toEqual(simulation.snapshot());
  for (let i = 0; i < ticks; i++) {
    simulation.tick();
    restored.tick();
    expect(restored.snapshot()).toEqual(simulation.snapshot());
  }
}

describe("wolf personal perception", () => {
  test("alpha sees farther without lending its perception to another wolf", () => {
    const simulation = fixture([
      unit("normal", 20),
      unit("alpha", 20, "alpha-wolf", 14),
      unit("player", 29, "arc-scout"),
    ]);
    simulation.tick();
    expect(simulation.actorById("alpha")!.combat?.attack?.targetId).toBe(
      "player",
    );
    expect(simulation.actorById("normal")!.combat?.attack).toBeUndefined();
    expect(
      simulation.actorById("normal")!.territory?.investigation,
    ).toBeUndefined();
    expect(
      definitions.find((definition) => definition.id === "alpha-wolf")!.health,
    ).toBeGreaterThan(wolf.health!);
    simulation.tick();
    expect(
      simulation.actorById("normal")!.territory?.investigation?.origin,
    ).toEqual(at(20, 14));
  });
  test("a mountain blocks both personal detection and wolf-to-wolf alerts", () => {
    const simulation = fixture(
      [unit("source", 16), unit("other", 22), unit("player", 23, "arc-scout")],
      (state) => {
        for (let z = 0; z <= options.height; z++)
          state.terrain!.heights[z * (options.width + 1) + 19] = 12;
        seedAlert(state, 1, "source");
      },
    );
    simulation.tick();
    expect(simulation.actorById("source")!.combat?.attack).toBeUndefined();
    expect(propagators(simulation)).toEqual(["source"]);
  });
  test("stable nearest selection retains a target despite a closer newcomer", () => {
    const simulation = fixture([
      unit("wolf", 20),
      unit("b", 24, "arc-scout"),
      unit("a", 16, "arc-scout"),
    ]);
    simulation.tick();
    expect(simulation.actorById("wolf")!.combat?.attack?.targetId).toBe("a");
    simulation.submitCommand({ kind: "move", actorId: "b", target: at(20) });
    tick(simulation, 5);
    expect(simulation.actorById("wolf")!.combat?.attack?.targetId).toBe("a");
  });
  test("lost personal detection returns home despite faction vision", () => {
    const units = [
      unit("chaser", 20),
      unit("distant", 30),
      unit("player", 24, "arc-scout"),
    ];
    const initial = fixture(units, undefined, tuning({}, 5));
    initial.tick();
    const simulation = fixture(
      units,
      (state) => {
        state.actors.find((actor) => actor.id === "player")!.worldPosition =
          at(31);
      },
      tuning({}, 5),
      initial.snapshot(),
    );
    simulation.tick();
    expect(simulation.actorById("chaser")!.combat?.attack).toBeUndefined();
    expect(simulation.actorById("chaser")!.territory?.mode).toBe(
      "returning-home",
    );
    expect(simulation.actorById("distant")!.combat?.attack?.targetId).toBe(
      "player",
    );
  });
  test("unseen damage alerts at the wounded position without revealing its source", () => {
    const units = [unit("wolf", 20), unit("shooter", 24, "arc-trooper")];
    const simulation = fixture(units, undefined, tuning({}, 2));
    simulation.tick();
    expect(simulation.actorById("wolf")!.combat?.attack).toBeUndefined();
    expect(simulation.actorById("wolf")!.territory?.mode).toBe("alerted");
    expect(simulation.actorById("wolf")!.worldPosition).toEqual(at(20));
    expect(simulation.snapshot().wildlife.alerts[0]!.origin).toEqual(at(20));
    continuation(simulation, units, tuning({}, 2));
  });
});

describe("wolf alerts", () => {
  test("sight relays preserve the root origin and propagate one hop per tick", () => {
    const units = [
      unit("a", 10),
      unit("b", 13),
      unit("c", 16),
      unit("player", 8, "arc-scout"),
    ];
    const simulation = fixture(units, undefined, tuning({}, 3));
    simulation.tick();
    const origin = simulation.snapshot().wildlife.alerts[0]!.origin;
    expect(origin).toEqual(at(10));
    expect(simulation.actorById("c")!.territory?.investigation).toBeUndefined();
    simulation.tick();
    expect(simulation.actorById("b")!.territory?.investigation?.origin).toEqual(
      origin,
    );
    expect(simulation.actorById("c")!.territory?.investigation).toBeUndefined();
    simulation.tick();
    expect(simulation.actorById("c")!.territory?.investigation?.origin).toEqual(
      origin,
    );
    expect(simulation.snapshot().wildlife.alerts[0]!.propagators).toEqual([
      "a",
      "b",
      "c",
    ]);
    continuation(simulation, units, tuning({}, 3));
  });
  test("equal simultaneous alerts use ID, and an active investigation persists", () => {
    const units = [unit("left", 10), unit("right", 18), unit("observer", 14)];
    const simulation = fixture(units, (state) => {
      seedAlert(state, 2, "left");
      seedAlert(state, 1, "right");
    });
    simulation.tick();
    expect(
      simulation.actorById("observer")!.territory?.investigation?.alertId,
    ).toBe(1);
    simulation.tick();
    expect(
      simulation.actorById("observer")!.territory?.investigation?.alertId,
    ).toBe(1);
    expect(propagators(simulation, 1)).toContain("observer");
    expect(propagators(simulation, 2)).not.toContain("observer");
  });
  test("expiry blocks new responders while active investigations finish once", () => {
    const units = [unit("a", 10), unit("b", 13), unit("c", 16)];
    const simulation = fixture(
      units,
      (state) => seedAlert(state, 1, "a", undefined, 1),
      tuning({}, 3),
    );
    simulation.tick();
    expect(simulation.actorById("b")!.territory?.investigation?.alertId).toBe(
      1,
    );
    expect(propagators(simulation)).toEqual(["a", "b"]);
    tick(simulation, 80);
    expect(simulation.snapshot().wildlife.alerts).toEqual([]);
    expect(simulation.actorById("b")!.territory?.mode).toBe("idle-at-home");
    expect(simulation.actorById("c")!.territory?.investigation).toBeUndefined();
    expect(simulation.actorById("c")!.worldPosition).toEqual(at(16));
  });
  test("observing a handled alert never restarts a finished response", () => {
    const units = [unit("a", 10), unit("b", 13)];
    const simulation = fixture(
      units,
      (state) => seedAlert(state, 1, "a"),
      tuning({ investigationSeconds: 0.1 }, 3),
    );
    tick(simulation, 70);
    expect(propagators(simulation)).toEqual(["a", "b"]);
    expect(simulation.actorById("b")!.territory?.mode).toBe("idle-at-home");
    expect(simulation.actorById("b")!.worldPosition).toEqual(at(13));
  });
  test("a fresh alert interrupts return and regeneration; damage alone does not divert return", () => {
    const units = [unit("source", 17), unit("wolf", 20)];
    for (const returning of [true, false]) {
      const simulation = fixture(units, (state) => {
        const actor = state.actors.find((actor) => actor.id === "wolf")!;
        actor.health = 50;
        if (returning) {
          actor.worldPosition = at(19);
          actor.combat = { returning: { point: at(20) } };
        }
        seedAlert(state, 1, "source");
      });
      simulation.tick();
      expect(
        simulation.actorById("wolf")!.territory?.investigation?.alertId,
      ).toBe(1);
      expect(simulation.actorById("wolf")!.health).toBe(50);
      expect(simulation.actorById("wolf")!.combat?.returning).toBeUndefined();
    }
    const simulation = fixture(
      [unit("wolf", 20), unit("shooter", 23, "arc-trooper")],
      (state) => {
        const actor = state.actors.find((actor) => actor.id === "wolf")!;
        actor.worldPosition = at(19);
        actor.combat = { returning: { point: at(20) } };
      },
      tuning({}, 2),
    );
    simulation.tick();
    expect(simulation.actorById("wolf")!.territory?.mode).toBe(
      "returning-home",
    );
    expect(simulation.actorById("wolf")!.worldPosition.x).toBeGreaterThan(
      at(19).x,
    );
  });
});

describe("wolf movement and persistence", () => {
  test("returns to a home inside the leash with a tile center outside it", () => {
    const home = { ...at(21), x: at(21).x - 0.2 };
    const simulation = fixture([unit("wolf", 20)], (state) => {
      state.actors[0]!.territory = createTerritoryState(at(20), {
        home,
        center: at(20),
        radius: 0.9,
      });
    });
    for (let tick = 0; tick < 30; tick += 1) simulation.tick();
    expect(simulation.actorById("wolf")!.worldPosition).toEqual(home);
    expect(simulation.actorById("wolf")!.territory!.mode).toBe("idle-at-home");
  });
  test("shared territory permits separated homes while the hard leash excludes targets and alerts", () => {
    const units = [
      unit("wolf", 23),
      unit("outside", 26, "arc-scout"),
      unit("source", 24),
    ];
    const simulation = fixture(units, (state) => {
      for (const actor of state.actors.filter((actor) => actor.territory))
        actor.territory!.radius = 5;
      seedAlert(state, 1, "source", at(26));
    });
    simulation.tick();
    expect(simulation.actorById("wolf")!.combat?.attack).toBeUndefined();
    expect(
      simulation.actorById("wolf")!.territory?.investigation,
    ).toBeUndefined();
    expect(simulation.actorById("wolf")!.territory?.home).toEqual(at(23));
  });
  test("a blocked home approaches a waiting point, preserves its goal, and cannot heal", () => {
    const units = [unit("wolf", 20)];
    const simulation = fixture(units, (state) => {
      const actor = state.actors[0]!;
      actor.worldPosition = at(24);
      actor.health = 50;
      state.terrain!.tiles[12 * options.width + 20]!.typeId = "water";
    });
    tick(simulation, 80);
    const actor = simulation.actorById("wolf")!;
    expect(actor.health).toBe(50);
    expect(actor.territory?.mode).toBe("returning-home");
    expect(actor.combat?.returning?.point).toEqual(at(20));
    expect(distance(actor.worldPosition, at(20))).toBe(1);
    continuation(simulation, units);
    simulation.submitCommand(
      {
        kind: "terrain",
        tiles: [{ x: 20, z: 12, terrain: { typeId: "plain" } }],
      },
      { script: true },
    );
    tick(simulation, 20);
    expect(simulation.actorById("wolf")!.worldPosition).toEqual(at(20));
    expect(simulation.actorById("wolf")!.health).toBeGreaterThan(50);
  });
  test("a stalled investigation is abandoned and remains handled", () => {
    const units = [unit("source", 10), unit("wolf", 16)];
    const simulation = fixture(
      units,
      (state) => seedAlert(state, 1, "source"),
      tuning({ stalledSeconds: 0.5 }),
    );
    simulation.tick();
    simulation.submitCommand(
      {
        kind: "terrain",
        tiles: Array.from({ length: 24 }, (_, z) => ({
          x: 13,
          z,
          terrain: { typeId: "water" },
        })),
      },
      { script: true },
    );
    tick(simulation, 40);
    expect(
      simulation.actorById("wolf")!.territory?.investigation,
    ).toBeUndefined();
    expect(propagators(simulation)).toEqual(["source", "wolf"]);
    expect(simulation.actorById("wolf")!.territory?.mode).toBe("idle-at-home");
    continuation(simulation, units, tuning({ stalledSeconds: 0.5 }));
  });
  test("save continuation covers every state and active bounded routes", () => {
    const cases: {
      units: ScenarioUnit[];
      edit?: (state: MissionState) => void;
      ticks?: number;
      mode: string;
    }[] = [
      { units: [unit("wolf", 20)], mode: "idle-at-home" },
      {
        units: [unit("wolf", 20)],
        edit: (state) => {
          state.actors[0]!.health = 50;
        },
        mode: "regenerating",
        ticks: 1,
      },
      {
        units: [unit("source", 15), unit("wolf", 20)],
        edit: (state) => seedAlert(state, 1, "source"),
        mode: "alerted",
        ticks: 1,
      },
      {
        units: [unit("source", 15), unit("wolf", 20)],
        edit: (state) => seedAlert(state, 1, "source"),
        mode: "investigating",
        ticks: 2,
      },
      {
        units: [unit("wolf", 20)],
        edit: (state) => {
          state.actors[0]!.worldPosition = at(24);
        },
        mode: "returning-home",
        ticks: 1,
      },
      {
        units: [unit("wolf", 20), unit("player", 24, "arc-scout")],
        mode: "pursuing",
        ticks: 1,
      },
      {
        units: [unit("wolf", 20), unit("player", 21, "arc-scout")],
        mode: "attacking",
        ticks: 2,
      },
    ];
    for (const item of cases) {
      const simulation = fixture(item.units, item.edit);
      tick(simulation, item.ticks ?? 0);
      expect(simulation.actorById("wolf")!.territory?.mode).toBe(item.mode);
      continuation(simulation, item.units);
    }
  });
  test("actor order and tick scheduling batches produce identical wolf and alert state", () => {
    const units = [
      unit("a", 10),
      unit("b", 13),
      unit("c", 16),
      unit("player", 8, "arc-scout"),
    ];
    const forward = fixture(units, undefined, tuning({}, 3));
    const reverse = fixture(
      units,
      (state) => state.actors.reverse(),
      tuning({}, 3),
    );
    const canonical = (state: MissionState) => ({
      ...state,
      actors: state.actors.sort((a, b) => a.id.localeCompare(b.id)),
    });
    for (const batch of [1, 2, 7, 3, 12]) {
      tick(forward, batch);
      tick(reverse, batch);
      expect(canonical(reverse.snapshot())).toEqual(
        canonical(forward.snapshot()),
      );
    }
  });

  test("fresh personal threats interrupt investigation, return, and regeneration", () => {
    const units = [unit("wolf", 20), unit("player", 24, "arc-scout")];
    for (const mode of [
      "investigating",
      "returning-home",
      "regenerating",
    ] as const) {
      const simulation = fixture(units, (state) => {
        const actor = state.actors[0]!;
        actor.health = 50;
        actor.territory!.mode = mode;
        if (mode === "investigating") {
          seedAlert(state, 1, "wolf", at(16));
          actor.territory!.investigation = { alertId: 1, origin: at(16) };
        }
        if (mode === "returning-home") {
          actor.worldPosition = at(19);
          actor.combat = { returning: { point: at(20) } };
        }
      });
      simulation.tick();
      expect(simulation.actorById("wolf")!.combat?.attack?.targetId).toBe(
        "player",
      );
      expect(
        simulation.actorById("wolf")!.territory?.investigation,
      ).toBeUndefined();
      expect(simulation.actorById("wolf")!.combat?.returning).toBeUndefined();
      expect(simulation.actorById("wolf")!.health).toBe(50);
    }
  });
  test("regeneration delay starts after pursuit ends, even without a hit", () => {
    const units = [unit("wolf", 20), unit("player", 24, "arc-scout")];
    const chasing = fixture(
      units,
      (state) => {
        state.actors[0]!.health = 50;
      },
      tuning({ regenerationDelaySeconds: 1 }),
    );
    chasing.tick();
    const simulation = fixture(
      units,
      (state) => {
        state.actors.find((actor) => actor.id === "player")!.worldPosition =
          at(38);
      },
      tuning({ regenerationDelaySeconds: 1 }),
      chasing.snapshot(),
    );
    tick(simulation, 6);
    expect(simulation.actorById("wolf")!.worldPosition).toEqual(at(20));
    expect(simulation.actorById("wolf")!.health).toBe(50);
    tick(simulation, 6);
    expect(simulation.actorById("wolf")!.health).toBeGreaterThan(50);
  });
  test("zero regeneration stays idle without reporting healing", () => {
    const simulation = fixture(
      [unit("wolf", 20)],
      (state) => {
        state.actors[0]!.health = 50;
      },
      tuning({ regenerationPerSecond: 0 }),
    );
    try {
      tick(simulation, 20);
      expect(simulation.actorById("wolf")!.health).toBe(50);
      expect(simulation.actorById("wolf")!.territory?.mode).toBe(
        "idle-at-home",
      );
    } finally {
      simulation.dispose();
    }
  });
  test("unreachable hostiles are skipped and bounded routes find valid detours", () => {
    const units = [unit("wolf", 18), unit("player", 22, "arc-scout")];
    const simulation = fixture(units, (state) => {
      state.actors[0]!.territory!.radius = 6;
      for (const z of [11, 12, 13])
        state.terrain!.tiles[z * options.width + 20]!.typeId = "water";
    });
    simulation.tick();
    const actor = simulation.actorById("wolf")!;
    expect(actor.combat?.attack?.targetId).toBe("player");
    expect(actor.movement?.waypoints?.length).toBeGreaterThan(1);
    expect(
      actor.movement?.waypoints?.every((point) => distance(point, at(20)) <= 6),
    ).toBe(true);
    const blocked = fixture(units, (state) => {
      for (let z = 0; z < options.height; z++)
        state.terrain!.tiles[z * options.width + 20]!.typeId = "water";
    });
    blocked.tick();
    expect(blocked.actorById("wolf")!.combat?.attack).toBeUndefined();
  });
  test("failed pursuit waits for target movement or relevant terrain changes", () => {
    const units = [unit("wolf", 24), unit("player", 20, "arc-scout")];
    const content = tuning({ stalledSeconds: 0.5 });
    const simulation = fixture(units, undefined, content);
    simulation.tick();
    simulation.submitCommand(
      {
        kind: "terrain",
        tiles: Array.from({ length: 24 }, (_, z) => ({
          x: 22,
          z,
          terrain: { typeId: "water" },
        })),
      },
      { script: true },
    );
    tick(simulation, 40);
    expect(simulation.actorById("wolf")!.territory?.failedTargets).toEqual([
      expect.objectContaining({ targetId: "player" }),
    ]);
    continuation(simulation, units, content);
    simulation.submitCommand(
      {
        kind: "terrain",
        tiles: [{ x: 0, z: 0, terrain: { typeId: "water" } }],
      },
      { script: true },
    );
    simulation.tick();
    expect(simulation.actorById("wolf")!.territory?.failedTargets?.length).toBe(
      1,
    );
    expect(simulation.actorById("wolf")!.combat?.attack).toBeUndefined();
    simulation.submitCommand(
      {
        kind: "terrain",
        tiles: [{ x: 22, z: 12, terrain: { typeId: "plain" } }],
      },
      { script: true },
    );
    simulation.tick();
    expect(simulation.actorById("wolf")!.combat?.attack?.targetId).toBe(
      "player",
    );
  });
  test("frame rates produce identical fixed-tick simulation", () => {
    const units = [
      unit("a", 10),
      unit("b", 13),
      unit("c", 16),
      unit("player", 8, "arc-scout"),
    ];
    const fast = fixture(units, undefined, tuning({}, 3));
    const slow = fixture(units, undefined, tuning({}, 3));
    for (const [simulation, frames] of [
      [fast, 60],
      [slow, 4],
    ] as const) {
      const clock = createFixedStepClock({
        tickSeconds: seconds,
        startMilliseconds: 0,
        maxCatchUpTicks: 100,
      });
      for (let frame = 1; frame <= frames * 3; frame++)
        tick(simulation, clock.ticksDue((frame * 1000) / frames));
    }
    expect(slow.snapshot()).toEqual(fast.snapshot());
  });

  test("only the selected controller prepares an actor's behavior", () => {
    const state = createScenarioState(
      scenario([unit("wolf", 20), unit("player", 24, "arc-scout")]),
      definitions,
    );
    updateCombat({
      tick: 0,
      tickSeconds: seconds,
      navigationVersion: 0,
      actors: state.actors,
      definitions: new Map(
        definitions.map((definition) => [definition.id, definition]),
      ),
      controllers: [
        { applies: () => true, plan: () => false },
        createTerritoryController(state.wildlife),
      ],
      wrecks: [],
      detects: () => true,
      hostile: (left, right) => left !== right,
      move: () => false,
      destination: (_actor, point) => point,
      destroy: () => {},
    });
    expect(state.wildlife.alerts).toEqual([]);
    expect(state.wildlife.nextAlertId).toBe(1);
  });

  test("alerts stay visible when their source has another controller", () => {
    const state = createScenarioState(
      scenario([unit("alpha", 20, "alpha-wolf"), unit("observer", 23)]),
      definitions,
    );
    seedAlert(state, 1, "alpha");
    updateCombat({
      tick: 0,
      tickSeconds: seconds,
      navigationVersion: 0,
      actors: state.actors,
      definitions: new Map(
        definitions.map((definition) => [definition.id, definition]),
      ),
      controllers: [
        {
          applies: (definition) => definition.id === "alpha-wolf",
          plan: () => false,
        },
        createTerritoryController(state.wildlife),
      ],
      wrecks: [],
      detects: () => true,
      hostile: (left, right) => left !== right,
      move: () => false,
      destination: (_actor, point) => point,
      destroy: () => {},
    });
    expect(
      state.actors.find((actor) => actor.id === "observer")!.territory!
        .investigation?.alertId,
    ).toBe(1);
    expect(
      state.actors.find((actor) => actor.id === "alpha")!.territory!
        .seenTargets,
    ).toBeUndefined();
  });
  test("authored homes can differ from starting positions", () => {
    const placement = unit("wolf", 20);
    placement.territory!.home = at(16);
    const simulation = fixture([placement]);
    expect(simulation.actorById("wolf")!.territory?.mode).toBe(
      "returning-home",
    );
    simulation.tick();
    expect(simulation.actorById("wolf")!.worldPosition.x).toBeLessThan(
      at(20).x,
    );
  });
  test("slow, continuous progress never times out a pursuit", () => {
    const content = definitions.map((definition) =>
      definition.id === "wolf"
        ? { ...definition, movement: { ...definition.movement!, speed: 0.01 } }
        : definition,
    );
    const units = [unit("wolf", 20), unit("player", 24, "arc-scout")];
    const simulation = fixture(units, undefined, content);
    tick(simulation, 40);
    expect(simulation.actorById("wolf")!.combat?.attack?.targetId).toBe(
      "player",
    );
    expect(simulation.actorById("wolf")!.territory?.failedTargets).toEqual([]);
    continuation(simulation, units, content);
  });
  test("moving less than a tile releases a failed approach", () => {
    const units = [unit("wolf", 20), unit("player", 24, "arc-scout")];
    const simulation = fixture(units, (state) => {
      state.actors[0]!.territory!.failedTargets = [
        {
          targetId: "player",
          position: { ...at(24), x: at(24).x - 0.25 },
          navigationVersion: 0,
        },
      ];
    });
    simulation.tick();
    expect(simulation.actorById("wolf")!.combat?.attack?.targetId).toBe(
      "player",
    );
  });
  test("saved routes cannot expand the encounter leash or leave it", () => {
    const units = [unit("wolf", 20), unit("player", 24, "arc-scout")];
    const active = fixture(units);
    active.tick();
    for (const edit of [
      (state: MissionState) => {
        state.actors[0]!.movement!.bounds!.radius = 30;
      },
      (state: MissionState) => {
        state.actors[0]!.movement!.waypoints = [at(39)];
      },
      (state: MissionState) => {
        state.actors[0]!.movement!.destination = at(39);
      },
    ])
      expect(() =>
        fixture(units, edit, definitions, active.snapshot()),
      ).toThrow("invalid route bounds");
  });
  test("invalid wolf spawns reject before publishing state or reserving IDs", () => {
    const simulation = fixture([unit("wolf", 20)]);
    const actor = createActor({
      id: "new-wolf",
      definitionId: "wolf",
      owner: "wildlife",
      worldPosition: at(25),
    });
    actor.territory = createTerritoryState(actor.worldPosition, {
      encounterId: "pack",
      center: at(21),
      radius: 18,
    });
    const before = simulation.snapshot();
    expect(() => simulation.spawnActor(actor)).toThrow("inconsistent bounds");
    expect(simulation.snapshot()).toEqual(before);
    actor.territory.center = at(20);
    expect(() => simulation.spawnActor(actor)).not.toThrow();
    expect(() => simulation.tick()).not.toThrow();
  });
  test("alert histories require wolf propagators and a matching investigation origin", () => {
    const units = [unit("wolf", 20), unit("player", 24, "arc-scout")];
    for (const edit of [
      (state: MissionState) => {
        state.wildlife.alerts[0]!.propagators = [];
      },
      (state: MissionState) => {
        state.wildlife.alerts[0]!.propagators.push("player");
      },
      (state: MissionState) => {
        state.actors[0]!.territory!.investigation = {
          alertId: 1,
          origin: at(21),
        };
      },
      (state: MissionState) => {
        state.actors[0]!.territory!.seenTargets = ["unknown"];
      },
    ])
      expect(() =>
        fixture(units, (state) => {
          seedAlert(state, 1, "wolf");
          edit(state);
        }),
      ).toThrow();
  });
  test("malformed alert and territory saves are rejected", () => {
    const units = [unit("wolf", 20)];
    for (const edit of [
      (state: MissionState) => {
        state.wildlife.nextAlertId = 0;
      },
      (state: MissionState) => {
        seedAlert(state, 1, "wolf");
        state.wildlife.alerts[0]!.expiresTick = -1;
      },
      (state: MissionState) => {
        state.actors[0]!.territory!.mode = "bogus" as never;
      },
      (state: MissionState) => {
        state.actors[0]!.territory!.center = at(1);
        state.actors[0]!.territory!.radius = 2;
      },
    ])
      expect(() => fixture(units, edit)).toThrow();
  });
});
