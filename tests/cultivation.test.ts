import {
  createTilePlacedActor,
  adjacentTiles,
  occupiedTilesFor,
} from "../src/simulation/placement";
import { expect, test } from "vitest";
import { BASE_CONTENT, MOVEMENT_PROFILES } from "./helpers/content";
import {
  advanceSeconds,
  exploredScenarioState,
  untilSeconds,
  playerOwners,
} from "./helpers/scenario";
import {
  createCultivationSite,
  cultivationEfficiency,
} from "../src/simulation/cultivation";
import { createMissionSimulation } from "../src/simulation/mission";
import { createActor } from "../src/simulation/actor";
import { TerrainGrid } from "../src/simulation/terrain";
import { OccupancyGrid } from "../src/simulation/occupancy";
import { createTerrainMoveBehavior } from "../src/simulation/terrain-movement";
import { defineScenario } from "../src/simulation/scenario";
import { parseMission, serializeMission } from "../src/simulation/mission-file";
import type {
  MissionState,
  MissionSimulation,
} from "../src/simulation/mission";
import type { MissionCommand } from "../src/simulation/command";
import type { MissionEventDefinition } from "../src/simulation/events";

const definitions = BASE_CONTENT.actors.filter(
  ({ faction }) => faction === "circle",
);
const terrainOptions = {
  width: 32,
  height: 20,
  tileSize: 1,
  terrainTypeIds: ["plain", "path", "rough", "water"],
};
const terrain = new TerrainGrid(terrainOptions);
const scenario = defineScenario({
  id: "cultivation-test",
  ...playerOwners("circle"),
  tileSize: 1,
  terrainTypeIds: ["plain", "path", "rough", "water"],
  terrain: terrain.terrainState(),
  buildings: [
    {
      actorId: "heart",
      definitionId: "circle-heartgrove",
      origin: { x: 2, z: 6 },
    },
  ],
  materials: 500,
  sites: [],
  loot: [],
  cultivation: {
    lifebloom: 150,
    sites: [
      createCultivationSite("near", "Near Lifebloom", { x: 14, z: 6 }),
      createCultivationSite("far", "Far Lifebloom", { x: 23, z: 6 }),
    ],
  },
});
function fixture(state?: MissionState, events?: MissionEventDefinition[]) {
  const map = new TerrainGrid(terrainOptions);
  const occupancy = new OccupancyGrid(map);
  const simulation = createMissionSimulation({
    state: state ?? exploredScenarioState(scenario, definitions),
    events,
    definitions,
    map,
    occupancy,
    tickSeconds: 0.1,
    bounds: map.worldBounds,
    behaviorRegistry: new Map([
      [
        "terrain-move",
        createTerrainMoveBehavior(map, occupancy, MOVEMENT_PROFILES),
      ],
      ["idle", { handleCommand: () => false, update: () => {} }],
    ]),
  });
  return { simulation, map };
}
function command(sim: MissionSimulation, value: MissionCommand) {
  sim.submitCommand(value);
  return sim.tick()[0]!;
}
function train(sim: MissionSimulation, id = "worker") {
  expect(
    command(sim, {
      kind: "train-unit",
      actorId: id,
      producerId: "heart",
      definitionId: "circle-cultivator",
    }).accepted,
  ).toBe(true);
  untilSeconds(sim, () => !!sim.actorById(id));
}
function place(
  sim: MissionSimulation,
  id = "conservatory",
  x = 10,
  z = 6,
  workerId = "worker",
  definitionId = "circle-conservatory",
) {
  return command(sim, {
    kind: "place-actor",
    actorId: id,
    definitionId,
    origin: { x, z },
    workerIds: [workerId],
  });
}
function opening() {
  const result = fixture();
  const { simulation } = result;
  train(simulation);
  expect(place(simulation).accepted).toBe(true);
  untilSeconds(
    simulation,
    () => !simulation.actorById("conservatory")!.construction,
  );
  return result;
}
function saved(sim: MissionSimulation) {
  return parseMission(
    serializeMission(scenario, sim.snapshot(), sim.tickSeconds),
    sim.tickSeconds,
  ).state;
}

