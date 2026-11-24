import { afterAll, beforeAll, expect, test } from "vitest";

import { ROUND_TICKS, runTicks } from "./helpers/ai-mirror";
import { setBalance } from "./helpers/scenario";
import { CIRCLE_MIRROR_CASES } from "../scripts/ai-match/runner";
import {
  assembleSkirmish,
  createSessionSimulation,
  missionTerrain,
} from "../src/mission-loading";
import { BUILT_IN_AI_CONCERNS } from "../src/simulation/ai-concerns";
import { circleIncomeRestart } from "../src/simulation/circle-concerns";
import {
  secondsToTicks,
  SIMULATION_TICK_SECONDS,
} from "../src/simulation/clock";
import { createCultivatorState } from "../src/simulation/cultivation";
import { createScenarioMap } from "../src/simulation/scenario";
import { distance } from "../src/simulation/world";

import type { CommandOutcome } from "../src/simulation/command";
import type { AiConcernContext } from "../src/simulation/director";
import type {
  MissionSimulation,
  MissionState,
} from "../src/simulation/mission";

const OWNERS = ["west", "east"] as const;
const MIRROR = assembleSkirmish(
  CIRCLE_MIRROR_CASES.find(({ id }) => id === "circle-mirror-west-normal")!
    .choice,
);
const MAP = createScenarioMap(missionTerrain(MIRROR));
const DEFINITIONS = new Map(MIRROR.definitions.map((d) => [d.id, d]));
const PLANS = MIRROR.content.aiProfiles!.find(
  ({ id }) => id === "circle-skirmish",
)!.tuning.plans!;
const INCOME = PLANS["circle-income"] as {
  workersPerSite: number;
  serveTiles: number;
};
const minutes = (count: number) =>
  secondsToTicks(count * 60, SIMULATION_TICK_SECONDS);
// Undisturbed by raids and attacks.
const UNDISTURBED = new Map(BUILT_IN_AI_CONCERNS).set("offense", () => {});

const resume = (state: MissionState) =>
  createSessionSimulation(
    {
      ...MIRROR,
      state: { ...structuredClone(state), terrain: state.terrain! },
    },
    undefined,
    UNDISTURBED,
  );

let simulation: MissionSimulation;
const outcomes: CommandOutcome[] = [];
/** The undisturbed base at eight minutes, with its first expansion. */
let developed: MissionState;

beforeAll(() => {
  simulation = createSessionSimulation(MIRROR, undefined, UNDISTURBED);
  outcomes.push(...runTicks(simulation, minutes(8)));
  developed = simulation.snapshot();
}, 60_000);
afterAll(() => simulation.dispose());

const ownedBy = (
  sim: Pick<MissionSimulation, "actors">,
  owner: string,
  definitionId: string,
) =>
  sim.actors.filter(
    (actor) =>
      actor.owner === owner &&
      actor.definitionId === definitionId &&
      !actor.construction,
  );

const workersOf = (sim: MissionSimulation, owner: string) =>
  sim.economy!.cultivation!.workers.filter(({ actorId }) =>
    ownedBy(sim, owner, "circle-cultivator").some(({ id }) => id === actorId),
  );

test("the Circle AI opens within the development windows", () => {
  for (const owner of OWNERS) {
    const { milestones } = simulation.metrics!.owners.find(
      (metrics) => metrics.owner === owner,
    )!;
    expect(milestones.firstIncome).toBeLessThanOrEqual(minutes(2));
    expect(milestones.militaryReady).toBeLessThanOrEqual(minutes(3));
    expect(milestones.firstCombatUnit).toBeLessThanOrEqual(minutes(5));
    expect(milestones.firstExpansion).toBeLessThanOrEqual(minutes(8));
  }
});

test("the Circle AI's commands stay valid", () => {
  const ai = outcomes.filter(({ issuer }) => issuer.ai);
  expect(ai.length).toBeGreaterThan(0);
  expect(ai.filter(({ accepted }) => !accepted)).toEqual([]);
  for (const owner of OWNERS)
    expect(simulation.ai[owner]!.rejections).toEqual([]);
});

test("the first Musterhall rallies close to home Lifebloom", () => {
  for (const owner of OWNERS) {
    const rally = outcomes.find(
      ({ issuer, command, accepted }) =>
        issuer.owner === owner &&
        accepted &&
        command.kind === "set-rally-point" &&
        ownedBy(simulation, owner, "circle-musterhall").some(
          ({ id }) => id === command.actorId,
        ),
    )?.command;
    expect(rally?.kind).toBe("set-rally-point");
    if (rally?.kind !== "set-rally-point") continue;
    const homeSites = MIRROR.scenario.skirmish!.startingResourceSites[owner]!;
    const closest = Math.min(
      ...simulation
        .economy!.cultivation!.sites.filter(({ id }) => homeSites.includes(id))
        .map(({ tile }) =>
          distance(rally.target!, MAP.tileCenter(tile.x, tile.z)),
        ),
    );
    expect(closest).toBeLessThanOrEqual(5 * MAP.tileSize);
  }
});

