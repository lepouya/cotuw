import { describe, expect, test } from "vitest";
import {
  ECONOMY_ACTOR_DEFINITIONS,
  ECONOMY_SCENARIO,
} from "../src/content/economy-scenario";
import { PROTOTYPE_MOVEMENT_PROFILES } from "../src/prototype-content";
import { createActor } from "../src/simulation/actor";
import { createMissionSimulation } from "../src/simulation/mission";
import {
  findNavigationPath,
  NavigationGrid,
} from "../src/simulation/navigation";
import { OccupancyGrid } from "../src/simulation/occupancy";
import {
  createScenarioState,
  deserializeMission,
  serializeMission,
} from "../src/simulation/scenario";
import { TerrainGrid } from "../src/simulation/terrain";
import { createTerrainMoveBehavior } from "../src/simulation/terrain-movement";

const seconds = 0.1;
const scenario = ECONOMY_SCENARIO;
const definitions = ECONOMY_ACTOR_DEFINITIONS;
const initialState = () => createScenarioState(scenario, definitions);

function mapForOpening() {
  const map = new TerrainGrid({
    width: scenario.terrain.width,
    height: scenario.terrain.height,
    tileSize: scenario.tileSize,
    terrainTypeIds: scenario.terrainTypeIds,
  });
  map.restoreTerrainState(scenario.terrain);
  return map;
}

function fixture(state = initialState()) {
  const map = mapForOpening();
  const occupancy = new OccupancyGrid(map);
  return createMissionSimulation({
    state,
    definitions,
    map,
    occupancy,
    tickSeconds: seconds,
    bounds: map.worldBounds,
    behaviorRegistry: new Map([
      [
        "terrain-move",
        createTerrainMoveBehavior(map, occupancy, PROTOTYPE_MOVEMENT_PROFILES),
      ],
      ["idle", { handleCommand: () => false, update: () => {} }],
    ]),
  });
}

describe("authored wolf encounters", () => {
  test("six wolves have passable homes and the den shares one territory", () => {
    const simulation = fixture();
    const map = mapForOpening();
    const grid = new NavigationGrid(
      map,
      new OccupancyGrid(map),
      PROTOTYPE_MOVEMENT_PROFILES[0],
    );
    const wolves = simulation
      .snapshot()
      .actors.filter((actor) => actor.territory);
    expect(wolves).toHaveLength(6);
    expect(
      wolves.filter((actor) => actor.definitionId === "alpha-wolf"),
    ).toHaveLength(1);
    const den = wolves.filter(
      (actor) => actor.territory!.encounterId === "wolf-den",
    );
    expect(den).toHaveLength(5);
    expect(
      new Set(den.map((actor) => JSON.stringify(actor.territory!.home))).size,
    ).toBe(5);
    for (const actor of wolves) {
      expect(actor.territory!.home).toEqual(actor.worldPosition);
      const tile = map.tileAtWorldPosition(
        actor.worldPosition.x,
        actor.worldPosition.z,
      );
      expect(grid.costAt(tile.x, tile.z)).toBeDefined();
      expect(
        findNavigationPath(grid, map.tileCenter(15, 50), actor.worldPosition)
          ?.reachedTarget,
      ).toBe(true);
    }
    for (const actor of den) {
      expect(actor.territory!.center).toEqual(map.tileCenter(78, 21));
      expect(actor.territory!.radius).toBe(12);
    }
    expect(simulation.actorById("lone-wolf")!.territory!.encounterId).toBe(
      "lone-wolf",
    );
    expect(wolves.every((actor) => !simulation.detects("arc", actor))).toBe(
      true,
    );
  });

  test("the three-tile entrance is the only ground route into the den", () => {
    const map = mapForOpening();
    const grid = new NavigationGrid(
      map,
      new OccupancyGrid(map),
      PROTOTYPE_MOVEMENT_PROFILES[0],
    );
    const from = map.tileCenter(46, 32);
    const to = map.tileCenter(78, 21);
    expect(findNavigationPath(grid, from, to)?.reachedTarget).toBe(true);
    for (let x = 77; x <= 79; x++) {
      expect(grid.costAt(x, 28)).toBeDefined();
      map.setTerrain(x, 28, { typeId: "plain", surfacePassable: false });
    }
    expect(findNavigationPath(grid, from, to)?.reachedTarget).toBe(false);
  });

  test("fighting the lone wolf leaves the den resting throughout the duel", () => {
    const state = initialState();
    const map = mapForOpening();
    state.actors.push(
      createActor({
        id: "duelist",
        definitionId: "arc-trooper",
        worldPosition: map.tileCenter(43, 32),
      }),
    );
    const simulation = fixture(state);
    let alerted = false;
    for (let tick = 0; tick < 200; tick++) {
      simulation.tick();
      for (const alert of simulation.snapshot().wildlife.alerts) {
        alerted = true;
        expect(alert.propagators).toEqual(["lone-wolf"]);
      }
      for (const actor of simulation
        .snapshot()
        .actors.filter(
          (actor) => actor.territory?.encounterId === "wolf-den",
        )) {
        expect(actor.territory!.mode).toBe("idle-at-home");
        expect(actor.worldPosition).toEqual(actor.territory!.home);
        expect(actor.combat?.attack).toBeUndefined();
      }
    }
    expect(alerted).toBe(true);
    expect(simulation.actorById("lone-wolf")).toBeUndefined();
    expect(simulation.actorById("duelist")).toBeDefined();
  });

  test("the den relays alerts and continues identically after saving", () => {
    const state = initialState();
    state.actors.push(
      createActor({
        id: "intruder",
        definitionId: "arc-trooper",
        worldPosition: mapForOpening().tileCenter(78, 29),
      }),
    );
    const simulation = fixture(state);
    for (let tick = 0; tick < 10; tick++) simulation.tick();
    const den = simulation
      .snapshot()
      .actors.filter((actor) => actor.territory?.encounterId === "wolf-den");
    const propagators = new Set(
      simulation
        .snapshot()
        .wildlife.alerts.flatMap((alert) => alert.propagators),
    );
    expect(den.every((actor) => propagators.has(actor.id))).toBe(true);
    expect(propagators.has("lone-wolf")).toBe(false);
    expect(den.some((actor) => actor.combat?.attack)).toBe(true);
    const restored = fixture(
      deserializeMission(
        serializeMission(simulation.snapshot(), seconds),
        scenario,
        seconds,
      ),
    );
    for (let tick = 0; tick < 50; tick++) {
      simulation.tick();
      restored.tick();
      expect(restored.snapshot()).toEqual(simulation.snapshot());
    }
    expect(simulation.actorById("intruder")).toBeUndefined();
    expect(simulation.actorById("lone-wolf")!.territory!.mode).toBe(
      "idle-at-home",
    );
  });
});
