import { afterEach, expect, test } from "vitest";

import { BASE_CONTENT } from "./helpers/content";
import {
  actorIn,
  advanceTicks,
  balance,
  command,
  exploredScenarioState,
  playerOwners,
  savedState,
  setBalance,
  startMission,
  stockpiles,
} from "./helpers/scenario";
import { createTilePlacedActor } from "../src/simulation/placement";
import { createActor } from "../src/simulation/actor";
import { defineScenario } from "../src/simulation/scenario";
import { TerrainGrid } from "../src/simulation/terrain";
import {
  applyRepairStep,
  nextRepairStep,
  repairCharge,
} from "../src/simulation/repair";
import type { Actor, ActorDefinition } from "../src/simulation/actor";
import type {
  MissionSimulation,
  MissionState,
} from "../src/simulation/mission";

const CC = "arc-command-center-prototype";
const BARRACKS = "arc-field-barracks";
const HEART = "circle-heartgrove";
const MUSTER = "circle-musterhall";
const definitions: ActorDefinition[] = BASE_CONTENT.actors.map(
  (definition) => ({
    ...definition,
    ...(definition.footprint && { health: 100, constructionSeconds: 3 }),
    ...(definition.id === BARRACKS && { materialsCost: 101 }),
    ...(definition.id === MUSTER && { lifebloomCost: 101 }),
  }),
);
const definition = (id: string) =>
  definitions.find((entry) => entry.id === id)!;
const options = {
  width: 64,
  height: 24,
  tileSize: 1,
  terrainTypeIds: ["plain", "path", "rough", "water"],
};
const map = new TerrainGrid(options);
const scenario = defineScenario({
  id: "repair-test",
  ...playerOwners("arc"),
  tileSize: 1,
  terrainTypeIds: options.terrainTypeIds,
  terrain: map.terrainState(),
  stockpiles: stockpiles(2000),
  sites: [],
  loot: [],
  buildings: [
    { actorId: "cc", definitionId: CC, origin: { x: 2, z: 10 } },
    { actorId: "barracks", definitionId: BARRACKS, origin: { x: 8, z: 10 } },
  ],
});
const initial = () => {
  const state = exploredScenarioState(scenario, definitions);
  actorIn(state, "barracks").health = 87.6;
  return state;
};
const simulations: MissionSimulation[] = [];
afterEach(() => simulations.splice(0).forEach((sim) => sim.dispose()));
function fixture(
  state = initial(),
  tickSeconds = 0.1,
  idleUpdate = (_actor: Actor) => {},
) {
  const { simulation } = startMission(new TerrainGrid(options), {
    state,
    definitions,
    tickSeconds,
    idleUpdate,
  });
  simulations.push(simulation);
  return simulation;
}
const repair = (sim: MissionSimulation, actorId = "barracks") =>
  command(sim, { kind: "repair", actorId });
const cancel = (sim: MissionSimulation, actorId = "barracks") =>
  command(sim, { kind: "cancel-repair", actorId });
const addBuilding = (
  state: MissionState,
  id: string,
  definitionId: string,
  x: number,
  owner = "player",
) => {
  const actor = createTilePlacedActor(
    map,
    definition(definitionId),
    { actorId: id, origin: { x, z: 10 } },
    owner,
  );
  state.actors.push(actor);
  return actor;
};
const place = (sim: MissionSimulation, actorId = "new") =>
  command(sim, {
    kind: "place-actor",
    actorId,
    definitionId: BARRACKS,
    origin: { x: 8, z: 15 },
  });

test("repair pays before each second's health and rounds cumulative charges once", () => {
  const sim = fixture();
  expect(repair(sim).accepted).toBe(true);
  expect(balance(sim)).toBe(2000);
  expect(sim.actorById("barracks")!.health).toBe(87.6);
  advanceTicks(sim, 8);
  expect(balance(sim)).toBe(2000);
  sim.tick();
  expect(sim.actorById("barracks")!.health).toBeCloseTo(88.6);
  expect(balance(sim)).toBe(1999);
  advanceTicks(sim, 110);
  expect(sim.actorById("barracks")!.repair).toMatchObject({
    completedSteps: 12,
    paidCost: 7,
  });
  advanceTicks(sim, 10);
  // Absent health means undamaged.
  expect(sim.actorById("barracks")!.health).toBeUndefined();
  expect(sim.actorById("barracks")!.repair).toBeUndefined();
  expect(balance(sim)).toBe(1993);
});

