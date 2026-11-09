import { expect, test } from "vitest";

import { BASE_CONTENT } from "./helpers/content";
import { trainsArmy } from "../src/simulation/actor";
import { affords, findPlacement } from "../src/simulation/ai-planning";
import { TerrainGrid } from "../src/simulation/terrain";

import type { AiConcernContext } from "../src/simulation/director";
import type { ActorPlacement } from "../src/simulation/placement";

const definitions = new Map(BASE_CONTENT.actors.map((d) => [d.id, d]));
const BARRACKS = definitions.get("arc-field-barracks")!;
const terrain = new TerrainGrid({
  width: 20,
  height: 20,
  tileSize: 1,
  terrainTypeIds: ["plain"],
});

/** A concern context whose placement check accepts on-map footprints. */
function context(funds: number, accepts = () => true) {
  const checked: ActorPlacement[] = [];
  const stub = {
    definitions,
    funds: () => funds,
    view: {
      actors: () => ({ placed: [] }),
      knowledge: { sites: [] },
      evaluatePlacement: (placement: ActorPlacement) => {
        checked.push(placement);
        return { accepted: accepts() };
      },
    },
  } as unknown as AiConcernContext;
  return { stub, checked };
}

test("producers whose roster omits some units still classify", () => {
  const roster = new Map(
    [...definitions].filter(([id]) => id !== "arc-trooper"),
  );
  expect(trainsArmy(BARRACKS, roster)).toBe(false);
  expect(trainsArmy(BARRACKS, definitions)).toBe(true);
});

test("affordability adds every listed price together", () => {
  const refinery = definitions.get("arc-materials-refinery")!;
  const harvester = definitions.get("arc-harvester")!;
  expect(affords(context(150).stub, refinery, harvester)).toBe(true);
  expect(affords(context(149).stub, refinery, harvester)).toBe(false);
});

test.each([
  ["inside", { x: 0, z: 0 }],
  ["past the edge", { x: -500, z: 500 }],
])("placement searches from an anchor %s the map", (_where, anchor) => {
  const { stub, checked } = context(1000);
  const origin = findPlacement(stub, terrain, BARRACKS, anchor);
  expect(origin).toBeDefined();
  for (const { origin: tried } of checked)
    for (const { x, z } of BARRACKS.footprint!.occupiedTiles)
      expect(terrain.containsTile(tried.x + x, tried.z + z)).toBe(true);
});

test("placement gives up when no candidate is accepted", () => {
  const { stub } = context(1000, () => false);
  expect(findPlacement(stub, terrain, BARRACKS, { x: 0, z: 0 })).toBe(
    undefined,
  );
});