test("paid opening trains its worker, tends a drop-off, cultivates, and funds production", () => {
  const { simulation: sim } = opening();
  try {
    expect(sim.economy!.cultivation!.lifebloom).toBe(0);
    expect(sim.economy!.materials).toBe(500);
    expect(
      command(sim, { kind: "gather", actorId: "worker", siteId: "near" })
        .accepted,
    ).toBe(true);
    untilSeconds(sim, () => sim.economy!.cultivation!.lifebloom >= 120);
    expect(
      place(sim, "muster", 8, 10, "worker", "circle-musterhall").accepted,
    ).toBe(true);
    untilSeconds(sim, () => !sim.actorById("muster")!.construction);
    expect(
      command(sim, { kind: "gather", actorId: "worker", siteId: "near" })
        .accepted,
    ).toBe(true);
    untilSeconds(sim, () => sim.economy!.cultivation!.lifebloom >= 55);
    for (const [id, definitionId] of [
      ["sentinel", "circle-sentinel"],
      ["wayfinder", "circle-wayfinder"],
    ])
      expect(
        command(sim, {
          kind: "train-unit",
          actorId: id!,
          definitionId: definitionId!,
          producerId: "muster",
        }).accepted,
      ).toBe(true);
    untilSeconds(sim, () => !!sim.actorById("wayfinder"));
    expect(sim.actorById("sentinel")).toBeDefined();
    expect(sim.economy!.cultivation!.sites[0]!.reserve).toBeGreaterThanOrEqual(
      99000,
    );
    expect(sim.economy!.materials).toBe(500);
  } finally {
    sim.dispose();
  }
});

test("growth requires a selected worker, pauses without losing progress, and resumes manually", () => {
  const { simulation: sim } = fixture();
  try {
    expect(
      sim.evaluatePlacement({
        actorId: "new",
        definitionId: "circle-conservatory",
        origin: { x: 10, z: 6 },
      }),
    ).toMatchObject({ accepted: false, reason: "missing-worker" });
    train(sim);
    expect(place(sim).accepted).toBe(true);
    untilSeconds(
      sim,
      () =>
        (sim.actorById("conservatory")!.construction?.completedTicks ?? 0) >=
        10,
    );
    expect(command(sim, { kind: "stop", actorId: "worker" }).accepted).toBe(
      true,
    );
    const progress =
      sim.actorById("conservatory")!.construction!.completedTicks;
    advanceSeconds(sim, 2);
    expect(sim.actorById("conservatory")!.construction!.completedTicks).toBe(
      progress,
    );
    const restored = fixture(saved(sim)).simulation;
    try {
      for (const current of [sim, restored]) {
        expect(
          command(current, {
            kind: "tend",
            actorId: "worker",
            buildingId: "conservatory",
          }).accepted,
        ).toBe(true);
        advanceSeconds(current, 10);
      }
      expect(restored.snapshot()).toEqual(sim.snapshot());
      expect(sim.actorById("conservatory")!.construction).toBeUndefined();
      expect(sim.economy!.cultivation!.lifebloom).toBe(0);
    } finally {
      restored.dispose();
    }
  } finally {
    sim.dispose();
  }
});

test("cancelling growth refunds Lifebloom once and frees its worker", () => {
  const { simulation: sim } = fixture();
  try {
    train(sim);
    expect(place(sim).accepted).toBe(true);
    expect(
      command(sim, { kind: "cancel-construction", actorId: "conservatory" })
        .accepted,
    ).toBe(true);
    expect(sim.economy!.cultivation!.lifebloom).toBe(100);
    expect(sim.economy!.materials).toBe(500);
    expect(sim.economy!.cultivation!.workers[0]).toMatchObject({
      phase: "idle",
    });
    expect(
      command(sim, { kind: "cancel-construction", actorId: "conservatory" })
        .accepted,
    ).toBe(false);
    expect(sim.economy!.cultivation!.lifebloom).toBe(100);
  } finally {
    sim.dispose();
  }
});