test("later damage does not enlarge the job or interrupt production", () => {
  let damage = false;
  const sim = fixture(initial(), 1, (actor) => {
    if (damage && actor.id === "barracks") {
      actor.health! -= 20;
      damage = false;
    }
  });
  repair(sim);
  damage = true;
  expect(
    command(sim, {
      kind: "train-unit",
      producerId: "barracks",
      actorId: "trooper",
      definitionId: "arc-trooper",
    }).accepted,
  ).toBe(true);
  expect(sim.economy!.production[0]!.completedTicks).toBe(1);
  advanceTicks(sim, 11);
  expect(sim.actorById("barracks")!.health).toBeCloseTo(80);
  expect(sim.actorById("barracks")!.repair).toBeUndefined();
});

test("explicit recovery completes repair without payment and yields its slot", () => {
  let recover = false;
  const sim = fixture(initial(), 0.1, (actor) => {
    if (recover && actor.id === "barracks") {
      delete actor.health;
      recover = false;
    }
  });
  repair(sim);
  place(sim);
  recover = true;
  sim.tick();
  expect(sim.actorById("barracks")!.repair).toBeUndefined();
  expect(sim.actorById("new")!.construction).toMatchObject({
    active: true,
    completedTicks: 1,
  });
  expect(balance(sim)).toBe(1899);
});

test("a partly recovered building pays only for health its final step restores", () => {
  let recover = false;
  const state = initial();
  actorIn(state, "cc").health = 90;
  const target = fixture(state, 1, (actor) => {
    if (recover && actor.id === "cc") {
      actor.health = 99.9;
      recover = false;
    }
  });
  repair(target, "cc");
  const before = balance(target);
  recover = true;
  target.tick();
  expect(target.actorById("cc")!.repair).toBeUndefined();
  expect(target.actorById("cc")!.health).toBeUndefined();
  expect(balance(target)).toBe(before);
});

test("cancellation keeps restored health and charges; restarting goes behind waiting work", () => {
  const sim = fixture(initial(), 1);
  repair(sim);
  const health = sim.actorById("barracks")!.health;
  const before = balance(sim);
  place(sim);
  expect(sim.actorById("new")!.construction!.active).toBeUndefined();
  expect(cancel(sim).accepted).toBe(true);
  expect(sim.actorById("barracks")!.health).toBeGreaterThanOrEqual(health!);
  expect(balance(sim)).toBe(before - 101 - 1);
  expect(sim.actorById("new")!.construction!.active).toBe(true);
  repair(sim);
  expect(sim.actorById("barracks")!.repair!.active).toBeUndefined();
  expect(sim.actorById("barracks")!.repair!.priority).toBeGreaterThan(
    sim.actorById("new")!.construction!.priority!,
  );
});

test("unaffordable work yields capacity, then waits behind active construction", () => {
  const state = initial();
  setBalance(state, 101);
  const sim = fixture(state);
  repair(sim);
  place(sim);
  advanceTicks(sim, 8);
  expect(sim.actorById("barracks")!.repair).toMatchObject({
    unaffordable: true,
  });
  expect(sim.actorById("barracks")!.health).toBe(87.6);
  expect(sim.actorById("new")!.construction).toMatchObject({
    active: true,
    completedTicks: 1,
  });
  const resumed = savedState(scenario, sim);
  setBalance(resumed, 100);
  const funded = fixture(resumed);
  advanceTicks(funded, 10);
  expect(funded.actorById("barracks")!.repair!.unaffordable).toBeUndefined();
  expect(funded.actorById("barracks")!.repair!.active).toBeUndefined();
  advanceTicks(funded, 30);
  expect(funded.actorById("barracks")!.health).toBeGreaterThan(87.6);
});

test("active construction keeps its slot when an older blocked repair becomes connected", () => {
  const state = initial();
  addBuilding(state, "remote", BARRACKS, 20).health = 90;
  addBuilding(state, "relay", "arc-relay-station", 13);
  const sim = fixture(state, 1);
  repair(sim, "remote");
  sim.removeActor("relay");
  place(sim);
  expect(sim.actorById("remote")!.repair!.active).toBeUndefined();
  const health = sim.actorById("remote")!.health;
  const resume = savedState(scenario, sim);
  addBuilding(resume, "replacement", "arc-relay-station", 13);
  const restored = fixture(resume, 1);
  restored.tick();
  expect(restored.actorById("new")!.construction!.active).toBe(true);
  expect(restored.actorById("remote")!.health).toBe(health);
  advanceTicks(restored, 3);
  expect(restored.actorById("remote")!.health).toBeGreaterThan(health!);
});