test("Cultivators spread across served sites within the per-site cap", () => {
  const range = INCOME.serveTiles * MAP.tileSize;
  for (const owner of OWNERS) {
    const conservatories = ownedBy(simulation, owner, "circle-conservatory");
    expect(conservatories.length).toBeGreaterThanOrEqual(2);
    expect(ownedBy(simulation, owner, "circle-musterhall")).toHaveLength(1);
    const workers = workersOf(simulation, owner);
    const load = new Map<string, number>();
    for (const { siteId } of workers)
      if (siteId) load.set(siteId, (load.get(siteId) ?? 0) + 1);
    expect(load.size).toBeGreaterThanOrEqual(3);
    for (const [siteId, count] of load) {
      expect(count).toBeLessThanOrEqual(INCOME.workersPerSite);
      const site = simulation.economy!.cultivation!.sites.find(
        ({ id }) => id === siteId,
      )!;
      const position = MAP.tileCenter(site.tile.x, site.tile.z);
      expect(
        conservatories.some(
          ({ worldPosition }) => distance(worldPosition, position) <= range,
        ),
      ).toBe(true);
    }
  }
});

/** Removes actors through the test hook before the next tick plans. */
function remove(sim: MissionSimulation, actorIds: readonly string[]) {
  for (const actorId of actorIds)
    sim.submitCommand({ kind: "remove-actor", actorId }, { owner: "west" });
  runTicks(sim, 1);
}

const ROUND = secondsToTicks(1, SIMULATION_TICK_SECONDS) + ROUND_TICKS;

test("Cultivators leave a Dormant site for an open one with room", () => {
  const state = structuredClone(developed);
  const cultivation = state.economy!.cultivation!;
  const assigned = (siteId: string) =>
    cultivation.workers
      .filter((worker) => worker.siteId === siteId)
      .map(({ actorId }) => actorId);
  const home = cultivation.sites.find(
    ({ id }) => id.startsWith("west-home-") && assigned(id).length > 0,
  )!;
  const open = cultivation.sites.find(
    ({ id }) =>
      id.startsWith("west-") &&
      !id.startsWith("west-home-") &&
      assigned(id).length > 0,
  )!;
  const moving = assigned(home.id);
  home.reserve = 5000;
  home.dormant = true;
  const sim = resume(state);
  try {
    // Free the open site's places once the dormancy is seen.
    remove(sim, assigned(open.id));
    const results = runTicks(sim, ROUND);
    const gathers = results.filter(
      ({ command, accepted }) =>
        accepted &&
        command.kind === "gather" &&
        moving.includes(command.actorId),
    );
    expect(gathers).toHaveLength(moving.length);
    expect(gathers.map(({ command }) => command)).toEqual(
      expect.arrayContaining(
        moving.map((actorId) => ({ kind: "gather", actorId, siteId: open.id })),
      ),
    );
  } finally {
    sim.dispose();
  }
});

test("an idle Cultivator waits when the only open site is full", () => {
  const state = structuredClone(developed);
  const cultivation = state.economy!.cultivation!;
  const west = new Set(
    ownedBy(state, "west", "circle-cultivator").map(({ id }) => id),
  );
  const at = (siteId: string) =>
    cultivation.workers.filter(
      ({ actorId, siteId: assigned }) =>
        west.has(actorId) && assigned === siteId,
    );
  const full = cultivation.sites.find(
    ({ id, dormant }) => !dormant && at(id).length === INCOME.workersPerSite,
  )!;
  const idle = cultivation.workers.findIndex(
    ({ actorId, siteId }) => west.has(actorId) && siteId && siteId !== full.id,
  );
  const { actorId } = cultivation.workers[idle]!;
  cultivation.workers[idle] = createCultivatorState(actorId);
  for (const site of cultivation.sites) {
    if (site === full) continue;
    site.dormant = true;
    site.reserve = site.dormantBelow;
  }
  const sim = resume(state);
  try {
    const results = runTicks(sim, ROUND);
    expect(
      results.some(
        ({ command }) =>
          command.kind === "gather" && command.actorId === actorId,
      ),
    ).toBe(false);
    expect(
      workersOf(sim, "west").find((worker) => worker.actorId === actorId)
        ?.siteId,
    ).toBeUndefined();
  } finally {
    sim.dispose();
  }
});

