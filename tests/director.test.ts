import { afterEach, expect, test } from "vitest";

import { ARC_AI_TUNING, BASE_CONTENT } from "./helpers/content";
import {
  actorIn,
  advanceTicks,
  balance,
  savedState,
  setBalance,
  startMission,
  stockpiles,
} from "./helpers/scenario";
import { issuedByPlayer } from "../src/simulation/command";
import { createAiState } from "../src/simulation/director";
import {
  launchOperation,
  withdrawOperations,
} from "../src/simulation/ai-operations";
import {
  ownBuildings,
  place,
  train as planTraining,
} from "../src/simulation/ai-planning";
import { startSimulationLoop } from "../src/simulation/loop";
import { createActor } from "../src/simulation/actor";
import {
  createScenarioMap,
  createScenarioState,
  defineScenario,
} from "../src/simulation/scenario";
import { TerrainGrid } from "../src/simulation/terrain";

import type {
  AiAllocation,
  AiWithdrawalContext,
  AiConcern,
  AiConcernContext,
  AiController,
  AiProfile,
} from "../src/simulation/director";
import type { MissionCommand } from "../src/simulation/command";
import type { ActorBehavior, ActorDefinition } from "../src/simulation/actor";
import type {
  MissionSimulation,
  MissionState,
} from "../src/simulation/mission";

const CC = "arc-command-center-prototype";
const BARRACKS = "arc-field-barracks";
const TROOPER = "arc-trooper";
const HARVESTER = "arc-harvester";
const TICK_SECONDS = 0.1;
/** Ticks between round starts with the default one-second rounds. */
const ROUND = 10;

const terrain = new TerrainGrid({
  width: 80,
  height: 24,
  tileSize: 1,
  terrainTypeIds: ["plain"],
});
const scenario = defineScenario({
  id: "director-test",
  tileSize: 1,
  terrainTypeIds: ["plain", "path", "rough", "water"],
  terrain: terrain.terrainState(),
  owners: [
    { id: "west", faction: "arc" },
    { id: "east", faction: "arc" },
  ],
  playerOwner: "west",
  relationships: [{ owners: ["west", "east"], relationship: "hostile" }],
  skirmish: {
    owners: ["west", "east"],
    startingResourceSites: { west: [], east: [] },
    qualifyingDefinitionIds: [CC, BARRACKS],
  },
  buildings: [
    {
      actorId: "west-hq",
      definitionId: CC,
      origin: { x: 2, z: 6 },
      owner: "west",
    },
    {
      actorId: "west-barracks",
      definitionId: BARRACKS,
      origin: { x: 10, z: 6 },
      owner: "west",
    },
    {
      actorId: "east-hq",
      definitionId: CC,
      origin: { x: 66, z: 6 },
      owner: "east",
    },
    {
      actorId: "east-barracks",
      definitionId: BARRACKS,
      origin: { x: 60, z: 6 },
      owner: "east",
    },
  ],
  units: [
    ...[1, 2, 3, 4].map((n) => ({
      actorId: `west-unit-${n}`,
      definitionId: TROOPER,
      owner: "west",
      tile: { x: 2 + n, z: 2 },
    })),
    {
      actorId: "west-worker",
      definitionId: HARVESTER,
      owner: "west",
      tile: { x: 8, z: 2 },
    },
    {
      actorId: "east-unit",
      definitionId: TROOPER,
      owner: "east",
      tile: { x: 70, z: 2 },
    },
  ],
  stockpiles: [
    ...stockpiles(100, "materials", "west"),
    ...stockpiles(1000, "materials", "east"),
  ],
  sites: [],
  loot: [],
});

const profile = (
  allocations: AiAllocation[],
  overrides: Partial<AiProfile> = {},
): AiProfile => ({
  id: "test",
  roundSeconds: 1,
  concernsPerTick: 8,
  commandsPerTick: 8,
  postures: { establishing: allocations },
  tuning: ARC_AI_TUNING,
  ...overrides,
});
const allocation = (
  concern: string,
  budget = 1,
  forces = 1,
  essential?: boolean,
): AiAllocation => ({
  concern,
  budget,
  forces,
  ...(essential && { essential }),
});

const simulations: MissionSimulation[] = [];
afterEach(() => simulations.splice(0).forEach((sim) => sim.dispose()));

function fixture(
  aiProfile: AiProfile,
  concerns: Record<string, AiConcern>,
  {
    state,
    controllers = [{ owner: "west", profile: aiProfile }],
    change,
    idleUpdate,
    definitions = BASE_CONTENT.actors,
  }: {
    state?: MissionState;
    controllers?: AiController[];
    change?: (state: MissionState) => void;
    idleUpdate?: ActorBehavior["update"];
    definitions?: readonly ActorDefinition[];
  } = {},
) {
  const start = state ?? {
    ...createScenarioState(scenario, definitions),
    ai: createAiState(controllers),
  };
  change?.(start);
  const { simulation } = startMission(
    createScenarioMap({ ...scenario, terrain: start.terrain! }),
    {
      state: start,
      skirmish: scenario.skirmish,
      definitions,
      tickSeconds: TICK_SECONDS,
      ai: controllers,
      aiConcerns: new Map(Object.entries(concerns)),
      idleUpdate,
    },
  );
  simulations.push(simulation);
  return simulation;
}

const train = (context: AiConcernContext, producerId = "west-barracks") =>
  context.issue({
    kind: "train-unit",
    producerId,
    actorId: context.newActorId(TROOPER),
    definitionId: TROOPER,
  });
/** Runs a concern's work once, on its first turn. */
const once = (work: AiConcern): AiConcern => {
  let done = false;
  return (context) => {
    if (!done) work(context);
    done = true;
  };
};

