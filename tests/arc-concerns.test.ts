import { afterAll, beforeAll, expect, test } from "vitest";

import {
  dueRound,
  MIRROR,
  resumeMirror,
  ROUND_TICKS,
  runTicks,
} from "./helpers/ai-mirror";
import { createSessionSimulation, loadMission } from "../src/mission-loading";
import {
  secondsToTicks,
  SIMULATION_TICK_SECONDS,
} from "../src/simulation/clock";
import { serializeMission } from "../src/simulation/mission-file";
import { disconnectedBuildings } from "../src/simulation/support";
import { BUILT_IN_AI_CONCERNS } from "../src/simulation/ai-concerns";
import { createHarvesterState } from "../src/simulation/harvesting";
import { distance } from "../src/simulation/world";
import { setBalance } from "./helpers/scenario";

import type { CommandOutcome } from "../src/simulation/command";
import type {
  MissionSimulation,
  MissionState,
} from "../src/simulation/mission";

const OWNERS = ["west", "east"] as const;
const STARTING_MATERIALS = 150;
const minutes = (count: number) =>
  secondsToTicks(count * 60, SIMULATION_TICK_SECONDS);

let simulation: MissionSimulation;
const outcomes: CommandOutcome[] = [];
let saved: string;
let atSave: MissionState;
let afterSave: MissionState;

// One undisturbed opening, inspected at three and five minutes.
beforeAll(() => {
  simulation = createSessionSimulation(MIRROR);
  outcomes.push(...runTicks(simulation, minutes(3)));
  atSave = simulation.snapshot();
  saved = serializeMission(MIRROR.scenario, atSave, SIMULATION_TICK_SECONDS);
  outcomes.push(...runTicks(simulation, minutes(0.5)));
  afterSave = simulation.snapshot();
  outcomes.push(...runTicks(simulation, minutes(1.5)));
});
afterAll(() => simulation.dispose());

const ownedBy = (owner: string, definitionId: string) =>
  simulation.actors.filter(
    (actor) => actor.owner === owner && actor.definitionId === definitionId,
  );

test("the ARC AI opens within the development windows", () => {
  for (const owner of OWNERS) {
    const { milestones } = simulation.metrics!.owners.find(
      (metrics) => metrics.owner === owner,
    )!;
    expect(milestones.firstIncome).toBeLessThanOrEqual(minutes(2));
    expect(milestones.militaryReady).toBeLessThanOrEqual(minutes(4));
    expect(milestones.firstCombatUnit).toBeLessThanOrEqual(minutes(5));
    expect(simulation.ai[owner]!.posture).toBe("developing");
  }
});

test("the ARC AI grows income and forces with ordinary placement and costs", () => {
  const disconnected = disconnectedBuildings(simulation.support);
  for (const owner of OWNERS) {
    const refineries = ownedBy(owner, "arc-materials-refinery");
    expect(refineries.length).toBeGreaterThanOrEqual(2);
    expect(ownedBy(owner, "arc-field-barracks")).toHaveLength(1);
    // Raids after the grace period can already have cost Troopers.
    const { peakArmy } = simulation.metrics!.owners.find(
      (metrics) => metrics.owner === owner,
    )!;
    expect(peakArmy).toBeGreaterThanOrEqual(3);
    for (const building of [
      ...refineries,
      ...ownedBy(owner, "arc-field-barracks"),
    ])
      expect(disconnected.has(building.id)).toBe(false);
    const harvesters = simulation.economy!.harvesters.filter(({ actorId }) =>
      ownedBy(owner, "arc-harvester").some(({ id }) => id === actorId),
    );
    expect(harvesters.length).toBeGreaterThanOrEqual(1);
    for (const harvester of harvesters) {
      expect(refineries.map(({ id }) => id)).toContain(harvester.refineryId);
      expect(harvester.targetSiteId).toMatch(new RegExp(`^${owner}-home-`));
    }
    const { gathered, spent } = simulation.metrics!.owners.find(
      (metrics) => metrics.owner === owner,
    )!;
    expect(spent.materials).toBeLessThanOrEqual(
      STARTING_MATERIALS + gathered.materials,
    );
  }
});

test("the ARC AI's commands stay valid", () => {
  const ai = outcomes.filter(({ issuer }) => issuer.ai);
  expect(ai.length).toBeGreaterThan(0);
  expect(ai.filter(({ accepted }) => !accepted)).toEqual([]);
  for (const owner of OWNERS)
    expect(simulation.ai[owner]!.rejections).toEqual([]);
});

