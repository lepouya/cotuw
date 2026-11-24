import { expect, test } from "vitest";

import { BASE_CONTENT } from "./helpers/content";
import { trainsArmy } from "../src/simulation/actor";
import {
  affords,
  findPlacement,
  groupSites,
  place,
  sitesNear,
  tendGrowth,
} from "../src/simulation/ai-planning";
import { occupiedTilesFor } from "../src/simulation/placement";
import { TerrainGrid } from "../src/simulation/terrain";

import type { PlacementMemory } from "../src/simulation/ai-planning";
import type { MissionCommand } from "../src/simulation/command";
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
  own: readonly object[] = [],
) {
  const checked: ActorPlacement[] = [];
  const stub = {
    definitions,
    funds: () => funds,
    view: {
      actors: () => ({ placed: [], own }),
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
  for (const { actorId: id, definitionId, origin, quarterTurns = 0 } of checked)
    for (const { x, z } of occupiedTilesFor(
      { id, definitionId, tilePlacement: { origin, quarterTurns } },
      BARRACKS,
    ))
      expect(terrain.containsTile(x, z)).toBe(true);
});

test("placement turns with the owner's headquarters", () => {
  const headquarters = {
    id: "hq",
    definitionId: "arc-command-center-prototype",
    tilePlacement: { origin: { x: 0, z: 0 }, quarterTurns: 2 },
  };
  const placements = (own: readonly object[]) => {
    const { stub, checked } = context(1000, () => false, own);
    findPlacement(stub, terrain, BARRACKS, { x: 0, z: 0 }, "placement");
    return checked;
  };
  const straight = placements([]);
  const turned = placements([headquarters]);
  expect(turned.map(({ quarterTurns }) => quarterTurns)).toEqual(
    straight.map(() => 2),
  );
  // The turned search visits each straight candidate's half-turned origin.
  const center = straight[0]!.origin;
  expect(turned.map(({ origin }) => origin)).toEqual(
    straight.map(({ origin }) => ({
      x: 2 * center.x - origin.x,
      z: 2 * center.z - origin.z,
    })),
  );
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

test("site groups keep ID order as later sites merge them", () => {
  const sites = [0, 4, 8, 2, 6].map((x, index) => ({
    id: String(index),
    tile: { x, z: 0 },
  }));
  expect(groupSites([...sites].reverse(), 2)).toEqual([sites]);
});

test("same-tick growth and tending reserve distinct workers", () => {
  const workers = ["first", "second"].map((id) => ({
    id,
    definitionId: "circle-cultivator",
  }));
  const definition = definitions.get("circle-conservatory")!;
  const issuedCommands: MissionCommand[] = [];
  const { stub } = context(1000);
  const planning = (actorId: string) =>
    ({
      ...placing(stub, 100),
      issuedCommands,
      newActorId: () => actorId,
      issue: (command: MissionCommand) => !!issuedCommands.push(command),
      view: {
        ...stub.view,
        actors: () => ({
          placed: [],
          own: [
            {
              id: "untended",
              definitionId: definition.id,
              construction: {},
              tilePlacement: {},
            },
          ],
          ownMobile: workers,
        }),
        economy: () => ({
          cultivation: {
            workers: workers.map(({ id }) => ({ actorId: id })),
          },
        }),
        tendWorker: (_id: string, candidates: readonly string[]) =>
          candidates[0],
        evaluatePlacement: ({ workerIds }: ActorPlacement) => ({
          accepted: !!workerIds?.length,
          workerId: workerIds?.[0],
        }),
      },
    }) as unknown as AiConcernContext;
  tendGrowth(planning("income"));
  const anchor = terrain.tileCenter(3, 3);
  expect(place(planning("new"), {}, terrain, definition, anchor)).toBe(true);
  expect(place(planning("later"), {}, terrain, definition, anchor)).toBe(false);
  expect(issuedCommands).toEqual([
    { kind: "tend", actorId: "first", buildingId: "untended" },
    expect.objectContaining({ kind: "place-actor", workerIds: ["second"] }),
  ]);
});

test("sites near a point follow the workers that gather them", () => {
  const sites = (faction: string | undefined) =>
    ({
      definitions,
      terrain,
      view: {
        faction,
        economy: () => ({
          sites: [
            { id: "spent", tile: { x: 1, z: 1 }, remainingMaterials: 0 },
            { id: "far", tile: { x: 9, z: 9 }, remainingMaterials: 10 },
          ],
          cultivation: { sites: [{ id: "grove", tile: { x: 2, z: 2 } }] },
        }),
      },
    }) as unknown as AiConcernContext;
  const ids = (found: ReturnType<typeof sitesNear>) =>
    found.map(({ id }) => id);
  const point = terrain.tileCenter(0, 0);
  expect(ids(sitesNear(sites("arc"), point))).toEqual(["far"]);
  expect(ids(sitesNear(sites("circle"), point))).toEqual(["grove"]);
  // An owner without one faction gathers both, unless a worker is named.
  expect(ids(sitesNear(sites(undefined), point))).toEqual(["grove", "far"]);
  expect(
    ids(
      sitesNear(sites(undefined), point, [definitions.get("arc-harvester")!]),
    ),
  ).toEqual(["far"]);
});
