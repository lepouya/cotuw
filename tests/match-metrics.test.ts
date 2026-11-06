import { afterEach, expect, test } from "vitest";
import { createActor } from "../src/simulation/actor";
import type { ActorDefinition } from "../src/simulation/actor";
import { createCultivationSite } from "../src/simulation/cultivation";
import { createMissionSimulation } from "../src/simulation/mission";
import type {
  MissionSimulation,
  MissionState,
} from "../src/simulation/mission";
import { parseMission, serializeMission } from "../src/simulation/mission-file";
import {
  createScenarioMap,
  createScenarioState,
  defineScenario,
} from "../src/simulation/scenario";
import { OccupancyGrid } from "../src/simulation/occupancy";
import { TerrainGrid } from "../src/simulation/terrain";
import { createTerrainMoveBehavior } from "../src/simulation/terrain-movement";
import type { SkirmishRules } from "../src/simulation/skirmish";
import { BASE_CONTENT, MOVEMENT_PROFILES } from "./helpers/content";
import {
  advanceSeconds,
  command,
  exploredFog,
  stockpiles,
  untilSeconds,
} from "./helpers/scenario";

const CC = "arc-command-center-prototype";
const BARRACKS = "arc-field-barracks";
const REFINERY = "arc-materials-refinery";
const TROOPER = "arc-trooper";
const HEART = "circle-heartgrove";
const CONSERVATORY = "circle-conservatory";
const MUSTER = "circle-musterhall";
const definitions: ActorDefinition[] = BASE_CONTENT.actors.map(
  (definition) => ({
    ...structuredClone(definition),
    ...(definition.constructionSeconds && { constructionSeconds: 0.2 }),
    ...(definition.trainingSeconds && { trainingSeconds: 0.2 }),
    ...(definition.harvesting && {
      harvesting: { capacity: 3, loadSeconds: 0.3, patchRadius: 1 },
    }),
  }),
);
const terrain = new TerrainGrid({
  width: 40,
  height: 24,
  tileSize: 1,
  terrainTypeIds: ["plain", "path", "rough", "water"],
});
const rules: SkirmishRules = {
  owners: ["player", "rival"],
  qualifyingDefinitionIds: [
    CC,
    BARRACKS,
    REFINERY,
    HEART,
    CONSERVATORY,
    MUSTER,
  ],
  startingResourceSites: {
    player: ["near", "bloom-near"],
    rival: ["far", "bloom-far"],
  },
};
const scenario = defineScenario({
  id: "metrics-test",
  tileSize: 1,
  terrainTypeIds: ["plain", "path", "rough", "water"],
  terrain: terrain.terrainState(),
  owners: [
    { id: "player", faction: "arc" },
    { id: "rival", faction: "arc" },
    { id: "wildlife", faction: "wildlife" },
  ],
  playerOwner: "player",
  skirmish: rules,
  relationships: [
    { owners: ["player", "rival"], relationship: "hostile" },
    { owners: ["player", "wildlife"], relationship: "hostile" },
  ],
  buildings: [
    {
      actorId: "home",
      definitionId: CC,
      owner: "player",
      origin: { x: 2, z: 6 },
    },
    {
      actorId: "barracks",
      definitionId: BARRACKS,
      owner: "player",
      origin: { x: 7, z: 6 },
    },
    {
      actorId: "refinery",
      definitionId: REFINERY,
      owner: "player",
      origin: { x: 6, z: 12 },
    },
    {
      actorId: "enemy",
      definitionId: CC,
      owner: "rival",
      origin: { x: 30, z: 6 },
    },
  ],
  stockpiles: [
    ...stockpiles(2000),
    ...stockpiles(2000, "materials", "rival"),
    ...stockpiles(2000, "lifebloom"),
  ],
  sites: [
    {
      id: "near",
      name: "Home",
      tile: { x: 14, z: 12 },
      initialMaterials: 2,
      remainingMaterials: 2,
    },
    {
      id: "neighbor",
      name: "Outside",
      tile: { x: 15, z: 12 },
      initialMaterials: 20,
      remainingMaterials: 20,
    },
    {
      id: "far",
      name: "Rival",
      tile: { x: 27, z: 12 },
      initialMaterials: 20,
      remainingMaterials: 20,
    },
  ],
  loot: [
    {
      id: "loot",
      name: "Gift",
      tile: { x: 12, z: 18 },
      materials: 25,
      collected: false,
    },
  ],
  cultivation: {
    sites: [
      createCultivationSite("bloom-near", "Home", { x: 14, z: 6 }),
      createCultivationSite("bloom-far", "Outside", { x: 23, z: 6 }),
    ],
  },
});
const sims: MissionSimulation[] = [];
afterEach(() => sims.splice(0).forEach((sim) => sim.dispose()));
function initial() {
  const state = createScenarioState(scenario, definitions);
  state.fog = exploredFog(state);
  return state;
}
function fixture(
  state = initial(),
  skirmish = rules,
  fault = false,
  content = definitions,
) {
  const map = createScenarioMap({ ...scenario, terrain: state.terrain! });
  const occupancy = new OccupancyGrid(map);
  const sim = createMissionSimulation({
    state,
    skirmish,
    definitions: content,
    map,
    occupancy,
    bounds: map.worldBounds,
    tickSeconds: 0.1,
    behaviorRegistry: new Map([
      [
        "terrain-move",
        createTerrainMoveBehavior(map, occupancy, MOVEMENT_PROFILES),
      ],
      [
        "idle",
        {
          handleCommand: () => false,
          update: () => {
            if (fault) throw Error("test fault");
          },
        },
      ],
    ]),
  });
  sims.push(sim);
  return sim;
}
const player = (sim: MissionSimulation) => sim.metrics!.owners[0]!;
const rival = (sim: MissionSimulation) => sim.metrics!.owners[1]!;
const unit = (
  state: MissionState,
  id: string,
  definitionId = TROOPER,
  owner = "player",
  x = 12,
  z = 18,
) =>
  state.actors.push(
    createActor({
      id,
      definitionId,
      owner,
      worldPosition: terrain.tileCenter(x, z),
    }),
  );
