import { describe, expect, test } from "vitest";
import {
  ECONOMY_ACTOR_DEFINITIONS,
  MOVEMENT_PROFILES,
} from "./helpers/content";
import { SIMULATION_TICK_SECONDS } from "../src/simulation/clock";
import { LEVEL_SOURCES } from "../src/content/levels";
import { PROTOTYPE_LANDMARKS } from "../scripts/levels/m0-terrain";
import { createActor } from "../src/simulation/actor";
import type { Actor } from "../src/simulation/actor";
import type { TileCoord } from "../src/simulation/grid";
import { personallyDetects } from "../src/simulation/vision";
import { distance } from "../src/simulation/world";
import { createMissionSimulation } from "../src/simulation/mission";
import type { MissionState } from "../src/simulation/mission";
import {
  findNavigationPath,
  NavigationGrid,
  segmentCost,
} from "../src/simulation/navigation";
import { OccupancyGrid } from "../src/simulation/occupancy";
import { createScenarioMap } from "../src/simulation/scenario";
import { parseMission, serializeMission } from "../src/simulation/mission-file";
import { createTerrainMoveBehavior } from "../src/simulation/terrain-movement";

const seconds = 0.1;
const level = () =>
  parseMission(
    LEVEL_SOURCES.get("arc-economy-opening")!,
    SIMULATION_TICK_SECONDS,
  );
const { scenario, state: opening } = level();
const definitions = ECONOMY_ACTOR_DEFINITIONS;
const initialState = (): MissionState => level().state;

const mapForOpening = () =>
  createScenarioMap({ ...scenario, terrain: opening.terrain });

function fixture(state = initialState(), updateIdle = () => {}) {
  const map = mapForOpening();
  const occupancy = new OccupancyGrid(map);
  return createMissionSimulation({
    state,
    definitions,
    map,
    occupancy,
    tickSeconds: seconds,
    bounds: map.worldBounds,
    objectives: scenario.objectives,
    behaviorRegistry: new Map([
      [
        "terrain-move",
        createTerrainMoveBehavior(map, occupancy, MOVEMENT_PROFILES),
      ],
      ["idle", { handleCommand: () => false, update: updateIdle }],
    ]),
  });
}

type Simulation = ReturnType<typeof fixture>;
const objective = (simulation: Simulation, id: string) =>
  simulation.objectives.find((objective) => objective.id === id)!;
const goalsComplete = (simulation: Simulation) =>
  simulation.objectives
    .filter(({ progress }) => progress)
    .every(({ status }) => status === "complete");

function finalFightState(): MissionState {
  const state = initialState();
  for (const wolf of state.actors.filter((actor) => actor.territory)) {
    wolf.health = 1;
    state.actors.push(
      createActor({
        id: `trooper-${wolf.id}`,
        definitionId: "arc-trooper",
        worldPosition: {
          x: wolf.worldPosition.x - 1.5,
          z: wolf.worldPosition.z,
        },
      }),
    );
  }
  return state;
}

