import { afterEach, expect, test, vi } from "vitest";
import { BASE_CONTENT } from "./helpers/content";
import {
  actorIn,
  advanceTicks,
  balance,
  command,
  exploredScenarioState,
  playerOwners,
  savedState,
  startMission,
  stockpiles,
} from "./helpers/scenario";
import { createActor, isArmyUnit, isScoutUnit } from "../src/simulation/actor";
import { createTilePlacedActor } from "../src/simulation/placement";
import { defineScenario } from "../src/simulation/scenario";
import { TerrainGrid } from "../src/simulation/terrain";
import {
  serviceProvider,
  serviceRejection,
  updateUnitSupport,
  validateRestorationDefinition,
} from "../src/simulation/unit-support";
import { distance } from "../src/simulation/world";
import type { Actor, ActorDefinition } from "../src/simulation/actor";
import type {
  MissionSimulation,
  MissionState,
} from "../src/simulation/mission";

const options = {
  width: 64,
  height: 24,
  tileSize: 1,
  terrainTypeIds: ["plain", "path", "rough", "water"],
};
const map = new TerrainGrid(options);
const at = (x: number, z = 10) => map.tileCenter(x, z);
const definitions = new Map(
  BASE_CONTENT.actors.map((definition) => [definition.id, definition]),
);
const scenario = defineScenario({
  id: "unit-support-test",
  ...playerOwners("arc"),
  tileSize: 1,
  terrainTypeIds: options.terrainTypeIds,
  terrain: map.terrainState(),
  stockpiles: stockpiles(2000),
  sites: [],
  loot: [],
  buildings: [
    {
      actorId: "cc",
      definitionId: "arc-command-center-prototype",
      origin: { x: 2, z: 3 },
    },
    {
      actorId: "barracks",
      definitionId: "arc-field-barracks",
      origin: { x: 7, z: 3 },
    },
  ],
  units: [
    { actorId: "medic", definitionId: "arc-medic", tile: { x: 10, z: 10 } },
    { actorId: "trooper", definitionId: "arc-trooper", tile: { x: 11, z: 10 } },
    {
      actorId: "harvester",
      definitionId: "arc-harvester",
      tile: { x: 12, z: 10 },
    },
  ],
});
const initial = () => {
  const state = exploredScenarioState(scenario, BASE_CONTENT.actors);
  actorIn(state, "trooper").health = 20;
  actorIn(state, "harvester").health = 30;
  return state;
};
const simulations: MissionSimulation[] = [];
afterEach(() => simulations.splice(0).forEach((sim) => sim.dispose()));
function fixture(
  state = initial(),
  content: readonly ActorDefinition[] = BASE_CONTENT.actors,
) {
  const sim = startMission(new TerrainGrid(options), {
    state,
    definitions: content,
    tickSeconds: 0.1,
  }).simulation;
  simulations.push(sim);
  return sim;
}
const support = (
  sim: MissionSimulation,
  targetId = "trooper",
  actorId = "medic",
  queued = false,
) =>
  command(sim, {
    kind: "service",
    actorId,
    targetId,
    ...(queued && { queued }),
  });
const add = (
  state: MissionState,
  id: string,
  definitionId: string,
  x: number,
  z = 10,
) => {
  const actor = createActor({
    id,
    definitionId,
    owner: "player",
    worldPosition: at(x, z),
  });
  state.actors.push(actor);
  return actor;
};