const train = (
  sim: MissionSimulation,
  id: string,
  definitionId = TROOPER,
  producerId = "barracks",
) => {
  expect(
    command(sim, { kind: "train-unit", actorId: id, definitionId, producerId })
      .accepted,
  ).toBe(true);
};
const roundtrip = (sim: MissionSimulation) =>
  fixture(
    parseMission(
      serializeMission(scenario, sim.snapshot(), sim.tickSeconds),
      sim.tickSeconds,
    ).state,
  );

// Starting actors affect population and the peak, but never production counters.
test("opening samples include starting actors, active vision and military readiness", () => {
  const state = initial();
  unit(state, "army");
  unit(state, "scout", "arc-scout", "player", 13);
  state.fog = { explored: {} };
  const sim = fixture(state);
  expect(player(sim)).toMatchObject({
    unitsProduced: 0,
    buildingsCompleted: 0,
    unitsLost: 0,
    buildingsLost: 0,
    peakArmy: 1,
    milestones: { militaryReady: 0 },
  });
  const first = player(sim).history[0]!;
  expect(first).toMatchObject({ tick: 0, units: 2, buildings: 3 });
  expect(first.visible).toBeGreaterThan(0);
  expect(first.explored).toBe(first.visible);
  expect(rival(sim).history[0]!.buildings).toBe(1);
  expect(player(sim).gathered).toEqual({ materials: 0, lifebloom: 0 });
  expect(player(sim).spent).toEqual({ materials: 0, lifebloom: 0 });
});

test("training, cancellation, completion and sale keep exact counters", () => {
  const sim = fixture();
  train(sim, "cancelled");
  expect(
    command(sim, { kind: "cancel-production", actorId: "cancelled" }).accepted,
  ).toBe(true);
  expect(player(sim).spent.materials).toBe(0);
  expect(player(sim).unitsProduced).toBe(0);
  train(sim, "scout", "arc-scout");
  untilSeconds(sim, () => !!sim.actorById("scout"));
  expect(player(sim).milestones.firstCombatUnit).toBeUndefined();
  train(sim, "trooper");
  untilSeconds(sim, () => !!sim.actorById("trooper"));
  const producedTick = sim.completedTicks - 1;
  expect(player(sim).milestones.firstCombatUnit).toBe(producedTick);
  expect(player(sim).unitsProduced).toBe(2);
  expect(player(sim).peakArmy).toBe(1);
  const place = (id: string, x: number) =>
    command(sim, {
      kind: "place-actor",
      actorId: id,
      definitionId: BARRACKS,
      origin: { x, z: 2 },
    });
  expect(place("cancel", 6).accepted).toBe(true);
  expect(
    command(sim, { kind: "cancel-construction", actorId: "cancel" }).accepted,
  ).toBe(true);
  expect(place("built", 6).accepted).toBe(true);
  untilSeconds(sim, () => !sim.actorById("built")!.construction);
  expect(player(sim).buildingsCompleted).toBe(1);
  const spending = player(sim).spent.materials;
  expect(spending).toBe(
    100 +
      definitions.find((d) => d.id === TROOPER)!.materialsCost! +
      definitions.find((d) => d.id === "arc-scout")!.materialsCost!,
  );
  expect(command(sim, { kind: "sell-actor", actorId: "built" }).accepted).toBe(
    true,
  );
  expect(player(sim).spent.materials).toBe(spending);
  expect(player(sim)).toMatchObject({
    unitsLost: 0,
    buildingsLost: 0,
    buildingsCompleted: 1,
  });
  expect(roundtrip(sim).metrics).toEqual(sim.metrics);
});

