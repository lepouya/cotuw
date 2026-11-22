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
  startMission,
  stockpiles,
  untilSeconds,
} from "./helpers/scenario";
import { createActor } from "../src/simulation/actor";
import { createCultivationSite } from "../src/simulation/cultivation";
import { createTilePlacedActor } from "../src/simulation/placement";
import { defineScenario } from "../src/simulation/scenario";
import { TerrainGrid } from "../src/simulation/terrain";

import type { CultivatorState } from "../src/simulation/cultivation";
import type { CommandIssuer, MissionCommand } from "../src/simulation/command";
import type {
  MissionSimulation,
  MissionState,
} from "../src/simulation/mission";

// Circle save coverage: every interruptible state continues exactly as an
// uninterrupted run through its mission file.
const definitions = BASE_CONTENT.actors.filter(
  ({ faction }) => faction === "circle",
);
const definition = (id: string) => definitions.find((each) => each.id === id)!;
const options = {
  width: 40,
  height: 20,
  tileSize: 1,
  terrainTypeIds: ["plain", "path", "rough", "water"],
};
const scenario = defineScenario({
  id: "circle-continuation",
  ...playerOwners("circle"),
  tileSize: 1,
  terrainTypeIds: options.terrainTypeIds,
  terrain: new TerrainGrid(options).terrainState(),
  buildings: [
    {
      actorId: "heart",
      definitionId: "circle-heartgrove",
      origin: { x: 2, z: 6 },
    },
  ],
  stockpiles: stockpiles(2000, "lifebloom"),
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
type Options = { emergencyHeadquarters?: boolean };
const simulations: MissionSimulation[] = [];
afterEach(() => simulations.splice(0).forEach((sim) => sim.dispose()));
function fixture(
  state = exploredScenarioState(scenario, definitions),
  { emergencyHeadquarters }: Options = {},
) {
  const mission = startMission(new TerrainGrid(options), {
    state,
    definitions,
    tickSeconds: 0.1,
    emergencyHeadquarters,
  });
  simulations.push(mission.simulation);
  return mission;
}
function resume(sim: MissionSimulation, rules: Options = {}) {
  const restored = fixture(savedState(scenario, sim), rules).simulation;
  expect(restored.snapshot()).toEqual(sim.snapshot());
  return restored;
}
function compareContinuation(original: MissionSimulation, rules?: Options) {
  let restored = resume(original, rules);
  return {
    checkpoint() {
      const next = resume(restored, rules);
      restored.dispose();
      restored = next;
    },
    advance(step: (sim: MissionSimulation) => void) {
      step(original);
      step(restored);
      expect(restored.snapshot()).toEqual(original.snapshot());
    },
  };
}
const accept = (
  sim: MissionSimulation,
  value: MissionCommand,
  issuer?: CommandIssuer,
) => expect(command(sim, value, issuer)).toMatchObject({ accepted: true });
const workerOf = (sim: MissionSimulation, actorId = "worker") =>
  sim.economy!.cultivation!.workers.find(
    (worker) => worker.actorId === actorId,
  )!;
const siteOf = (sim: MissionSimulation, siteId = "near") =>
  sim.economy!.cultivation!.sites.find(({ id }) => id === siteId)!;
function train(
  sim: MissionSimulation,
  actorId = "worker",
  producerId = "heart",
) {
  accept(sim, trainCommand(actorId, producerId));
  untilSeconds(sim, () => !!sim.actorById(actorId));
}
const grow = (
  sim: MissionSimulation,
  actorId: string,
  definitionId: string,
  x: number,
  z: number,
  workerId = "worker",
) => accept(sim, placeCommand(actorId, definitionId, x, z, workerId));
const gather = (sim: MissionSimulation, actorId: string, siteId = "near") =>
  accept(sim, { kind: "gather", actorId, siteId });
/** A trained worker and a completed Conservatory beside the near site. */
function opening(state?: MissionState) {
  const mission = fixture(state);
  train(mission.simulation);
  grow(mission.simulation, "conservatory", "circle-conservatory", 10, 6);
  untilSeconds(
    mission.simulation,
    () => !mission.simulation.actorById("conservatory")!.construction,
  );
  return mission;
}
const ring = (x: number, z: number) =>
  [-1, 0, 1].flatMap((dx) =>
    [-1, 0, 1].map((dz) => ({ x: x + dx, z: z + dz })),
  );
const terrain = (
  sim: MissionSimulation,
  tiles: { x: number; z: number }[],
  typeId: string,
) =>
  accept(
    sim,
    {
      kind: "terrain",
      tiles: tiles.map((tile) => ({ ...tile, terrain: { typeId } })),
    },
    { script: true },
  );

type PhaseCase = {
  phase: CultivatorState["phase"];
  arrange: () => MissionSimulation;
  /** Steps both runs share after loading, before the final comparison. */
  then?: (sim: MissionSimulation) => void;
  /** What the resumed work accomplished. */
  done: (sim: MissionSimulation) => void;
};
const delivered = (sim: MissionSimulation) => deposited(sim, "lifebloom");
const PHASES: PhaseCase[] = [
  {
    phase: "idle",
    arrange: () => {
      const { simulation: sim, map } = opening();
      gather(sim, "worker");
      untilSeconds(sim, () => workerOf(sim).cargo >= 5);
      accept(sim, {
        kind: "move",
        actorId: "worker",
        target: map.tileCenter(18, 12),
      });
      return sim;
    },
    then: (sim) => gather(sim, "worker", "far"),
    done: (sim) => {
      const { reserve, capacity } = siteOf(sim, "far");
      expect(reserve).toBeLessThan(capacity);
    },
  },
  {
    phase: "travelling",
    arrange: () => {
      const { simulation: sim } = opening();
      gather(sim, "worker", "far");
      advanceSeconds(sim, 1);
      return sim;
    },
    done: (sim) => expect(delivered(sim)).toBeGreaterThanOrEqual(30),
  },
  {
    phase: "gathering",
    arrange: () => {
      const { simulation: sim } = opening();
      gather(sim, "worker");
      untilSeconds(
        sim,
        () =>
          workerOf(sim).phase === "gathering" &&
          workerOf(sim).gatherProgress > 0 &&
          workerOf(sim).cargo >= 3,
      );
      return sim;
    },
    done: (sim) => expect(delivered(sim)).toBeGreaterThanOrEqual(30),
  },
  {
    phase: "returning",
    arrange: () => {
      const { simulation: sim } = opening();
      gather(sim, "worker", "far");
      untilSeconds(sim, () => workerOf(sim).phase === "returning");
      advanceSeconds(sim, 1);
      return sim;
    },
    done: (sim) => expect(delivered(sim)).toBeGreaterThanOrEqual(30),
  },
  {
    phase: "waiting",
    arrange: () => {
      const state = exploredScenarioState(scenario, definitions);
      Object.assign(state.economy!.cultivation!.sites[0]!, {
        dormant: true,
        reserve: 10000,
        regenerationProgress: 3,
      });
      const { simulation: sim, map } = opening(state);
      gather(sim, "worker");
      accept(sim, {
        kind: "move",
        actorId: "worker",
        target: map.tileCenter(30, 14),
        queued: true,
      });
      untilSeconds(sim, () => workerOf(sim).phase === "waiting");
      return sim;
    },
    done: (sim) => {
      expect(siteOf(sim).dormant).toBe(false);
      expect(workerOf(sim).siteId).toBe("near");
      expect(sim.actorById("worker")!.orders).toHaveLength(1);
      expect(workerOf(sim)).toMatchObject({ phase: "gathering" });
      expect(workerOf(sim).cargo).toBeGreaterThan(0);
    },
  },
  {
    phase: "blocked",
    arrange: () => {
      const { simulation: sim } = opening();
      terrain(sim, ring(23, 6), "water");
      gather(sim, "worker", "far");
      untilSeconds(sim, () => workerOf(sim).phase === "blocked");
      return sim;
    },
    then: (sim) => terrain(sim, ring(23, 6), "plain"),
    done: (sim) => expect(delivered(sim)).toBeGreaterThanOrEqual(30),
  },
  {
    phase: "no-dropoff",
    arrange: () => {
      const { simulation: sim } = opening();
      gather(sim, "worker", "far");
      untilSeconds(sim, () => workerOf(sim).cargo >= 30);
      sim.removeActor("conservatory");
      untilSeconds(sim, () => workerOf(sim).phase === "no-dropoff");
      return sim;
    },
    // Growth interrupts the stranded cargo, which then needs a return order.
    then: (sim) => {
      grow(sim, "replacement", "circle-conservatory", 18, 10, "worker");
      untilSeconds(sim, () => !sim.actorById("replacement")!.construction);
      expect(workerOf(sim).cargo).toBe(30);
      accept(sim, { kind: "return-cargo", actorId: "worker" });
    },
    done: (sim) => expect(delivered(sim)).toBe(30),
  },
  {
    phase: "tending",
    arrange: () => {
      const { simulation: sim } = opening();
      grow(sim, "muster", "circle-musterhall", 8, 11);
      untilSeconds(
        sim,
        () => (sim.actorById("muster")!.construction?.completedTicks ?? 0) > 20,
      );
      return sim;
    },
    done: (sim) =>
      expect(sim.actorById("muster")!.construction).toBeUndefined(),
  },
];

test.each(PHASES)(
  "a Cultivator saved while $phase continues identically",
  ({ phase, arrange, then, done }) => {
    const sim = arrange();
    expect(workerOf(sim).phase).toBe(phase);
    const { advance } = compareContinuation(sim);
    advance((each) => advanceSeconds(each, 2));
    if (then) advance(then);
    advance((each) => advanceSeconds(each, 60));
    done(sim);
  },
);

test("worker replacement keeps paid growth, yields its slot, and resumes in queue order", () => {
  const { simulation: sim } = fixture();
  for (const id of ["worker", "spare", "third"]) train(sim, id);
  grow(sim, "first", "circle-musterhall", 8, 11, "worker");
  untilSeconds(
    sim,
    () => (sim.actorById("first")!.construction?.completedTicks ?? 0) >= 30,
  );
  grow(sim, "second", "circle-conservatory", 10, 3, "spare");
  const paid = balance(sim, "lifebloom");
  const progress = sim.actorById("first")!.construction!.completedTicks;
  expect(sim.actorById("second")!.construction!.active).toBeFalsy();

  // Losing the tender pauses its growth, and the next job takes the slot.
  sim.removeActor("worker");
  untilSeconds(sim, () => !!sim.actorById("second")!.construction?.active);
  const { advance, checkpoint } = compareContinuation(sim);
  advance((each) => advanceSeconds(each, 2));
  expect(sim.actorById("first")!.construction).toMatchObject({
    completedTicks: progress,
  });
  expect(sim.actorById("first")!.construction!.active).toBeFalsy();

  // A replacement travelling to the paused job waits behind the active one.
  advance((each) =>
    accept(each, { kind: "tend", actorId: "third", buildingId: "first" }),
  );
  expect(workerOf(sim, "third")).toMatchObject({
    phase: "tending",
    tendingId: "first",
  });
  checkpoint();
  advance((each) =>
    untilSeconds(each, () => !each.actorById("second")!.construction),
  );
  checkpoint();
  advance((each) =>
    untilSeconds(each, () => !!each.actorById("first")!.construction?.active),
  );
  expect(
    sim.actorById("first")!.construction!.completedTicks,
  ).toBeGreaterThanOrEqual(progress);
  checkpoint();
  advance((each) =>
    untilSeconds(each, () => !each.actorById("first")!.construction),
  );
  expect(balance(sim, "lifebloom")).toBe(paid);
  expect(workerOf(sim, "third").phase).toBe("idle");
});

test("emergency Heartgrove regrowth continues identically from a save", () => {
  const rules = { emergencyHeadquarters: true };
  const { simulation: sim } = fixture(undefined, rules);
  train(sim);
  sim.removeActor("heart");
  grow(sim, "new-heart", "circle-heartgrove", 8, 10);
  untilSeconds(
    sim,
    () => (sim.actorById("new-heart")!.construction?.completedTicks ?? 0) > 10,
  );
  const { advance } = compareContinuation(sim, rules);
  advance((each) =>
    untilSeconds(each, () => !each.actorById("new-heart")!.construction),
  );
  advance((each) => train(each, "after", "new-heart"));
});

test("dormant recovery keeps assignments and queued orders through saves and reopens on the same tick", () => {
  const state = exploredScenarioState(scenario, definitions);
  state.economy!.cultivation!.sites[0]!.reserve = 15500;
  const { simulation: sim, map } = opening(state);
  for (const id of ["a", "b", "c"]) train(sim, id);
  for (const id of ["worker", "a", "b", "c"]) gather(sim, id);
  accept(sim, {
    kind: "move",
    actorId: "a",
    target: map.tileCenter(30, 14),
    queued: true,
  });
  untilSeconds(sim, () => siteOf(sim).dormant);
  const { advance, checkpoint } = compareContinuation(sim);
  advance((each) => advanceSeconds(each, 20));
  expect(siteOf(sim).dormant).toBe(true);
  expect(sim.actorById("a")!.orders).toHaveLength(1);
  expect(
    sim.economy!.cultivation!.workers.every(({ siteId }) => siteId === "near"),
  ).toBe(true);
  checkpoint();
  advance((each) => untilSeconds(each, () => !siteOf(each).dormant, 60));
  advance((each) => advanceSeconds(each, 10));
  expect(workerOf(sim, "b").phase).not.toBe("waiting");
});

test("Healer, Artificer, and Heartgrove repair work continue identically from a save", () => {
  const state = exploredScenarioState(scenario, definitions);
  const map = new TerrainGrid(options);
  const building = (id: string, definitionId: string, x: number, z: number) =>
    state.actors.push(
      createTilePlacedActor(
        map,
        definition(definitionId),
        { actorId: id, origin: { x, z } },
        "player",
      ),
    );
  const unit = (id: string, definitionId: string, x: number) =>
    state.actors.push(
      createActor({
        id,
        definitionId,
        owner: "player",
        worldPosition: map.tileCenter(x, 16),
      }),
    );
  building("muster", "circle-musterhall", 8, 11);
  building("nursery", "circle-construct-nursery", 16, 12);
  unit("healer", "circle-healer", 24);
  unit("sentinel", "circle-sentinel", 27);
  unit("artificer", "circle-artificer", 24);
  unit("ram", "circle-briar-ram", 29);
  for (const [id, health] of [
    ["muster", 200],
    ["nursery", 300],
    ["sentinel", 20],
    ["ram", 60],
  ] as const)
    actorIn(state, id).health = health;
  const sim = fixture(state).simulation;
  accept(sim, { kind: "service", actorId: "healer", targetId: "sentinel" });
  accept(sim, { kind: "service", actorId: "artificer", targetId: "ram" });
  // Two repairs share the Heartgrove queue; the second waits.
  accept(sim, { kind: "repair", actorId: "muster" });
  accept(sim, { kind: "repair", actorId: "nursery" });
  untilSeconds(
    sim,
    () =>
      sim.actorById("sentinel")!.health! > 25 &&
      sim.actorById("ram")!.health! > 65,
  );
  expect(sim.actorById("healer")!.service?.targetId).toBe("sentinel");
  expect(sim.actorById("artificer")!.service?.targetId).toBe("ram");
  expect(sim.actorById("muster")!.repair).toMatchObject({ active: true });
  expect(sim.actorById("nursery")!.repair?.active).toBeFalsy();
  const { advance, checkpoint } = compareContinuation(sim);
  advance((each) => advanceSeconds(each, 30));
  checkpoint();
  advance((each) =>
    untilSeconds(
      each,
      () =>
        !each.actorById("muster")!.repair &&
        !each.actorById("nursery")!.repair &&
        !each.actorById("sentinel")!.health &&
        !each.actorById("ram")!.health,
    ),
  );
});

/** Steps by mission second; every run plays the same script. */
const BASE_SCRIPT: [
  number,
  MissionCommand | ((sim: MissionSimulation) => void),
][] = [
  [0, trainCommand("worker")],
  [0, trainCommand("a")],
  [0, trainCommand("b")],
  [13, placeCommand("conservatory", "circle-conservatory", 10, 6, "worker")],
  [13, { kind: "gather", actorId: "a", siteId: "near" }],
  [13, { kind: "gather", actorId: "b", siteId: "far" }],
  [30, { kind: "gather", actorId: "worker", siteId: "near" }],
  [40, placeCommand("muster", "circle-musterhall", 8, 11, "a")],
  // Losing the tender mid-growth leaves the paid job for a replacement.
  [
    47,
    (sim) => {
      expect(
        sim.actorById("muster")!.construction!.completedTicks,
      ).toBeGreaterThan(0);
      sim.removeActor("a");
    },
  ],
  [
    51,
    (sim) => expect(sim.actorById("muster")!.construction!.active).toBeFalsy(),
  ],
  [52, { kind: "tend", actorId: "b", buildingId: "muster" }],
  [75, { kind: "gather", actorId: "b", siteId: "far" }],
  [80, trainCommand("sentinel", "muster", "circle-sentinel")],
  [80, trainCommand("healer", "muster", "circle-healer")],
  [85, placeCommand("spire", "circle-thornspire", 18, 10, "worker")],
];
function trainCommand(
  actorId: string,
  producerId = "heart",
  definitionId = "circle-cultivator",
): MissionCommand {
  return { kind: "train-unit", actorId, producerId, definitionId };
}
function placeCommand(
  actorId: string,
  definitionId: string,
  x: number,
  z: number,
  workerId: string,
): MissionCommand {
  return {
    kind: "place-actor",
    actorId,
    definitionId,
    origin: { x, z },
    workerIds: [workerId],
  };
}
function playBase(checkpointSeconds?: number) {
  let sim = fixture().simulation;
  const ticks = (seconds: number) => Math.round(seconds / sim.tickSeconds);
  const end = ticks(150);
  const interval = checkpointSeconds && ticks(checkpointSeconds);
  const outcomes: boolean[] = [];
  for (let tick = 0; tick < end; tick++) {
    for (const [at, step] of BASE_SCRIPT)
      if (ticks(at) === tick) {
        if (typeof step === "function") step(sim);
        else sim.submitCommand(step, { owner: sim.playerOwner });
      }
    for (const { accepted } of sim.tick()) outcomes.push(accepted);
    if (interval && sim.completedTicks % interval === 0) {
      const restored = resume(sim);
      sim.dispose();
      sim = restored;
    }
  }
  return { sim, outcomes };
}

test("a Circle base reloaded from its mission file every 17 seconds matches an uninterrupted run", () => {
  const whole = playBase();
  const segmented = playBase(17);
  const expectedOutcomes = BASE_SCRIPT.flatMap(([, step]) =>
    typeof step === "function" ? [] : [true],
  );
  expect(whole.outcomes).toEqual(expectedOutcomes);
  expect(segmented.outcomes).toEqual(expectedOutcomes);
  expect(segmented.sim.snapshot()).toEqual(whole.sim.snapshot());
  const { sim } = whole;
  expect(sim.actorById("muster")!.construction).toBeUndefined();
  expect(sim.actorById("sentinel")).toBeDefined();
  expect(sim.actorById("healer")).toBeDefined();
  expect(sim.actorById("spire")).toBeDefined();
  expect(delivered(sim)).toBeGreaterThan(100);
}, 20_000);

const emptyCargo = { cargo: 0, gatherProgress: 0, cargoSources: undefined };
const contradictions: [string, Partial<CultivatorState>][] = [
  ["idle with a site", { phase: "idle", siteId: "near" }],
  ["travelling without a site", { phase: "travelling" }],
  ["gathering without a site", { phase: "gathering" }],
  ["waiting without a site", { phase: "waiting" }],
  [
    "gathering toward a drop-off",
    { phase: "gathering", siteId: "near", dropoffId: "conservatory" },
  ],
  ["returning without cargo", { phase: "returning", ...emptyCargo }],
  ["no-dropoff without cargo", { phase: "no-dropoff", ...emptyCargo }],
  [
    "no-dropoff with a drop-off",
    { phase: "no-dropoff", dropoffId: "conservatory" },
  ],
  ["blocked without a target", { phase: "blocked" }],
  [
    "blocked on a delivery without cargo",
    { phase: "blocked", dropoffId: "conservatory", ...emptyCargo },
  ],
  ["tending without a building", { phase: "tending" }],
  ["with an unknown phase", { phase: "resting" as CultivatorState["phase"] }],
];
test.each(contradictions)(
  "loading rejects a Cultivator %s",
  (_name, change) => {
    const { simulation: sim } = opening();
    gather(sim, "worker", "far");
    untilSeconds(sim, () => workerOf(sim).phase === "returning");
    untilSeconds(sim, () => !!workerOf(sim).dropoffId);
    const state = savedState(scenario, sim);
    const worker = state.economy!.cultivation!.workers[0]!;
    // Start from a valid returning worker with cargo, a site, and a drop-off.
    expect(() => fixture(structuredClone(state))).not.toThrow();
    delete worker.siteId;
    delete worker.dropoffId;
    Object.assign(worker, change);
    expect(() => fixture(state)).toThrow("invalid cultivation state");
  },
);