test("support eligibility distinguishes personnel, machines, ownership, and buildings", () => {
  const state = initial();
  const medic = actorIn(state, "medic");
  const trooper = actorIn(state, "trooper");
  const harvester = actorIn(state, "harvester");
  const mechanic = add(state, "mechanic", "arc-mechanic", 13);
  const reject = (provider: Actor, target: Actor) =>
    serviceRejection(provider, target, definitions, state.actors);
  expect(reject(medic, trooper)).toBeUndefined();
  expect(reject(medic, harvester)).toBe("invalid-service-target");
  expect(reject(mechanic, harvester)).toBeUndefined();
  expect(reject(mechanic, trooper)).toBe("invalid-service-target");
  medic.health = 10;
  expect(reject(medic, medic)).toBe("invalid-service-target");
  expect(reject(medic, actorIn(state, "cc"))).toBe("invalid-service-target");
  trooper.owner = "wildlife";
  expect(reject(medic, trooper)).toBe("invalid-service-target");
  trooper.owner = "player";
  delete trooper.health;
  expect(reject(medic, trooper)).toBe("undamaged");
  trooper.health = 1;
  trooper.worldPosition = at(30);
  expect(reject(medic, trooper)).toBe("out-of-range");
  expect(reject(trooper, harvester)).toBe("invalid-provider");
});

test("one provider can serve several recovery kinds", () => {
  const state = initial();
  const artificer = add(state, "artificer", "arc-artificer", 13);
  const medic = definitions.get("arc-medic")!;
  const content = new Map(definitions).set("arc-artificer", {
    ...medic,
    id: "arc-artificer",
    restoration: {
      ...medic.restoration!,
      targetKinds: ["mechanical", "biological"],
    },
  });
  for (const id of ["trooper", "harvester"])
    expect(
      serviceRejection(artificer, actorIn(state, id), content, state.actors),
    ).toBeUndefined();
});

test("selected providers prefer the nearest admitted one, then explain", () => {
  const state = initial();
  const near = add(state, "near", "arc-medic", 12, 11);
  const busy = add(state, "busy", "arc-medic", 11, 11);
  const far = add(state, "far", "arc-medic", 40);
  const trooper = actorIn(state, "trooper");
  const choose = (...candidates: Actor[]) =>
    serviceProvider(trooper, candidates, definitions, state.actors)?.id;
  expect(choose(far, near)).toBe("near");
  busy.service = { targetId: "trooper", origin: at(11, 11) };
  expect(choose(near, busy)).toBe("busy");
  delete busy.service;
  expect(choose(far)).toBe("far");
  expect(choose(actorIn(state, "harvester"))).toBeUndefined();
});

test("idle acquisition is nearest-first with stable ties and no resource drain", () => {
  const state = initial();
  actorIn(state, "trooper").worldPosition = at(12);
  add(state, "a-scout", "arc-scout", 8).health = 1;
  state.actors.reverse();
  const sim = fixture(state);
  sim.tick();
  expect(sim.actorById("medic")!.service?.targetId).toBe("a-scout");
  expect(balance(sim)).toBe(2000);
  expect(sim.actorById("trooper")!.health).toBe(20);
  expect(sim.actorById("harvester")!.health).toBe(30);
});

test("one provider owns a target and a rejected priority preserves both orders", () => {
  const state = initial();
  add(state, "other-medic", "arc-medic", 11, 11);
  const sim = fixture(state);
  expect(support(sim).accepted).toBe(true);
  expect(sim.actorById("medic")!.service?.manual).toBe(true);
  expect(sim.actorById("other-medic")!.service).toBeUndefined();
  expect(support(sim, "trooper", "other-medic")).toMatchObject({
    accepted: false,
    reason: "target-busy",
  });
  expect(sim.actorById("medic")!.service?.manual).toBe(true);
  expect(sim.actorById("trooper")!.health).toBeCloseTo(21.2);
});

test("manual priority finishes at full health, then automatic support resumes", () => {
  const state = initial();
  actorIn(state, "trooper").health = 99.5;
  add(state, "scout", "arc-scout", 10, 11).health = 1;
  const sim = fixture(state);
  expect(support(sim).accepted).toBe(true);
  expect(sim.actorById("trooper")!.health).toBeUndefined();
  expect(sim.actorById("medic")!.service).toBeUndefined();
  sim.tick();
  expect(sim.actorById("medic")!.service?.targetId).toBe("scout");
});

