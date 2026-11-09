import { afterEach, expect, test } from "vitest";

import { BASE_CONTENT } from "./helpers/content";
import {
  balance,
  command,
  exploredFog,
  savedState,
  startMission,
  stockpiles,
} from "./helpers/scenario";
import {
  createScenarioState,
  defineScenario,
} from "../src/simulation/scenario";
import { createActor } from "../src/simulation/actor";
import { secondsToTicks } from "../src/simulation/clock";
import { createCultivationSite } from "../src/simulation/cultivation";
import { createObservations } from "../src/simulation/observations";
import { createTilePlacedActor } from "../src/simulation/placement";
import { TerrainGrid } from "../src/simulation/terrain";

import type { ActorDefinition } from "../src/simulation/actor";
import type {
  MissionSimulation,
  MissionState,
} from "../src/simulation/mission";
import type { EconomyState } from "../src/simulation/economy";

const definitions: ActorDefinition[] = BASE_CONTENT.actors.map(
  (definition) => ({
    ...definition,
    // Keep support broad and vision narrow so fog can hide valid build sites.
    vision: definition.vision && { radius: 1 },
    support: definition.support && { ...definition.support, radius: 100 },
  }),
);
definitions.push({
  id: "wall",
  behaviorId: "idle",
  footprint: {
    layer: "surface",
    blocksMovement: true,
    occupiedTiles: Array.from({ length: 16 }, (_, z) => ({ x: 0, z })),
  },
  placement: { terrainTypeIds: ["plain"], maxSlope: 1 },
});
const options = {
  width: 30,
  height: 16,
  tileSize: 1,
  terrainTypeIds: ["plain", "path", "rough", "water"],
};
const map = new TerrainGrid(options);
const missions: MissionSimulation[] = [];
afterEach(() => {
  for (const mission of missions.splice(0)) mission.dispose();
});

function fixture({
  hidden = false,
  explored = true,
  edit = (_state: MissionState) => {},
  ...extra
}: Partial<Pick<EconomyState, "sites" | "loot">> & {
  hidden?: boolean;
  explored?: boolean;
  edit?: (state: MissionState) => void;
} = {}) {
  const scenario = defineScenario({
    id: "owner-rules",
    tileSize: 1,
    terrainTypeIds: options.terrainTypeIds,
    terrain: map.terrainState(),
    owners: [{ id: "player" }, { id: "rival" }],
    playerOwner: "player",
    buildings: [
      {
        actorId: "hq",
        owner: "player",
        definitionId: "arc-command-center-prototype",
        origin: { x: 2, z: 2 },
      },
      {
        actorId: "barracks",
        owner: "player",
        definitionId: "arc-field-barracks",
        origin: { x: 6, z: 2 },
      },
      {
        actorId: "heart",
        owner: "player",
        definitionId: "circle-heartgrove",
        origin: { x: 2, z: 9 },
      },
      ...(hidden
        ? [
            {
              actorId: "secret",
              definitionId: "arc-field-barracks",
              owner: "rival",
              origin: { x: 18, z: 2 },
            },
          ]
        : []),
    ],
    units: [
      {
        actorId: "worker",
        owner: "player",
        definitionId: "circle-cultivator",
        tile: { x: 6, z: 10 },
      },
    ],
    stockpiles: [...stockpiles(1000), ...stockpiles(1000, "lifebloom")],
    sites: [],
    cultivation: { sites: [] },
    loot: [],
    ...extra,
  });
  const state = createScenarioState(scenario, definitions);
  if (explored) state.fog = exploredFog(state);
  edit(state);
  const result = startMission(new TerrainGrid(options), {
    state,
    definitions,
    tickSeconds: 0.1,
  });
  missions.push(result.simulation);
  return { ...result, scenario, view: result.simulation.viewOf("player") };
}
const placement = (x = 18, z = 2, actorId = "new-building") => ({
  kind: "place-actor" as const,
  actorId,
  definitionId: "arc-field-barracks",
  origin: { x, z },
});

test.each([false, true])(
  "hidden buildings do not affect placement previews (explored=%s)",
  (explored) => {
    const empty = fixture({ explored });
    const hidden = fixture({ hidden: true, explored });
    expect(hidden.view.shownActor("secret")).toBeUndefined();
    expect(hidden.view.knowledge.observations).toEqual(
      empty.view.knowledge.observations,
    );
    expect(hidden.view.evaluatePlacement(placement())).toEqual(
      empty.view.evaluatePlacement(placement()),
    );
    expect(hidden.view.evaluatePlacement(placement())).toMatchObject(
      explored ? { accepted: true } : { reason: "unexplored" },
    );
    const before = balance(hidden.simulation);
    expect(command(hidden.simulation, placement())).toMatchObject({
      accepted: false,
      reason: explored ? "occupancy-conflict" : "unexplored",
    });
    expect(balance(hidden.simulation)).toBe(before);
  },
);

