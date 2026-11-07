import { expect, test } from "vitest";
import { LEVEL_SOURCES } from "../src/content/levels";
import {
  assembleSkirmish,
  createSessionSimulation,
  loadLevel,
  loadMission,
} from "../src/mission-loading";
import { createActor } from "../src/simulation/actor";
import { SIMULATION_TICK_SECONDS } from "../src/simulation/clock";
import {
  DIFFICULTIES,
  DIFFICULTY_IDS,
  resolveSetup,
} from "../src/simulation/mission-setup";
import { serializeMission } from "../src/simulation/mission-file";
import { createScenarioMap } from "../src/simulation/scenario";
import { BASE_CONTENT } from "./helpers/content";

import type { LoadedMission } from "../src/mission-loading";
import type { Difficulty } from "../src/simulation/mission-setup";
import type { MissionSimulation } from "../src/simulation/mission";

const WEAPON_DAMAGE = BASE_CONTENT.actors.find(
  ({ id }) => id === "arc-trooper",
)!.weapon!.damage;
const MAX_HEALTH = BASE_CONTENT.actors.find(
  ({ id }) => id === "arc-trooper",
)!.health!;

function mission(difficulty: Difficulty) {
  return assembleSkirmish({
    factions: { west: "arc", east: "arc" },
    playerSlot: "west",
    difficulty,
  });
}

/** A skirmish with one player trooper beside one enemy trooper. */
function duel(loaded: LoadedMission) {
  const simulation = createSessionSimulation(loaded);
  const map = createScenarioMap({
    ...loaded.scenario,
    terrain: loaded.state.terrain,
  });
  for (const [id, owner, x] of [
    ["ours", "west", 30],
    ["theirs", "east", 32],
  ] as const)
    simulation.spawnActor(
      createActor({
        id,
        definitionId: "arc-trooper",
        owner,
        worldPosition: map.tileCenter(x, 50),
      }),
    );
  return simulation;
}

const lost = (simulation: MissionSimulation, id: string) =>
  MAX_HEALTH - (simulation.actorById(id)!.health ?? MAX_HEALTH);

function firstExchange(simulation: MissionSimulation) {
  for (let tick = 0; tick < 3000; tick++) {
    simulation.tick();
    if (lost(simulation, "ours") && lost(simulation, "theirs")) return;
  }
  throw new Error("The troopers never exchanged fire.");
}

test.each(DIFFICULTY_IDS)(
  "%s scales enemy damage and effective health only",
  (difficulty) => {
    const { scale } = DIFFICULTIES[difficulty];
    const simulation = duel(mission(difficulty));
    firstExchange(simulation);
    expect(lost(simulation, "ours")).toBeCloseTo(WEAPON_DAMAGE * scale, 9);
    expect(lost(simulation, "theirs")).toBeCloseTo(WEAPON_DAMAGE / scale, 9);
    simulation.dispose();
  },
);

test("difficulty leaves stocks and the opening unchanged", () => {
  const opening = ({ state }: LoadedMission) => [
    state.actors,
    state.economy!.stockpiles,
    state.economy!.sites,
  ];
  expect(opening(mission("hard"))).toEqual(opening(mission("easy")));
});

test("caller changes cannot alter a running mission's scaling", () => {
  const loaded = mission("hard");
  const simulation = duel(loaded);
  const setup = loaded.scenario.setup!;
  Object.assign(setup, { enemyScale: 1, enemyOwners: [] });
  firstExchange(simulation);
  expect(lost(simulation, "ours")).toBeCloseTo(WEAPON_DAMAGE * Math.SQRT2, 9);
  expect(lost(simulation, "theirs")).toBeCloseTo(WEAPON_DAMAGE / Math.SQRT2, 9);
  simulation.dispose();
});

test("scaled fights continue identically after saving and loading", () => {
  const loaded = mission("hard");
  const original = duel(loaded);
  firstExchange(original);
  const source = serializeMission(
    loaded.scenario,
    original.snapshot(),
    SIMULATION_TICK_SECONDS,
    { name: "Mid-fight", savedAt: "2026-11-06T00:00:00.000Z" },
  );
  const restored = loadMission(source);
  expect(restored.scenario.setup).toEqual(loaded.scenario.setup);
  const continued = createSessionSimulation(restored);
  for (let tick = 0; tick < 120; tick++) {
    original.tick();
    continued.tick();
  }
  expect(continued.snapshot()).toEqual(original.snapshot());
  original.dispose();
  continued.dispose();
});

test("levels scale their hostile owners at the chosen difficulty", () => {
  const { scenario, state } = loadLevel(
    LEVEL_SOURCES.get("arc-economy-opening")!,
    "easy",
  );
  expect(scenario.setup).toEqual({
    difficulty: "easy",
    enemyScale: Math.SQRT1_2,
    enemyOwners: state.owners
      .map(({ id }) => id)
      .filter((id) => id !== state.playerOwner),
  });
  expect(loadMission(LEVEL_SOURCES.get("sandbox")!).scenario.setup).toBe(
    undefined,
  );
});

test("levels authored at the chosen difficulty keep their enemy owners", () => {
  const file = JSON.parse(LEVEL_SOURCES.get("arc-economy-opening")!);
  file.scenario.setup = {
    ...resolveSetup("hard", file.state),
    enemyOwners: [],
  };
  const source = JSON.stringify(file);
  expect(loadLevel(source, "hard").scenario.setup).toEqual(file.scenario.setup);
  expect(loadLevel(source, "easy").scenario.setup?.enemyOwners).not.toEqual([]);
});

test("allies stay outside enemy scaling", () => {
  expect(
    resolveSetup("hard", {
      owners: [{ id: "player" }, { id: "ally" }, { id: "rival" }],
      playerOwner: "player",
      relationships: [{ owners: ["ally", "player"], relationship: "allied" }],
    }).enemyOwners,
  ).toEqual(["rival"]);
});

test.each([
  ["an unknown difficulty", { difficulty: "brutal" }],
  ["a scale that disagrees with it", { enemyScale: 1 }],
  ["the player as an enemy", { enemyOwners: ["west"] }],
  ["an unknown enemy", { enemyOwners: ["north"] }],
  ["factions that disagree", { factions: { west: "arc", east: "circle" } }],
])("loading rejects %s", (_, change) => {
  const file = JSON.parse(
    serializeMission(
      mission("hard").scenario,
      mission("hard").state,
      SIMULATION_TICK_SECONDS,
    ),
  );
  file.scenario.setup = { ...file.scenario.setup, ...change };
  expect(() => loadMission(JSON.stringify(file))).toThrow(
    "Mission has an invalid setup.",
  );
});

test.each([null, [], "hard", 1])("loading rejects setup %j", (setup) => {
  const file = JSON.parse(LEVEL_SOURCES.get("arc-economy-opening")!);
  file.scenario.setup = setup;
  expect(() => loadMission(JSON.stringify(file))).toThrow(
    new RangeError("Mission has an invalid setup."),
  );
});

test("loading rejects skirmish factions without skirmish rules", () => {
  const file = JSON.parse(LEVEL_SOURCES.get("arc-economy-opening")!);
  file.scenario.setup = {
    ...resolveSetup("normal", file.state),
    factions: Object.fromEntries(
      file.state.owners.map(
        ({ id, faction }: { id: string; faction?: string }) => [id, faction],
      ),
    ),
  };
  expect(() => loadMission(JSON.stringify(file))).toThrow(
    "Mission has an invalid setup.",
  );
});