test("Stop suppresses service for its tick and Move replaces it", () => {
  const sim = fixture();
  sim.tick();
  const before = sim.actorById("trooper")!.health;
  expect(command(sim, { kind: "stop", actorId: "medic" }).accepted).toBe(true);
  expect(sim.actorById("trooper")!.health).toBe(before);
  expect(sim.actorById("medic")!.service).toBeUndefined();
  sim.tick();
  expect(sim.actorById("trooper")!.health).toBeGreaterThan(before!);
  command(sim, { kind: "move", actorId: "medic", target: at(25) });
  advanceTicks(sim, 5);
  expect(sim.actorById("medic")!.service).toBeUndefined();
  expect(sim.actorById("medic")!.movement).toBeDefined();
});

test("queued service waits for Move and a queued Move waits for service completion", () => {
  const state = initial();
  actorIn(state, "trooper").worldPosition = at(16);
  actorIn(state, "trooper").health = 90;
  const sim = fixture(state);
  command(sim, { kind: "move", actorId: "medic", target: at(14) });
  expect(support(sim, "trooper", "medic", true).queued).toBe(true);
  expect(sim.actorById("medic")!.orders).toEqual([
    { kind: "service", targetId: "trooper" },
  ]);
  advanceTicks(sim, 15);
  expect(sim.actorById("medic")!.service?.manual).toBe(true);
  expect(
    command(sim, {
      kind: "move",
      actorId: "medic",
      target: at(25),
      queued: true,
    }).queued,
  ).toBe(true);
  advanceTicks(sim, 25);
  expect(sim.actorById("trooper")!.health).toBeUndefined();
  expect(sim.actorById("medic")!.movement?.target).toEqual(at(25));
});

test("pursuit release excludes the moving target until it returns to acquisition", () => {
  const state = initial();
  actorIn(state, "trooper").worldPosition = at(16);
  const sim = fixture(state);
  support(sim);
  command(sim, { kind: "move", actorId: "trooper", target: at(40) });
  advanceTicks(sim, 55);
  const medic = sim.actorById("medic")!;
  expect(medic.service).toBeUndefined();
  expect(medic.movement).toBeUndefined();
  expect(distance(medic.worldPosition, at(10))).toBeLessThanOrEqual(10);
  expect(medic.serviceExcluded).toEqual([
    { targetId: "trooper", origin: at(10) },
  ]);
  const position = medic.worldPosition;
  advanceTicks(sim, 10);
  expect(sim.actorById("medic")!.worldPosition).toEqual(position);
  command(sim, { kind: "move", actorId: "trooper", target: at(16) });
  advanceTicks(sim, 70);
  expect(sim.actorById("medic")!.serviceExcluded).toBeUndefined();
  expect(sim.actorById("medic")!.service?.targetId).toBe("trooper");
});

test("blocked service owns its retry state and retries only after relevant changes", () => {
  const state = initial();
  actorIn(state, "trooper").worldPosition = at(15);
  const destination = vi.fn(() => undefined);
  const move = vi.fn(() => false);
  const world = {
    actors: state.actors,
    definitions,
    tick: 0,
    tickSeconds: 0.1,
    navigationVersion: 0,
    move,
    destination,
  };
  for (let tick = 0; tick < 50; tick++) updateUnitSupport({ ...world, tick });
  expect(destination).toHaveBeenCalledTimes(1);
  expect(actorIn(state, "medic").service?.blocked).toBeDefined();
  updateUnitSupport({ ...world, navigationVersion: 1 });
  expect(destination).toHaveBeenCalledTimes(2);
  actorIn(state, "trooper").worldPosition = at(17);
  updateUnitSupport({ ...world, navigationVersion: 1 });
  expect(destination).toHaveBeenCalledTimes(3);
});