// Undisturbed by raids and attacks.
const UNDISTURBED = new Map(BUILT_IN_AI_CONCERNS).set("offense", () => {});
const PLANS = MIRROR.content.aiProfiles![0]!.tuning.plans!;
let expanded:
  | {
      state: MissionState;
      firstBlueprint: MissionState;
      results: CommandOutcome[];
    }
  | undefined;

/** The undisturbed base six minutes after the opening, computed once. */
function expandedBase() {
  if (!expanded) {
    const sim = resumeMirror(simulation.snapshot(), UNDISTURBED);
    try {
      const results: CommandOutcome[] = [];
      let firstBlueprint: MissionState | undefined;
      const until = sim.completedTicks + minutes(6);
      while (sim.completedTicks < until) {
        const outcomes = sim.tick();
        results.push(...outcomes);
        if (
          !firstBlueprint &&
          outcomes.some(
            ({ issuer, command, accepted }) =>
              accepted &&
              issuer.owner === "west" &&
              command.kind === "place-actor" &&
              remoteRefineries(sim, "west", true).some(
                ({ id }) => id === command.actorId,
              ),
          )
        )
          firstBlueprint = sim.snapshot();
      }
      expect(firstBlueprint).toBeDefined();
      expanded = {
        state: sim.snapshot(),
        firstBlueprint: firstBlueprint!,
        results,
      };
    } finally {
      sim.dispose();
    }
  }
  return expanded;
}

/** Refineries beyond headquarters support. */
const remoteRefineries = (
  sim: MissionSimulation,
  owner = "west",
  unfinished = false,
) =>
  sim.actors.filter(
    (actor) =>
      actor.owner === owner &&
      actor.definitionId === "arc-materials-refinery" &&
      !!actor.construction === unfinished &&
      distance(
        actor.worldPosition,
        sim.actorById(`${owner}-headquarters`)!.worldPosition,
      ) > 12,
  );

test("the developing base expands, defends its expansion, and fields a mixed army", () => {
  const { state, results } = expandedBase();
  const sim = resumeMirror(structuredClone(state), UNDISTURBED);
  try {
    expect(results.filter(({ accepted }) => !accepted)).toEqual([]);
    const plans = PLANS;
    const disconnected = disconnectedBuildings(sim.support);
    for (const owner of OWNERS) {
      const completed = sim.actors.filter(
        (actor) => actor.owner === owner && !actor.construction,
      );
      const of = (definitionId: string) =>
        completed.filter((actor) => actor.definitionId === definitionId);
      const remote = remoteRefineries(sim, owner);
      expect(of("arc-materials-refinery")).toHaveLength(
        (plans["arc-income"]!.refineries as number) +
          (plans["arc-expansion"]!.refineries as number),
      );
      expect(remote).toHaveLength(plans["arc-expansion"]!.refineries as number);
      expect(of("arc-relay-station").length).toBeGreaterThanOrEqual(1);
      for (const building of [...remote, ...of("arc-relay-station")])
        expect(disconnected.has(building.id)).toBe(false);
      expect(of("arc-field-barracks")).toHaveLength(2);
      // Every remote Refinery has a guard; the last may still be on order.
      const guards = (refinery: (typeof remote)[number]) =>
        of("arc-sentry-turret").filter(
          ({ worldPosition }) =>
            distance(worldPosition, refinery.worldPosition) <=
            (plans["arc-defenses"]!.guardTiles as number),
        );
      for (const refinery of remote)
        expect(guards(refinery).length).toBeGreaterThan(0);
      expect(
        new Set(remote.flatMap((refinery) => guards(refinery))).size,
      ).toBeGreaterThanOrEqual(plans["arc-defenses"]!.remote as number);
      const harvesters = sim.economy!.harvesters.filter(({ actorId }) =>
        sim.viewOf(owner).ownActor(actorId),
      );
      expect(harvesters).toHaveLength(4);
      expect(
        harvesters.filter(({ targetSiteId }) =>
          targetSiteId?.startsWith(`${owner}-forward-`),
        ),
      ).toHaveLength(remote.length);
      const { milestones } = sim.metrics!.owners.find(
        (metrics) => metrics.owner === owner,
      )!;
      // First expansion income lands in the minute 5 to 8 window.
      expect(milestones.firstExpansion).toBeLessThan(minutes(9));
      expect(of("arc-demolition-trooper").length).toBeGreaterThan(0);
      expect(of("arc-medic").length).toBeGreaterThan(0);
      const [mechanic] = of("arc-mechanic");
      expect(mechanic).toBeDefined();
      expect(
        Math.min(
          ...of("arc-materials-refinery").map(({ worldPosition }) =>
            distance(worldPosition, mechanic!.worldPosition),
          ),
        ),
      ).toBeLessThanOrEqual((plans.forces!.stationTiles as number) + 1);
    }
  } finally {
    sim.dispose();
  }
}, 30_000);