test("worker production and loot do not count as combat production or gathered income", () => {
  const state = initial();
  unit(state, "looter", "arc-scout");
  const sim = fixture(state);
  train(sim, "worker", "arc-harvester", "refinery");
  untilSeconds(sim, () => !!sim.actorById("worker"));
  expect(sim.economy!.loot[0]!.collected).toBe(true);
  expect(player(sim)).toMatchObject({
    unitsProduced: 1,
    peakArmy: 0,
    gathered: { materials: 0, lifebloom: 0 },
  });
  expect(player(sim).milestones.firstIncome).toBeUndefined();
  expect(player(sim).milestones.firstCombatUnit).toBeUndefined();
});

test("mixed Materials cargo retains sources through interruption and save/load", () => {
  const sim = fixture();
  train(sim, "worker", "arc-harvester", "refinery");
  untilSeconds(sim, () => !!sim.actorById("worker"));
  command(sim, { kind: "gather", actorId: "worker", siteId: "near" });
  untilSeconds(sim, () => sim.economy!.harvesters[0]!.cargo === 3);
  expect(sim.economy!.harvesters[0]!.cargoSources).toEqual([
    { siteId: "near", amount: 2000 },
    { siteId: "neighbor", amount: 1000 },
  ]);
  expect(player(sim).gathered.materials).toBe(0);
  command(sim, { kind: "stop", actorId: "worker" });
  const restored = roundtrip(sim);
  for (const current of [sim, restored]) {
    command(current, { kind: "return-cargo", actorId: "worker" });
    untilSeconds(current, () => player(current).gathered.materials > 0);
    expect(player(current).milestones).toMatchObject({
      firstIncome: current.completedTicks - 1,
      firstExpansion: current.completedTicks - 1,
    });
    expect(player(current).gathered.materials).toBe(3);
    expect(current.economy!.harvesters[0]!.cargoSources).toEqual([]);
  }
  expect(restored.snapshot()).toEqual(sim.snapshot());
});

test("Circle fractional cargo preserves mixed provenance through site changes and delivery", () => {
  const state = initial();
  state.actors = state.actors.filter((actor) => actor.owner !== "player");
  const circleScenario = {
    ...scenario,
    buildings: [
      {
        actorId: "heart",
        definitionId: HEART,
        owner: "player",
        origin: { x: 2, z: 6 },
      },
      {
        actorId: "dropoff",
        definitionId: CONSERVATORY,
        owner: "player",
        origin: { x: 10, z: 6 },
      },
      {
        actorId: "enemy",
        definitionId: CC,
        owner: "rival",
        origin: { x: 30, z: 6 },
      },
    ],
    units: [
      {
        actorId: "cultivator",
        definitionId: "circle-cultivator",
        owner: "player",
        tile: { x: 14, z: 6 },
      },
    ],
  };
  const start = createScenarioState(circleScenario, definitions);
  start.fog = exploredFog(start);
  const sim = fixture(start);
  command(sim, { kind: "gather", actorId: "cultivator", siteId: "bloom-near" });
  advanceSeconds(sim, 0.4);
  const worker = () => sim.economy!.cultivation!.workers[0]!;
  expect(worker().gatherProgress).toBe(500);
  command(sim, { kind: "gather", actorId: "cultivator", siteId: "bloom-far" });
  untilSeconds(sim, () => worker().cargo >= 1);
  command(sim, { kind: "return-cargo", actorId: "cultivator" });
  untilSeconds(sim, () => player(sim).gathered.lifebloom > 0);
  expect(player(sim).gathered.lifebloom).toBe(1);
  expect(player(sim).milestones.firstExpansion).toBe(sim.completedTicks - 1);
  const loaded = roundtrip(sim);
  expect(loaded.snapshot()).toEqual(sim.snapshot());
});