test("cultivation preserves cargo on interruption and delivers before changing sites", () => {
  const { simulation: sim, map } = opening();
  try {
    command(sim, { kind: "gather", actorId: "worker", siteId: "near" });
    untilSeconds(sim, () => sim.economy!.cultivation!.workers[0]!.cargo >= 5);
    const cargo = sim.economy!.cultivation!.workers[0]!.cargo;
    command(sim, {
      kind: "move",
      actorId: "worker",
      target: map.tileCenter(18, 10),
    });
    advanceSeconds(sim, 2);
    expect(sim.economy!.cultivation!.workers[0]).toMatchObject({
      cargo,
      phase: "idle",
    });
    expect(sim.economy!.cultivation!.workers[0]!.siteId).toBeUndefined();
    command(sim, { kind: "gather", actorId: "worker", siteId: "far" });
    expect(sim.economy!.cultivation!.workers[0]!.phase).toBe("returning");
    untilSeconds(sim, () => sim.economy!.cultivation!.lifebloom >= cargo);
    expect(sim.economy!.cultivation!.sites[1]!.reserve).toBe(100000);
    expect(sim.economy!.cultivation!.workers[0]!.siteId).toBe("far");
    sim.removeActor("conservatory");
    untilSeconds(
      sim,
      () => sim.economy!.cultivation!.workers[0]!.phase === "no-dropoff",
    );
    expect(sim.economy!.cultivation!.workers[0]!.cargo).toBe(30);
    advanceSeconds(sim, 2);
    expect(sim.economy!.cultivation!.workers[0]!.cargo).toBe(30);
  } finally {
    sim.dispose();
  }
});

test("shared reserves enter dormancy deterministically, retain Gather and its queue, then recover", () => {
  const state = exploredScenarioState(scenario, definitions);
  const site = state.economy!.cultivation!.sites[0]!;
  site.reserve = 10500;
  state.economy!.cultivation!.lifebloom = 500;
  const { simulation: sim, map } = fixture(state);
  try {
    for (const id of ["a", "b", "c", "d"]) train(sim, id);
    for (const id of ["a", "b", "c", "d"])
      command(sim, { kind: "gather", actorId: id, siteId: "near" });
    command(sim, {
      kind: "move",
      actorId: "a",
      target: map.tileCenter(25, 10),
      queued: true,
    });
    untilSeconds(sim, () => sim.economy!.cultivation!.sites[0]!.dormant);
    const dormant = sim.economy!.cultivation!.sites[0]!;
    expect(dormant.reserve).toBe(10000);
    expect(
      sim.economy!.cultivation!.workers.every(
        (worker) => worker.siteId === "near",
      ),
    ).toBe(true);
    expect(sim.actorById("a")!.orders).toHaveLength(1);
    const restored = fixture(saved(sim)).simulation;
    try {
      advanceSeconds(sim, 10);
      advanceSeconds(restored, 10);
      expect(restored.snapshot()).toEqual(sim.snapshot());
    } finally {
      restored.dispose();
    }
    expect(sim.actorById("a")!.orders).toHaveLength(1);
    // An explicit interruption releases the site while recovery continues.
    for (const id of ["a", "b", "c", "d"])
      command(sim, { kind: "stop", actorId: id });
    untilSeconds(sim, () => !sim.economy!.cultivation!.sites[0]!.dormant);
    expect(sim.economy!.cultivation!.sites[0]!.reserve).toBeGreaterThanOrEqual(
      60000,
    );
  } finally {
    sim.dispose();
  }
});

test("output curve has the agreed full, strained, and dormant values", () => {
  const site = createCultivationSite("site", "Site", { x: 0, z: 0 });
  expect(cultivationEfficiency(site)).toBe(1);
  site.reserve = 60000;
  expect(cultivationEfficiency(site)).toBe(1);
  site.reserve = 50000;
  expect(cultivationEfficiency(site)).toBe(0.9);
  site.reserve = 35000;
  expect(cultivationEfficiency(site)).toBe(0.75);
  site.reserve = 10001;
  expect(cultivationEfficiency(site)).toBeCloseTo(0.5);
  site.dormant = true;
  expect(cultivationEfficiency(site)).toBe(0);
});