test("a cut Relay chain is restored and its expansion reconnects", () => {
  const state = structuredClone(expandedBase().state);
  const sim = resumeMirror(dueRound(state), UNDISTURBED);
  try {
    for (const { id, owner, definitionId } of state.actors)
      if (owner === "west" && definitionId === "arc-relay-station")
        sim.submitCommand({ kind: "remove-actor", actorId: id }, { owner });
    sim.tick();
    const remote = remoteRefineries(sim);
    expect(remote.length).toBeGreaterThan(0);
    const offline = () => {
      const disconnected = disconnectedBuildings(sim.support);
      return remote.filter(({ id }) => disconnected.has(id));
    };
    expect(offline()).toEqual(remote);
    const results = runTicks(sim, minutes(1));
    expect(results.filter(({ accepted }) => !accepted)).toEqual([]);
    expect(offline()).toEqual([]);
    const placed = results.filter(
      ({ command, issuer }) =>
        issuer.owner === "west" && command.kind === "place-actor",
    );
    // The chain comes back before any further expansion.
    expect(placed[0]?.command).toMatchObject({
      definitionId: "arc-relay-station",
    });
    expect(sim.ai.west!.memory["arc-expansion"]).toEqual(
      state.ai.west!.memory["arc-expansion"],
    );
  } finally {
    sim.dispose();
  }
}, 30_000);

test("an expansion lost to visible enemies is abandoned, not rebuilt", () => {
  const state = structuredClone(expandedBase().state);
  const [held] = state.ai.west!.memory["arc-expansion"]!.deposits as string[];
  expect(held).toBeDefined();
  // An enemy Turret holds the deposit, within sight of west's own guard.
  const guard = state.actors.find(
    ({ owner, definitionId }) =>
      owner === "west" && definitionId === "arc-sentry-turret",
  )!;
  const { origin } = guard.tilePlacement!;
  state.actors.push({
    id: "enemy-turret",
    definitionId: guard.definitionId,
    owner: "east",
    worldPosition: { ...guard.worldPosition, z: guard.worldPosition.z + 3 },
    facing: 0,
    occupancyLayer: guard.occupancyLayer,
    tilePlacement: { origin: { ...origin, z: origin.z + 3 }, quarterTurns: 0 },
  });
  const { history } = state.metrics!.owners.find(
    ({ owner }) => owner === "east",
  )!;
  history[history.length - 1]!.buildings += 1;
  const sim = resumeMirror(dueRound(state), UNDISTURBED);
  try {
    const remote = remoteRefineries(sim);
    expect(remote.length).toBeGreaterThan(0);
    for (const { id } of remote)
      sim.submitCommand(
        { kind: "remove-actor", actorId: id },
        { owner: "west" },
      );
    const results = runTicks(sim, ROUND_TICKS * 2);
    expect(sim.actorById("enemy-turret")).toBeDefined();
    expect(
      (sim.ai.west!.memory["arc-expansion"]?.deposits as
        string[] | undefined) ?? [],
    ).not.toContain(held);
    expect(
      results.filter(
        ({ command, issuer }) =>
          issuer.owner === "west" &&
          command.kind === "place-actor" &&
          command.definitionId === "arc-materials-refinery",
      ),
    ).toEqual([]);
  } finally {
    sim.dispose();
  }
}, 30_000);

test("an offline Refinery blueprint resumes after the Relay chain is rebuilt", () => {
  const state = structuredClone(expandedBase().firstBlueprint);
  setBalance(state, 1000, "materials", "west");
  const sim = resumeMirror(dueRound(state), UNDISTURBED);
  try {
    const [blueprint] = remoteRefineries(sim, "west", true);
    expect(blueprint?.construction).toBeDefined();
    for (const { id, owner, definitionId } of state.actors)
      if (owner === "west" && definitionId === "arc-relay-station")
        sim.submitCommand({ kind: "remove-actor", actorId: id }, { owner });
    sim.tick();
    expect(disconnectedBuildings(sim.support).has(blueprint!.id)).toBe(true);
    runTicks(sim, minutes(1));
    expect(disconnectedBuildings(sim.support).has(blueprint!.id)).toBe(false);
    expect(sim.actorById(blueprint!.id)).toBeDefined();
    expect(sim.actorById(blueprint!.id)?.construction).toBeUndefined();
  } finally {
    sim.dispose();
  }
}, 30_000);