test.each([CC, BARRACKS, REFINERY])(
  "committed damage to %s records opponent milestones and combat building loss",
  (definitionId) => {
    const state = initial();
    const enemy = state.actors.find((a) => a.id === "enemy")!;
    enemy.definitionId = definitionId;
    enemy.health = 1;
    delete enemy.headquartersId;
    unit(state, "attacker", TROOPER, "player", 28, 7);
    const sim = fixture(state);
    expect(
      command(sim, { kind: "attack", actorId: "attacker", targetId: "enemy" })
        .accepted,
    ).toBe(true);
    expect(player(sim).milestones).toMatchObject({
      firstEngagement: 0,
      firstBaseAttack: 0,
    });
    expect(rival(sim).milestones.firstEngagement).toBe(0);
    expect(rival(sim).milestones.firstBaseAttack).toBeUndefined();
    expect(rival(sim).buildingsLost).toBe(1);
  },
);

test("neutral and wildlife damage cannot trigger opponent-specific milestones", () => {
  const state = initial();
  unit(state, "wolf-target", "arc-scout", "wildlife", 12, 18);
  state.actors.find((a) => a.id === "wolf-target")!.health = 1;
  unit(state, "attacker", TROOPER, "player", 11, 18);
  const sim = fixture(state);
  command(sim, {
    kind: "attack",
    actorId: "attacker",
    targetId: "wolf-target",
  });
  expect(sim.actorById("wolf-target")).toBeUndefined();
  expect(player(sim).milestones.firstEngagement).toBeUndefined();
  expect(rival(sim).unitsLost).toBe(0);
});

test("five-second histories, exact milestones and final sample survive continuation and freeze", () => {
  const sim = fixture();
  advanceSeconds(sim, 5);
  expect(player(sim).history.map((sample) => sample.tick)).toEqual([0, 49]);
  const restored = roundtrip(sim);
  const previous = sim.metrics;
  for (const current of [sim, restored]) {
    advanceSeconds(current, 0.3);
    command(
      current,
      { kind: "sell-actor", actorId: "enemy" },
      { owner: "rival" },
    );
    expect(player(current).history.map((sample) => sample.tick)).toEqual([
      0, 49, 53,
    ]);
    expect(rival(current).history[2]!.buildings).toBe(0);
    const frozen = current.snapshot();
    advanceSeconds(current, 10);
    expect(current.snapshot()).toEqual(frozen);
    expect(roundtrip(current).snapshot()).toEqual(frozen);
  }
  expect(previous!.owners[0]!.history).toHaveLength(2);
  expect(restored.snapshot()).toEqual(sim.snapshot());
});

test("failed ticks publish no metrics, payments, damage or samples", () => {
  const sim = fixture(initial(), rules, true);
  sim.submitCommand({
    kind: "train-unit",
    actorId: "worker",
    producerId: "refinery",
    definitionId: "arc-harvester",
  });
  const before = sim.snapshot();
  expect(() => sim.tick()).toThrow("test fault");
  expect(sim.snapshot()).toEqual(before);
});

test.each(["missing", "history", "future", "negative"])(
  "rejects inconsistent persisted metrics: %s",
  (field) => {
    const sim = fixture();
    command(sim, { kind: "sell-actor", actorId: "enemy" }, { owner: "rival" });
    const state = sim.snapshot();
    if (field === "missing") delete state.metrics;
    if (field === "history") state.metrics!.owners[0]!.history.pop();
    if (field === "future")
      state.metrics!.owners[0]!.milestones.firstIncome = state.tick;
    if (field === "negative") state.metrics!.owners[0]!.unitsLost = -1;
    expect(() => fixture(state)).toThrow("invalid match metrics");
  },
);

test.each([{ player: ["missing"], rival: [] }, { player: [] }, undefined])(
  "rejects invalid starting sites: %j",
  (startingResourceSites) => {
    expect(() =>
      fixture(initial(), { ...rules, startingResourceSites } as SkirmishRules),
    ).toThrow("invalid skirmish rules");
  },
);