test.each(["cancel", "remove"])(
  "%s growth stops its worker's automatic tending route",
  (action) => {
    const { simulation: sim } = fixture();
    try {
      train(sim);
      expect(place(sim, "growth", 20, 12).accepted).toBe(true);
      expect(sim.actorById("worker")!.movement).toBeDefined();
      if (action === "cancel")
        command(sim, { kind: "cancel-construction", actorId: "growth" });
      else sim.removeActor("growth");
      expect(sim.economy!.cultivation!.workers[0]!.phase).toBe("idle");
      expect(sim.actorById("worker")!.movement).toBeUndefined();
      const restored = fixture(saved(sim)).simulation;
      try {
        advanceSeconds(sim, 2);
        advanceSeconds(restored, 2);
        expect(restored.snapshot()).toEqual(sim.snapshot());
      } finally {
        restored.dispose();
      }
    } finally {
      sim.dispose();
    }
  },
);

test("single-worker growth yields blocked slots without preempting active work", () => {
  const state = exploredScenarioState(scenario, definitions);
  state.economy!.cultivation!.lifebloom = 2000;
  const { simulation: sim } = fixture(state);
  try {
    train(sim, "a");
    train(sim, "b");
    expect(place(sim, "first", 7, 7, "a").accepted).toBe(true);
    untilSeconds(sim, () => !!sim.actorById("first")!.construction?.active);
    expect(
      command(sim, { kind: "tend", actorId: "b", buildingId: "first" }),
    ).toMatchObject({ accepted: false, reason: "tender-occupied" });
    command(sim, { kind: "stop", actorId: "a" });
    const progress = sim.actorById("first")!.construction!.completedTicks;
    expect(place(sim, "second", 7, 11, "b").accepted).toBe(true);
    untilSeconds(sim, () => !!sim.actorById("second")!.construction?.active);
    command(sim, { kind: "tend", actorId: "a", buildingId: "first" });
    advanceSeconds(sim, 1);
    expect(sim.actorById("first")!.construction!.completedTicks).toBe(progress);
    expect(sim.actorById("second")!.construction?.active).toBe(true);
    untilSeconds(sim, () => !sim.actorById("second")!.construction);
    untilSeconds(sim, () => !!sim.actorById("first")!.construction?.active);
    sim.removeActor("a");
    expect(
      sim.economy!.cultivation!.workers.some(
        (worker) => worker.tendingId === "first",
      ),
    ).toBe(false);
    const paused = sim.actorById("first")!.construction!.completedTicks;
    advanceSeconds(sim, 2);
    expect(sim.actorById("first")!.construction!.completedTicks).toBe(paused);
    expect(
      command(sim, { kind: "tend", actorId: "b", buildingId: "first" })
        .accepted,
    ).toBe(true);
    untilSeconds(sim, () => !sim.actorById("first")!.construction);
    expect(sim.economy!.cultivation!.lifebloom).toBe(1700);
  } finally {
    sim.dispose();
  }
});