test.each([false, true])(
  "map bounds take precedence over fog (explored=%s)",
  (explored) => {
    const { simulation, view } = fixture({ explored });
    const edge = placement(options.width - 1, 2);
    expect(view.evaluatePlacement(edge)).toMatchObject({
      reason: "out-of-bounds",
    });
    expect(command(simulation, edge)).toMatchObject({
      reason: "out-of-bounds",
    });
  },
);

test("newer building memories take precedence over overlapping older footprints", () => {
  const { view } = fixture({
    edit: (state) => {
      state.tick = 2;
      state.retiredActorIds.push("old", "replacement");
      state.observations.player = {
        ...createObservations(),
        actors: [18, 19].map((x, index) => {
          const actor = createTilePlacedActor(
            map,
            definitions.find(({ id }) => id === "arc-field-barracks")!,
            { actorId: index ? "replacement" : "old", origin: { x, z: 2 } },
            "rival",
          );
          return {
            actorId: actor.id,
            definitionId: actor.definitionId,
            owner: actor.owner,
            worldPosition: actor.worldPosition,
            tilePlacement: actor.tilePlacement,
            tick: index,
          };
        }),
      };
    },
  });
  // Only the replacement's eastern edge overlaps this candidate.
  expect(view.evaluatePlacement(placement(21))).toMatchObject({
    reason: "occupancy-conflict",
  });
  expect(view.evaluatePlacement(placement(16)).accepted).toBe(true);
});

test("hidden mobile units and their historical positions do not block previews", () => {
  const setup = (x: number) =>
    fixture({
      edit: (state) => {
        state.actors.push(
          createActor({
            id: "mobile",
            definitionId: "arc-scout",
            owner: "rival",
            worldPosition: map.tileCenter(x, 2),
          }),
        );
        state.observations.player = {
          ...createObservations(),
          actors: [
            {
              actorId: "mobile",
              definitionId: "arc-scout",
              owner: "rival",
              worldPosition: map.tileCenter(18, 2),
              tick: 0,
            },
          ],
        };
      },
    });
  const present = setup(18),
    moved = setup(25);
  expect(present.view.shownActor("mobile")).toBeUndefined();
  expect(present.view.knowledge.observations).toEqual(
    moved.view.knowledge.observations,
  );
  expect(present.view.evaluatePlacement(placement())).toEqual(
    moved.view.evaluatePlacement(placement()),
  );
  expect(present.view.evaluatePlacement(placement()).accepted).toBe(true);
  expect(command(present.simulation, placement())).toMatchObject({
    accepted: false,
    reason: "actor-conflict",
  });
});

test("previews cannot probe hidden actors, retired IDs, or foreign paid IDs", () => {
  const empty = fixture();
  const hidden = fixture({
    hidden: true,
    edit: (state) => {
      state.retiredActorIds.push("secret-retired");
      state.economy!.production.push({
        actorId: "secret-paid",
        producerId: "secret",
        definitionId: "arc-trooper",
        paidCost: 25,
        totalTicks: secondsToTicks(4, 0.1),
        completedTicks: 0,
        exitBlocked: false,
      });
    },
  });
  for (const id of ["secret", "secret-retired", "secret-paid"]) {
    expect(hidden.view.evaluatePlacement(placement(22, 6, id))).toEqual(
      empty.view.evaluatePlacement(placement(22, 6, id)),
    );
    const training = {
      kind: "train-unit" as const,
      producerId: "barracks",
      actorId: id,
      definitionId: "arc-trooper",
    };
    expect(hidden.view.evaluateTraining(training)).toEqual(
      empty.view.evaluateTraining(training),
    );
    expect(hidden.view.evaluateTraining(training)).toEqual({
      accepted: true,
      queued: true,
    });
  }
  expect(
    command(hidden.simulation, {
      kind: "train-unit",
      producerId: "barracks",
      actorId: "secret-paid",
      definitionId: "arc-trooper",
    }),
  ).toMatchObject({ accepted: false, reason: "used-id" });
});