test("army roles follow content for armed and unarmed units", () => {
  const { weapon } = definitions.find(({ id }) => id === TROOPER)!;
  const armedScouts = definitions.map((definition) =>
    definition.id === "arc-scout" ? { ...definition, weapon } : definition,
  );
  const opening = () => {
    const state = initial();
    unit(state, "scout", "arc-scout");
    return state;
  };
  expect(player(fixture(opening())).peakArmy).toBe(0);
  expect(player(fixture(opening(), rules, false, armedScouts)).peakArmy).toBe(
    1,
  );
});

test.each(["arc-harvester", "circle-cultivator"])(
  "%s cargo capacity must fit safe thousandths",
  (id) => {
    const content = definitions.map((definition) => {
      if (definition.id !== id) return definition;
      const work = definition.harvesting
        ? { harvesting: { ...definition.harvesting, capacity: 1e13 } }
        : { cultivation: { ...definition.cultivation!, capacity: 1e13 } };
      return { ...definition, ...work };
    });
    expect(() => fixture(initial(), rules, false, content)).toThrow(RangeError);
  },
);

test("missions without fog report full coverage", () => {
  const state = initial();
  delete state.fog;
  const tiles = terrain.width * terrain.height;
  expect(player(fixture(state)).history[0]).toMatchObject({
    explored: tiles,
    visible: tiles,
  });
});

test("unattributed cargo is rejected in every mission", () => {
  const sim = fixture();
  train(sim, "worker", "arc-harvester", "refinery");
  untilSeconds(sim, () => !!sim.actorById("worker"));
  const state = sim.snapshot();
  state.economy!.harvesters[0]!.cargo = 1;
  expect(() => fixture(state)).toThrow("invalid economy state");
  state.economy!.harvesters[0]!.cargoSources = [
    { siteId: "near", amount: 1000 },
  ];
  expect(fixture(state).economy!.harvesters[0]!.cargo).toBe(1);
});

test("simultaneous lethal unit combat counts both losses without reducing the peak", () => {
  const state = initial();
  unit(state, "left", TROOPER, "player", 16, 18);
  unit(state, "right", TROOPER, "rival", 18, 18);
  for (const actor of state.actors.filter((actor) => !actor.tilePlacement))
    actor.health = 1;
  const sim = fixture(state);
  sim.tick();
  for (const owner of sim.metrics!.owners) {
    expect(owner).toMatchObject({
      unitsProduced: 0,
      unitsLost: 1,
      buildingsLost: 0,
      peakArmy: 1,
    });
    expect(owner.milestones.firstEngagement).toBe(0);
    expect(owner.milestones.firstBaseAttack).toBeUndefined();
  }
  expect(roundtrip(sim).snapshot()).toEqual(sim.snapshot());
});

test.each(["defense", "relay", "unfinished"])(
  "damage to a %s counts as a base attack and building loss",
  (kind) => {
    const definition = {
      ...structuredClone(
        definitions.find((definition) => definition.id === BARRACKS)!,
      ),
      id: `test-${kind}`,
      production: undefined,
    };
    const content = [...definitions, definition];
    const start = createScenarioState(
      {
        ...scenario,
        buildings: [
          ...scenario.buildings,
          {
            actorId: "target",
            definitionId: definition.id,
            owner: "rival",
            origin: { x: 25, z: 15 },
          },
        ],
      },
      content,
    );
    start.fog = exploredFog(start);
    const target = start.actors.find((actor) => actor.id === "target")!;
    target.health = 1;
    if (kind === "unfinished")
      target.construction = { paidCost: 100, completedTicks: 0, totalTicks: 2 };
    unit(start, "attacker", TROOPER, "player", 23, 16);
    const sim = fixture(start, rules, false, content);
    command(sim, { kind: "attack", actorId: "attacker", targetId: "target" });
    expect(sim.result).toBeUndefined();
    expect(player(sim).milestones.firstBaseAttack).toBe(0);
    expect(rival(sim)).toMatchObject({
      buildingsLost: 1,
      buildingsCompleted: 0,
    });
  },
);

test("the final tick includes paid production and construction completion", () => {
  const sim = fixture();
  expect(
    command(sim, {
      kind: "place-actor",
      actorId: "built",
      definitionId: BARRACKS,
      origin: { x: 6, z: 2 },
    }).accepted,
  ).toBe(true);
  train(sim, "trooper");
  expect(player(sim).unitsProduced).toBe(0);
  command(sim, { kind: "sell-actor", actorId: "enemy" }, { owner: "rival" });
  expect(player(sim)).toMatchObject({
    buildingsCompleted: 1,
    unitsProduced: 1,
    peakArmy: 1,
    milestones: { firstCombatUnit: 2 },
    spent: { materials: 125, lifebloom: 0 },
  });
  expect(player(sim).history[1]).toMatchObject({
    tick: 2,
    buildings: 4,
    units: 1,
  });
  expect(roundtrip(sim).metrics).toEqual(sim.metrics);
});

