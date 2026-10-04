import { describe, expect, test } from "vitest";

import { parseContentPack } from "../src/content/content-pack";
import { terrainLayers } from "../src/render/terrain-style";
import { TerrainGrid } from "../src/simulation/terrain";
import { BASE_CONTENT } from "./helpers/content";

const withEdit = (edit: (pack: any) => void) => {
  const pack = structuredClone(BASE_CONTENT) as any;
  pack.format = "cotuw-content";
  pack.formatVersion = 1;
  edit(pack);
  return () => parseContentPack(JSON.stringify(pack));
};

describe("content packs", () => {
  test("the base pack presents every actor it defines", () => {
    for (const { id } of BASE_CONTENT.actors)
      expect(BASE_CONTENT.presentation[id]?.name, id).toBeTruthy();
  });

  test("reject unknown formats, built-ins, and tile types", () => {
    expect(withEdit((pack) => (pack.formatVersion = 2))).toThrow(
      'format "cotuw-content" version 1',
    );
    expect(
      withEdit(
        (pack) => (pack.presentation.wolf.model = { builtin: "dragon" }),
      ),
    ).toThrow('unknown built-in model "dragon"');
    expect(
      withEdit(
        (pack) =>
          (pack.presentation["arc-field-barracks"].building.details = "tower"),
      ),
    ).toThrow('unknown building details "tower"');
    expect(
      withEdit((pack) => (pack.terrain.layers.rough[1].tileType = "snow")),
    ).toThrow('unknown tile type "snow"');
  });

  test("terrain styles follow tile types, coverage, and shore depth", () => {
    const map = new TerrainGrid({
      width: 7,
      height: 1,
      tileSize: 1,
      terrainTypeIds: ["plain", "rough", "water"],
      createTerrain: (x) => ({
        typeId: x === 0 ? "rough" : x === 1 ? "plain" : "water",
      }),
    });
    const layers = terrainLayers(BASE_CONTENT.terrain);
    const ids = (x: number) =>
      layers(x, 0, map.terrainAt(x, 0), map).map(({ type }) => type?.id);
    expect(ids(0)).toEqual(["dirt", "clutter"]);
    expect(ids(1)).toEqual(["dirt"]);
    expect(ids(2)).toEqual(["dirt", "water", "water-ripples"]);
    const waterAlpha = (x: number) =>
      layers(x, 0, map.terrainAt(x, 0), map)[1].color.a;
    expect(waterAlpha(2)).toBeLessThan(waterAlpha(6));
  });
});

test.each([
  [
    "missing lighting",
    (pack: any) => {
      delete pack.view.lighting;
    },
    "lighting",
  ],
  [
    "invalid sun direction",
    (pack: any) => {
      pack.view.lighting.sunDirection = [0, 0, 0];
    },
    "sun direction",
  ],
  [
    "negative model scale",
    (pack: any) => {
      pack.presentation.wolf.model.scale = -1;
    },
    "model scale",
  ],
  [
    "prototype model name",
    (pack: any) => {
      pack.presentation.wolf.model.builtin = "constructor";
    },
    "unknown built-in",
  ],
  [
    "missing building model",
    (pack: any) => {
      delete pack.presentation["arc-field-barracks"].building;
    },
    "geometry",
  ],
  [
    "invalid building color",
    (pack: any) => {
      pack.presentation["arc-field-barracks"].building.color = [1, 0];
    },
    "colors",
  ],
  [
    "invalid actor graphics",
    (pack: any) => {
      pack.presentation["arc-trooper"].model.glb.bounds = null;
    },
    "bounds",
  ],
  [
    "missing clips",
    (pack: any) => {
      delete pack.presentation["arc-trooper"].model.glb.clips;
    },
    "named clips",
  ],
  [
    "invalid presentation",
    (pack: any) => {
      pack.presentation = null;
    },
    "presentation",
  ],
  [
    "duplicate actor",
    (pack: any) => {
      pack.actors.push(pack.actors[0]);
    },
    "actors",
  ],
  [
    "invalid movement profile",
    (pack: any) => {
      delete pack.movementProfiles[0].terrainCosts;
    },
    "profile shape",
  ],
  [
    "invalid layer list",
    (pack: any) => {
      pack.terrain.layers.plain = {};
    },
    "layer list",
  ],
  [
    "invalid layer color",
    (pack: any) => {
      pack.terrain.layers.plain[0].color = null;
    },
    "layer settings",
  ],
  [
    "invalid shore depth",
    (pack: any) => {
      pack.terrain.shore.depthTiles = 0;
    },
    "shore settings",
  ],
  [
    "invalid coverage",
    (pack: any) => {
      pack.terrain.layers.plain[1].coverage = 2;
    },
    "layer settings",
  ],
])("rejects %s when parsing content", (_name, edit, message) => {
  expect(withEdit(edit)).toThrow(message);
});

test("cached content cannot be mutated without changing its version", () => {
  expect(() => {
    (BASE_CONTENT.presentation.wolf as any).name = "Changed";
  }).toThrow();
  expect(() => {
    (BASE_CONTENT.movementProfiles[0].terrainCosts as any).plain = 20;
  }).toThrow();
});
