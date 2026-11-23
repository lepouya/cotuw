import { afterEach, expect, test } from "vitest";

import { BASE_CONTENT } from "./helpers/content";
import {
  actorIn,
  advanceSeconds,
  balance,
  command,
  deposited,
  exploredScenarioState,
  playerOwners,
  savedState,
  setBalance,
  spawnUnit,
  startMission,
  stockpiles,
  untilSeconds,
} from "./helpers/scenario";
import {
  createTilePlacedActor,
  adjacentTiles,
  isTilePlacedActor,
  occupiedTilesFor,
} from "../src/simulation/placement";
import {
  createCultivationSite,
  cultivationEfficiency,
} from "../src/simulation/cultivation";
import { TerrainGrid } from "../src/simulation/terrain";
import { blockedWorkerIds, idleWorkerIds } from "../src/simulation/economy";
import { RESOURCE_SCALE } from "../src/simulation/resources";
import { defineScenario } from "../src/simulation/scenario";

import type {
  MissionState,
  MissionSimulation,
  MissionSimulationOptions,
} from "../src/simulation/mission";
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
  stockpiles: [...stockpiles(500), ...stockpiles(150, "lifebloom")],
  sites: [],
  loot: [],
  cultivation: {
    sites: [
      createCultivationSite(
        "near",
        "Near Lifebloom",
        { x: 14, z: 6 },
        BASE_CONTENT.cultivationSite,
      ),
      createCultivationSite(
        "far",
        "Far Lifebloom",
        { x: 23, z: 6 },
        BASE_CONTENT.cultivationSite,
      ),
    ],
  },
});
const missions: MissionSimulation[] = [];
afterEach(() => {
  for (const mission of missions.splice(0)) mission.dispose();
});
function fixture(
  state?: MissionState,
  options: Pick<
    MissionSimulationOptions,
    "events" | "emergencyHeadquarters"
  > = {},
) {
  const mission = startMission(new TerrainGrid(terrainOptions), {
    state: state ?? exploredScenarioState(scenario, definitions),
    ...options,
    definitions,
    tickSeconds: 0.1,
  });
  missions.push(mission.simulation);
  return mission;
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

test("paid opening trains its worker, tends a drop-off, cultivates, and funds production", () => {
  const { simulation: sim } = opening();
  expect(balance(sim, "lifebloom")).toBe(0);
  expect(balance(sim)).toBe(500);
  expect(
    command(sim, { kind: "gather", actorId: "worker", siteId: "near" })
      .accepted,
  ).toBe(true);
  untilSeconds(sim, () => balance(sim, "lifebloom") >= 120);
  expect(
    place(sim, "muster", 8, 10, "worker", "circle-musterhall").accepted,
  ).toBe(true);
  untilSeconds(sim, () => !sim.actorById("muster")!.construction);
  expect(
    command(sim, { kind: "gather", actorId: "worker", siteId: "near" })
      .accepted,
  ).toBe(true);
  untilSeconds(sim, () => balance(sim, "lifebloom") >= 55);
  for (const [id, definitionId] of [
    ["sentinel", "circle-sentinel"],
    ["wayfinder", "circle-wayfinder"],
  ] as const)
    expect(
      command(sim, {
        kind: "train-unit",
        actorId: id,
        definitionId,
        producerId: "muster",
      }).accepted,
    ).toBe(true);
  untilSeconds(sim, () => !!sim.actorById("wayfinder"));
  expect(sim.actorById("sentinel")).toBeDefined();
  expect(sim.economy!.cultivation!.sites[0]!.reserve).toBeGreaterThanOrEqual(
    99000,
  );
  expect(balance(sim)).toBe(500);
});

test("growth requires a selected worker, pauses without losing progress, and resumes manually", () => {
  const { simulation: sim } = fixture();
  expect(
    sim.viewOf(sim.playerOwner).evaluatePlacement({
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
      (sim.actorById("conservatory")!.construction?.completedTicks ?? 0) >= 10,
  );
  expect(command(sim, { kind: "stop", actorId: "worker" }).accepted).toBe(true);
  const progress = sim.actorById("conservatory")!.construction!.completedTicks;
  advanceSeconds(sim, 2);
  expect(sim.actorById("conservatory")!.construction!.completedTicks).toBe(
    progress,
  );
  const restored = fixture(savedState(scenario, sim)).simulation;
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
  expect(balance(sim, "lifebloom")).toBe(0);
});

test("cancelling growth refunds Lifebloom once and frees its worker", () => {
  const { simulation: sim } = fixture();
  train(sim);
  expect(place(sim).accepted).toBe(true);
  expect(
    command(sim, { kind: "cancel-construction", actorId: "conservatory" })
      .accepted,
  ).toBe(true);
  expect(balance(sim, "lifebloom")).toBe(100);
  expect(balance(sim)).toBe(500);
  expect(sim.economy!.cultivation!.workers[0]).toMatchObject({
    phase: "idle",
  });
  expect(
    command(sim, { kind: "cancel-construction", actorId: "conservatory" })
      .accepted,
  ).toBe(false);
  expect(balance(sim, "lifebloom")).toBe(100);
});

test("cultivation preserves cargo on interruption and delivers before changing sites", () => {
  const { simulation: sim, map } = opening();
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
  expect(idleWorkerIds(sim.economy, sim.actorById)).toEqual(["worker"]);
  command(sim, { kind: "gather", actorId: "worker", siteId: "far" });
  expect(sim.economy!.cultivation!.workers[0]!.phase).toBe("returning");
  untilSeconds(sim, () => balance(sim, "lifebloom") >= cargo);
  expect(sim.economy!.cultivation!.sites[1]!.reserve).toBe(100000);
  expect(sim.economy!.cultivation!.workers[0]!.siteId).toBe("far");
  sim.removeActor("conservatory");
  untilSeconds(
    sim,
    () => sim.economy!.cultivation!.workers[0]!.phase === "no-dropoff",
  );
  expect(sim.economy!.cultivation!.workers[0]!.cargo).toBe(30);
  expect(idleWorkerIds(sim.economy, sim.actorById)).toEqual([]);
  advanceSeconds(sim, 2);
  expect(sim.economy!.cultivation!.workers[0]!.cargo).toBe(30);
});

test("shared reserves enter dormancy deterministically, retain Gather and its queue, then recover", () => {
  const state = exploredScenarioState(scenario, definitions);
  const site = state.economy!.cultivation!.sites[0]!;
  site.reserve = 10500;
  setBalance(state, 500, "lifebloom");
  const { simulation: sim, map } = fixture(state);
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
  const restored = fixture(savedState(scenario, sim)).simulation;
  advanceSeconds(sim, 10);
  advanceSeconds(restored, 10);
  expect(restored.snapshot()).toEqual(sim.snapshot());

  expect(sim.actorById("a")!.orders).toHaveLength(1);
  // An explicit interruption releases the site while recovery continues.
  for (const id of ["a", "b", "c", "d"])
    command(sim, { kind: "stop", actorId: id });
  untilSeconds(sim, () => !sim.economy!.cultivation!.sites[0]!.dormant);
  expect(sim.economy!.cultivation!.sites[0]!.reserve).toBeGreaterThanOrEqual(
    60000,
  );
});

test("output curve has the agreed full, strained, and dormant values", () => {
  const site = createCultivationSite(
    "site",
    "Site",
    { x: 0, z: 0 },
    BASE_CONTENT.cultivationSite,
  );
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
    train(sim);
    expect(place(sim, "growth", 20, 12).accepted).toBe(true);
    expect(sim.actorById("worker")!.movement).toBeDefined();
    if (action === "cancel")
      command(sim, { kind: "cancel-construction", actorId: "growth" });
    else sim.removeActor("growth");
    expect(sim.economy!.cultivation!.workers[0]!.phase).toBe("idle");
    expect(sim.actorById("worker")!.movement).toBeUndefined();
    const restored = fixture(savedState(scenario, sim)).simulation;
    advanceSeconds(sim, 2);
    advanceSeconds(restored, 2);
    expect(restored.snapshot()).toEqual(sim.snapshot());
  },
);

test("single-worker growth yields blocked slots without preempting active work", () => {
  const state = exploredScenarioState(scenario, definitions);
  setBalance(state, 2000, "lifebloom");
  const { simulation: sim } = fixture(state);
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
  expect(idleWorkerIds(sim.economy, sim.actorById)).toEqual([]);
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
    command(sim, { kind: "tend", actorId: "b", buildingId: "first" }).accepted,
  ).toBe(true);
  untilSeconds(sim, () => !sim.actorById("first")!.construction);
  expect(balance(sim, "lifebloom")).toBe(1700);
});

test("tending reports an unreachable entrance and resumes when it opens", () => {
  const { simulation: sim, map } = fixture();
  train(sim);
  expect(place(sim).accepted).toBe(true);
  const building = sim.actorById("conservatory")!;
  const definition = definitions.find(
    ({ id }) => id === building.definitionId,
  )!;
  if (!isTilePlacedActor(building)) throw new Error("Expected placed growth");
  const entrances = adjacentTiles(map, occupiedTilesFor(building, definition));
  const changeEntrances = (current: MissionSimulation, typeId: string) =>
    command(
      current,
      {
        kind: "terrain",
        tiles: entrances.map((tile) => ({ ...tile, terrain: { typeId } })),
      },
      { script: true },
    );
  expect(changeEntrances(sim, "water").accepted).toBe(true);
  untilSeconds(sim, () => workerOf(sim).tendingBlocked === true);
  expect(workerOf(sim)).toMatchObject({
    phase: "tending",
    tendingId: "conservatory",
    tendingBlocked: true,
  });
  expect(idleWorkerIds(sim.economy, sim.actorById)).toEqual([]);
  expect(blockedWorkerIds(sim.economy, sim.actorById)).toEqual([
    workerOf(sim).actorId,
  ]);

  const restored = fixture(savedState(scenario, sim)).simulation;
  for (const current of [sim, restored]) {
    expect(changeEntrances(current, "plain").accepted).toBe(true);
    untilSeconds(
      current,
      () => !!current.actorById("conservatory")!.construction?.active,
    );
    expect(workerOf(current).tendingBlocked).toBeUndefined();
    expect(blockedWorkerIds(current.economy, current.actorById)).toEqual([]);
  }
  expect(restored.snapshot()).toEqual(sim.snapshot());
});

test("completed buildings operate without a Heartgrove while growth waits for reassignment", () => {
  const state = exploredScenarioState(scenario, definitions);
  setBalance(state, 2000, "lifebloom");
  const { simulation: sim, map } = fixture(state);
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
  fixture(savedState(scenario, sim));
  const progress = sim.actorById("conservatory")!.construction!.completedTicks;
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
});

test("each Heartgrove supplies an independent growth slot", () => {
  const state = exploredScenarioState(scenario, definitions);
  setBalance(state, 2000, "lifebloom");
  const { simulation: sim, map } = fixture(state);
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
  expect(sim.actorById("west")!.headquartersId).toBe("heart");
  expect(sim.actorById("east")!.headquartersId).toBe("east-heart");
  // Both affiliations remain stable through a save and continuation.
  const restored = fixture(savedState(scenario, sim)).simulation;
  advanceSeconds(sim, 12);
  advanceSeconds(restored, 12);
  expect(restored.snapshot()).toEqual(sim.snapshot());

  expect(sim.actorById("east")!.construction).toBeUndefined();
  expect(sim.actorById("west")!.construction).toBeUndefined();
  expect(sim.actorById("west")!.headquartersId).toBe("heart");
  expect(sim.actorById("east")!.headquartersId).toBe("east-heart");
});

test("delivery uses the nearest reachable drop-off and restarts after an outage", () => {
  const { simulation: sim, map } = opening();
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
  command(
    sim,
    {
      kind: "terrain",
      tiles: adjacentTiles(map, occupiedTilesFor(near, definition)).map(
        (tile) => ({ ...tile, terrain: { typeId: "water" } }),
      ),
    },
    { script: true },
  );
  untilSeconds(sim, () => balance(sim, "lifebloom") >= 30);
  expect(
    sim.buildingActivity.some(
      (activity) =>
        activity.buildingId === "far-dropoff" && activity.kind === "delivery",
    ),
  ).toBe(true);
  expect(sim.economy!.cultivation!.workers[0]!.cargo).toBe(0);
});

test("a blocked partial delivery retains queued orders and reroutes after drop-off loss", () => {
  const { simulation: original, map } = opening();
  let sim: MissionSimulation | undefined;
  command(original, { kind: "gather", actorId: "worker", siteId: "far" });
  untilSeconds(
    original,
    () => original.economy!.cultivation!.workers[0]!.cargo >= 5,
  );
  command(original, { kind: "stop", actorId: "worker" });
  command(original, { kind: "return-cargo", actorId: "worker" });
  const state = savedState(scenario, original);
  const worker = state.economy!.cultivation!.workers[0]!;
  const cargo = worker.cargo;
  expect(cargo).toBeGreaterThan(0);
  expect(worker.dropoffId).toBe("conservatory");
  worker.phase = "blocked";
  const actor = actorIn(state, "worker");
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
  const restored = fixture(savedState(scenario, sim)).simulation;
  for (const current of [sim, restored]) {
    current.spawnActor(
      createTilePlacedActor(
        map,
        definitions.find(({ id }) => id === "circle-conservatory")!,
        { actorId: "replacement-dropoff", origin: { x: 18, z: 12 } },
        "player",
      ),
    );
    untilSeconds(current, () => balance(current, "lifebloom") >= cargo);
    current.tick();
    expect(current.actorById("worker")!.orders).toBeUndefined();
    expect(current.actorById("worker")!.movement!.target).toEqual(destination);
    expect(current.economy!.cultivation!.workers[0]!.cargo).toBe(0);
  }
  expect(restored.snapshot()).toEqual(sim.snapshot());
});

test("dormant workers keep assignments and resume automatically after recovery", () => {
  const state = exploredScenarioState(scenario, definitions);
  const site = state.economy!.cultivation!.sites[0]!;
  site.dormant = true;
  site.reserve = 10000;
  const { simulation: sim } = fixture(state);
  train(sim);
  command(sim, { kind: "gather", actorId: "worker", siteId: "near" });
  untilSeconds(
    sim,
    () => sim.economy!.cultivation!.workers[0]!.phase === "waiting",
  );
  expect(sim.economy!.cultivation!.workers[0]!.siteId).toBe("near");
  expect(idleWorkerIds(sim.economy, sim.actorById)).toEqual([]);
  untilSeconds(sim, () => !sim.economy!.cultivation!.sites[0]!.dormant, 60);
  expect(sim.economy!.cultivation!.workers[0]!.phase).toBe("gathering");
  expect(sim.economy!.cultivation!.sites[0]!.reserve).toBeGreaterThan(59000);
  advanceSeconds(sim, 2);
  expect(sim.economy!.cultivation!.workers[0]!.cargo).toBeGreaterThan(0);
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
])(
  "malformed cultivation state is rejected before publication (%#)",
  (change) => {
    const state = exploredScenarioState(scenario, definitions);
    change(state);
    expect(() => fixture(state)).toThrow("invalid cultivation state");
  },
);

test("placement rejects another owner's workers before spending or assigning work", () => {
  const state = exploredScenarioState(scenario, definitions);
  state.owners.push({ id: "rival", faction: "circle" });
  setBalance(state, 1000, "lifebloom");
  const { simulation: sim, map } = fixture(state);
  train(sim);
  spawnUnit(
    sim,
    "rival-worker",
    "circle-cultivator",
    map.tileCenter(13, 10),
    "rival",
  );
  const before = balance(sim, "lifebloom");
  const placement = {
    kind: "place-actor" as const,
    actorId: "growth",
    definitionId: "circle-conservatory",
    origin: { x: 10, z: 6 },
    workerIds: ["worker", "rival-worker"],
  };
  expect(command(sim, placement)).toMatchObject({
    accepted: false,
    reason: "unauthorized",
  });
  expect(balance(sim, "lifebloom")).toBe(before);
  expect(sim.actorById("growth")).toBeUndefined();
  expect(
    sim.economy!.cultivation!.workers.every((worker) => !worker.tendingId),
  ).toBe(true);
  expect(command(sim, { ...placement, workerIds: ["worker"] }).accepted).toBe(
    true,
  );
  expect(sim.actorById("growth")!.owner).toBe("player");
});

test("placement selects the nearest reachable selected Cultivator without mutating navigation", () => {
  const state = exploredScenarioState(scenario, definitions);
  setBalance(state, 1000, "lifebloom");
  const { simulation: sim, map } = fixture(state);
  train(sim, "near-worker");
  train(sim, "far-worker");
  command(sim, {
    kind: "move",
    actorId: "far-worker",
    target: map.tileCenter(28, 10),
  });
  advanceSeconds(sim, 8);
  const version = map.navigationChanges.version;
  const evaluation = sim.viewOf(sim.playerOwner).evaluatePlacement({
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
});

test("allied Heartgroves host growth until the alliance stops sharing them", () => {
  const state = exploredScenarioState(scenario, definitions);
  state.owners.push({ id: "ally", faction: "circle" });
  actorIn(state, "heart").owner = "ally";
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
  const { simulation: sim, map } = fixture(state, { events });
  spawnUnit(sim, "worker", "circle-cultivator", map.tileCenter(8, 9));
  expect(place(sim).accepted).toBe(true);
  const construction = () => sim.actorById("conservatory")!.construction!;
  untilSeconds(sim, () => construction().completedTicks > 0, 3.5);
  expect(sim.actorById("conservatory")!.headquartersId).toBe("heart");
  untilSeconds(sim, () => sim.snapshot().firedEvents.length > 0, 4);
  // The revoked queue reassigns on the next tick; saves load meanwhile.
  expect(sim.actorById("conservatory")!.headquartersId).toBe("heart");
  fixture(savedState(scenario, sim), { events });
  sim.tick();
  const paused = construction();
  expect(sim.actorById("conservatory")!.headquartersId).toBeUndefined();
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
  expect(sim.actorById("conservatory")!).toMatchObject({
    headquartersId: "own-heart",
    construction: {
      active: true,
      completedTicks: paused.completedTicks + 1,
      paidCost: paused.paidCost,
    },
  });
});

test.each(["tending", "returning"] as const)(
  "loading rejects another owner's saved %s assignment",
  (phase) => {
    const { simulation: sim } = fixture();
    train(sim);
    expect(place(sim).accepted).toBe(true);
    const state = savedState(scenario, sim);
    state.owners.push({ id: "other", faction: "circle" });
    const worker = state.economy!.cultivation!.workers[0]!;
    const building = actorIn(state, "conservatory");
    building.owner = "other";
    if (phase === "returning") {
      delete building.construction;
      delete worker.tendingId;
      worker.dropoffId = "conservatory";
      worker.cargo = 1;
      worker.cargoSources = [
        { siteId: state.economy!.cultivation!.sites[0]!.id, amount: 1000 },
      ];
      worker.phase = "returning";
    }
    expect(() => fixture(state)).toThrow("invalid cultivation state");
  },
);

test.each([false, true])(
  "a tended replacement Heartgrove grows without capacity only under the emergency rule (%s)",
  (emergencyHeadquarters) => {
    const state = exploredScenarioState(scenario, definitions);
    setBalance(state, 1000, "lifebloom");
    const { simulation: sim } = fixture(state, { emergencyHeadquarters });
    train(sim);
    sim.removeActor("heart");
    const outcome = place(
      sim,
      "new-heart",
      8,
      10,
      "worker",
      "circle-heartgrove",
    );
    if (!emergencyHeadquarters) {
      expect(outcome).toMatchObject({
        accepted: false,
        reason: "missing-headquarters",
      });
      return;
    }
    expect(outcome.accepted).toBe(true);
    untilSeconds(sim, () => !!sim.actorById("new-heart")!.construction?.active);
    expect(sim.actorById("new-heart")!.headquartersId).toBeUndefined();
    untilSeconds(sim, () => !sim.actorById("new-heart")!.construction, 30);
  },
);

const reserveOf = (sim: MissionSimulation, siteId = "near") =>
  sim.economy!.cultivation!.sites.find(({ id }) => id === siteId)!;
const workerOf = (sim: MissionSimulation, actorId = "worker") =>
  sim.economy!.cultivation!.workers.find(
    (worker) => worker.actorId === actorId,
  )!;
/** Resource thousandths a worker holds, including its fractional remainder. */
const held = (sim: MissionSimulation, actorId = "worker") =>
  workerOf(sim, actorId).cargo * RESOURCE_SCALE +
  workerOf(sim, actorId).gatherProgress;
function spawnDropoff(
  sim: MissionSimulation,
  map: TerrainGrid,
  actorId: string,
  origin: { x: number; z: number },
) {
  sim.spawnActor(
    createTilePlacedActor(
      map,
      definitions.find(({ id }) => id === "circle-conservatory")!,
      { actorId, origin },
      "player",
    ),
  );
}

test("gathering slows with the reserve without changing what is drawn", () => {
  const drawn = (initial: number) => {
    const state = exploredScenarioState(scenario, definitions);
    Object.assign(state.economy!.cultivation!.sites[0]!, {
      reserve: initial,
      regeneration: 0,
    });
    const { simulation: sim } = fixture(state);
    train(sim);
    command(sim, { kind: "gather", actorId: "worker", siteId: "near" });
    untilSeconds(sim, () => workerOf(sim).phase === "gathering");
    const reserve = reserveOf(sim).reserve;
    const cargo = held(sim);
    advanceSeconds(sim, 10);
    // The worker holds exactly what the site lost.
    expect(reserve - reserveOf(sim).reserve).toBe(held(sim) - cargo);
    return held(sim) - cargo;
  };
  expect(drawn(100000)).toBe(10000);
  // Efficiency falls from 75% at 35% reserve as the worker draws it down.
  const strained = drawn(35000);
  expect(strained).toBeGreaterThan(7000);
  expect(strained).toBeLessThan(7500);
});

test("active regeneration sustains one worker while two drain the site", () => {
  const lowest = (workers: string[]) => {
    const state = exploredScenarioState(scenario, definitions);
    setBalance(state, 500, "lifebloom");
    const { simulation: sim } = fixture(state);
    for (const id of workers) train(sim, id);
    expect(place(sim, "conservatory", 10, 6, workers[0]).accepted).toBe(true);
    untilSeconds(sim, () => !sim.actorById("conservatory")!.construction);
    for (const id of workers)
      command(sim, { kind: "gather", actorId: id, siteId: "near" });
    let minimum = reserveOf(sim).reserve;
    for (let tick = 0; tick < 1800; tick++) {
      sim.tick();
      minimum = Math.min(minimum, reserveOf(sim).reserve);
    }
    // Each worker delivers at least two full loads.
    expect(deposited(sim, "lifebloom")).toBeGreaterThanOrEqual(
      60 * workers.length,
    );
    return minimum;
  };
  expect(lowest(["worker"])).toBeGreaterThanOrEqual(99000);
  expect(lowest(["a", "b"])).toBeLessThan(90000);
});

test("dormancy reopens after exactly 50 seconds and waiting workers resume", () => {
  const state = exploredScenarioState(scenario, definitions);
  state.economy!.cultivation!.sites[0]!.reserve = 10500;
  setBalance(state, 500, "lifebloom");
  const { simulation: sim } = fixture(state);
  const ids = ["a", "b", "c", "d"];
  for (const id of ids) train(sim, id);
  expect(place(sim, "conservatory", 10, 6, "a").accepted).toBe(true);
  untilSeconds(sim, () => !sim.actorById("conservatory")!.construction);
  for (const id of ids)
    command(sim, { kind: "gather", actorId: id, siteId: "near" });
  untilSeconds(sim, () => reserveOf(sim).dormant);
  expect(reserveOf(sim).reserve).toBe(10000);
  let ticks = 0;
  let waiting: string[] = [];
  while (reserveOf(sim).dormant && ticks * sim.tickSeconds <= 50) {
    waiting = ids.filter((id) => workerOf(sim, id).phase === "waiting");
    sim.tick();
    ticks++;
  }
  expect(reserveOf(sim).dormant).toBe(false);
  expect(ticks * sim.tickSeconds).toBeCloseTo(50);
  expect(waiting.length).toBeGreaterThan(0);
  for (const id of ids)
    expect(workerOf(sim, id)).toMatchObject({ siteId: "near" });
  // Waiting workers resume on the tick the site reopens.
  for (const id of waiting)
    expect(workerOf(sim, id)).toMatchObject({ phase: "gathering" });
});

test("a site entering dormancy sends partial cargo home before waiting there", () => {
  const { simulation: first, map } = opening();
  command(first, { kind: "gather", actorId: "worker", siteId: "far" });
  untilSeconds(first, () => workerOf(first).cargo >= 5);
  const state = savedState(scenario, first);
  Object.assign(state.economy!.cultivation!.sites[1]!, {
    reserve: 10000,
    dormant: true,
  });
  const sim = fixture(state).simulation;
  const cargo = workerOf(sim).cargo;
  sim.tick();
  expect(workerOf(sim)).toMatchObject({ phase: "returning", siteId: "far" });
  untilSeconds(sim, () => workerOf(sim).phase === "waiting");
  expect(workerOf(sim).cargo).toBe(0);
  expect(balance(sim, "lifebloom")).toBe(cargo);
  const site = map.tileCenter(23, 6);
  const { worldPosition } = sim.actorById("worker")!;
  expect(
    Math.hypot(worldPosition.x - site.x, worldPosition.z - site.z),
  ).toBeLessThanOrEqual(0.75);
});

test.each(["stop", "construction"] as const)(
  "a %s order keeps cargo without a delivery detour",
  (order) => {
    const state = exploredScenarioState(scenario, definitions);
    setBalance(state, 1000, "lifebloom");
    const { simulation: sim } = fixture(state);
    train(sim);
    expect(place(sim).accepted).toBe(true);
    untilSeconds(sim, () => !sim.actorById("conservatory")!.construction);
    command(sim, { kind: "gather", actorId: "worker", siteId: "far" });
    untilSeconds(sim, () => workerOf(sim).cargo >= 5);
    const cargo = workerOf(sim).cargo;
    const funds = balance(sim, "lifebloom");
    if (order === "stop") {
      command(sim, { kind: "stop", actorId: "worker" });
      expect(sim.actorById("worker")!.movement).toBeUndefined();
    } else
      expect(
        place(sim, "muster", 25, 11, "worker", "circle-musterhall").accepted,
      ).toBe(true);
    expect(workerOf(sim).dropoffId).toBeUndefined();
    advanceSeconds(sim, 20);
    expect(workerOf(sim).cargo).toBe(cargo);
    const musterhall = definitions.find(
      ({ id }) => id === "circle-musterhall",
    )!;
    expect(balance(sim, "lifebloom")).toBe(
      order === "stop" ? funds : funds - musterhall.lifebloomCost!,
    );
    expect(sim.buildingActivity.some(({ kind }) => kind === "delivery")).toBe(
      false,
    );
    if (order === "construction")
      expect(sim.actorById("muster")!.construction).toBeUndefined();
    expect(workerOf(sim).phase).toBe("idle");
  },
);

test("delivery ignores another owner's nearer Conservatory", () => {
  const state = exploredScenarioState(scenario, definitions);
  state.owners.push({ id: "other", faction: "circle" });
  const { simulation: first, map } = fixture(state);
  train(first);
  spawnDropoff(first, map, "mine", { x: 4, z: 12 });
  spawnDropoff(first, map, "theirs", { x: 17, z: 9 });
  const saved = savedState(scenario, first);
  actorIn(saved, "theirs").owner = "other";
  const sim = fixture(saved).simulation;
  command(sim, { kind: "gather", actorId: "worker", siteId: "near" });
  untilSeconds(sim, () => workerOf(sim).phase === "returning");
  sim.tick();
  expect(workerOf(sim).dropoffId).toBe("mine");
  untilSeconds(sim, () => balance(sim, "lifebloom") >= 180);
});

test.each([
  ["a river", "upstream"],
  ["open ground", "across"],
] as const)(
  "delivery takes the shortest walk across %s",
  (ground, expected) => {
    const { simulation: sim, map } = fixture();
    train(sim);
    // The river leaves one ford at its east end.
    if (ground === "a river")
      expect(
        command(
          sim,
          {
            kind: "terrain",
            tiles: Array.from({ length: 29 }, (_, x) =>
              [10, 11].map((z) => ({ x, z, terrain: { typeId: "water" } })),
            ).flat(),
          },
          { script: true },
        ).accepted,
      ).toBe(true);
    // Across is nearer in a straight line.
    spawnDropoff(sim, map, "across", { x: 13, z: 12 });
    spawnDropoff(sim, map, "upstream", { x: 24, z: 3 });
    command(sim, { kind: "gather", actorId: "worker", siteId: "near" });
    untilSeconds(sim, () => workerOf(sim).phase === "returning");
    expect(workerOf(sim).dropoffId).toBe(expected);
    untilSeconds(sim, () => workerOf(sim).cargo === 0);
    expect(
      sim.buildingActivity.some(
        (activity) =>
          activity.buildingId === expected && activity.kind === "delivery",
      ),
    ).toBe(true);
  },
);

test("simultaneous workers stop at the threshold in worker-ID order and continue identically", () => {
  const state = exploredScenarioState(scenario, definitions);
  setBalance(state, 500, "lifebloom");
  const { simulation: first, map } = fixture(state);
  const ids = ["a", "b", "c", "d"];
  for (const id of ids) train(first, id);
  for (const id of ids)
    command(first, { kind: "gather", actorId: id, siteId: "near" });
  untilSeconds(first, () =>
    ids.every((id) => workerOf(first, id).phase === "gathering"),
  );
  const saved = savedState(scenario, first);
  // Leaves less than one tick of draw for the four workers.
  Object.assign(saved.economy!.cultivation!.sites[0]!, {
    reserve: 10070,
    regeneration: 0,
  });
  for (const worker of saved.economy!.cultivation!.workers) {
    const actor = actorIn(saved, worker.actorId);
    actor.worldPosition = map.tileCenter(14, 6);
    delete actor.movement;
    worker.cargo = 0;
    worker.gatherProgress = 0;
    worker.rateProgress = 0;
    delete worker.cargoSources;
  }
  const reversed = structuredClone(saved);
  reversed.economy!.cultivation!.workers.reverse();
  const runs = [saved, reversed].map((state) => {
    const sim = fixture(state).simulation;
    const before = ids.map((id) => held(sim, id));
    sim.tick();
    expect(reserveOf(sim)).toMatchObject({ reserve: 10000, dormant: true });
    return {
      sim,
      drawn: ids.map((id, index) => held(sim, id) - before[index]!),
    };
  });
  const [firstRun, secondRun] = runs;
  const { drawn } = firstRun!;
  expect(secondRun!.drawn).toEqual(drawn);
  // The lowest ID draws its full share before later workers.
  expect(drawn).toEqual([50, 20, 0, 0]);
  const restored = fixture(savedState(scenario, runs[0]!.sim)).simulation;
  advanceSeconds(runs[0]!.sim, 20);
  advanceSeconds(restored, 20);
  expect(restored.snapshot()).toEqual(runs[0]!.sim.snapshot());
});

test("cultivation waits for a reachable site even inside its arrival radius", () => {
  const { simulation: first, map } = fixture();
  train(first);
  const state = savedState(scenario, first);
  const target = map.tileCenter(14, 6);
  actorIn(state, "worker").worldPosition = { ...target, x: target.x - 0.6 };
  const { simulation: sim } = fixture(state);
  const changeSite = (typeId: string) =>
    command(
      sim,
      { kind: "terrain", tiles: [{ x: 14, z: 6, terrain: { typeId } }] },
      { script: true },
    );
  expect(changeSite("water").accepted).toBe(true);
  expect(
    command(sim, { kind: "gather", actorId: "worker", siteId: "near" })
      .accepted,
  ).toBe(true);
  expect(workerOf(sim).phase).toBe("blocked");
  expect(held(sim)).toBe(0);
  expect(changeSite("plain").accepted).toBe(true);
  expect(workerOf(sim).phase).toBe("gathering");
  expect(held(sim)).toBeGreaterThan(0);
});

test("equal-cost deliveries choose the lower building ID", () => {
  const { simulation: first, map } = fixture();
  train(first);
  spawnDropoff(first, map, "z-dropoff", { x: 13, z: 10 });
  spawnDropoff(first, map, "a-dropoff", { x: 13, z: 1 });
  const state = savedState(scenario, first);
  // Both footprints offer a straight, three-tile walk to an entrance.
  const worker = actorIn(state, "worker");
  worker.worldPosition = map.tileCenter(14, 6);
  const sim = fixture(state).simulation;
  command(sim, { kind: "gather", actorId: "worker", siteId: "near" });
  untilSeconds(sim, () => workerOf(sim).phase === "returning");
  expect(workerOf(sim).dropoffId).toBe("a-dropoff");
});