test("completed buildings operate without a Heartgrove while growth waits for reassignment", () => {
  const state = exploredScenarioState(scenario, definitions);
  state.economy!.cultivation!.lifebloom = 2000;
  const { simulation: sim, map } = fixture(state);
  try {
    train(sim);
    expect(
      place(sim, "muster", 8, 11, "worker", "circle-musterhall").accepted,
    ).toBe(true);
    untilSeconds(sim, () => !sim.actorById("muster")!.construction);
    expect(place(sim).accepted).toBe(true);
    untilSeconds(
      sim,
      () => !!sim.actorById("conservatory")!.construction?.active,
    );
    sim.removeActor("heart");
    const restored = fixture(saved(sim)).simulation;
    restored.dispose();
    const progress =
      sim.actorById("conservatory")!.construction!.completedTicks;
    advanceSeconds(sim, 2);
    expect(sim.actorById("conservatory")!.construction!.completedTicks).toBe(
      progress,
    );
    expect(
      command(sim, {
        kind: "train-unit",
        producerId: "muster",
        actorId: "sentinel",
        definitionId: "circle-sentinel",
      }).accepted,
    ).toBe(true);
    untilSeconds(sim, () => !!sim.actorById("sentinel"));
    // Scripted replacement isolates infrastructure reassignment from recovery rules.
    sim.spawnActor(
      createTilePlacedActor(
        map,
        definitions.find(({ id }) => id === "circle-heartgrove")!,
        { actorId: "replacement", origin: { x: 2, z: 6 } },
        "player",
      ),
    );
    untilSeconds(sim, () => !sim.actorById("conservatory")!.construction);
  } finally {
    sim.dispose();
  }
});

test("each Heartgrove supplies an independent growth slot", () => {
  const state = exploredScenarioState(scenario, definitions);
  state.economy!.cultivation!.lifebloom = 2000;
  const { simulation: sim, map } = fixture(state);
  try {
    sim.spawnActor(
      createTilePlacedActor(
        map,
        definitions.find(({ id }) => id === "circle-heartgrove")!,
        { actorId: "east-heart", origin: { x: 25, z: 12 } },
        "player",
      ),
    );
    train(sim, "a");
    train(sim, "b");
    expect(place(sim, "west", 7, 7, "a").accepted).toBe(true);
    expect(place(sim, "east", 20, 12, "b").accepted).toBe(true);
    untilSeconds(sim, () => !!sim.actorById("east")!.construction?.active);
    expect(sim.actorById("west")!.construction?.headquartersId).toBe("heart");
    expect(sim.actorById("east")!.construction?.headquartersId).toBe(
      "east-heart",
    );
    // Both affiliations remain stable through a save and continuation.
    const restored = fixture(saved(sim)).simulation;
    try {
      advanceSeconds(sim, 12);
      advanceSeconds(restored, 12);
      expect(restored.snapshot()).toEqual(sim.snapshot());
    } finally {
      restored.dispose();
    }
    expect(sim.actorById("east")!.construction).toBeUndefined();
    expect(sim.actorById("west")!.construction).toBeUndefined();
  } finally {
    sim.dispose();
  }
});

test("delivery uses the nearest reachable drop-off and restarts after an outage", () => {
  const { simulation: sim, map } = opening();
  try {
    command(sim, { kind: "gather", actorId: "worker", siteId: "near" });
    untilSeconds(sim, () => sim.economy!.cultivation!.workers[0]!.cargo === 30);
    sim.removeActor("conservatory");
    advanceSeconds(sim, 1);
    expect(sim.economy!.cultivation!.workers[0]!.phase).toBe("no-dropoff");
    const definition = definitions.find(
      ({ id }) => id === "circle-conservatory",
    )!;
    const near = createTilePlacedActor(
      map,
      definition,
      {
        actorId: "near-dropoff",
        origin: { x: 10, z: 6 },
      },
      "player",
    );
    sim.spawnActor(near);
    sim.spawnActor(
      createTilePlacedActor(
        map,
        definition,
        {
          actorId: "far-dropoff",
          origin: { x: 20, z: 9 },
        },
        "player",
      ),
    );
    command(sim, {
      kind: "terrain",
      tiles: adjacentTiles(map, occupiedTilesFor(near, definition)).map(
        (tile) => ({ ...tile, terrain: { typeId: "water" } }),
      ),
    });
    untilSeconds(sim, () => sim.economy!.cultivation!.lifebloom >= 30);
    expect(
      sim.buildingActivity.some(
        (activity) =>
          activity.buildingId === "far-dropoff" && activity.kind === "delivery",
      ),
    ).toBe(true);
    expect(sim.economy!.cultivation!.workers[0]!.cargo).toBe(0);
  } finally {
    sim.dispose();
  }
});