test("free training previews choose exits without consulting hidden units", () => {
  const setup = (blocker?: { x: number; z: number }) =>
    fixture({
      edit: (state) => {
        state.economy = undefined;
        state.actors = state.actors.filter(({ id }) => id !== "worker");
        if (blocker)
          state.actors.push(
            createActor({
              id: "mobile",
              definitionId: "arc-scout",
              owner: "rival",
              worldPosition: blocker,
            }),
          );
      },
    });
  const empty = setup();
  const training = {
    kind: "train-unit" as const,
    producerId: "barracks",
    actorId: "trained",
    definitionId: "arc-trooper",
  };
  const preview = empty.view.evaluateTraining(training);
  if (!preview.accepted || !("actor" in preview))
    throw new Error("Expected a free training exit.");
  const hidden = setup(preview.actor.worldPosition);
  expect(hidden.view.shownActor("mobile")).toBeUndefined();
  expect(hidden.view.evaluateTraining(training)).toEqual(preview);
  expect(command(hidden.simulation, training).accepted).toBe(true);
  expect(hidden.simulation.actorById("trained")!.worldPosition).not.toEqual(
    preview.actor.worldPosition,
  );
});

test("rally previews ignore unseen occupancy while execution rejects it", () => {
  const empty = fixture();
  const hidden = fixture({ hidden: true });
  const target = map.tileCenter(18, 2);
  expect(empty.view.evaluateRallyPoint("barracks", target)).toBe(true);
  expect(hidden.view.evaluateRallyPoint("barracks", target)).toBe(true);
  expect(
    command(hidden.simulation, {
      kind: "set-rally-point",
      actorId: "barracks",
      target,
    }).accepted,
  ).toBe(false);
});

test("detecting an obstruction updates placement and rally previews", () => {
  const { simulation, view } = fixture({ hidden: true });
  expect(view.evaluatePlacement(placement()).accepted).toBe(true);
  simulation.spawnActor({
    id: "observer",
    definitionId: "arc-scout",
    owner: "player",
    worldPosition: map.tileCenter(17, 2),
    facing: 0,
    occupancyLayer: "surface",
  });
  simulation.tick();
  expect(view.shownActor("secret")).toBeDefined();
  expect(view.evaluatePlacement(placement())).toMatchObject({
    reason: "occupancy-conflict",
  });
  expect(view.evaluateRallyPoint("barracks", map.tileCenter(18, 2))).toBe(
    false,
  );
});

test("remembered buildings block previews until their absence is observed", () => {
  const setup = (removed: boolean) =>
    fixture({
      hidden: true,
      edit: (state) => {
        const actor = state.actors.find(({ id }) => id === "secret")!;
        state.observations.player = {
          ...createObservations(),
          actors: [
            {
              actorId: actor.id,
              definitionId: actor.definitionId,
              owner: actor.owner,
              worldPosition: actor.worldPosition,
              tilePlacement: actor.tilePlacement,
              tick: 0,
            },
          ],
        };
        if (removed) {
          state.actors = state.actors.filter(({ id }) => id !== "secret");
          state.retiredActorIds.push("secret");
        }
      },
    });
  const standing = setup(false);
  const removed = setup(true);
  expect(removed.view.evaluatePlacement(placement())).toEqual(
    standing.view.evaluatePlacement(placement()),
  );
  expect(removed.view.evaluatePlacement(placement())).toMatchObject({
    reason: "occupancy-conflict",
  });
  const saved = savedState(removed.scenario, removed.simulation);
  expect(saved.observations.player).toEqual(
    removed.view.knowledge.observations,
  );
  const resumed = startMission(new TerrainGrid(options), {
    state: saved,
    definitions,
    tickSeconds: 0.1,
  }).simulation;
  missions.push(resumed);
  expect(resumed.viewOf("player").evaluatePlacement(placement())).toEqual(
    removed.view.evaluatePlacement(placement()),
  );
  removed.simulation.spawnActor({
    id: "observer",
    definitionId: "arc-scout",
    owner: "player",
    worldPosition: map.tileCenter(17, 2),
    facing: 0,
    occupancyLayer: "surface",
  });
  removed.simulation.tick();
  expect(removed.view.knowledge.observations.actors).toEqual([]);
  expect(removed.view.evaluatePlacement(placement()).accepted).toBe(true);
});

test("unseen depletion and salvage pickups retain their last-seen blockers", () => {
  const setup = (changed: boolean) =>
    fixture({
      sites: [
        {
          id: "site",
          name: "Site",
          tile: { x: 18, z: 6 },
          initialMaterials: 100,
          remainingMaterials: changed ? 0 : 100,
        },
      ],
      loot: [
        {
          id: "loot",
          name: "Loot",
          tile: { x: 22, z: 6 },
          materials: 25,
          collected: changed,
        },
      ],
      edit: (state) => {
        state.observations.player = {
          ...createObservations(),
          sites: [{ siteId: "site", amount: 100, tick: 0 }],
          loot: [{ lootId: "loot", tick: 0 }],
        };
      },
    });
  const before = setup(false),
    after = setup(true);
  for (const x of [18, 22]) {
    expect(after.view.evaluatePlacement(placement(x, 6))).toEqual(
      before.view.evaluatePlacement(placement(x, 6)),
    );
    expect(after.view.evaluatePlacement(placement(x, 6))).toMatchObject({
      reason: "resource-site",
    });
  }
  expect(command(after.simulation, placement(18, 6)).accepted).toBe(true);
});