test.each(["healing", "pursuit", "exclusion", "stop", "queued"])(
  "saved %s continues exactly",
  (phase) => {
    const state = initial();
    if (phase !== "healing") actorIn(state, "trooper").worldPosition = at(16);
    const sim = fixture(state);
    support(sim);
    if (phase === "exclusion") {
      command(sim, { kind: "move", actorId: "trooper", target: at(40) });
      advanceTicks(sim, 20);
    }
    if (phase === "stop") command(sim, { kind: "stop", actorId: "medic" });
    if (phase === "queued")
      command(sim, {
        kind: "move",
        actorId: "medic",
        target: at(25),
        queued: true,
      });
    const resumed = fixture(savedState(scenario, sim));
    advanceTicks(sim, 75);
    advanceTicks(resumed, 75);
    expect(resumed.snapshot()).toEqual(sim.snapshot());
  },
);

test("a destroyed target releases its provider and cannot be revived", () => {
  const state = initial();
  add(state, "scout", "arc-scout", 10, 11).health = 1;
  const sim = fixture(state);
  support(sim);
  command(sim, { kind: "remove-actor", actorId: "trooper" });
  expect(sim.actorById("trooper")).toBeUndefined();
  expect(sim.actorById("medic")!.service?.targetId).toBe("scout");
});

test("Field Barracks trains both support units through its shared paid queue", () => {
  const sim = fixture();
  for (const role of ["medic", "mechanic"])
    expect(
      command(sim, {
        kind: "train-unit",
        producerId: "barracks",
        actorId: `new-${role}`,
        definitionId: `arc-${role}`,
      }).accepted,
    ).toBe(true);
  expect(balance(sim)).toBe(1920);
  expect(
    sim.economy!.production.map(({ definitionId }) => definitionId),
  ).toEqual(["arc-medic", "arc-mechanic"]);
  advanceTicks(sim, 60);
  expect(sim.actorById("new-medic")).toBeDefined();
  expect(sim.actorById("new-mechanic")).toBeUndefined();
  advanceTicks(sim, 60);
  expect(sim.actorById("new-mechanic")).toBeDefined();
});

test("support definitions cannot become scouts, army units, or armed providers", () => {
  for (const id of ["arc-medic", "arc-mechanic"]) {
    const definition = definitions.get(id)!;
    expect(isScoutUnit(definition)).toBe(false);
    expect(isArmyUnit(definition)).toBe(false);
    expect(() =>
      validateRestorationDefinition({
        ...definition,
        weapon: definitions.get("arc-trooper")!.weapon,
      }),
    ).toThrow(/restoration/);
    for (const targetKinds of [[], ["biological", "biological"], ["undead"]])
      expect(() =>
        validateRestorationDefinition({
          ...definition,
          restoration: { ...definition.restoration!, targetKinds },
        } as ActorDefinition),
      ).toThrow(/restoration/);
  }
  expect(() =>
    validateRestorationDefinition({
      ...definitions.get("arc-field-barracks")!,
      recoveryKind: "mechanical",
    }),
  ).toThrow(/recovery kind/);
});

test("malformed saves reject duplicate claims, unknown targets, and invalid retry state", () => {
  const state = initial();
  add(state, "other", "arc-medic", 11, 11);
  actorIn(state, "medic").service = { targetId: "trooper", origin: at(10) };
  actorIn(state, "other").service = { targetId: "trooper", origin: at(11, 11) };
  expect(() => fixture(state)).toThrow(/service target/);
  delete actorIn(state, "other").service;
  actorIn(state, "medic").service!.targetId = "missing";
  expect(() => fixture(state)).toThrow(/service target/);
  actorIn(state, "medic").service!.targetId = "trooper";
  actorIn(state, "medic").service!.blocked = {
    at: at(12),
    navigationVersion: -1,
  };
  expect(() => fixture(state)).toThrow(/service state/);
});