test("military readiness waits for support and does not require a queued unit", () => {
  const state = initial();
  const barracks = state.actors.find((actor) => actor.id === "barracks")!;
  barracks.tilePlacement!.origin = { x: 25, z: 18 };
  delete barracks.headquartersId;
  const sim = fixture(state);
  expect(player(sim).milestones.militaryReady).toBeUndefined();
  // A direct setup grant can supply the disconnected producer before play.
  const root = structuredClone(
    state.actors.find((actor) => actor.id === "home")!,
  );
  root.id = "replacement";
  root.headquartersId = root.id;
  root.tilePlacement!.origin = { x: 22, z: 18 };
  sim.spawnActor(root);
  expect(player(sim).milestones.militaryReady).toBe(0);
  expect(player(sim).unitsProduced).toBe(0);
});

test("exploration and active vision histories sample the committed owner views", () => {
  const state = initial();
  unit(state, "scout", "arc-scout", "player", 12, 18);
  state.fog = { explored: {} };
  const sim = fixture(state);
  sim.submitCommand({
    kind: "move",
    actorId: "scout",
    target: terrain.tileCenter(25, 18),
  });
  advanceSeconds(sim, 5);
  const sample = player(sim).history[1]!;
  const fog = sim.knowledgeOf("player").fog!;
  let visible = 0;
  for (let z = 0; z < terrain.height; z++)
    for (let x = 0; x < terrain.width; x++)
      visible += Number(fog.isVisible(x, z));
  expect(sample).toMatchObject({
    tick: 49,
    visible,
    explored: fog.exploredCount,
  });
  expect(sample.explored).toBeGreaterThan(player(sim).history[0]!.explored);
  expect(sample.explored).toBeGreaterThan(sample.visible);
  expect(sim.knowledgeOf("player")).not.toHaveProperty("metrics");
  expect(roundtrip(sim).snapshot()).toEqual(sim.snapshot());
});

test("prepaid opening jobs can be cancelled without a negative spending total", () => {
  const state = initial();
  state.economy!.production.push({
    actorId: "prepaid",
    producerId: "barracks",
    definitionId: TROOPER,
    paidCost: 25,
    completedTicks: 0,
    totalTicks: 2,
    exitBlocked: false,
  });
  const sim = fixture(state);
  expect(player(sim).spent.materials).toBe(25);
  command(sim, { kind: "cancel-production", actorId: "prepaid" });
  expect(player(sim).spent.materials).toBe(0);
  expect(roundtrip(sim).metrics).toEqual(sim.metrics);
});

test.each(["cargo", "gathered", "population", "sample"])(
  "rejects inconsistent checkpoint data: %s",
  (field) => {
    const sim = fixture();
    train(sim, "worker", "arc-harvester", "refinery");
    untilSeconds(sim, () => !!sim.actorById("worker"));
    command(sim, { kind: "sell-actor", actorId: "enemy" }, { owner: "rival" });
    const state = sim.snapshot();
    if (field === "cargo") state.economy!.harvesters[0]!.cargo = 1;
    if (field === "gathered") state.metrics!.owners[0]!.gathered.materials = 1;
    if (field === "population") state.metrics!.owners[0]!.history[1]!.units++;
    if (field === "sample")
      state.metrics!.owners[0]!.history[1] = null as never;
    expect(() => fixture(state)).toThrow(RangeError);
  },
);

test("same-faction owners attribute production and spending to their own commands", () => {
  const start = createScenarioState(
    {
      ...scenario,
      buildings: [
        ...scenario.buildings,
        {
          actorId: "rival-barracks",
          definitionId: BARRACKS,
          owner: "rival",
          origin: { x: 26, z: 6 },
        },
      ],
    },
    definitions,
  );
  start.fog = exploredFog(start);
  const sim = fixture(start);
  sim.submitCommand({
    kind: "train-unit",
    actorId: "player-unit",
    producerId: "barracks",
    definitionId: TROOPER,
  });
  sim.submitCommand(
    {
      kind: "train-unit",
      actorId: "rival-unit",
      producerId: "rival-barracks",
      definitionId: TROOPER,
    },
    { owner: "rival" },
  );
  advanceSeconds(sim, 0.2);
  for (const owner of sim.metrics!.owners)
    expect(owner).toMatchObject({
      unitsProduced: 1,
      peakArmy: 1,
      spent: { materials: 25, lifebloom: 0 },
      milestones: { firstCombatUnit: 1 },
    });
  expect(roundtrip(sim).snapshot()).toEqual(sim.snapshot());
});