test("payments follow repair priority across independent headquarters and pooled owners", () => {
  const state = initial();
  state.owners.push({ id: "ally", faction: "arc" });
  state.relationships.push({
    owners: ["player", "ally"],
    relationship: "allied",
    sharesResources: true,
  });
  state.economy!.stockpiles[0] = {
    resource: "materials",
    owners: ["player", "ally"],
    amount: 1,
  };
  addBuilding(state, "ally-root", CC, 42, "ally");
  addBuilding(state, "ally-building", BARRACKS, 48, "ally").health = 90;
  const sim = fixture(state);
  command(sim, { kind: "repair", actorId: "ally-building" }, { owner: "ally" });
  repair(sim);
  advanceTicks(sim, 8);
  expect(balance(sim)).toBe(0);
  expect(sim.actorById("ally-building")!.health).toBe(91);
  expect(sim.actorById("barracks")!.health).toBe(87.6);
  expect(sim.actorById("barracks")!.repair!.unaffordable).toBe(true);
});

test("an unaffordable older step blocks cheaper later steps sharing a balance", () => {
  const state = initial();
  setBalance(state, 1);
  actorIn(state, "cc").health = 90;
  addBuilding(state, "second", CC, 42);
  addBuilding(state, "later", BARRACKS, 48).health = 90;
  const sim = fixture(state);
  repair(sim, "cc");
  repair(sim, "later");
  advanceTicks(sim, 8);
  expect(sim.actorById("cc")!.repair!.unaffordable).toBe(true);
  expect(sim.actorById("later")!.repair!.unaffordable).toBe(true);
  expect(balance(sim)).toBe(1);
});

test("an unaffordable balance does not block another owner's independent balance", () => {
  const state = initial();
  setBalance(state, 1);
  actorIn(state, "cc").health = 90;
  state.owners.push({ id: "ally", faction: "arc" });
  state.economy!.stockpiles.push({
    resource: "materials",
    owners: ["ally"],
    amount: 1,
  });
  addBuilding(state, "ally-root", CC, 42, "ally");
  addBuilding(state, "ally-building", BARRACKS, 48, "ally").health = 90;
  const sim = fixture(state);
  repair(sim, "cc");
  command(sim, { kind: "repair", actorId: "ally-building" }, { owner: "ally" });
  advanceTicks(sim, 8);
  expect(sim.actorById("cc")!.health).toBe(90);
  expect(sim.actorById("ally-building")!.health).toBe(91);
  expect(balance(sim)).toBe(1);
  expect(balance(sim, "materials", "ally")).toBe(0);
});

test("shared headquarters spend the repaired building owner's resources", () => {
  const state = initial();
  state.owners.push({ id: "ally", faction: "arc" });
  state.relationships.push({
    owners: ["player", "ally"],
    relationship: "allied",
    sharesSupport: true,
    sharesHeadquarters: true,
  });
  state.economy!.stockpiles.push({
    resource: "materials",
    owners: ["ally"],
    amount: 1,
  });
  actorIn(state, "barracks").owner = "ally";
  const sim = fixture(state);
  command(sim, { kind: "repair", actorId: "barracks" }, { owner: "ally" });
  advanceTicks(sim, 9);
  expect(sim.actorById("barracks")!).toMatchObject({
    headquartersId: "cc",
    health: 88.6,
  });
  expect(balance(sim)).toBe(2000);
  expect(balance(sim, "materials", "ally")).toBe(0);
});

test("headquarters repair uses its own capacity and reassigns surviving work after loss", () => {
  const state = initial();
  addBuilding(state, "second", CC, 13);
  actorIn(state, "cc").health = 90;
  const sim = fixture(state, 1);
  repair(sim, "cc");
  repair(sim);
  expect(sim.actorById("barracks")!.repair!.active).toBeUndefined();
  sim.removeActor("cc");
  sim.tick();
  expect(sim.actorById("barracks")!).toMatchObject({
    headquartersId: "second",
    repair: { active: true, completedSteps: 1 },
  });
});

test("Circle repairs use Lifebloom and no tending worker or support chain", () => {
  const state = initial();
  state.actors = [];
  state.owners[0]!.faction = "circle";
  state.economy!.stockpiles = [
    { owners: ["player"], resource: "lifebloom", amount: 100 },
  ];
  addBuilding(state, "heart", HEART, 2);
  addBuilding(state, "muster", MUSTER, 48).health = 90;
  const sim = fixture(state, 1);
  expect(repair(sim, "muster").accepted).toBe(true);
  expect(sim.actorById("muster")!).toMatchObject({
    headquartersId: "heart",
    health: 91,
    repair: { active: true },
  });
  expect(balance(sim, "lifebloom")).toBe(99);
});