test("the director needs no observer and its commands apply in their tick", () => {
  const sim = fixture(profile([allocation("trainer")]), {
    trainer: once((context) => {
      expect(train(context)).toBe(true);
    }),
  });
  const outcomes = sim.tick();
  expect(outcomes).toEqual([
    expect.objectContaining({
      accepted: true,
      issuer: { owner: "west", ai: true },
      tick: 0,
      command: expect.objectContaining({
        kind: "train-unit",
        actorId: `ai:4:west:${TROOPER}:1`,
      }),
    }),
  ]);
  expect(balance(sim, "materials", "west")).toBe(75);
});

test("loaded missions run their director without a driver's help", () => {
  let turns = 0;
  const concerns = { counter: () => void (turns += 1) };
  const first = fixture(profile([allocation("counter")]), concerns);
  advanceTicks(first, ROUND + 3);
  expect(turns).toBe(2);
  const resumed = fixture(profile([allocation("counter")]), concerns, {
    state: savedState(scenario, first),
  });
  advanceTicks(resumed, 7);
  // The next round is still one tick away.
  expect(turns).toBe(2);
  resumed.tick();
  expect(turns).toBe(3);
});

test.each(["place-actor", "train-unit"] as const)(
  "%s planning works when an existing actor is named ai-probe",
  (kind) => {
    const sim = fixture(
      profile([allocation("builder")]),
      {
        builder: once((context) => {
          const queued =
            kind === "place-actor"
              ? place(
                  context,
                  context.terrain!,
                  context.definitions.get("arc-materials-refinery")!,
                  context.view.ownActor("west-hq")!.worldPosition,
                )
              : planTraining(
                  context,
                  ownBuildings(
                    context,
                    (definition) => definition.id === BARRACKS,
                  )[0]!,
                  context.definitions.get(TROOPER)!,
                );
          expect(queued).toBeTruthy();
        }),
      },
      {
        change: (state) => {
          state.actors.find(({ id }) => id === "west-unit-4")!.id = "ai-probe";
          setBalance(state, 1000, "materials", "west");
        },
      },
    );
    expect(sim.tick()).toMatchObject([{ accepted: true, command: { kind } }]);
  },
);

test("rounds wait their interval and owners plan on separate ticks", () => {
  const ticks: Record<string, number[]> = { west: [], east: [] };
  const aiProfile = profile([allocation("recorder")]);
  const sim = fixture(
    aiProfile,
    {
      recorder: ({ tick, view }) => void ticks[view.owner]!.push(tick),
    },
    {
      controllers: [
        { owner: "west", profile: aiProfile },
        { owner: "east", profile: aiProfile },
      ],
    },
  );
  advanceTicks(sim, 2 * ROUND + 2);
  expect(ticks).toEqual({ west: [0, 10, 20], east: [1, 11, 21] });
});

test("budgets split resources by weight and keep each concern's savings", () => {
  const funds: number[] = [];
  const sim = fixture(
    profile([allocation("saver", 3), allocation("spender")]),
    {
      saver: (context) => void funds.push(context.funds("materials")),
      spender: once((context) => {
        expect(context.funds("materials")).toBe(25);
        expect(train(context)).toBe(true);
        // Its 25 are spent, so another Trooper is refused.
        expect(train(context)).toBe(false);
        expect(context.funds("materials")).toBe(0);
      }),
    },
  );
  advanceTicks(sim, ROUND + 1);
  expect(balance(sim, "materials", "west")).toBe(75);
  expect(funds).toEqual([75, 75]);
  expect(sim.snapshot().ai.west!.budgets).toEqual({
    saver: { materials: 75 },
    spender: { materials: 0 },
  });
});

test("released funds are shared again by weight", () => {
  const funds: number[] = [];
  const sim = fixture(
    profile([allocation("releaser"), allocation("saver", 3)]),
    {
      releaser: (context) => {
        funds.push(context.funds("materials"));
        context.releaseFunds();
        expect(context.funds("materials")).toBe(0);
      },
      saver: () => {},
    },
  );
  advanceTicks(sim, 2 * ROUND + 1);
  // 100 splits 25/75; each release regains a quarter of what it returned.
  expect(funds).toEqual([25, 6.25, 1.563]);
  expect(sim.snapshot().ai.west!.budgets).toEqual({
    releaser: {},
    saver: { materials: 98.4375 },
  });
});

test("a release can keep a reserve and return only the surplus", () => {
  const funds: number[] = [];
  const sim = fixture(profile([allocation("keeper"), allocation("saver", 3)]), {
    keeper: (context) => {
      funds.push(context.funds("materials"));
      context.releaseFunds({ materials: 10 });
      expect(context.funds("materials")).toBe(10);
    },
    saver: () => {},
  });
  advanceTicks(sim, 2 * ROUND + 1);
  // 25 of 100 keeps 10; each returned surplus splits again by weight.
  expect(funds).toEqual([25, 13.75, 10.938]);
  expect(sim.snapshot().ai.west!.budgets.keeper).toEqual({ materials: 10 });
});

test("float error in a budget share cannot block an exact price", () => {
  let trained = false;
  const sim = fixture(
    profile([allocation("buyer"), allocation("saver", 3)]),
    {
      buyer: (context) => {
        expect(context.funds("materials")).toBe(25);
        trained = train(context);
      },
      saver: () => {},
    },
    {
      change: (state) => {
        state.ai.west!.budgets = {
          buyer: { materials: 24.999999999999996 },
          saver: { materials: 75 },
        };
      },
    },
  );
  sim.tick();
  expect(trained).toBe(true);
  expect(balance(sim, "materials", "west")).toBe(75);
});