test("a blocked partial delivery retains queued orders and reroutes after drop-off loss", () => {
  const { simulation: original, map } = opening();
  let sim: MissionSimulation | undefined;
  try {
    command(original, { kind: "gather", actorId: "worker", siteId: "far" });
    untilSeconds(
      original,
      () => original.economy!.cultivation!.workers[0]!.cargo >= 5,
    );
    command(original, { kind: "stop", actorId: "worker" });
    command(original, { kind: "return-cargo", actorId: "worker" });
    const state = saved(original);
    const worker = state.economy!.cultivation!.workers[0]!;
    const cargo = worker.cargo;
    expect(cargo).toBeGreaterThan(0);
    expect(worker.dropoffId).toBe("conservatory");
    worker.phase = "blocked";
    const actor = state.actors.find(({ id }) => id === "worker")!;
    delete actor.movement;
    const destination = map.tileCenter(25, 12);
    actor.orders = [{ kind: "move", target: destination }];
    sim = fixture(state).simulation;
    sim.tick();
    expect(sim.actorById("worker")!.orders).toHaveLength(1);
    expect(sim.economy!.cultivation!.workers[0]!.phase).toBe("returning");
    expect(sim.actorById("worker")!.movement).toBeDefined();
    sim.removeActor("conservatory");
    expect(sim.actorById("worker")!.movement).toBeUndefined();
    const restored = fixture(saved(sim)).simulation;
    try {
      for (const current of [sim, restored]) {
        current.spawnActor(
          createTilePlacedActor(
            map,
            definitions.find(({ id }) => id === "circle-conservatory")!,
            { actorId: "replacement-dropoff", origin: { x: 18, z: 12 } },
            "player",
          ),
        );
        untilSeconds(
          current,
          () => current.economy!.cultivation!.lifebloom >= cargo,
        );
        current.tick();
        expect(current.actorById("worker")!.orders).toBeUndefined();
        expect(current.actorById("worker")!.movement!.target).toEqual(
          destination,
        );
        expect(current.economy!.cultivation!.workers[0]!.cargo).toBe(0);
      }
      expect(restored.snapshot()).toEqual(sim.snapshot());
    } finally {
      restored.dispose();
    }
  } finally {
    sim?.dispose();
    original.dispose();
  }
});

test("dormant workers keep assignments and resume automatically after recovery", () => {
  const state = exploredScenarioState(scenario, definitions);
  const site = state.economy!.cultivation!.sites[0]!;
  site.dormant = true;
  site.reserve = 10000;
  const { simulation: sim } = fixture(state);
  try {
    train(sim);
    command(sim, { kind: "gather", actorId: "worker", siteId: "near" });
    untilSeconds(
      sim,
      () => sim.economy!.cultivation!.workers[0]!.phase === "waiting",
    );
    expect(sim.economy!.cultivation!.workers[0]!.siteId).toBe("near");
    untilSeconds(sim, () => !sim.economy!.cultivation!.sites[0]!.dormant, 60);
    expect(sim.economy!.cultivation!.workers[0]!.phase).toBe("gathering");
    expect(sim.economy!.cultivation!.sites[0]!.reserve).toBeGreaterThan(59000);
    advanceSeconds(sim, 2);
    expect(sim.economy!.cultivation!.workers[0]!.cargo).toBeGreaterThan(0);
  } finally {
    sim.dispose();
  }
});

test.each([
  (state: MissionState) => {
    state.economy!.cultivation!.sites[0]!.reserve = -1;
  },
  (state: MissionState) => {
    state.economy!.cultivation!.sites[0]!.regenerationProgress = 99999;
  },
  (state: MissionState) => {
    state.economy!.cultivation!.sites[0]!.recoverAt = 0;
  },
  (state: MissionState) => {
    state.economy!.cultivation!.lifebloom = 0.5;
  },
])(
  "malformed cultivation state is rejected before publication (%#)",
  (change) => {
    const state = exploredScenarioState(scenario, definitions);
    change(state);
    expect(() => fixture(state)).toThrow("invalid cultivation state");
  },
);