test("Circle paid growth and training use Lifebloom and the same milestone definitions", () => {
  const start = createScenarioState(
    {
      ...scenario,
      buildings: [
        {
          actorId: "heart",
          definitionId: HEART,
          owner: "player",
          origin: { x: 2, z: 6 },
        },
        {
          actorId: "enemy",
          definitionId: CC,
          owner: "rival",
          origin: { x: 30, z: 6 },
        },
      ],
    },
    definitions,
  );
  start.fog = exploredFog(start);
  const sim = fixture(start);
  train(sim, "cultivator", "circle-cultivator", "heart");
  untilSeconds(sim, () => !!sim.actorById("cultivator"));
  expect(
    command(sim, {
      kind: "place-actor",
      actorId: "muster",
      definitionId: MUSTER,
      origin: { x: 10, z: 6 },
      workerIds: ["cultivator"],
    }).accepted,
  ).toBe(true);
  untilSeconds(sim, () => !sim.actorById("muster")!.construction);
  const ready = sim.completedTicks - 1;
  train(sim, "sentinel", "circle-sentinel", "muster");
  untilSeconds(sim, () => !!sim.actorById("sentinel"));
  expect(player(sim)).toMatchObject({
    unitsProduced: 2,
    buildingsCompleted: 1,
    peakArmy: 1,
    spent: { materials: 0, lifebloom: 185 },
    milestones: {
      militaryReady: ready,
      firstCombatUnit: sim.completedTicks - 1,
    },
  });
  expect(player(sim).milestones.firstIncome).toBeUndefined();
  expect(roundtrip(sim).snapshot()).toEqual(sim.snapshot());
});

test("losing a producer retains its spending and does not count queued units as losses", () => {
  const state = initial();
  state.actors.find((actor) => actor.id === "barracks")!.health = 1;
  unit(state, "attacker", TROOPER, "rival", 11, 6);
  const sim = fixture(state);
  train(sim, "queued");
  expect(sim.actorById("barracks")).toBeUndefined();
  expect(sim.economy!.production).toEqual([]);
  expect(player(sim)).toMatchObject({
    unitsProduced: 0,
    unitsLost: 0,
    buildingsLost: 1,
    spent: { materials: 25, lifebloom: 0 },
  });
  expect(roundtrip(sim).metrics).toEqual(sim.metrics);
});

test("construction without an economy counts completion without payment", () => {
  const state = initial();
  delete state.economy;
  const skirmish = {
    ...rules,
    startingResourceSites: { player: [], rival: [] },
  };
  const sim = fixture(state, skirmish);
  expect(
    command(sim, {
      kind: "place-actor",
      actorId: "free",
      definitionId: BARRACKS,
      origin: { x: 6, z: 2 },
    }).accepted,
  ).toBe(true);
  expect(player(sim)).toMatchObject({
    buildingsCompleted: 1,
    spent: { materials: 0, lifebloom: 0 },
  });
  const restored = fixture(sim.snapshot(), skirmish);
  expect(restored.metrics).toEqual(sim.metrics);
});

test("peak army includes a unit produced and destroyed within one tick", () => {
  const state = initial();
  delete state.economy;
  delete state.fog;
  const gun = {
    ...structuredClone(definitions.find(({ id }) => id === CC)!),
    id: "test-armed-headquarters",
    weapon: {
      ...definitions.find(({ id }) => id === TROOPER)!.weapon!,
      damage: 200,
      range: 100,
    },
  };
  state.actors.find(({ id }) => id === "enemy")!.definitionId = gun.id;
  const skirmish = {
    ...rules,
    qualifyingDefinitionIds: [...rules.qualifyingDefinitionIds, gun.id],
    startingResourceSites: { player: [], rival: [] },
  };
  const sim = fixture(state, skirmish, false, [...definitions, gun]);
  sim.submitCommand({
    kind: "train-unit",
    actorId: "ephemeral",
    producerId: "barracks",
    definitionId: TROOPER,
  });
  sim.submitCommand(
    { kind: "attack", actorId: "enemy", targetId: "ephemeral" },
    { owner: "rival" },
  );
  expect(sim.tick().map(({ accepted }) => accepted)).toEqual([true, true]);
  expect(sim.actorById("ephemeral")).toBeUndefined();
  expect(player(sim)).toMatchObject({
    unitsProduced: 1,
    unitsLost: 1,
    peakArmy: 1,
  });
  expect(
    fixture(sim.snapshot(), skirmish, false, [...definitions, gun]).metrics,
  ).toEqual(sim.metrics);
});