test("essential concerns draw lower budgets, lowest priority first", () => {
  const sim = fixture(
    profile([
      allocation("urgent", 1, 1, true),
      allocation("middle"),
      allocation("last"),
    ]),
    {
      urgent: once((context) => {
        expect(context.funds("materials")).toBeCloseTo(100);
        for (let trained = 0; trained < 3; trained += 1)
          expect(train(context)).toBe(true);
      }),
      middle: () => {},
      last: () => {},
    },
  );
  sim.tick();
  const budgets = sim.snapshot().ai.west!.budgets;
  // Its 75 took its own third, the last concern's third, and then the middle's.
  expect(budgets.urgent!.materials).toBeCloseTo(0);
  expect(budgets.last!.materials).toBeCloseTo(0);
  expect(budgets.middle!.materials).toBeCloseTo(25);
});

test("balances that fall take from low-priority budgets first", () => {
  const sim = fixture(profile([allocation("high"), allocation("low")]), {
    high: () => {},
    low: () => {},
  });
  sim.tick();
  sim.submitCommand(
    {
      kind: "train-unit",
      producerId: "west-barracks",
      actorId: "outside-spending",
      definitionId: TROOPER,
    },
    { owner: "west" },
  );
  advanceTicks(sim, ROUND);
  expect(sim.snapshot().ai.west!.budgets).toEqual({
    high: { materials: 50 },
    low: { materials: 25 },
  });
});

test("refused commands reach their concern and their funds return", () => {
  const seen: AiConcernContext["rejections"][] = [];
  const aiProfile = profile([allocation("refused")]);
  const concern: AiConcern = (context) => {
    seen.push(context.rejections);
    if (context.tick === 0) expect(train(context, "west-hq")).toBe(true);
  };
  const sim = fixture(aiProfile, { refused: concern });
  const [outcome] = sim.tick();
  expect(outcome).toMatchObject({
    accepted: false,
    reason: "unsupported-unit",
  });
  expect(sim.snapshot().ai.west!.rejections).toHaveLength(1);
  // The saved rejection survives a load and is delivered once.
  const resumed = fixture(
    aiProfile,
    { refused: concern },
    {
      state: savedState(scenario, sim),
    },
  );
  advanceTicks(resumed, 2 * ROUND);
  expect(seen[1]).toEqual([
    expect.objectContaining({
      concern: "refused",
      tick: 0,
      reason: "unsupported-unit",
      command: expect.objectContaining({ kind: "train-unit" }),
    }),
  ]);
  expect(seen[2]).toEqual([]);
  expect(balance(resumed, "materials", "west")).toBe(100);
  expect(resumed.snapshot().ai.west!.budgets.refused!.materials).toBe(100);
});

test("refused purchases restore the budgets they reserved, including borrowed funds", () => {
  const sim = fixture(
    profile([allocation("essential", 1, 0, true), allocation("saver", 3, 0)]),
    {
      essential: once((context) => {
        expect(train(context, "west-hq")).toBe(true);
        expect(train(context, "west-hq")).toBe(true);
      }),
      saver: () => {},
    },
  );
  expect(sim.tick().every(({ accepted }) => !accepted)).toBe(true);
  expect(balance(sim, "materials", "west")).toBe(100);
  expect(sim.snapshot().ai.west!.budgets).toEqual({
    essential: { materials: 25 },
    saver: { materials: 75 },
  });
  advanceTicks(sim, ROUND);
  expect(sim.snapshot().ai.west!.budgets.saver!.materials).toBe(75);
});

test("budgets see spending between ticks of an unfinished round", () => {
  const seen: number[] = [];
  const sim = fixture(
    profile([allocation("high"), allocation("low")], { concernsPerTick: 1 }),
    {
      high: () => {},
      low: (context) => void seen.push(context.funds("materials")),
    },
  );
  sim.submitCommand(
    {
      kind: "train-unit",
      producerId: "west-barracks",
      actorId: "external",
      definitionId: TROOPER,
    },
    { owner: "west" },
  );
  sim.tick();
  expect(sim.snapshot().ai.west!.cursor).toBe(1);
  sim.tick();
  expect(seen).toEqual([25]);
});

test("forces are claimed by one concern within its share", () => {
  const sim = fixture(profile([allocation("first"), allocation("second")]), {
    first: once((context) => {
      expect(context.claim("west-unit-1")).toBe(true);
      expect(context.claim("west-unit-1")).toBe(true);
      expect(context.claim("west-unit-2")).toBe(true);
      // Its share of the four fielded units is full.
      expect(context.claim("west-unit-3")).toBe(false);
      expect(context.claimed()).toEqual(["west-unit-1", "west-unit-2"]);
      // Workers, buildings, others' units, and unknown IDs are not forces.
      expect(context.claim("west-worker")).toBe(false);
      expect(context.claim("west-barracks")).toBe(false);
      expect(context.claim("east-unit")).toBe(false);
      expect(context.claim("constructor")).toBe(false);
    }),
    second: once((context) => {
      expect(context.claim("west-unit-1")).toBe(false);
      expect(context.claim("west-unit-3")).toBe(true);
      context.release("west-unit-1");
      context.release("west-unit-3");
      expect(context.claimed()).toEqual([]);
    }),
  });
  sim.tick();
  expect(sim.snapshot().ai.west!.claims).toEqual({
    "west-unit-1": "first",
    "west-unit-2": "first",
  });
});