test("repair admission rejects invalid, foreign, full-health, unfinished, and duplicate work", () => {
  const state = initial();
  const sim = fixture(state);
  expect(repair(sim, "missing").reason).toBe("invalid-building");
  expect(repair(sim, "cc").reason).toBe("undamaged");
  expect(
    command(sim, { kind: "repair", actorId: "barracks" }, { owner: "wildlife" })
      .reason,
  ).toBe("unauthorized");
  place(sim);
  expect(repair(sim, "new").reason).toBe("invalid-building");
  repair(sim);
  expect(repair(sim).reason).toBe("already-repairing");
  expect(cancel(sim, "cc").reason).toBe("missing-repair");
});

test.each(["active", "queued", "unaffordable", "disconnected"] as const)(
  "save/load preserves %s work and continuation",
  (mode) => {
    const state = initial();
    if (mode === "unaffordable") setBalance(state, 0);
    const sim = fixture(state);
    if (mode === "queued") place(sim);
    repair(sim);
    if (mode === "disconnected") sim.removeActor("cc");
    advanceTicks(sim, 13);
    const resumed = fixture(savedState(scenario, sim));
    expect(resumed.snapshot()).toEqual(sim.snapshot());
    for (let tick = 0; tick < 45; tick++) {
      sim.tick();
      resumed.tick();
    }
    expect(resumed.snapshot()).toEqual(sim.snapshot());
  },
);

test("selling a building removes its repair without refunds", () => {
  const sim = fixture(initial(), 1);
  repair(sim);
  const spent = balance(sim);
  expect(
    command(sim, { kind: "sell-actor", actorId: "barracks" }).accepted,
  ).toBe(true);
  expect(balance(sim)).toBeGreaterThan(spent);
  const afterSale = balance(sim);
  advanceTicks(sim, 15);
  expect(balance(sim)).toBe(afterSale);
  expect(cancel(sim).reason).toBe("missing-repair");
});

test.each([
  { missingHealth: 0 },
  { missingHealth: 100 },
  { completedSteps: -1 },
  { completedSteps: 100 },
  { paidCost: 2 },
  { priority: 0 },
  { queuedTick: 1 },
  { active: "yes" },
  { active: true, unaffordable: true },
])("invalid saved repair state is rejected: %j", (invalid) => {
  const state = initial();
  actorIn(state, "barracks").repair = {
    missingHealth: 12.4,
    completedSteps: 0,
    paidCost: 0,
    priority: 1,
    queuedTick: 0,
    ...invalid,
  } as Actor["repair"];
  expect(() => fixture(state)).toThrow("invalid repair state");
});

test("saved infrastructure priorities are unique per owner", () => {
  const sim = fixture();
  place(sim);
  repair(sim);
  const state = savedState(scenario, sim);
  actorIn(state, "barracks").repair!.priority = actorIn(
    state,
    "new",
  ).construction!.priority!;
  expect(() => fixture(state)).toThrow("duplicate infrastructure priority");
});

test("a smaller final step pays only the remaining cumulative charge", () => {
  const actor = initial().actors.find((actor) => actor.id === "barracks")!;
  actor.repair = {
    missingHealth: 1.2,
    completedSteps: 1,
    paidCost: 1,
    priority: 1,
    queuedTick: 0,
  };
  expect(nextRepairStep(actor, definition(BARRACKS))).toMatchObject({
    cost: 0,
    complete: true,
  });
  expect(nextRepairStep(actor, definition(BARRACKS)).health).toBeCloseTo(0.2);
  expect(repairCharge(100, definition(BARRACKS))).toBe(51);
});

test("whole-unit boundaries tolerate floating-point arithmetic", () => {
  expect(
    repairCharge(100, {
      ...definition(BARRACKS),
      materialsCost: Number.MAX_SAFE_INTEGER,
    }),
  ).toBe(4503599627370496);
  expect(repairCharge(1e308, { ...definition(BARRACKS), health: 1e308 })).toBe(
    51,
  );
  expect(repairCharge(Number.EPSILON, definition(BARRACKS))).toBe(1);
  expect(
    repairCharge(7 / 100, {
      ...definition(BARRACKS),
      health: 7,
      materialsCost: 200,
    }),
  ).toBe(1);
  expect(
    repairCharge(7 / 100 + 0.001, {
      ...definition(BARRACKS),
      health: 7,
      materialsCost: 200,
    }),
  ).toBe(2);
});

test("large finite health still restores only one percent per step", () => {
  const actor = actorIn(initial(), "barracks");
  actor.health = 9e307;
  actor.repair = {
    missingHealth: 1e307,
    completedSteps: 1,
    paidCost: 1,
    priority: 1,
    queuedTick: 0,
  };
  const step = nextRepairStep(actor, {
    ...definition(BARRACKS),
    health: 1e308,
  });
  expect(step.complete).toBe(false);
  expect(step.health / 1e306).toBeCloseTo(1);
  expect(step.cost).toBe(1);
});