describe("mission objectives", () => {
  test("presentation and verdict cannot mutate committed progress", () => {
    const simulation = fixture(finalFightState());
    simulation.tick();
    const before = simulation.snapshot();
    const view = objective(simulation, "wolf-den");
    expect(() => {
      view.progress!.current = 0;
    }).toThrow(TypeError);
    expect(() => {
      simulation.result!.tick = 50;
    }).toThrow(TypeError);
    expect(simulation.snapshot()).toEqual(before);
    expect(objective(simulation, "wolf-den").progress!.current).toBe(5);
  });

  test("a failed tick rolls back objective progress and verdict", () => {
    const simulation = fixture(finalFightState(), () => {
      throw new Error("behavior failed");
    });
    const before = simulation.snapshot();
    expect(() => simulation.tick()).toThrow("behavior failed");
    expect(simulation.snapshot()).toEqual(before);
    expect(simulation.result).toBeUndefined();
    expect(
      simulation.objectives.every(({ status }) => status === "active"),
    ).toBe(true);
  });

  test("the lone-wolf objective completes without granting victory", () => {
    const state = initialState();
    state.actors.find((actor) => actor.id === "lone-wolf")!.health = 1;
    state.actors.push(
      createActor({
        id: "duelist",
        definitionId: "arc-trooper",
        worldPosition: mapForOpening().tileCenter(43, 32),
      }),
    );
    const simulation = fixture(state);
    simulation.tick();
    expect(
      simulation.objectives.map(({ status, progress }) => ({
        status,
        progress,
      })),
    ).toEqual([
      { status: "active", progress: undefined },
      { status: "complete", progress: { current: 1, total: 1 } },
      { status: "active", progress: { current: 0, total: 5 } },
    ]);
    expect(simulation.result).toBeUndefined();
    for (let tick = 0; tick < 610; tick++) simulation.tick();
    expect(simulation.wrecks).toHaveLength(0);
    const restored = fixture(
      parseMission(
        serializeMission(scenario, simulation.snapshot(), seconds),
        seconds,
      ).state,
    );
    expect(restored.objectives).toEqual(simulation.objectives);
    restored.tick();
    simulation.tick();
    expect(restored.snapshot()).toEqual(simulation.snapshot());
  });

  test("all six combat deaths grant persistent victory and allow free play", () => {
    const simulation = fixture(finalFightState());
    for (let tick = 0; tick < 20 && !simulation.result; tick++)
      simulation.tick();
    const won = simulation.result;
    expect(won?.kind).toBe("victory");
    expect(goalsComplete(simulation)).toBe(true);
    const saved = simulation.snapshot();
    const restored = fixture(
      parseMission(serializeMission(scenario, saved, seconds), seconds).state,
    );
    expect(restored.result).toEqual(simulation.result);
    const command = {
      kind: "move" as const,
      actorId: "trooper-lone-wolf",
      target: mapForOpening().tileCenter(40, 32),
    };
    for (const sim of [simulation, restored]) {
      sim.submitCommand(command);
      expect(sim.tick()[0].accepted).toBe(true);
      expect(sim.completedTicks).toBe(saved.tick + 1);
      expect(sim.result).toEqual(won);
    }
    expect(restored.snapshot()).toEqual(simulation.snapshot());
    expect(
      fixture().objectives.every(
        ({ status, progress }) => status === "active" && !progress?.current,
      ),
    ).toBe(true);
  });

  test("removing an objective actor does not count as defeating it", () => {
    const simulation = fixture();
    simulation.removeActor("lone-wolf");
    simulation.tick();
    expect(objective(simulation, "lone-wolf").progress!.current).toBe(0);
    expect(simulation.result).toBeUndefined();
    expect(fixture(simulation.snapshot()).objectives).toEqual(
      simulation.objectives,
    );
  });

  test("Command Center destruction takes priority over the final wolf deaths", () => {
    const state = finalFightState();
    const center = state.actors.find(
      ({ id }) => id === "starting-command-center",
    )!;
    center.health = 1;
    const wolf = state.actors.find(({ id }) => id === "lone-wolf")!;
    wolf.worldPosition = { x: -39.5, z: 0.5 };
    wolf.territory = { home: { ...wolf.worldPosition } };
    wolf.combat = {
      attack: { targetId: center.id, lastKnown: { ...center.worldPosition } },
    };
    state.actors.find(({ id }) => id === "trooper-lone-wolf")!.worldPosition = {
      x: -36.5,
      z: 0.5,
    };
    const simulation = fixture(state);
    simulation.tick();
    expect(goalsComplete(simulation)).toBe(true);
    expect(simulation.result).toEqual({
      kind: "defeat",
      objectiveId: "protect-command-center",
      tick: 0,
    });
    const defeated = simulation.snapshot();
    simulation.tick();
    expect(simulation.snapshot()).toEqual(defeated);
    expect(fixture(defeated).result).toEqual(simulation.result);
  });

  test("Command Center destruction still ends post-victory free play", () => {
    const won = fixture(finalFightState());
    for (let tick = 0; tick < 20 && !won.result; tick++) won.tick();
    const state = won.snapshot();
    const center = state.actors.find(
      ({ id }) => id === "starting-command-center",
    )!;
    center.health = 1;
    const point = { x: -39.5, z: 0.5 };
    const attacker = createActor({
      id: "free-play-wolf",
      definitionId: "wolf",
      worldPosition: point,
    });
    attacker.territory = { home: point };
    attacker.combat = {
      attack: { targetId: center.id, lastKnown: { ...center.worldPosition } },
    };
    state.actors.push(attacker);
    const simulation = fixture(state);
    simulation.tick();
    expect(simulation.result).toEqual({
      kind: "defeat",
      objectiveId: "protect-command-center",
      tick: state.tick,
    });
    expect(goalsComplete(simulation)).toBe(true);
    expect(fixture(simulation.snapshot()).result).toEqual(simulation.result);
  });

  test("rejects fabricated or inconsistent progress", () => {
    const invalid = initialState();
    invalid.objectives[1].destroyedActorIds.push("lone-wolf");
    invalid.objectives[1].resolvedTick = 0;
    invalid.tick = 1;
    expect(() => fixture(invalid)).toThrow("objective progress");
    const won = fixture(finalFightState());
    for (let tick = 0; tick < 20 && !won.result; tick++) won.tick();
    const unresolved = won.snapshot();
    delete unresolved.objectives[1].resolvedTick;
    expect(() => fixture(unresolved)).toThrow("objective progress");
    const premature = initialState();
    premature.objectives[2].resolvedTick = 0;
    premature.tick = 1;
    expect(() => fixture(premature)).toThrow("objective progress");
  });
});