test("float error in a force share cannot add a unit to its quota", () => {
  const sim = fixture(
    // An exact quarter of four units, which floats compute above one.
    profile([allocation("small", 1, 0.23), allocation("large", 1, 0.69)]),
    {
      small: (context) => {
        expect(context.claim("west-unit-1")).toBe(true);
        expect(context.claim("west-unit-2")).toBe(false);
      },
      large: () => {},
    },
  );
  sim.tick();
  expect(sim.snapshot().ai.west!.claims).toEqual({ "west-unit-1": "small" });
});

test("stationary actors cannot be claimed or inflate a force quota", () => {
  const sim = fixture(
    profile([allocation("first"), allocation("second")]),
    {
      first: (context) => {
        expect(context.claim("stationary-prop")).toBe(false);
        expect(context.claim("west-unit-1")).toBe(true);
        expect(context.claim("west-unit-2")).toBe(true);
        expect(context.claim("west-unit-3")).toBe(false);
      },
      second: () => {},
    },
    {
      definitions: [...BASE_CONTENT.actors, { id: "prop", behaviorId: "idle" }],
      change: (state) =>
        state.actors.push(
          createActor({
            id: "stationary-prop",
            definitionId: "prop",
            owner: "west",
            worldPosition: { x: 8, z: 3 },
          }),
        ),
    },
  );
  sim.tick();
});

test("essential concerns take non-essential claims but not essential ones", () => {
  const sim = fixture(
    profile([
      allocation("guard", 1, 0, true),
      allocation("defend", 1, 0, true),
      allocation("raid", 1, 1),
    ]),
    {
      guard: (context) => {
        if (context.tick !== ROUND) return;
        expect(context.claim("west-unit-1")).toBe(true);
        expect(context.claim("west-unit-2")).toBe(false);
      },
      defend: (context) => {
        if (context.tick === 0) expect(context.claim("west-unit-2")).toBe(true);
      },
      raid: (context) => {
        if (context.tick === 0) expect(context.claim("west-unit-1")).toBe(true);
      },
    },
  );
  advanceTicks(sim, ROUND + 1);
  expect(sim.snapshot().ai.west!.claims).toEqual({
    "west-unit-1": "guard",
    "west-unit-2": "defend",
  });
});

test("claims end when their actor leaves the mission", () => {
  const claimed: string[][] = [];
  const sim = fixture(profile([allocation("holder")]), {
    holder: (context) => {
      context.claim("west-unit-1");
      context.claim("west-unit-2");
      claimed.push(context.claimed());
      if (context.tick === 0)
        context.issue({ kind: "remove-actor", actorId: "west-unit-1" });
    },
  });
  sim.tick();
  expect(sim.snapshot().ai.west!.claims).toHaveProperty("west-unit-1");
  advanceTicks(sim, ROUND);
  expect(sim.snapshot().ai.west!.claims).toEqual({ "west-unit-2": "holder" });
  expect(claimed[1]).toEqual(["west-unit-2"]);
});

test("posture changes release claims beyond the concern's new quota", () => {
  const sim = fixture(
    profile([], {
      postures: {
        establishing: [allocation("holder", 1, 3), allocation("other", 1, 1)],
        developing: [allocation("holder", 1, 1), allocation("other", 1, 3)],
      },
    }),
    {
      holder: (context) => {
        if (context.tick === 0) {
          for (const id of ["west-unit-3", "west-unit-2", "west-unit-1"])
            expect(context.claim(id)).toBe(true);
          context.requestPosture("developing");
        }
      },
      other: () => {},
    },
  );
  advanceTicks(sim, ROUND + 1);
  expect(sim.snapshot().ai.west!.claims).toEqual({ "west-unit-1": "holder" });
});

test("each tick's commands and concern turns stay within the profile limits", () => {
  const issued: Record<string, boolean[]> = { a: [], b: [] };
  const issue = (name: string): AiConcern =>
    once((context) => {
      for (let count = 0; count < 2; count += 1)
        issued[name]!.push(
          context.issue({ kind: "stop", actorId: `west-unit-${count + 1}` }),
        );
    });
  const commands = fixture(
    profile([allocation("a"), allocation("b")], { commandsPerTick: 3 }),
    { a: issue("a"), b: issue("b") },
  );
  expect(commands.tick()).toHaveLength(3);
  expect(issued).toEqual({ a: [true, true], b: [true, false] });

  const turns: [string, number][] = [];
  const turn =
    (name: string): AiConcern =>
    ({ tick }) =>
      void turns.push([name, tick]);
  const spread = fixture(
    profile([allocation("x"), allocation("y"), allocation("z")], {
      concernsPerTick: 2,
    }),
    { x: turn("x"), y: turn("y"), z: turn("z") },
  );
  spread.tick();
  expect(spread.snapshot().ai.west!.cursor).toBe(2);
  spread.tick();
  expect(spread.snapshot().ai.west!.cursor).toBeUndefined();
  advanceTicks(spread, ROUND - 2);
  expect(turns).toEqual([
    ["x", 0],
    ["y", 0],
    ["z", 1],
  ]);
  spread.tick();
  expect(turns.slice(3)).toEqual([
    ["x", 10],
    ["y", 10],
  ]);
});