test("finishing a large-health job preserves damage beyond its recorded amount", () => {
  const actor = actorIn(initial(), "barracks");
  actor.health = 5e307;
  actor.repair = {
    missingHealth: 1e307,
    completedSteps: 9,
    paidCost: 5,
    priority: 1,
    queuedTick: 0,
  };
  const ledger = { stockpiles: stockpiles(1), deposited: [] };
  applyRepairStep(actor, { ...definition(BARRACKS), health: 1e308 }, ledger);
  expect(actor.repair).toBeUndefined();
  expect(actor.health! / 1e307).toBeCloseTo(5.1);
  expect(ledger.stockpiles[0]!.amount).toBe(0);
});

test("the final fractional step leaves exactly full health", () => {
  const state = initial();
  actorIn(state, "barracks").health = 100 * (1 - 0.844);
  const sim = fixture(state, 1);
  repair(sim);
  advanceTicks(sim, 84);
  expect(sim.actorById("barracks")!.repair).toBeUndefined();
  expect(sim.actorById("barracks")!.health).toBeUndefined();
  expect(repair(sim).reason).toBe("undamaged");
});

test("private repair state does not appear on a detected foreign building", () => {
  const sim = fixture();
  repair(sim);
  const state = savedState(scenario, sim);
  state.owners.push({ id: "observer", faction: "arc" });
  addBuilding(state, "observer-root", CC, 2, "observer");
  actorIn(state, "observer-root").tilePlacement!.origin.z = 4;
  const restored = fixture(state);
  const observed = restored.viewOf("observer").shownActor("barracks");
  expect(observed).toBeDefined();
  expect(observed).not.toHaveProperty("repair");
  expect(observed).not.toHaveProperty("headquartersId");
  expect(restored.viewOf("player").ownActor("barracks")!.repair).toBeDefined();
});

test("unseen opponents' jobs do not change an owner's queue metadata", () => {
  const state = initial();
  state.owners.push({ id: "rival", faction: "arc" });
  state.economy!.stockpiles.push({
    resource: "materials",
    owners: ["rival"],
    amount: 100,
  });
  addBuilding(state, "rival-root", CC, 42, "rival").health = 90;
  const left = fixture(state);
  const right = fixture(structuredClone(state));
  repair(left);
  right.submitCommand(
    { kind: "repair", actorId: "rival-root" },
    { owner: "rival" },
  );
  repair(right);
  expect(left.actorById("barracks")!.repair).toEqual(
    right.actorById("barracks")!.repair,
  );
});

test("repair requires a resource stockpile before any payment is due", () => {
  const state = initial();
  state.economy!.stockpiles = [];
  const sim = fixture(state);
  expect(repair(sim).reason).toBe("missing-resource");
});

test("saved repair cannot name a resource the owner does not hold", () => {
  const sim = fixture();
  repair(sim);
  const state = savedState(scenario, sim);
  state.economy!.stockpiles = [];
  expect(() => fixture(state)).toThrow("invalid economy state");
});

test("destruction prevents repair and payment in the same tick", () => {
  const state = initial();
  actorIn(state, "barracks").health = 1;
  state.actors.push(
    createActor({
      id: "attacker",
      definitionId: "arc-trooper",
      owner: "wildlife",
      worldPosition: map.tileCenter(8, 13),
    }),
  );
  const sim = fixture(state, 1);
  sim.submitCommand(
    { kind: "attack", actorId: "attacker", targetId: "barracks" },
    { owner: "wildlife" },
  );
  expect(repair(sim).accepted).toBe(true);
  expect(sim.actorById("barracks")).toBeUndefined();
  expect(balance(sim)).toBe(2000);
  advanceTicks(sim, 2);
  expect(balance(sim)).toBe(2000);
});

test("pending repair commands survive save/load and apply in submission order", () => {
  const sim = fixture();
  sim.submitCommand(
    { kind: "repair", actorId: "barracks" },
    { owner: "player" },
  );
  sim.submitCommand(
    { kind: "cancel-repair", actorId: "barracks" },
    { owner: "player" },
  );
  sim.submitCommand(
    { kind: "repair", actorId: "barracks" },
    { owner: "player" },
  );
  const restored = fixture(savedState(scenario, sim));
  expect(restored.tick()).toEqual(sim.tick());
  expect(restored.snapshot()).toEqual(sim.snapshot());
  expect(sim.actorById("barracks")!.repair).toBeDefined();
});