test.each([false, true])(
  "rejects exploration history exceeding saved terrain memory (finished: %s)",
  (finished) => {
    const state = initial();
    state.fog = { explored: {} };
    const sim = fixture(state);
    advanceSeconds(sim, 5);
    if (finished)
      command(
        sim,
        { kind: "sell-actor", actorId: "enemy" },
        { owner: "rival" },
      );
    const saved = sim.snapshot();
    const history = saved.metrics!.owners[0]!.history;
    history[history.length - 1]!.explored = terrain.width * terrain.height;
    expect(() => fixture(saved)).toThrow("invalid match metrics");
  },
);

test.each(["production", "construction"])(
  "rejects spending below refundable %s payments",
  (kind) => {
    const sim = fixture();
    if (kind === "production") train(sim, "pending");
    else
      expect(
        command(sim, {
          kind: "place-actor",
          actorId: "pending",
          definitionId: BARRACKS,
          origin: { x: 6, z: 2 },
        }).accepted,
      ).toBe(true);
    const state = sim.snapshot();
    state.metrics!.owners[0]!.spent.materials = 0;
    expect(() => fixture(state)).toThrow("invalid match metrics");
  },
);

test("opponent engagement milestones must agree on their shared first hit", () => {
  const state = initial();
  unit(state, "attacker", TROOPER, "player", 28, 7);
  const sim = fixture(state);
  command(sim, { kind: "attack", actorId: "attacker", targetId: "enemy" });
  sim.tick();
  const saved = sim.snapshot();
  saved.metrics!.owners[1]!.milestones.firstEngagement = 1;
  expect(() => fixture(saved)).toThrow("invalid match metrics");
});

test("committed metrics share immutable history without exposing mutable counters", () => {
  const sim = fixture();
  const opening = sim.metrics!;
  sim.tick();
  const next = sim.metrics!;
  expect(next.owners[0]!.history).toBe(opening.owners[0]!.history);
  expect(Reflect.set(next.owners[0]!, "peakArmy", 99)).toBe(false);
  expect(Reflect.set(next.owners[0]!.milestones, "firstIncome", 99)).toBe(
    false,
  );
  expect(Reflect.set(next.owners[0]!.spent, "materials", 99)).toBe(false);
  expect(Reflect.set(next.owners[0]!.history[0]!, "units", 99)).toBe(false);
  advanceSeconds(sim, 4.9);
  const sampled = player(sim).history;
  expect(sampled).not.toBe(opening.owners[0]!.history);
  expect(sampled[0]).toBe(opening.owners[0]!.history[0]);
  expect(opening.owners[0]!.history).toHaveLength(1);
  expect(Reflect.set(sampled[1]!, "units", 99)).toBe(false);
});

test("explicit null cargo provenance is rejected even for an empty worker", () => {
  const state = createScenarioState(
    {
      ...scenario,
      units: [
        {
          actorId: "worker",
          definitionId: "arc-harvester",
          owner: "player",
          tile: { x: 14, z: 12 },
        },
      ],
    },
    definitions,
  );
  state.economy!.harvesters[0]!.cargoSources = null as never;
  expect(() => fixture(state)).toThrow("invalid economy state");
});

test("cultivation cargo capacity includes the fractional remainder", () => {
  const state = createScenarioState(
    {
      ...scenario,
      units: [
        {
          actorId: "worker",
          definitionId: "circle-cultivator",
          owner: "player",
          tile: { x: 14, z: 6 },
        },
      ],
    },
    definitions,
  );
  const capacity = definitions.find(({ id }) => id === "circle-cultivator")!
    .cultivation!.capacity;
  Object.assign(state.economy!.cultivation!.workers[0]!, {
    cargo: capacity,
    gatherProgress: 1,
    cargoSources: [{ siteId: "bloom-near", amount: capacity * 1000 + 1 }],
  });
  expect(() => fixture(state)).toThrow("invalid cultivation state");
});
