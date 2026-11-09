import { afterEach, expect, test } from "vitest";

import { BASE_CONTENT } from "./helpers/content";
import {
  actorIn,
  advanceSeconds,
  balance,
  command,
  exploredFog,
  startMission,
  stockpiles,
} from "./helpers/scenario";
import { createActor } from "../src/simulation/actor";
import { createObjectiveStates } from "../src/simulation/objectives";
import { parseMission, serializeMission } from "../src/simulation/mission-file";
import {
  createScenarioMap,
  createScenarioState,
  defineScenario,
} from "../src/simulation/scenario";
import { TerrainGrid } from "../src/simulation/terrain";
import { evaluateSkirmish } from "../src/simulation/skirmish";

import type { ObjectiveDefinition } from "../src/simulation/objectives";
import type { SkirmishRules } from "../src/simulation/skirmish";
import type {
  MissionSimulation,
  MissionState,
} from "../src/simulation/mission";
import type { ActorPlacement } from "../src/simulation/placement";

const CC = "arc-command-center-prototype";
const BARRACKS = "arc-field-barracks";
const HEART = "circle-heartgrove";
const CONSERVATORY = "circle-conservatory";
const rules: SkirmishRules = {
  owners: ["player", "rival"],
  startingResourceSites: { player: [], rival: [] },
  qualifyingDefinitionIds: [
    CC,
    BARRACKS,
    "arc-materials-refinery",
    HEART,
    CONSERVATORY,
    "circle-musterhall",
  ],
};
const terrain = new TerrainGrid({
  width: 40,
  height: 24,
  tileSize: 1,
  terrainTypeIds: ["plain"],
});
const building = (
  actorId: string,
  definitionId = CC,
  x = 2,
  owner = "player",
  z = 6,
) => ({
  actorId,
  definitionId,
  owner,
  origin: { x, z },
});
const scenario = defineScenario({
  id: "skirmish-test",
  tileSize: 1,
  terrainTypeIds: ["plain", "path", "rough", "water"],
  terrain: terrain.terrainState(),
  owners: [
    { id: "player", faction: "arc" },
    { id: "rival", faction: "arc" },
  ],
  playerOwner: "player",
  relationships: [{ owners: ["player", "rival"], relationship: "hostile" }],
  skirmish: rules,
  emergencyHeadquarters: true,
  buildings: [building("home"), building("enemy", CC, 30, "rival")],
  stockpiles: [
    ...stockpiles(1000),
    ...stockpiles(1000, "materials", "rival"),
    ...stockpiles(1000, "lifebloom"),
  ],
  sites: [],
  loot: [],
  cultivation: { sites: [] },
});
const simulations: MissionSimulation[] = [];
afterEach(() => simulations.splice(0).forEach((sim) => sim.dispose()));
const initial = (
  buildings: (ActorPlacement & { owner?: string })[] = scenario.buildings.map(
    (b) => ({ ...b }),
  ),
) => {
  const state = createScenarioState(
    { ...scenario, buildings },
    BASE_CONTENT.actors,
  );
  state.fog = exploredFog(state);
  return state;
};
function fixture(
  state = initial(),
  {
    skirmish = rules,
    fault = false,
    objectives = [],
  }: {
    skirmish?: SkirmishRules | null;
    fault?: boolean;
    objectives?: readonly ObjectiveDefinition[];
  } = {},
) {
  const map = createScenarioMap({ ...scenario, terrain: state.terrain! });
  const { simulation } = startMission(map, {
    state,
    skirmish: skirmish ?? undefined,
    objectives,
    emergencyHeadquarters: scenario.emergencyHeadquarters,
    definitions: BASE_CONTENT.actors,
    tickSeconds: 0.1,
    idleUpdate: () => {
      if (fault) throw new Error("test fault");
    },
  });
  simulations.push(simulation);
  return simulation;
}
const remove = (sim: MissionSimulation, actorId: string, owner = "player") =>
  sim.submitCommand({ kind: "sell-actor", actorId }, { owner });
const pending = (state: MissionState, id: string, remainingTicks = 100) => {
  const actor = actorIn(state, id);
  const definition = BASE_CONTENT.actors.find(
    ({ id }) => id === actor.definitionId,
  )!;
  const totalTicks = Math.round(definition.constructionSeconds! / 0.1);
  actor.construction = {
    paidCost: definition.materialsCost ?? definition.lifebloomCost!,
    completedTicks: Math.max(0, totalTicks - remainingTicks),
    totalTicks,
  };
  if (actor.headquartersId === actor.id) delete actor.headquartersId;
};