test("postures reorder concerns and release those they do not use", () => {
  const log: string[] = [];
  const sim = fixture(
    profile([], {
      postures: {
        establishing: [allocation("old"), allocation("kept")],
        developing: [allocation("kept")],
      },
    }),
    {
      old: (context) => {
        log.push(`old:${context.posture}`);
        expect(context.claim("west-unit-1")).toBe(true);
        expect(context.requestPosture("pressuring")).toBe(false);
        expect(context.requestPosture("developing")).toBe(true);
      },
      kept: (context) => {
        log.push(`kept:${context.posture}`);
        // An equally urgent request from a higher-priority concern wins.
        if (context.posture === "establishing")
          context.requestPosture("establishing");
      },
    },
  );
  sim.tick();
  expect(sim.snapshot().ai.west!.requestedPosture).toBe("developing");
  advanceTicks(sim, ROUND);
  expect(log).toEqual([
    "old:establishing",
    "kept:establishing",
    "kept:developing",
  ]);
  const { budgets, claims, posture, memory } = sim.snapshot().ai.west!;
  expect(posture).toBe("developing");
  expect(claims).toEqual({});
  expect(budgets).toEqual({ kept: { materials: 100 } });
  // Memory outlives the posture, so a concern can resume its plan.
  expect(memory).toHaveProperty("old");
});

test.each([
  [["developing", "recovering"], "recovering"],
  [["recovering", "pressuring"], "recovering"],
  [["recovering", "defending"], "defending"],
  [["defending", "recovering"], "defending"],
  [["pressuring", "developing"], "pressuring"],
] as const)(
  "posture requests %j resolve to %s regardless of concern order",
  (requests, expected) => {
    const sim = fixture(
      profile([], {
        postures: {
          establishing: [allocation("first"), allocation("second")],
          developing: [],
          pressuring: [],
          defending: [],
          recovering: [],
        },
      }),
      {
        first: once((context) => void context.requestPosture(requests[0])),
        second: once((context) => void context.requestPosture(requests[1])),
      },
    );
    sim.tick();
    expect(sim.snapshot().ai.west!.requestedPosture).toBe(expected);
    advanceTicks(sim, ROUND);
    expect(sim.snapshot().ai.west!.posture).toBe(expected);
  },
);

test("a concern the new posture leaves out withdraws once, without spending", () => {
  const withdrawals: { tick: number; memory: unknown }[] = [];
  const old: AiConcern = Object.assign(
    (context: AiConcernContext) => {
      context.memory.marker = context.tick;
      context.requestPosture("developing");
    },
    {
      withdraw: (context: AiWithdrawalContext) => {
        withdrawals.push({ tick: context.tick, memory: { ...context.memory } });
        expect(
          context.issue({
            kind: "train-unit",
            producerId: "west-barracks",
            actorId: "ai:4:west:trooper:9",
            definitionId: TROOPER,
          }),
        ).toBe(false);
        expect(context.issue({ kind: "stop", actorId: "east-unit" })).toBe(
          false,
        );
        expect(context.issue({ kind: "stop", actorId: "west-unit-1" })).toBe(
          true,
        );
      },
    },
  );
  const sim = fixture(
    profile([], {
      postures: {
        establishing: [allocation("old"), allocation("kept")],
        developing: [allocation("kept")],
      },
    }),
    { old, kept: () => {} },
  );
  const outcomes = Array.from({ length: 3 * ROUND }, () => sim.tick()).flat();
  expect(withdrawals).toEqual([{ tick: ROUND, memory: { marker: 0 } }]);
  expect(
    outcomes.filter(({ issuer }) => issuer.ai).map(({ command }) => command),
  ).toEqual([{ kind: "stop", actorId: "west-unit-1" }]);
  expect(sim.snapshot().ai.west!.budgets).not.toHaveProperty("old");
});

test("withdrawal obeys tick limits and resumes pending orders after loading", () => {
  const old: AiConcern = Object.assign(
    (context: AiConcernContext) => {
      context.memory.operations = [1, 2].map((number) =>
        launchOperation(context, {
          id: `raid:${number}`,
          kind: "raid",
          phase: "advance",
          target: { x: 30, z: 0 },
          rally: { x: -20, z: 0 },
          units: [`west-unit-${number}`],
        }),
      );
      context.requestPosture("developing");
    },
    { withdraw: withdrawOperations },
  );
  const aiProfile = profile([], {
    commandsPerTick: 1,
    concernsPerTick: 1,
    postures: {
      establishing: [allocation("old")],
      developing: [allocation("kept")],
    },
  });
  const keptTicks: number[] = [];
  const concerns = {
    old,
    kept: (context: AiConcernContext) => void keptTicks.push(context.tick),
  };
  const sim = fixture(aiProfile, concerns);
  advanceTicks(sim, ROUND);
  const first = sim.tick();
  expect(first.map(({ command }) => command)).toMatchObject([
    { kind: "move", actorId: "west-unit-1" },
  ]);
  expect(sim.ai.west!.withdrawing).toEqual(["old"]);
  expect(keptTicks).toEqual([]);
  const resumed = fixture(aiProfile, concerns, {
    state: savedState(scenario, sim),
  });
  expect(resumed.tick()).toEqual(sim.tick());
  expect(sim.ai.west!.withdrawing).toBeUndefined();
  expect(keptTicks).toEqual([]);
  expect(resumed.tick()).toEqual(sim.tick());
  expect(keptTicks).toEqual([ROUND + 2, ROUND + 2]);
  expect(resumed.snapshot()).toEqual(sim.snapshot());
});

test("withdrawal cannot override a surviving concern's claims", () => {
  const old: AiConcern = Object.assign(
    (context: AiConcernContext) => {
      context.claim("west-unit-1");
      context.memory.ready = true;
      context.requestPosture("developing");
    },
    {
      withdraw: (context: AiWithdrawalContext) => {
        expect(context.canOrder("west-unit-1")).toBe(false);
        expect(context.issue({ kind: "stop", actorId: "west-unit-1" })).toBe(
          false,
        );
      },
    },
  );
  const sim = fixture(
    profile([], {
      postures: {
        establishing: [allocation("old"), allocation("kept", 0, 1, true)],
        developing: [allocation("kept", 0, 1, true)],
      },
    }),
    {
      old,
      kept: (context) => void context.claim("west-unit-1"),
    },
  );
  const outcomes = Array.from({ length: ROUND + 1 }, () => sim.tick()).flat();
  expect(sim.ai.west!.claims["west-unit-1"]).toBe("kept");
  expect(outcomes).toEqual([]);
});