test("placement selects the nearest reachable selected Cultivator without mutating navigation", () => {
  const state = exploredScenarioState(scenario, definitions);
  state.economy!.cultivation!.lifebloom = 1000;
  const { simulation: sim, map } = fixture(state);
  try {
    train(sim, "near-worker");
    train(sim, "far-worker");
    command(sim, {
      kind: "move",
      actorId: "far-worker",
      target: map.tileCenter(28, 10),
    });
    advanceSeconds(sim, 8);
    const version = map.navigationChanges.version;
    const evaluation = sim.evaluatePlacement({
      actorId: "growth",
      definitionId: "circle-conservatory",
      origin: { x: 10, z: 6 },
      workerIds: ["far-worker", "near-worker"],
    });
    expect(evaluation).toMatchObject({
      accepted: true,
      workerId: "near-worker",
    });
    expect(map.navigationChanges.version).toBe(version);
    expect(sim.actorById("growth")).toBeUndefined();
  } finally {
    sim.dispose();
  }
});

test("allied Heartgroves host growth until the alliance stops sharing them", () => {
  const state = exploredScenarioState(scenario, definitions);
  state.owners.push({ id: "ally", faction: "circle" });
  state.actors.find(({ id }) => id === "heart")!.owner = "ally";
  state.relationships.push({
    owners: ["player", "ally"],
    relationship: "allied",
    sharesHeadquarters: true,
  });
  const events: MissionEventDefinition[] = [
    {
      id: "end-sharing",
      trigger: { kind: "time", seconds: 4 },
      actions: [
        {
          kind: "set-relationship",
          owners: ["player", "ally"],
          relationship: "allied",
        },
      ],
    },
  ];
  const { simulation: sim, map } = fixture(state, events);
  try {
    sim.spawnActor(
      createActor({
        id: "worker",
        definitionId: "circle-cultivator",
        owner: "player",
        worldPosition: map.tileCenter(8, 9),
      }),
    );
    expect(place(sim).accepted).toBe(true);
    const construction = () => sim.actorById("conservatory")!.construction!;
    untilSeconds(sim, () => construction().completedTicks > 0, 3.5);
    expect(construction().headquartersId).toBe("heart");
    untilSeconds(sim, () => sim.snapshot().firedEvents.length > 0, 4);
    // The revoked queue reassigns on the next tick; saves load meanwhile.
    expect(construction().headquartersId).toBe("heart");
    fixture(saved(sim), events).simulation.dispose();
    sim.tick();
    const paused = construction();
    expect(paused.headquartersId).toBeUndefined();
    expect(paused.active).toBeUndefined();
    advanceSeconds(sim, 2);
    expect(construction()).toEqual(paused);
    sim.spawnActor(
      createTilePlacedActor(
        map,
        definitions.find(({ id }) => id === "circle-heartgrove")!,
        { actorId: "own-heart", origin: { x: 2, z: 13 } },
        "player",
      ),
    );
    sim.tick();
    expect(construction()).toMatchObject({
      headquartersId: "own-heart",
      active: true,
      completedTicks: paused.completedTicks + 1,
      paidCost: paused.paidCost,
    });
  } finally {
    sim.dispose();
  }
});

test.each(["tending", "returning"] as const)(
  "loading rejects another owner's saved %s assignment",
  (phase) => {
    const { simulation: sim } = fixture();
    try {
      train(sim);
      expect(place(sim).accepted).toBe(true);
      const state = saved(sim);
      state.owners.push({ id: "other", faction: "circle" });
      const worker = state.economy!.cultivation!.workers[0]!;
      const building = state.actors.find(({ id }) => id === "conservatory")!;
      building.owner = "other";
      if (phase === "returning") {
        delete building.construction;
        delete worker.tendingId;
        worker.dropoffId = "conservatory";
        worker.cargo = 1;
        worker.phase = "returning";
      }
      expect(() => fixture(state)).toThrow("invalid cultivation state");
    } finally {
      sim.dispose();
    }
  },
);