test("a raided home Refinery gets a Sentry Turret even if the raider escaped sight", () => {
  const state = structuredClone(expandedBase().state);
  setBalance(state, 1000, "materials", "west");
  const home = state.actors.find(({ id }) => id === "west-headquarters")!;
  const refinery = state.actors.find(
    (actor) =>
      actor.owner === "west" &&
      actor.definitionId === "arc-materials-refinery" &&
      distance(actor.worldPosition, home.worldPosition) <= 12,
  )!;
  const raider = state.actors.find(
    ({ owner, definitionId }) =>
      owner === "east" && definitionId === "arc-trooper",
  )!;
  refinery.combat = {
    lastHit: { attackerId: raider.id, tick: state.tick },
  };
  const sim = resumeMirror(dueRound(state), UNDISTURBED);
  try {
    expect(sim.viewOf("west").shownActor(raider.id)).toBeUndefined();
    const results = runTicks(sim, minutes(0.5));
    expect(sim.ai.west!.memory["arc-defenses"]).toMatchObject({
      raided: [refinery.id],
    });
    const turrets = results.filter(
      ({ command, issuer, accepted }) =>
        accepted &&
        issuer.owner === "west" &&
        command.kind === "place-actor" &&
        command.definitionId === "arc-sentry-turret",
    );
    expect(
      turrets.some(({ command }) => {
        const turret = sim.actorById((command as { actorId: string }).actorId);
        return (
          !!turret &&
          distance(turret.worldPosition, refinery.worldPosition) <=
            (PLANS["arc-defenses"]!.guardTiles as number)
        );
      }),
    ).toBe(true);
  } finally {
    sim.dispose();
  }
}, 30_000);

test("a saved ARC AI continues exactly as an uninterrupted one", () => {
  const resumed = createSessionSimulation(loadMission(saved));
  try {
    expect(resumed.snapshot()).toEqual(atSave);
    runTicks(resumed, minutes(0.5));
    expect(resumed.snapshot()).toEqual(afterSave);
  } finally {
    resumed.dispose();
  }
});

test.each([1, 2])(
  "an income turn reserves a Refinery for one of %i unassigned workers",
  (workers) => {
    const state = structuredClone(atSave);
    const worker = state.actors.find(
      ({ owner, definitionId }) =>
        owner === "west" && definitionId === "arc-harvester",
    )!;
    const empty = state.economy!.harvesters.find(
      ({ actorId }) => actorId === worker.id,
    )!;
    const refineryId = empty.refineryId!;
    state.economy!.harvesters = state.economy!.harvesters.map((entry) =>
      entry === empty ? createHarvesterState(worker.id) : entry,
    );
    for (let index = 1; index < workers; index++) {
      const extra = { ...structuredClone(worker), id: `unassigned-${index}` };
      state.actors.push(extra);
      state.economy!.harvesters.push(createHarvesterState(extra.id));
    }
    const history = state.metrics!.owners.find(
      ({ owner }) => owner === "west",
    )!.history;
    history[history.length - 1]!.units += workers - 1;
    state.economy!.stockpiles.forEach((stockpile) => (stockpile.amount = 1000));
    dueRound(state);
    const concerns = new Map(BUILT_IN_AI_CONCERNS);
    for (const name of ["arc-production", "forces"])
      concerns.set(
        name,
        Object.assign(() => {}, concerns.get(name)),
      );
    const sim = resumeMirror(state, concerns);
    try {
      const results = runTicks(sim, ROUND_TICKS).filter(
        ({ issuer }) => issuer.owner === "west",
      );
      expect(results.filter(({ accepted }) => !accepted)).toEqual([]);
      expect(
        results.filter(({ command }) => command.kind === "assign-refinery"),
      ).toHaveLength(1);
      expect(
        sim.economy!.production.filter(
          ({ producerId }) => producerId === refineryId,
        ),
      ).toEqual([]);
    } finally {
      sim.dispose();
    }
  },
);

test.each(["missing", "blocked"])(
  "forces restore a %s rally point",
  (condition) => {
    const state = structuredClone(atSave);
    const producer = state.actors.find(
      ({ owner, definitionId }) =>
        owner === "west" && definitionId === "arc-field-barracks",
    )!;
    if (condition === "missing") delete producer.rallyPoint;
    else
      producer.rallyPoint = {
        ...state.actors.find(({ id }) => id === "west-headquarters")!
          .worldPosition,
      };
    const sim = resumeMirror(dueRound(state));
    try {
      runTicks(sim, ROUND_TICKS);
      const target = sim.actorById(producer.id)!.rallyPoint;
      expect(target).toBeDefined();
      expect(sim.viewOf("west").evaluateRallyPoint(producer.id, target!)).toBe(
        true,
      );
    } finally {
      sim.dispose();
    }
  },
);