test("reactivating a concern cancels its pending withdrawal", () => {
  const withdrawals: number[] = [];
  const turns: number[] = [];
  const old: AiConcern = Object.assign(
    (context: AiConcernContext) => {
      turns.push(context.tick);
      if (context.memory.started) return;
      context.memory.started = true;
      context.requestPosture("developing");
    },
    {
      withdraw: (context: AiWithdrawalContext) => {
        withdrawals.push(context.tick);
        return false;
      },
    },
  );
  const sim = fixture(
    profile([], {
      postures: {
        establishing: [allocation("old")],
        developing: [allocation("kept")],
      },
    }),
    { old, kept: (context) => void context.requestPosture("establishing") },
  );
  advanceTicks(sim, 2 * ROUND + 1);
  expect(turns).toEqual([0, 2 * ROUND]);
  expect(withdrawals).toEqual(
    Array.from({ length: ROUND }, (_, index) => ROUND + index),
  );
  expect(sim.ai.west!.withdrawing).toBeUndefined();
});

test("inactive concerns keep refusals until their next turn", () => {
  const seen: AiConcernContext["rejections"][] = [];
  const sim = fixture(
    profile([], {
      postures: {
        establishing: [allocation("posture"), allocation("trainer")],
        developing: [allocation("posture")],
      },
    }),
    {
      posture: (context) => {
        context.requestPosture(
          context.posture === "establishing" ? "developing" : "establishing",
        );
      },
      trainer: (context) => {
        seen.push(context.rejections);
        if (context.tick === 0) train(context, "west-hq");
      },
    },
  );
  advanceTicks(sim, ROUND + 1);
  expect(sim.snapshot().ai.west!.rejections).toHaveLength(1);
  const resumed = fixture(
    profile([], {
      postures: {
        establishing: [allocation("posture"), allocation("trainer")],
        developing: [allocation("posture")],
      },
    }),
    {
      posture: () => {},
      trainer: (context) => void seen.push(context.rejections),
    },
    { state: savedState(scenario, sim) },
  );
  advanceTicks(resumed, ROUND);
  expect(seen).toEqual([
    [],
    [
      expect.objectContaining({
        concern: "trainer",
        reason: "unsupported-unit",
      }),
    ],
  ]);
  expect(resumed.snapshot().ai.west!.rejections).toEqual([]);
});

test("commands cannot probe actors the owner does not see", () => {
  const stop = (actorId: string): MissionCommand => ({ kind: "stop", actorId });
  const issued: Record<string, boolean> = {};
  const hidden = fixture(profile([allocation("probe")]), {
    probe: once((context) => {
      issued.stop = context.issue(stop("east-unit"));
      issued.gone = context.issue(stop("never-existed"));
      issued.attack = context.issue({
        kind: "attack",
        actorId: "west-unit-1",
        targetId: "east-unit",
      });
      issued.train = train(context, "east-barracks");
      issued.job = context.issue({
        kind: "cancel-production",
        actorId: "east-job",
      });
      issued.id = context.issue({
        kind: "train-unit",
        producerId: "west-barracks",
        actorId: "east-unit",
        definitionId: TROOPER,
      });
    }),
  });
  expect(hidden.tick()).toEqual([]);
  expect(issued).toEqual({
    stop: false,
    gone: false,
    attack: false,
    train: false,
    job: false,
    id: false,
  });

  // The same order is legal, and reports its reasons, once the target is seen.
  const seen = fixture(
    profile([allocation("attacker")]),
    {
      attacker: once((context) => {
        expect(
          context.issue({
            kind: "attack",
            actorId: "west-unit-1",
            targetId: "east-unit",
          }),
        ).toBe(true);
        expect(context.issue(stop("east-unit"))).toBe(true);
      }),
    },
    {
      change: (state) => {
        const { x, z } = actorIn(state, "west-unit-4").worldPosition;
        actorIn(state, "east-unit").worldPosition = { x: x + 2, z };
      },
    },
  );
  const outcomes = seen.tick();
  expect(outcomes[0]).toMatchObject({ accepted: true });
  expect(outcomes[1]).toMatchObject({
    accepted: false,
    reason: "unauthorized",
  });
});

test("players' own orders stay distinguishable from their AI's", () => {
  const sim = fixture(profile([allocation("mover")]), {
    mover: once((context) => {
      context.issue({ kind: "stop", actorId: "west-unit-1" });
    }),
  });
  sim.submitCommand(
    { kind: "stop", actorId: "west-unit-2" },
    { owner: "west" },
  );
  const issuers = sim.tick().map(({ issuer }) => issuer);
  expect(issuers.map((issuer) => issuedByPlayer(issuer, "west"))).toEqual([
    true,
    false,
  ]);
});

test("hidden enemy state cannot change an owner's commands", () => {
  const run = (change?: (state: MissionState) => void) => {
    const log: unknown[] = [];
    const sim = fixture(
      profile([allocation("planner")]),
      {
        planner: (context) => {
          const { view } = context;
          log.push({
            shown: view.actors().shown.map(({ id }) => id),
            balances: view.economy()!.stockpiles,
            placement: view.evaluatePlacement({
              actorId: "probe",
              definitionId: BARRACKS,
              origin: { x: 60, z: 12 },
            }).accepted,
            issued: train(context),
            id: context.newActorId(TROOPER),
          });
        },
      },
      { change },
    );
    advanceTicks(sim, 5 * ROUND);
    return log;
  };
  const plain = run();
  expect(plain).toHaveLength(5);
  expect(
    run((state) => {
      state.economy!.stockpiles.find(({ owners }) =>
        owners.includes("east"),
      )!.amount = 7;
      state.actors = state.actors.filter(({ id }) => id !== "east-unit");
      state.retiredActorIds.push("east-unit");
      // Even a hidden actor using a generated ID must not affect planning.
      state.retiredActorIds.push(`ai:4:west:${TROOPER}:2`);
    }),
  ).toEqual(plain);
});

