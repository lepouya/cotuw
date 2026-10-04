import { describe, expect, test } from "vitest";
import { TerrainGrid } from "../src/simulation/terrain";
import {
  createScenarioMap,
  createScenarioState,
  defineScenario,
} from "../src/simulation/scenario";

describe("scenario terrain", () => {
  test("restores a catalog without the default plain terrain", () => {
    const terrain = new TerrainGrid({
      width: 3,
      height: 2,
      tileSize: 2,
      createTerrain: () => ({ typeId: "water", surfacePassable: true }),
      createHeight: (x, z) => x + z,
      terrainTypeIds: ["water"],
    });
    terrain.setHeight(3, 2, 8);
    const scenario = defineScenario({
      id: "water-world",
      tileSize: terrain.tileSize,
      terrainTypeIds: [...terrain.terrainTypeIds],
      terrain: terrain.terrainState(),
      playerFaction: "arc",
      buildings: [],
      materials: 0,
      sites: [],
      loot: [],
    });
    const restored = createScenarioMap(scenario);
    expect(restored.terrainState()).toEqual(scenario.terrain);
    expect(restored.tileSize).toBe(2);
    expect(createScenarioState(scenario, []).terrain).toEqual(scenario.terrain);
    restored.setTerrain(0, 0, { typeId: "water", surfacePassable: false });
    expect(scenario.terrain.tiles[0].surfacePassable).toBe(true);
  });
});