test("Mechanic restores a raid survivor without changing its cargo or assignment", () => {
  const state = initial();
  add(state, "mechanic", "arc-mechanic", 12, 11);
  const enemy = add(state, "raider", "arc-trooper", 15);
  enemy.owner = "wildlife";
  const worker = state.economy!.harvesters.find(
    ({ actorId }) => actorId === "harvester",
  )!;
  state.actors.push(
    createTilePlacedActor(
      map,
      definitions.get("arc-materials-refinery")!,
      { actorId: "refinery", origin: { x: 13, z: 3 } },
      "player",
    ),
  );
  worker.refineryId = "refinery";
  worker.phase = "idle";
  worker.cargo = 5;
  state.economy!.sites.push({
    id: "source",
    name: "Source",
    tile: { x: 40, z: 20 },
    initialMaterials: 100,
    remainingMaterials: 95,
  });
  worker.cargoSources = [{ siteId: "source", amount: 5000 }];
  const sim = fixture(state);
  const before = structuredClone(sim.economy!.harvesters[0]);
  expect(
    command(
      sim,
      { kind: "attack", actorId: "raider", targetId: "harvester" },
      { owner: "wildlife" },
    ).accepted,
  ).toBe(true);
  const afterHit = sim.actorById("harvester")!.health!;
  expect(afterHit).toBeLessThan(30);
  command(
    sim,
    { kind: "remove-actor", actorId: "raider" },
    { owner: "wildlife" },
  );
  const resumed = fixture(savedState(scenario, sim));
  advanceTicks(sim, 30);
  advanceTicks(resumed, 30);
  expect(sim.actorById("harvester")!.health).toBeGreaterThan(30);
  expect(sim.economy!.harvesters[0]).toEqual(before);
  expect(resumed.snapshot()).toEqual(sim.snapshot());
});

test("lethal combat resolves before support and releases the lost target", () => {
  const state = initial();
  add(state, "mechanic", "arc-mechanic", 12, 11);
  actorIn(state, "harvester").health = 1;
  const enemy = add(state, "raider", "arc-trooper", 15);
  enemy.owner = "wildlife";
  const sim = fixture(state);
  command(
    sim,
    { kind: "attack", actorId: "raider", targetId: "harvester" },
    { owner: "wildlife" },
  );
  expect(sim.actorById("harvester")).toBeUndefined();
  expect(sim.actorById("mechanic")!.service).toBeUndefined();
});

test("an unreachable bounded route waits through saves and resumes after terrain changes", () => {
  const state = initial();
  actorIn(state, "trooper").worldPosition = at(18);
  state.terrain = new TerrainGrid({
    ...options,
    createTerrain: (x) => ({ typeId: x === 14 ? "water" : "plain" }),
  }).terrainState();
  const sim = fixture(state);
  expect(support(sim).accepted).toBe(true);
  advanceTicks(sim, 15);
  expect(sim.actorById("medic")!.service?.blocked).toBeDefined();
  expect(sim.actorById("medic")!.movement).toBeUndefined();
  const resumed = fixture(savedState(scenario, sim));
  const terrain = {
    kind: "terrain" as const,
    tiles: [{ x: 14, z: 10, terrain: { typeId: "plain" } }],
  };
  command(sim, terrain, { script: true });
  command(resumed, terrain, { script: true });
  advanceTicks(sim, 30);
  advanceTicks(resumed, 30);
  expect(sim.actorById("trooper")!.health).toBeGreaterThan(20);
  expect(sim.actorById("medic")!.service?.blocked).toBeUndefined();
  expect(resumed.snapshot()).toEqual(sim.snapshot());
});

test("a new manual priority resets a released target's pursuit origin", () => {
  const state = initial();
  actorIn(state, "medic").worldPosition = at(20);
  actorIn(state, "medic").serviceExcluded = [
    { targetId: "trooper", origin: at(10) },
  ];
  actorIn(state, "trooper").worldPosition = at(24);
  const sim = fixture(state);
  expect(support(sim).accepted).toBe(true);
  expect(sim.actorById("medic")!.serviceExcluded).toBeUndefined();
  expect(sim.actorById("medic")!.service!.origin).toEqual(at(20));
  command(sim, { kind: "move", actorId: "trooper", target: at(40) });
  advanceTicks(sim, 40);
  expect(sim.actorById("medic")!.serviceExcluded).toEqual([
    { targetId: "trooper", origin: at(20) },
  ]);
});