/** Training, claims, borrowing, and a partial round to carry across splits. */
const continuationProfile = profile(
  [allocation("planner", 2, 2), allocation("raider", 1, 1, true)],
  { concernsPerTick: 1 },
);
const continuationConcerns: Record<string, AiConcern> = {
  planner: (context) => {
    const trained = (context.memory.trained as number | undefined) ?? 0;
    if (trained < 3 && train(context)) context.memory.trained = trained + 1;
    for (const { id } of context.view.actors().ownMobile) context.claim(id);
  },
  raider: (context) => {
    for (const actorId of context.claimed().slice(0, 1))
      context.issue({
        kind: "move",
        actorId,
        target: { x: 20, z: 12 },
      } satisfies MissionCommand);
    context.claim("west-unit-4");
    if (context.tick < ROUND) train(context, "west-hq");
  },
};

test("a saved mission continues exactly as an uninterrupted one", () => {
  const aiProfile = continuationProfile;
  const concerns = continuationConcerns;
  const whole = fixture(aiProfile, concerns);
  advanceTicks(whole, 100);
  // Tick 21 falls inside a round, with its cursor partway through.
  for (const split of [1, 21, 50]) {
    const before = fixture(aiProfile, concerns);
    advanceTicks(before, split);
    if (split === 21) expect(before.snapshot().ai.west!.cursor).toBe(1);
    const after = fixture(aiProfile, concerns, {
      state: savedState(scenario, before),
    });
    advanceTicks(after, 100 - split);
    expect(after.snapshot()).toEqual(whole.snapshot());
  }
});

test.each<[string, number[]]>([
  ["one tick per frame", Array.from({ length: 100 }, () => 100)],
  ["uneven frames", [30, 470, 1750, 20, 3730, 4000]],
  ["a stall caught up in bounded batches", [10_000]],
])(
  "AI matches continue identically across clock batching: %s",
  (_name, frames) => {
    const whole = fixture(continuationProfile, continuationConcerns);
    advanceTicks(whole, 100);
    const sim = fixture(continuationProfile, continuationConcerns);
    const clock = { now: 0 };
    const loop = startSimulationLoop(sim, {
      pumpMilliseconds: 60_000,
      maxCatchUpSeconds: 0.5,
      now: () => clock.now,
    });
    // Half a tick of slack keeps float rounding from owing too few ticks.
    clock.now = 50;
    try {
      let batches = 0;
      for (const frame of frames) {
        clock.now += frame;
        loop.advance();
        batches += 1;
      }
      // Each call runs at most five ticks; the remainder stays owed.
      while (sim.completedTicks < 100 && batches < 1000) {
        loop.advance();
        batches += 1;
      }
      expect(batches).toBeGreaterThanOrEqual(20);
      expect(loop.faulted).toBe(false);
    } finally {
      loop.stop();
    }
    expect(sim.snapshot()).toEqual(whole.snapshot());
  },
);

test("a concern's failure faults the mission", () => {
  const sim = fixture(profile([allocation("broken")]), {
    broken: () => {
      throw new Error("bad plan");
    },
  });
  expect(() => sim.tick()).toThrow("bad plan");
  expect(() => sim.tick()).toThrow("faulted");
});

test.each(["planning", "simulation"] as const)(
  "%s failures roll back director state and commands",
  (failure) => {
    const sim = fixture(
      profile([allocation("planner"), allocation("broken")]),
      {
        planner: (context) => {
          context.memory.planned = true;
          train(context);
        },
        broken: (context) => {
          if (failure === "planning") throw new Error("bad plan");
          context.issue({ kind: "stop", actorId: "west-unit-1" });
        },
      },
      {
        idleUpdate:
          failure === "simulation"
            ? () => {
                throw new Error("bad plan");
              }
            : undefined,
      },
    );
    const before = sim.snapshot();
    expect(() => sim.tick()).toThrow("bad plan");
    expect(sim.snapshot()).toEqual(before);
    expect(() => sim.tick()).toThrow("faulted");
  },
);

test.each(["tick", "dispose", "submitCommand", "removeActor"] as const)(
  "concerns cannot call mission %s methods",
  (operation) => {
    const sim = fixture(profile([allocation("reentrant")]), {
      reentrant: () => {
        if (operation === "tick") sim.tick();
        if (operation === "dispose") sim.dispose();
        if (operation === "removeActor") sim.removeActor("west-unit-1");
        if (operation === "submitCommand")
          sim.submitCommand(
            { kind: "stop", actorId: "west-unit-1" },
            { owner: "west" },
          );
      },
    });
    const before = sim.snapshot();
    expect(() => sim.tick()).toThrow(/during a tick|recursively/);
    expect(sim.snapshot()).toEqual(before);
    expect(() => sim.tick()).toThrow("faulted");
  },
);

test.each([Infinity, undefined, new Map(), new Date(), () => {}])(
  "concerns must keep JSON memory (%s)",
  (value) => {
    const sim = fixture(profile([allocation("memory")]), {
      memory: (context) => {
        context.memory.value = value;
      },
    });
    const before = sim.snapshot();
    expect(() => sim.tick()).toThrow("memory must stay JSON");
    expect(sim.snapshot()).toEqual(before);
  },
);

