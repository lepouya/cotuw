import { expect, test, vi } from "vitest";

import { createActor } from "../src/simulation/actor";
import { idleWorkerIds } from "../src/simulation/economy";
import { createCultivatorState } from "../src/simulation/cultivation";
import { createHarvesterState } from "../src/simulation/harvesting";
import { createIdleWorkerControls } from "../src/ui/idle-workers";

import type { Actor } from "../src/simulation/actor";
import type { EconomyState } from "../src/simulation/economy";
import type { CultivatorState } from "../src/simulation/cultivation";
import type { HarvesterState } from "../src/simulation/harvesting";

const actor = (id: string, extra: Partial<Actor> = {}) => ({
  ...createActor({
    id,
    definitionId: "worker",
    owner: "player",
    worldPosition: { x: 0, z: 0 },
  }),
  ...extra,
});

function economy(
  harvesters: HarvesterState[],
  workers: CultivatorState[] = [],
): EconomyState {
  return {
    stockpiles: [],
    deposited: [],
    sites: [],
    loot: [],
    harvesters,
    production: [],
    cultivation: { sites: [], workers },
  };
}

const harvester = (id: string, state: Partial<HarvesterState>) => ({
  ...createHarvesterState(id, "refinery"),
  ...state,
});

const cultivator = (id: string, state: Partial<CultivatorState>) => ({
  ...createCultivatorState(id),
  ...state,
});

test("idle workers include stopped, exhausted, and unaffiliated workers with cargo", () => {
  const state = economy(
    [
      harvester("h-stopped", { phase: "idle", cargo: 4 }),
      harvester("h-exhausted", { phase: "depleted", targetSiteId: "patch" }),
      harvester("h-new", { phase: "unassigned", refineryId: undefined }),
      harvester("h-gathering", { phase: "gathering", targetSiteId: "patch" }),
      harvester("h-returning", { phase: "returning", cargo: 10 }),
      harvester("h-blocked", { phase: "blocked", targetSiteId: "patch" }),
      // Its patch assignment awaits a delivery route.
      harvester("h-orphaned", {
        phase: "unassigned",
        refineryId: undefined,
        targetSiteId: "patch",
      }),
    ],
    [
      cultivator("c-idle", { cargo: 6 }),
      cultivator("c-waiting", { phase: "waiting", siteId: "grove" }),
      cultivator("c-no-dropoff", { phase: "no-dropoff", cargo: 3 }),
      cultivator("c-paused-tending", { phase: "tending", tendingId: "hall" }),
    ],
  );
  const actors = state.harvesters
    .map(({ actorId }) => actor(actorId))
    .concat(state.cultivation!.workers.map(({ actorId }) => actor(actorId)));
  expect(
    idleWorkerIds(state, (id) => actors.find((actor) => actor.id === id)),
  ).toEqual(["c-idle", "h-exhausted", "h-new", "h-stopped"]);
});

test("pending orders keep otherwise idle workers busy", () => {
  const state = economy(
    ["moving", "attack-moving", "queued", "attacking", "returning", "free"].map(
      (id) => harvester(id, { phase: "idle" }),
    ),
  );
  const actors = [
    actor("moving", { movement: { target: { x: 1, z: 1 } } }),
    actor("attack-moving", { attackMove: { target: { x: 1, z: 1 } } }),
    actor("queued", { orders: [{ kind: "move", target: { x: 1, z: 1 } }] }),
    actor("attacking", {
      combat: { attack: { targetId: "wolf", lastKnown: { x: 1, z: 1 } } },
    }),
    actor("returning", { combat: { returning: { point: { x: 1, z: 1 } } } }),
    actor("free", { orders: [] }),
  ];
  const actorById = (id: string) => actors.find((actor) => actor.id === id);
  expect(idleWorkerIds(state, actorById)).toEqual(["free"]);
  // Workers another owner commands are absent from the actors passed in.
  expect(idleWorkerIds(state, () => undefined)).toEqual([]);
  expect(idleWorkerIds(undefined, actorById)).toEqual([]);
});

test("Period cycles idle workers in ID order; Select all keeps the camera", () => {
  let ids = ["harvester-1", "harvester-2"];
  const select = vi.fn();
  const focus = vi.fn();
  const controls = createIdleWorkerControls(undefined, {
    idleIds: () => ids,
    select,
    focus,
    enabled: () => true,
  });
  for (let press = 0; press < 3; press++) controls.next();
  expect(select.mock.calls).toEqual([
    [["harvester-1"]],
    [["harvester-2"]],
    [["harvester-1"]],
  ]);
  expect(focus).toHaveBeenCalledTimes(3);
  // The cycle continues after the last choice when the list changes.
  ids = ["cultivator-1", "harvester-3"];
  controls.next();
  expect(select).toHaveBeenLastCalledWith(["harvester-3"]);
  controls.selectAll();
  expect(select).toHaveBeenLastCalledWith(["cultivator-1", "harvester-3"]);
  expect(focus).toHaveBeenCalledTimes(4);
  ids = [];
  expect(controls.next()).toBe(false);
  expect(controls.selectAll()).toBe(false);
});