test.each(["player", "rival"])(
  "selling %s's last building resolves from the player's perspective",
  (owner) => {
    const sim = fixture();
    remove(sim, owner === "player" ? "home" : "enemy", owner);
    expect(sim.result).toBeUndefined();
    expect(sim.tick()[0].accepted).toBe(true);
    expect(sim.result).toEqual({
      kind: owner === "player" ? "defeat" : "victory",
      tick: 0,
      eliminatedOwners: [owner],
    });
    const final = sim.snapshot();
    advanceSeconds(sim, 2);
    expect(sim.snapshot()).toEqual(final);
    expect(() => remove(sim, "enemy", "rival")).toThrow("mission has ended");
  },
);

test.each([false, true])(
  "same-tick sales draw regardless of actor and command order (%s)",
  (reverse) => {
    const state = initial();
    if (reverse) state.actors.reverse();
    const sim = fixture(state);
    for (const owner of reverse ? ["rival", "player"] : ["player", "rival"])
      remove(sim, owner === "player" ? "home" : "enemy", owner);
    expect(sim.tick().every(({ accepted }) => accepted)).toBe(true);
    expect(sim.result).toEqual({
      kind: "draw",
      tick: 0,
      eliminatedOwners: ["player", "rival"],
    });
  },
);

test("disconnected completed buildings and economic stalls do not eliminate their owner", () => {
  const state = initial([
    ...scenario.buildings,
    building("stranded", BARRACKS, 15),
  ]);
  for (const stockpile of state.economy!.stockpiles) stockpile.amount = 0;
  const sim = fixture(state);
  sim.removeActor("home");
  sim.tick();
  expect(
    sim.support!.nodes.find(({ actorId }) => actorId === "stranded")!.connected,
  ).toBe(false);
  advanceSeconds(sim, 10);
  expect(balance(sim)).toBe(0);
  expect(sim.result).toBeUndefined();
});

test("unfinished construction and surviving mobile units do not prevent elimination", () => {
  const state = initial([
    ...scenario.buildings,
    building("unfinished", BARRACKS, 8),
  ]);
  pending(state, "unfinished");
  state.actors.push(
    createActor({
      id: "worker",
      definitionId: "arc-trooper",
      owner: "player",
      worldPosition: terrain.tileCenter(4, 15),
    }),
  );
  const sim = fixture(state);
  remove(sim, "home");
  sim.tick();
  expect(sim.actorById("unfinished")!.construction).toBeDefined();
  expect(sim.result?.kind).toBe("defeat");
});

test.each([true, false])(
  "replacement completion at the elimination checkpoint counts only when ready (%s)",
  (ready) => {
    const state = initial([
      ...scenario.buildings,
      building("replacement", CC, 8),
    ]);
    pending(state, "replacement", ready ? 1 : 2);
    const sim = fixture(state);
    remove(sim, "home");
    sim.tick();
    if (ready) {
      expect(sim.actorById("replacement")!.construction).toBeUndefined();
      expect(sim.result).toBeUndefined();
      remove(sim, "replacement");
      sim.tick();
      expect(sim.result).toMatchObject({ kind: "defeat", tick: 1 });
    } else {
      expect(sim.actorById("replacement")!.construction!.completedTicks).toBe(
        119,
      );
      expect(sim.result?.kind).toBe("defeat");
    }
  },
);

test("lost support cannot finish a final-tick blueprint", () => {
  const state = initial([
    ...scenario.buildings,
    building("unfinished", BARRACKS, 8),
  ]);
  pending(state, "unfinished", 1);
  const sim = fixture(state);
  remove(sim, "home");
  sim.tick();
  expect(sim.actorById("unfinished")!.construction!.completedTicks).toBe(79);
  expect(sim.result?.kind).toBe("defeat");
});

test("emergency recovery pays normally while a completed building keeps the owner alive", () => {
  const sim = fixture(
    initial([...scenario.buildings, building("survivor", BARRACKS, 8)]),
  );
  remove(sim, "home");
  sim.tick();
  const before = balance(sim);
  expect(
    command(sim, { kind: "place-actor", ...building("replacement", CC, 12) })
      .accepted,
  ).toBe(true);
  expect(balance(sim)).toBe(before - 300);
  expect(sim.actorById("replacement")!.construction).toMatchObject({
    completedTicks: 1,
    totalTicks: 120,
  });
  advanceSeconds(sim, 12);
  expect(sim.actorById("replacement")!.construction).toBeUndefined();
  remove(sim, "survivor");
  sim.tick();
  expect(sim.result).toBeUndefined();
});