test("resources round-trip after gathering and collection", () => {
  const state = initialState();
  state.economy!.sites[0].remainingMaterials -= 25;
  state.economy!.loot[0].collected = true;
  expect(
    parseMission(serializeMission(scenario, state, seconds), seconds).state,
  ).toEqual(state);
});

describe("authored wolf encounters", () => {
  test("encounters cannot see each other anywhere their leashes permit travel", () => {
    const map = mapForOpening();
    const wolves = initialState().actors.filter((actor) => actor.territory);
    const definitionsById = new Map(definitions.map((d) => [d.id, d]));
    const occupancy = new OccupancyGrid(map);
    const travelTiles = (actor: Actor): TileCoord[] => {
      const territory = actor.territory!;
      const definition = definitionsById.get(actor.definitionId)!;
      const center = territory.center ?? territory.home;
      const radius = territory.radius ?? definition.territory!.leashRadius;
      const profile = MOVEMENT_PROFILES.find(
        ({ id }) => id === definition.movement!.profileId,
      )!;
      // Includes boundary tiles touched by continuous routes and separation.
      const grid = new NavigationGrid(map, occupancy, profile, "surface", {
        center,
        radius: radius + Math.SQRT1_2 * map.tileSize,
      });
      const home = map.tileAtWorldPosition(territory.home.x, territory.home.z);
      const region = grid.regionAt(home.x, home.z);
      expect(region).toBeGreaterThanOrEqual(0);
      const tiles: TileCoord[] = [];
      for (let z = 0; z < map.height; z++)
        for (let x = 0; x < map.width; x++)
          if (grid.regionAt(x, z) === region) tiles.push({ x, z });
      expect(tiles.length).toBeGreaterThan(20);
      return tiles;
    };
    const lone = wolves.find(({ id }) => id === "lone-wolf")!;
    const loneTiles = travelTiles(lone);
    const den = wolves.filter(({ id }) => id !== lone.id);
    let occludedPairs = 0;
    for (const observer of den) {
      const radius = Math.max(
        definitionsById.get(observer.definitionId)!.vision!.radius,
        definitionsById.get(lone.definitionId)!.vision!.radius,
      );
      for (const from of travelTiles(observer)) {
        observer.worldPosition = map.tileCenter(from.x, from.z);
        for (const to of loneTiles) {
          lone.worldPosition = map.tileCenter(to.x, to.z);
          if (distance(observer.worldPosition, lone.worldPosition) > radius)
            continue;
          occludedPairs++;
          expect(
            personallyDetects(observer, lone, definitionsById, map),
            `${observer.id} at ${from.x},${from.z} sees lone wolf at ${to.x},${to.z}`,
          ).toBe(false);
          expect(personallyDetects(lone, observer, definitionsById, map)).toBe(
            false,
          );
        }
      }
    }
    expect(occludedPairs).toBeGreaterThan(0);
  });

  test("recovery salvage rewards the lone-wolf approach and pays for two Troopers", () => {
    const map = mapForOpening();
    const grid = new NavigationGrid(
      map,
      new OccupancyGrid(map),
      MOVEMENT_PROFILES[0],
    );
    const simulation = fixture();
    const recovery = opening.economy!.loot.filter(({ id }) =>
      ["salvage-2", "salvage-3"].includes(id),
    );
    expect(recovery).toHaveLength(2);
    const trooper = definitions.find(({ id }) => id === "arc-trooper")!;
    expect(recovery.reduce((total, loot) => total + loot.materials, 0)).toBe(
      2 * trooper.materialsCost!,
    );
    for (const loot of recovery) {
      expect(loot.tile.x).toBeGreaterThan(46);
      expect(loot.tile.x).toBeLessThan(61);
      expect(
        distance(
          map.tileCenter(loot.tile.x, loot.tile.z),
          map.tileCenter(46, 32),
        ),
      ).toBeLessThan(14);
      expect(
        findNavigationPath(
          grid,
          map.tileCenter(46, 32),
          map.tileCenter(loot.tile.x, loot.tile.z),
        )?.reachedTarget,
      ).toBe(true);
      expect(simulation.fog!.isExplored(loot.tile.x, loot.tile.z)).toBe(false);
    }
  });

  test("rough ground offers a faster detour and ridge routes reconnect", () => {
    const map = mapForOpening();
    const grid = new NavigationGrid(
      map,
      new OccupancyGrid(map),
      MOVEMENT_PROFILES[0],
    );
    const from = map.tileCenter(35, 47);
    const to = map.tileCenter(58, 47);
    const path = findNavigationPath(grid, from, to)!;
    expect(path.reachedTarget).toBe(true);
    let previous = from;
    let length = 0;
    let cost = 0;
    for (const point of path.waypoints) {
      length += distance(previous, point);
      cost += segmentCost(grid, previous, point)!;
      previous = point;
    }
    expect(length).toBeGreaterThan(distance(from, to));
    expect(cost).toBeLessThan(segmentCost(grid, from, to)!);
    const crossingFrom = map.tileCenter(56, 34);
    const crossingTo = map.tileCenter(70, 34);
    expect(
      findNavigationPath(grid, crossingFrom, crossingTo)?.reachedTarget,
    ).toBe(true);
    for (let z = 32; z <= 35; z++)
      for (let x = 61; x <= 65; x++)
        map.setTerrain(x, z, { typeId: "path", surfacePassable: false });
    const detour = findNavigationPath(grid, crossingFrom, crossingTo)!;
    expect(detour.reachedTarget).toBe(true);
    expect(
      detour.waypoints.some((point) => point.z >= map.tileCenter(62, 66).z),
    ).toBe(true);
  });

  test("distinct mountain peaks leave both ridge crossings and the den entrance usable", () => {
    const map = mapForOpening();
    const grid = new NavigationGrid(
      map,
      new OccupancyGrid(map),
      MOVEMENT_PROFILES[0],
    );
    for (const landmark of PROTOTYPE_LANDMARKS)
      for (const peak of landmark.peaks) {
        expect(map.heightAt(peak.x, peak.z), landmark.id).toBeGreaterThan(8);
        expect(
          findNavigationPath(
            grid,
            map.tileCenter(15, 50),
            map.tileCenter(peak.x, peak.z),
          )?.reachedTarget,
        ).toBe(false);
      }
    for (const z of [32, 68]) {
      const route = findNavigationPath(
        grid,
        map.tileCenter(56, z),
        map.tileCenter(70, z),
      );
      expect(route?.reachedTarget).toBe(true);
    }
    expect(grid.costAt(78, 28)).toBeDefined();
    expect(grid.costAt(75, 23)).toBeGreaterThan(grid.costAt(78, 23)!);
    expect(grid.costAt(30, 44)).toBeDefined();
    expect(map.slopeAt(30, 44)).toBeGreaterThan(0.1);
  });

  test("six wolves have passable homes and the den shares one territory", () => {
    const simulation = fixture();
    const map = mapForOpening();
    const grid = new NavigationGrid(
      map,
      new OccupancyGrid(map),
      MOVEMENT_PROFILES[0],
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
      MOVEMENT_PROFILES[0],
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
      parseMission(
        serializeMission(scenario, simulation.snapshot(), seconds),
        seconds,
      ).state,
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
