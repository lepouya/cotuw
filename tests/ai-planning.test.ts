import { expect, test } from "vitest";

import { BASE_CONTENT } from "./helpers/content";
import { trainsArmy } from "../src/simulation/actor";
import { affords, findPlacement, place } from "../src/simulation/ai-planning";
import { TerrainGrid } from "../src/simulation/terrain";

import type { PlacementMemory } from "../src/simulation/ai-planning";
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
function context(
  funds: number,
  accepts: (placement: ActorPlacement) => boolean = () => true,
) {
  const checked: ActorPlacement[] = [];
  const stub = {
    definitions,
    funds: () => funds,
    view: {
      actors: () => ({ placed: [] }),
      knowledge: { sites: [] },
      evaluatePlacement: (placement: ActorPlacement) => {
        checked.push(placement);
        return { accepted: accepts(placement) };
      },
    },
  } as unknown as AiConcernContext;
  return { stub, checked };
}

test("producers whose roster omits some units still classify", () => {
  const roster = new Map(
    [...definitions].filter(([id]) => id !== "arc-trooper"),
  );
  expect(trainsArmy(BARRACKS, roster)).toBe(true);
  roster.delete("arc-demolition-trooper");
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
  const origin = findPlacement(stub, terrain, BARRACKS, anchor, "placement");
  expect(origin).toBeDefined();
  for (const { origin: tried } of checked)
    for (const { x, z } of BARRACKS.footprint!.occupiedTiles)
      expect(terrain.containsTile(tried.x + x, tried.z + z)).toBe(true);
});

test("placement gives up when no candidate is accepted", () => {
  const { stub } = context(1000, () => false);
  expect(
    findPlacement(stub, terrain, BARRACKS, { x: 0, z: 0 }, "placement"),
  ).toBeUndefined();
});

/** A placing context at `tick`, whose commands `issue` accepts or refuses. */
const placing = (
  stub: AiConcernContext,
  tick: number,
  issue: () => boolean = () => true,
) =>
  ({
    ...stub,
    tick,
    tickSeconds: 0.1,
    tuning: { placementRetrySeconds: 10 },
    newActorId: () => "placement",
    issue,
  }) as unknown as AiConcernContext;

test("a search that finds no site waits before searching again", () => {
  const { stub, checked } = context(1000, () => false);
  const memory: PlacementMemory = {};
  const anchor = { x: 0, z: 0 };
  expect(place(placing(stub, 100), memory, terrain, BARRACKS, anchor)).toBe(
    false,
  );
  expect(memory.placementRetryTick).toBe(200);
  const searched = checked.length;
  expect(searched).toBeGreaterThan(0);
  place(placing(stub, 199), memory, terrain, BARRACKS, anchor);
  expect(checked).toHaveLength(searched);
  place(placing(stub, 200), memory, terrain, BARRACKS, anchor);
  expect(checked.length).toBeGreaterThan(searched);
});

test("placement tries each anchor in one search before waiting", () => {
  // Only sites beyond the first anchor's search are valid.
  const { stub } = context(1000, ({ origin }) => origin.x >= 12);
  const memory: PlacementMemory = {};
  let issued = 0;
  const near = terrain.tileCenter(2, 2);
  const far = terrain.tileCenter(15, 15);
  expect(
    place(
      placing(stub, 100, () => ++issued > 0),
      memory,
      terrain,
      BARRACKS,
      [near, far],
    ),
  ).toBe(true);
  expect(issued).toBe(1);
  expect(memory).toEqual({});
});

test("a refused placement also waits before searching again", () => {
  const { stub } = context(1000);
  const memory: PlacementMemory = {};
  expect(
    place(
      placing(stub, 100, () => false),
      memory,
      terrain,
      BARRACKS,
      {
        x: 0,
        z: 0,
      },
    ),
  ).toBe(false);
  expect(memory).toEqual({ placementRetryTick: 200 });
});

test("an unaffordable placement neither searches nor waits", () => {
  const { stub, checked } = context(0);
  const memory: PlacementMemory = {};
  expect(
    place(placing(stub, 5), memory, terrain, BARRACKS, { x: 0, z: 0 }),
  ).toBe(false);
  expect(checked).toEqual([]);
  expect(memory).toEqual({});
});