test.each(["victory", "defeat", "draw"] as const)(
  "%s remains frozen through a mission-file round trip",
  (kind) => {
    const sim = fixture();
    if (kind !== "victory") remove(sim, "home");
    if (kind !== "defeat") remove(sim, "enemy", "rival");
    sim.tick();
    const file = parseMission(
      serializeMission(scenario, sim.snapshot(), 0.1),
      0.1,
    );
    expect(file.scenario.skirmish).toEqual(rules);
    const restored = fixture(file.state, { skirmish: file.scenario.skirmish });
    expect(restored.result?.kind).toBe(kind);
    restored.tick();
    expect(restored.snapshot()).toEqual(sim.snapshot());
  },
);

test("an in-progress save continues identically through elimination", () => {
  const sim = fixture();
  sim.tick();
  remove(sim, "enemy", "rival");
  const file = parseMission(
    serializeMission(scenario, sim.snapshot(), 0.1),
    0.1,
  );
  const restored = fixture(file.state, { skirmish: file.scenario.skirmish });
  sim.tick();
  restored.tick();
  expect(restored.snapshot()).toEqual(sim.snapshot());
  expect(sim.result?.kind).toBe("victory");
});

test("a failed tick publishes neither the sales nor a result", () => {
  const sim = fixture(initial(), { fault: true });
  remove(sim, "home");
  const before = sim.snapshot();
  expect(() => sim.tick()).toThrow("test fault");
  expect(sim.snapshot()).toEqual(before);
  expect(sim.result).toBeUndefined();
});

test.each([
  { owners: ["player", "player"] },
  { owners: ["player", "missing"] },
  { owners: ["rival", "missing"] },
  { qualifyingDefinitionIds: ["arc-trooper"] },
  { qualifyingDefinitionIds: ["unknown"] },
  { qualifyingDefinitionIds: [] },
  { qualifyingDefinitionIds: [CC, CC] },
])("rejects malformed skirmish rules: %j", (change) => {
  expect(() =>
    fixture(initial(), { skirmish: { ...rules, ...change } as SkirmishRules }),
  ).toThrow("invalid skirmish rules");
});

test("skirmish rules cannot accompany campaign objectives", () => {
  const objectives: ObjectiveDefinition[] = [
    {
      id: "hold",
      kind: "protect",
      label: "Hold",
      directive: "Hold the base.",
      actorIds: ["home"],
    },
  ];
  const state = initial();
  state.objectives = createObjectiveStates(objectives);
  expect(() => fixture(state, { objectives })).toThrow(
    "invalid skirmish rules",
  );
});

test("a saved result requires skirmish rules", () => {
  const sim = fixture();
  remove(sim, "home");
  sim.tick();
  expect(() => fixture(sim.snapshot(), { skirmish: null })).toThrow(
    "skirmish result without rules",
  );
});

test.each(["kind", "tick", "owners", "commands"])(
  "rejects inconsistent saved results: %s",
  (field) => {
    const sim = fixture();
    remove(sim, "home");
    sim.tick();
    const state = sim.snapshot();
    if (field === "kind") state.skirmishResult!.kind = "victory";
    if (field === "tick") state.skirmishResult!.tick++;
    if (field === "owners") state.skirmishResult!.eliminatedOwners = ["rival"];
    if (field === "commands")
      state.commands.push({
        tick: state.tick,
        issuer: { owner: "rival" },
        command: { kind: "sell-actor", actorId: "enemy" },
      });
    expect(() => fixture(state)).toThrow("invalid skirmish result");
  },
);

test("authored defenses count while relays and other owners do not", () => {
  const state = initial();
  const defense = { ...state.actors[0], definitionId: "test-defense" };
  const actors = [defense, state.actors[1]];
  const testRules = {
    ...rules,
    qualifyingDefinitionIds: [...rules.qualifyingDefinitionIds, "test-defense"],
  };
  expect(evaluateSkirmish(testRules, actors, "player", 4)).toBeUndefined();
  expect(evaluateSkirmish(rules, actors, "player", 4)?.kind).toBe("defeat");
  defense.definitionId = "test-relay";
  expect(evaluateSkirmish(testRules, actors, "player", 4)?.kind).toBe("defeat");
  defense.definitionId = "test-defense";
  defense.owner = "ally";
  expect(evaluateSkirmish(testRules, actors, "player", 4)?.kind).toBe("defeat");
});

