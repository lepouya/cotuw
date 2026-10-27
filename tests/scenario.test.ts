import { playerOwners, stockpiles } from "./helpers/scenario";
import { describe, expect, test } from "vitest";
import { ARC_ACTOR_DEFINITIONS } from "./helpers/content";
import type { Stockpile } from "../src/simulation/stockpiles";
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
      ...playerOwners("arc"),
      buildings: [],
      stockpiles: stockpiles(0),
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

describe("scenario stockpiles", () => {
  const terrain = new TerrainGrid({ width: 2, height: 2, tileSize: 1 });
  test.each([
    [{ resource: "materials", owners: ["stranger"], amount: 3 }],
    [{ resource: "gold", owners: ["player"], amount: 3 }],
    [{ resource: "materials", owners: [], amount: 3 }],
    [{ resource: "materials", owners: ["player", "ally"], amount: 1.5 }],
    [...stockpiles(1), ...stockpiles(2)],
  ])(
    "rejects malformed balances before pooling (%#)",
    (...startingBalances) => {
      const scenario = defineScenario({
        id: "stockpiles",
        tileSize: 1,
        terrainTypeIds: [...terrain.terrainTypeIds],
        terrain: terrain.terrainState(),
        owners: [{ id: "player" }, { id: "ally" }],
        playerOwner: "player",
        relationships: [
          {
            owners: ["player", "ally"],
            relationship: "allied",
            sharesResources: true,
          },
        ],
        buildings: [],
        stockpiles: startingBalances as Stockpile[],
        sites: [],
        loot: [],
      });
      expect(() => createScenarioState(scenario, [])).toThrow(
        "invalid stockpiles",
      );
    },
  );
});

describe("scenario owners", () => {
  const terrain = new TerrainGrid({
    width: 8,
    height: 8,
    tileSize: 1,
    terrainTypeIds: ["plain"],
  });
  const scenario = (owners: { id: string; faction?: string }[]) =>
    defineScenario({
      id: "owners",
      tileSize: 1,
      terrainTypeIds: ["plain"],
      terrain: terrain.terrainState(),
      owners,
      playerOwner: owners[0]!.id,
      buildings: [],
      units: [
        { actorId: "scout", definitionId: "arc-scout", tile: { x: 1, z: 1 } },
        {
          actorId: "rival-scout",
          definitionId: "arc-scout",
          owner: "rival",
          tile: { x: 5, z: 5 },
        },
      ],
    });

  test("actors default to the first owner playing their faction", () => {
    const state = createScenarioState(
      scenario([
        { id: "player", faction: "arc" },
        { id: "rival", faction: "arc" },
      ]),
      ARC_ACTOR_DEFINITIONS,
    );
    expect(state.actors.map(({ id, owner }) => [id, owner])).toEqual([
      ["scout", "player"],
      ["rival-scout", "rival"],
    ]);
  });

  test("an actor whose faction no owner plays is an authoring error", () => {
    expect(() =>
      createScenarioState(
        scenario([{ id: "player", faction: "circle" }, { id: "rival" }]),
        ARC_ACTOR_DEFINITIONS,
      ),
    ).toThrow("Scenario actor scout has no owner.");
  });
});