test.each([
  "unbounded",
  "different-center",
  "different-radius",
  "outside-origin",
  "attack-move",
  "blocked-route",
])(
  "saved service rejects %s movement that cannot preserve its pursuit contract",
  (variant) => {
    const state = initial();
    actorIn(state, "trooper").worldPosition = at(18);
    const sim = fixture(state);
    support(sim);
    const snapshot = savedState(scenario, sim);
    const provider = actorIn(snapshot, "medic");
    expect(provider.movement?.bounds).toBeDefined();
    switch (variant) {
      case "unbounded":
        delete provider.movement!.bounds;
        break;
      case "different-center":
        provider.movement!.bounds!.center = at(11);
        break;
      case "different-radius":
        provider.movement!.bounds!.radius = 20;
        break;
      case "outside-origin":
        provider.service!.origin = at(40);
        break;
      case "attack-move":
        provider.attackMove = { target: at(18) };
        break;
      case "blocked-route":
        provider.service!.blocked = { at: at(18), navigationVersion: 0 };
        break;
    }
    expect(() => fixture(snapshot)).toThrow(/service/);
  },
);

test("restoration validation rejects sparse target kinds", () => {
  const definition = structuredClone(definitions.get("arc-medic")!);
  definition.restoration!.targetKinds = new Array(1);
  expect(() => validateRestorationDefinition(definition)).toThrow(
    /restoration/,
  );
});

test("full recovery clears pursuit exclusions before next-tick raid damage", () => {
  const state = initial();
  actorIn(state, "trooper").health = 99.5;
  actorIn(state, "medic").serviceExcluded = [
    { targetId: "trooper", origin: at(0) },
  ];
  add(state, "other-medic", "arc-medic", 12);
  const sim = fixture(state);
  sim.tick();
  expect(sim.actorById("trooper")!.health).toBeUndefined();
  const resumed = fixture(savedState(scenario, sim));
  for (const mission of [sim, resumed]) {
    mission.spawnActor(
      createActor({
        id: "raider",
        definitionId: "arc-trooper",
        owner: "wildlife",
        worldPosition: at(15),
      }),
    );
    command(
      mission,
      { kind: "attack", actorId: "raider", targetId: "trooper" },
      { owner: "wildlife" },
    );
    expect(mission.actorById("medic")!.service?.targetId).toBe("trooper");
    expect(mission.actorById("medic")!.serviceExcluded).toBeUndefined();
  }
  expect(resumed.snapshot()).toEqual(sim.snapshot());
});

test.each(["unknown", "claimed"])(
  "spawning a provider rejects %s targets without changing the mission",
  (variant) => {
    const sim = fixture();
    support(sim);
    const provider = createActor({
      id: "new-provider",
      definitionId: "arc-medic",
      owner: "player",
      worldPosition: at(12),
    });
    provider.service = {
      targetId: variant === "unknown" ? "missing" : "trooper",
      origin: at(12),
    };
    const before = sim.snapshot();
    expect(() => sim.spawnActor(provider)).toThrow(/service target/);
    expect(sim.snapshot()).toEqual(before);
    delete provider.service;
    sim.spawnActor(provider);
    expect(sim.actorById(provider.id)).toBeDefined();
  },
);

test("saved service rejects a target on another tactical layer", () => {
  const state = initial();
  actorIn(state, "trooper").occupancyLayer = "air";
  actorIn(state, "medic").service = { targetId: "trooper", origin: at(10) };
  expect(() => fixture(state)).toThrow(/service target/);
});

test("sparse pursuit exclusions reject with a service-state explanation", () => {
  const state = initial();
  actorIn(state, "medic").serviceExcluded = new Array(1);
  expect(() => fixture(state)).toThrow(/service exclusions/);
});