test("hidden debris does not block previews or mutate the live navigation state", () => {
  const empty = fixture();
  const hidden = fixture({
    edit: (state) => {
      state.retiredActorIds.push("dead");
      const actor = createTilePlacedActor(
        map,
        definitions.find(({ id }) => id === "arc-field-barracks")!,
        { actorId: "dead", origin: { x: 18, z: 2 } },
        "rival",
      );
      state.wrecks.push({
        ...actor,
        actorId: actor.id,
        tick: 0,
      });
    },
  });
  const before = hidden.simulation.snapshot();
  expect(hidden.view.wrecks()).toEqual([]);
  expect(hidden.view.evaluatePlacement(placement())).toEqual(
    empty.view.evaluatePlacement(placement()),
  );
  expect(hidden.simulation.snapshot()).toEqual(before);
  expect(command(hidden.simulation, placement())).toMatchObject({
    accepted: false,
    reason: "debris",
  });
});

test("growth previews and tending choose workers through known navigation only", () => {
  const setup = (blocked: boolean) =>
    fixture({
      edit: (state) => {
        const cultivation = state.economy!.cultivation!;
        cultivation.sites.push(
          createCultivationSite("previous", "Previous job", { x: 6, z: 10 }),
        );
        const worker = cultivation.workers.find(
          ({ actorId }) => actorId === "worker",
        )!;
        worker.siteId = "previous";
        worker.phase = "gathering";
        state.actors.find(({ id }) => id === "worker")!.orders = [
          { kind: "move", target: map.tileCenter(7, 10) },
        ];
        const growth = createTilePlacedActor(
          map,
          definitions.find(({ id }) => id === "circle-conservatory")!,
          { actorId: "growth", origin: { x: 18, z: 10 } },
          "player",
        );
        growth.construction = {
          paidCost: 100,
          completedTicks: 0,
          totalTicks: secondsToTicks(6, 0.1),
        };
        state.actors.push(growth);
        if (blocked)
          state.actors.push(
            createTilePlacedActor(
              map,
              definitions.find(({ id }) => id === "wall")!,
              { actorId: "wall", origin: { x: 12, z: 0 } },
              "rival",
            ),
          );
      },
    });
  const empty = setup(false),
    hidden = setup(true);
  expect(hidden.view.shownActor("wall")).toBeUndefined();
  const before = hidden.simulation.snapshot();
  expect(empty.view.tendWorker("growth", ["worker"])).toBe("worker");
  expect(hidden.view.tendWorker("growth", ["worker"])).toBe("worker");
  const candidate = {
    actorId: "new-growth",
    definitionId: "circle-conservatory",
    origin: { x: 18, z: 7 },
    workerIds: ["worker"],
  };
  expect(hidden.view.evaluatePlacement(candidate)).toEqual(
    empty.view.evaluatePlacement(candidate),
  );
  expect(hidden.view.evaluatePlacement(candidate)).toMatchObject({
    accepted: true,
    workerId: "worker",
  });
  expect(hidden.simulation.snapshot()).toEqual(before);
  const worker = hidden.simulation.actorById("worker")!;
  const grid = hidden.movement.navigationGrid!(
    worker,
    definitions.find(({ id }) => id === worker.definitionId)!,
  );
  expect(grid.regionAt(17, 10)).toBeGreaterThanOrEqual(0);
  expect(grid.regionAt(6, 10)).not.toBe(grid.regionAt(17, 10));
  const tend = {
    kind: "tend" as const,
    actorId: "worker",
    buildingId: "growth",
  };
  expect(command(empty.simulation, tend).accepted).toBe(true);
  expect(command(hidden.simulation, tend)).toMatchObject({
    accepted: false,
    reason: "unreachable-growth",
  });
  const continuing = hidden.simulation.economy!.cultivation!.workers.find(
    ({ actorId }) => actorId === "worker",
  )!;
  expect(continuing.tendingId).toBeUndefined();
  expect(continuing).toMatchObject({ siteId: "previous", phase: "gathering" });
  expect(hidden.simulation.actorById("worker")!.orders).toEqual(worker.orders);
});