test("a Cultivator leaves an open site when its route becomes impassable", () => {
  const state = structuredClone(developed);
  const cultivation = state.economy!.cultivation!;
  const own = new Set(
    ownedBy(state, "west", "circle-cultivator").map(({ id }) => id),
  );
  const worker = cultivation.workers.find(
    ({ actorId, siteId, phase }) =>
      own.has(actorId) && siteId && phase === "gathering",
  )!;
  const site = cultivation.sites.find(({ id }) => id === worker.siteId)!;
  const alternative = cultivation.workers.find(
    ({ actorId, siteId }) =>
      own.has(actorId) &&
      siteId !== undefined &&
      siteId !== site.id &&
      cultivation.sites.some(({ id, dormant }) => id === siteId && !dormant),
  )!;
  state.terrain!.tiles[MAP.tileIndex(site.tile.x, site.tile.z)] = {
    typeId: "water",
  };
  worker.phase = "blocked";
  const sim = resume(state);
  try {
    expect(sim.viewOf("west").canReachTile(worker.actorId, site.tile)).toBe(
      false,
    );
    remove(sim, [alternative.actorId]);
    const results = runTicks(sim, ROUND);
    expect(results).toContainEqual(
      expect.objectContaining({
        accepted: true,
        command: {
          kind: "gather",
          actorId: worker.actorId,
          siteId: alternative.siteId,
        },
      }),
    );
  } finally {
    sim.dispose();
  }
});

test("growth that loses its tender borrows the nearest free Cultivator", () => {
  const sim = resume(developed);
  try {
    let tender: string | undefined;
    let building: string | undefined;
    for (let tick = 0; tick < minutes(4) && !tender; tick++) {
      sim.tick();
      const worker = sim.economy!.cultivation!.workers.find(
        ({ actorId, tendingId }) =>
          tendingId && sim.actorById(actorId)?.owner === "west",
      );
      tender = worker?.actorId;
      building = worker?.tendingId;
    }
    expect(tender).toBeDefined();
    remove(sim, [tender!]);
    expect(sim.actorById(building!)?.construction).toBeDefined();
    const results = runTicks(sim, ROUND);
    const tends = results.filter(
      ({ command, accepted }) =>
        accepted && command.kind === "tend" && command.buildingId === building,
    );
    expect(tends).toHaveLength(1);
    expect(
      sim.economy!.cultivation!.workers.some(
        ({ tendingId }) => tendingId === building,
      ),
    ).toBe(true);
  } finally {
    sim.dispose();
  }
});

// Concerns that plan nothing, so removals stay unanswered.
const IDLE = new Map(
  [...BUILT_IN_AI_CONCERNS].map(([id, concern]) => [
    id,
    Object.assign(() => {}, { planSpec: concern.planSpec }),
  ]),
);

/** West's restart report after removing its actors of these definitions. */
function restartWithout(definitionIds: readonly string[]) {
  const sim = createSessionSimulation(
    {
      ...MIRROR,
      state: { ...structuredClone(developed), terrain: developed.terrain! },
    },
    undefined,
    IDLE,
  );
  try {
    for (const job of sim.economy!.production)
      if (definitionIds.includes(job.definitionId))
        sim.submitCommand(
          { kind: "cancel-production", actorId: job.actorId },
          { owner: "west" },
        );
    remove(
      sim,
      sim.actors
        .filter(
          (actor) =>
            actor.owner === "west" &&
            definitionIds.includes(actor.definitionId),
        )
        .map(({ id }) => id),
    );
    return circleIncomeRestart({
      view: sim.viewOf("west"),
      definitions: DEFINITIONS,
      terrain: MAP,
    } as unknown as AiConcernContext);
  } finally {
    sim.dispose();
  }
}

test("the Circle restart price covers only what income lacks", () => {
  const full = { lifebloom: 150 };
  expect(restartWithout([])).toEqual({ reserve: full, needed: {} });
  expect(restartWithout(["circle-cultivator"])).toEqual({
    reserve: full,
    needed: { lifebloom: 50 },
  });
  expect(restartWithout(["circle-cultivator", "circle-conservatory"])).toEqual({
    reserve: full,
    needed: full,
  });
});

test("Cultivators without a Conservatory regrow income before producers", () => {
  const state = structuredClone(developed);
  setBalance(state, 100, "lifebloom", "west");
  const sim = resume(state);
  try {
    remove(
      sim,
      sim.actors
        .filter(
          ({ owner, definitionId }) =>
            owner === "west" &&
            [
              "circle-conservatory",
              "circle-musterhall",
              "circle-construct-nursery",
            ].includes(definitionId),
        )
        .map(({ id }) => id),
    );
    expect(workersOf(sim, "west").length).toBeGreaterThan(0);
    const placed: string[] = [];
    for (let tick = 0; tick < minutes(1) && !placed.length; tick++)
      for (const { command, issuer, accepted } of sim.tick())
        if (
          accepted &&
          issuer.owner === "west" &&
          command.kind === "place-actor"
        )
          placed.push(command.definitionId);
    expect(placed).toEqual(["circle-conservatory"]);
  } finally {
    sim.dispose();
  }
});