test("dictionary keys remain data in AI state", () => {
  const sim = fixture(profile([allocation("__proto__")]), {
    ["__proto__"]: (context) => {
      context.memory.turns = ((context.memory.turns as number) ?? 0) + 1;
      expect(train(context)).toBe(true);
    },
  });
  sim.tick();
  expect(sim.snapshot().ai.west!.memory).toEqual({
    ["__proto__"]: { turns: 1 },
  });
  expect(sim.snapshot().ai.west!.budgets).toEqual({
    ["__proto__"]: { materials: 75 },
  });
});

test("malformed concern commands cannot poison a saved rejection", () => {
  const sim = fixture(profile([allocation("planner")]), {
    planner: (context) => {
      expect(
        context.issue({ kind: "dance" } as unknown as MissionCommand),
      ).toBe(false);
    },
  });
  expect(sim.tick()).toEqual([]);
  expect(sim.snapshot().ai.west!.rejections).toEqual([]);
  const resumed = fixture(
    profile([allocation("planner")]),
    { planner: () => {} },
    {
      state: savedState(scenario, sim),
    },
  );
  expect(resumed.snapshot()).toEqual(sim.snapshot());
});

test("cyclic concern memory faults without publishing it", () => {
  const sim = fixture(profile([allocation("planner")]), {
    planner: (context) => {
      context.memory.self = context.memory;
    },
  });
  const before = sim.snapshot();
  expect(() => sim.tick()).toThrow("memory must stay JSON");
  expect(sim.snapshot()).toEqual(before);
});

test("the director stops when the mission ends", () => {
  let turns = 0;
  const sim = fixture(profile([allocation("counter")]), {
    counter: () => void (turns += 1),
  });
  sim.tick();
  for (const actorId of ["east-hq", "east-barracks"])
    sim.submitCommand({ kind: "sell-actor", actorId }, { owner: "east" });
  sim.tick();
  expect(sim.result?.kind).toBe("victory");
  const finished = turns;
  advanceTicks(sim, 2 * ROUND);
  expect(turns).toBe(finished);
  expect(sim.snapshot().commands).toEqual([]);
});

test.each<[string, () => void, string]>([
  [
    "an unknown concern",
    () => fixture(profile([allocation("missing")]), {}),
    'unknown concern "missing"',
  ],
  [
    "an unknown owner",
    () =>
      fixture(
        profile([]),
        {},
        { controllers: [{ owner: "north", profile: profile([]) }] },
      ),
    "unknown owner: north",
  ],
  [
    "an owner controlled twice",
    () =>
      fixture(
        profile([]),
        {},
        {
          controllers: [
            { owner: "west", profile: profile([]) },
            { owner: "west", profile: profile([]) },
          ],
        },
      ),
    "only one AI controller",
  ],
  [
    "a profile without establishing",
    () => fixture(profile([], { postures: { developing: [] } }), {}),
    "AI profile test needs",
  ],
  [
    "a repeated concern",
    () => fixture(profile([allocation("a"), allocation("a")]), { a: () => {} }),
    "AI profile test needs",
  ],
  [
    "a zero command limit",
    () => fixture(profile([], { commandsPerTick: 0 }), {}),
    "AI profile test needs",
  ],
  [
    "an unsafe round interval",
    () => fixture(profile([], { roundSeconds: 1e308 }), {}),
    "unsafe round interval",
  ],
  [
    "an unsafe tuning duration",
    () =>
      fixture(
        profile([], {
          tuning: {
            ...ARC_AI_TUNING,
            scouting: { ...ARC_AI_TUNING.scouting, replacementSeconds: 1e308 },
          },
        }),
        {},
      ),
    "unsafe tuning duration",
  ],
])("rejects %s", (_, start, message) => {
  expect(start).toThrow(message);
});

test.each<[string, (ai: any) => void]>([
  ["a missing owner", (ai) => delete ai.west],
  ["an extra owner", (ai) => (ai.east = structuredClone(ai.west))],
  ["a forbidden posture", (ai) => (ai.west.posture = "pressuring")],
  ["a non-string posture", (ai) => (ai.west.posture = ["establishing"])],
  ["a missing ID sequence", (ai) => delete ai.west.nextActorNumber],
  ["an unsafe ID sequence", (ai) => (ai.west.nextActorNumber = Infinity)],
  ["a negative budget", (ai) => (ai.west.budgets.a = { materials: -1 })],
  ["an unknown resource", (ai) => (ai.west.budgets.a = { gold: 1 })],
  ["a budget for no concern", (ai) => (ai.west.budgets.b = {})],
  ["a claim on no actor", (ai) => (ai.west.claims.ghost = "a")],
  ["a claim for no concern", (ai) => (ai.west.claims["west-unit-1"] = "b")],
  ["a cursor past the round", (ai) => (ai.west.cursor = 2)],
  ["withdrawal of no concern", (ai) => (ai.west.withdrawing = ["missing"])],
  ["withdrawal of an active concern", (ai) => (ai.west.withdrawing = ["a"])],
  ["a malformed rejection", (ai) => ai.west.rejections.push({ concern: "a" })],
  ["non-record memory", (ai) => (ai.west.memory.a = [])],
])("rejects saved AI state with %s", (_, corrupt) => {
  const aiProfile = profile([allocation("a")]);
  expect(() =>
    fixture(
      aiProfile,
      { a: () => {} },
      { change: (state) => corrupt(state.ai) },
    ),
  ).toThrow("invalid AI state");
});