test.each([false, true])(
  "simultaneous lethal combat draws regardless of actor order (%s)",
  (reverse) => {
    const state = initial();
    for (const actor of state.actors) actor.health = 1;
    for (const [id, owner, x] of [
      ["home-attacker", "rival", 6],
      ["enemy-attacker", "player", 28],
    ] as const)
      state.actors.push(
        createActor({
          id,
          owner,
          definitionId: "arc-trooper",
          worldPosition: terrain.tileCenter(x, 7),
        }),
      );
    if (reverse) state.actors.reverse();
    const sim = fixture(state);
    sim.submitCommand(
      { kind: "attack", actorId: "home-attacker", targetId: "home" },
      { owner: "rival" },
    );
    sim.submitCommand({
      kind: "attack",
      actorId: "enemy-attacker",
      targetId: "enemy",
    });
    expect(sim.tick().every(({ accepted }) => accepted)).toBe(true);
    expect(sim.attacks).toHaveLength(2);
    expect(sim.result).toEqual({
      kind: "draw",
      tick: 0,
      eliminatedOwners: ["player", "rival"],
    });
  },
);

test.each(["tended", "stopped", "untended"] as const)(
  "a final-tick emergency Heartgrove respects %s work",
  (work) => {
    const state = initial([
      building("home", HEART),
      building("replacement", HEART, 8),
      building("enemy", CC, 30, "rival"),
    ]);
    state.owners[0].faction = "circle";
    pending(state, "replacement", 1);
    if (work !== "untended") {
      state.actors.push(
        createActor({
          id: "tender",
          owner: "player",
          definitionId: "circle-cultivator",
          worldPosition: terrain.tileCenter(7, 7),
        }),
      );
      state.economy!.cultivation!.workers.push({
        actorId: "tender",
        cargo: 0,
        gatherProgress: 0,
        rateProgress: 0,
        tendingId: "replacement",
        phase: "tending",
      });
    }
    const sim = fixture(state);
    remove(sim, "home");
    if (work === "stopped")
      sim.submitCommand({ kind: "stop", actorId: "tender" });
    expect(sim.tick().every(({ accepted }) => accepted)).toBe(true);
    if (work === "tended") {
      expect(sim.actorById("replacement")!.construction).toBeUndefined();
      expect(sim.result).toBeUndefined();
    } else {
      expect(sim.actorById("replacement")!.construction!.completedTicks).toBe(
        119,
      );
      expect(sim.result?.kind).toBe("defeat");
    }
  },
);

test("completed Circle buildings survive loss of their Heartgrove", () => {
  const state = initial([
    building("home", HEART),
    building("survivor", CONSERVATORY, 15),
    building("enemy", CC, 30, "rival"),
  ]);
  state.owners[0].faction = "circle";
  const sim = fixture(state);
  remove(sim, "home");
  sim.tick();
  expect(sim.result).toBeUndefined();
  remove(sim, "survivor");
  sim.tick();
  expect(sim.result?.kind).toBe("defeat");
});

test("a finished save cannot drop its result and resume", () => {
  const sim = fixture();
  remove(sim, "home");
  sim.tick();
  const state = sim.snapshot();
  delete state.skirmishResult;
  expect(() => fixture(state)).toThrow("missing its skirmish result");
});

test.each(["spawn", "remove"] as const)(
  "live skirmishes reject direct %s hooks without changing saved state",
  (operation) => {
    const sim = fixture();
    const scout = createActor({
      id: "setup-scout",
      definitionId: "arc-scout",
      owner: "player",
      worldPosition: terrain.tileCenter(4, 15),
    });
    sim.spawnActor(scout);
    expect(sim.removeActor(scout.id)).toBe(true);
    sim.tick();
    const before = sim.snapshot();
    expect(() => {
      if (operation === "remove") sim.removeActor("home");
      else sim.spawnActor({ ...scout, id: "late-scout" });
    }).toThrow("Use commands to change actors after a skirmish starts.");
    expect(sim.snapshot()).toEqual(before);
    const restored = fixture(before);
    remove(sim, "home");
    remove(restored, "home");
    sim.tick();
    restored.tick();
    expect(restored.snapshot()).toEqual(sim.snapshot());
    expect(sim.result?.kind).toBe("defeat");
  },
);
