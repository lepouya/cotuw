import { describe, expect, test } from "vitest";
import {
  advanceSeconds,
  balance,
  stockpiles,
  untilSeconds,
} from "./helpers/scenario";
import {
  at,
  contentMap,
  fixture,
  rivals,
  TICK_SECONDS,
  unit,
} from "./helpers/rivals";
import { secondsToTicks } from "../src/simulation/clock";
import { parseMission, serializeMission } from "../src/simulation/mission-file";
import { disconnectedBuildings } from "../src/simulation/support";
import { regroupStockpiles } from "../src/simulation/stockpiles";

import type { Setup } from "./helpers/rivals";
import type {
  EconomyState,
  EconomyView,
  MaterialsSite,
} from "../src/simulation/economy";
import type { MissionState } from "../src/simulation/mission";

describe("owner relationships", () => {
  test("neutral owners neither engage nor accept Attack orders", () => {
    const { simulation } = fixture({
      units: [unit("trooper", 10), unit("visitor", 14, "rival")],
    });
    expect(simulation.relations.relationship("player", "rival")).toBe(
      "neutral",
    );
    advanceSeconds(simulation, 10);
    simulation.submitCommand({
      kind: "attack",
      actorId: "trooper",
      targetId: "visitor",
    });
    expect(simulation.tick()[0]).toMatchObject({
      accepted: false,
      reason: "invalid-target",
    });
    expect(simulation.actorById("visitor")!.health).toBeUndefined();
    expect(simulation.actorById("trooper")!.health).toBeUndefined();
  });

  test("timed events start a fight, and making peace ends it", () => {
    const { simulation } = fixture({
      units: [unit("trooper", 10), unit("visitor", 14, "rival")],
      events: [at(1, [rivals("hostile")]), at(3, [rivals("neutral")])],
    });
    advanceSeconds(simulation, 0.9);
    expect(simulation.relations.relationship("rival", "player")).toBe(
      "neutral",
    );
    advanceSeconds(simulation, 0.1);
    expect(simulation.relations.relationship("rival", "player")).toBe(
      "hostile",
    );
    untilSeconds(simulation, () => simulation.attacks.length > 0, 2);
    untilSeconds(
      simulation,
      () => simulation.relations.relationship("player", "rival") === "neutral",
    );
    const health = simulation.actorById("visitor")!.health;
    advanceSeconds(simulation, 5);
    expect(simulation.actorById("visitor")!.health).toBe(health);
    expect(simulation.actorById("trooper")!.combat?.attack).toBeUndefined();
    expect(simulation.snapshot().firedEvents).toEqual(["at-1", "at-3"]);
  });

  test("allies share vision until the alliance ends, keeping explored land", () => {
    const { simulation } = fixture({
      buildings: [
        {
          actorId: "cc",
          definitionId: "arc-command-center-prototype",
          origin: { x: 2, z: 2 },
        },
      ],
      units: [unit("scout", 50, "rival", "arc-scout")],
      relationships: [{ owners: ["rival", "player"], relationship: "allied" }],
      events: [at(1, [rivals("neutral")])],
    });
    const scout = () => simulation.actorById("scout")!;
    expect(simulation.fog!.isExplored(50, 10)).toBe(true);
    expect(simulation.detects("player", scout())).toBe(true);
    expect(simulation.detects("rival", simulation.actorById("cc")!)).toBe(true);
    advanceSeconds(simulation, 1);
    expect(simulation.detects("player", scout())).toBe(false);
    expect(simulation.detects("rival", simulation.actorById("cc")!)).toBe(
      false,
    );
    expect(simulation.fog!.isExplored(50, 10)).toBe(true);
  });

  test("support-sharing allies power and authorize construction until revoked", () => {
    const placement = {
      actorId: "new",
      definitionId: "arc-field-barracks",
      origin: { x: 8, z: 4 },
    };
    const { simulation } = fixture({
      explored: true,
      buildings: [
        {
          actorId: "ally-cc",
          definitionId: "arc-command-center-prototype",
          origin: { x: 2, z: 10 },
          owner: "rival",
        },
        {
          actorId: "barracks",
          definitionId: "arc-field-barracks",
          origin: { x: 8, z: 10 },
        },
      ],
      relationships: [
        {
          owners: ["player", "rival"],
          relationship: "allied",
          sharesSupport: true,
        },
      ],
      events: [at(1, [rivals("allied")])],
    });
    expect(disconnectedBuildings(simulation.support).has("barracks")).toBe(
      false,
    );
    expect(simulation.evaluatePlacement(placement).accepted).toBe(true);
    advanceSeconds(simulation, 1);
    expect(simulation.relations.relationship("player", "rival")).toBe("allied");
    expect(disconnectedBuildings(simulation.support).has("barracks")).toBe(
      true,
    );
    expect(simulation.evaluatePlacement(placement)).toMatchObject({
      accepted: false,
      reason: "outside-support",
    });
  });

  test("support sharing does not pass through a shared intermediary", () => {
    const barracks = (actorId: string, x: number, owner: string) => ({
      actorId,
      definitionId: "arc-field-barracks",
      origin: { x, z: 10 },
      owner,
    });
    const { simulation } = fixture({
      explored: true,
      buildings: [
        {
          actorId: "rival-cc",
          definitionId: "arc-command-center-prototype",
          origin: { x: 2, z: 10 },
          owner: "rival",
        },
        barracks("relay", 8, "middle"),
        barracks("barracks", 13, "player"),
      ],
      edit: (state) => {
        state.owners.push({ id: "middle", faction: "arc" });
        for (const other of ["rival", "player"])
          state.relationships.push({
            owners: ["middle", other],
            relationship: "allied",
            sharesSupport: true,
          });
      },
    });
    const disconnected = disconnectedBuildings(simulation.support);
    expect(disconnected.has("relay")).toBe(false);
    expect(disconnected.has("barracks")).toBe(true);
  });

  test("each owner's construction uses its own Command Center queue", () => {
    const site = (actorId: string, x: number, owner: string) => [
      {
        actorId: `${actorId}-cc`,
        definitionId: "arc-command-center-prototype",
        origin: { x, z: 10 },
        owner,
      },
      {
        actorId,
        definitionId: "arc-field-barracks",
        origin: { x: x + 6, z: 10 },
        owner,
      },
    ];
    const { simulation } = fixture({
      explored: true,
      buildings: [...site("mine", 2, "player"), ...site("theirs", 40, "rival")],
      edit: (state) => {
        for (const actor of state.actors)
          if (actor.definitionId === "arc-field-barracks")
            actor.construction = {
              paidCost: 100,
              completedTicks: 0,
              totalTicks: secondsToTicks(8, TICK_SECONDS),
            };
      },
    });
    simulation.tick();
    for (const id of ["mine", "theirs"])
      expect(simulation.actorById(id)!).toMatchObject({
        headquartersId: `${id}-cc`,
        construction: { active: true, completedTicks: 1 },
      });
  });

  test("rival Harvesters use their owner's resource knowledge under fog", () => {
    const site = (id: string, x: number): MaterialsSite => ({
      id,
      name: id,
      tile: { x, z: 12 },
      initialMaterials: 100,
      remainingMaterials: 100,
    });
    const { simulation } = fixture({
      units: [
        unit("trooper", 4),
        unit("harvester", 50, "rival", "arc-harvester"),
      ],
      buildings: [
        {
          actorId: "cc",
          definitionId: "arc-command-center-prototype",
          origin: { x: 40, z: 2 },
          owner: "rival",
        },
        {
          actorId: "refinery",
          definitionId: "arc-materials-refinery",
          origin: { x: 46, z: 10 },
          owner: "rival",
        },
      ],
      sites: [site("home", 50), site("hidden", 8)],
    });
    expect(simulation.fog!.isExplored(50, 12)).toBe(false);
    expect(simulation.sees("rival", contentMap.tileCenter(50, 12))).toBe(true);
    const rival = { owner: "rival" };
    simulation.submitCommand(
      { kind: "assign-refinery", actorId: "harvester", refineryId: "refinery" },
      rival,
    );
    simulation.submitCommand(
      { kind: "gather", actorId: "harvester", siteId: "home" },
      rival,
    );
    expect(simulation.tick().map(({ accepted }) => accepted)).toEqual([
      true,
      true,
    ]);
    expect(simulation.economy!.harvesters[0]).toMatchObject({
      activeSiteId: "home",
    });
    untilSeconds(
      simulation,
      () => simulation.economy!.harvesters[0]!.cargo > 0,
      5,
    );
    expect(
      simulation.economy!.sites.find(({ id }) => id === "home")!
        .remainingMaterials,
    ).toBeLessThan(100);
    simulation.submitCommand(
      { kind: "gather", actorId: "harvester", siteId: "hidden" },
      rival,
    );
    expect(simulation.tick()[0]).toMatchObject({
      accepted: false,
      reason: "missing-site",
    });
    expect(simulation.economy!.harvesters[0]!.activeSiteId).toBe("home");
  });

  test("an objective trigger fires when the objective completes", () => {
    const { simulation } = fixture({
      units: [unit("trooper", 10), unit("visitor", 14, "rival")],
      relationships: [{ owners: ["player", "rival"], relationship: "hostile" }],
      objectives: [
        {
          id: "defeat-visitor",
          kind: "destroy",
          label: "Defeat the visitor",
          directive: "Destroy the rival trooper.",
          actorIds: ["visitor"],
        },
      ],
      events: [
        {
          id: "truce",
          trigger: {
            kind: "objective-complete",
            objectiveId: "defeat-visitor",
          },
          actions: [rivals("allied")],
        },
      ],
      edit: (state) => {
        state.actors.find(({ id }) => id === "visitor")!.health = 1;
      },
    });
    untilSeconds(simulation, () => !simulation.actorById("visitor"), 10);
    expect(simulation.relations.relationship("player", "rival")).toBe("allied");
    expect(simulation.snapshot().firedEvents).toEqual(["truce"]);
  });

  test("relationships and fired events continue identically after loading", () => {
    const setup: Setup = {
      units: [unit("trooper", 10), unit("visitor", 14, "rival")],
      events: [at(1, [rivals("allied")]), at(2, [rivals("hostile")])],
    };
    const { simulation, content } = fixture(setup);
    advanceSeconds(simulation, 2.5);
    const saved = parseMission(
      serializeMission(content, simulation.snapshot(), TICK_SECONDS),
      TICK_SECONDS,
    ).state;
    expect(saved.relationships).toEqual([
      { owners: ["player", "rival"], relationship: "hostile" },
    ]);
    const restored = fixture(setup, saved).simulation;
    advanceSeconds(simulation, 5);
    advanceSeconds(restored, 5);
    expect(restored.relations.relationship("player", "rival")).toBe("hostile");
    expect(restored.snapshot()).toEqual(simulation.snapshot());
  });

  test.each<[string, (state: MissionState) => void, string]>([
    [
      "an unknown owner",
      (state) =>
        state.relationships.push({
          owners: ["player", "nobody"],
          relationship: "hostile",
        }),
      "invalid owner relationships",
    ],
    [
      "a repeated pair",
      (state) =>
        state.relationships.push(
          { owners: ["player", "rival"], relationship: "hostile" },
          { owners: ["rival", "player"], relationship: "allied" },
        ),
      "invalid owner relationships",
    ],
    [
      "hostile support sharing",
      (state) =>
        state.relationships.push({
          owners: ["player", "rival"],
          relationship: "hostile",
          sharesSupport: true,
        }),
      "invalid owner relationships",
    ],
    [
      "hostile headquarters sharing",
      (state) =>
        state.relationships.push({
          owners: ["player", "rival"],
          relationship: "hostile",
          sharesHeadquarters: true,
        }),
      "invalid owner relationships",
    ],
    [
      "an unknown fired event",
      (state) => state.firedEvents.push("missing"),
      "invalid fired events",
    ],
  ])("loading rejects %s", (_, edit, message) => {
    expect(() => fixture({ edit })).toThrow(message);
  });

  test("events must name known owners and objectives", () => {
    expect(() =>
      fixture({
        events: [
          {
            id: "lost",
            trigger: { kind: "objective-complete", objectiveId: "missing" },
            actions: [rivals("allied")],
          },
        ],
      }),
    ).toThrow("invalid event definition");
    expect(() =>
      fixture({
        events: [
          at(1, [{ ...rivals("allied"), owners: ["player", "nobody"] }]),
        ],
      }),
    ).toThrow("invalid event definition");
  });
});

describe("shared resource pools", () => {
  const sharing = {
    ...rivals("allied"),
    sharesResources: true as const,
  };
  const lifebloom = (amount: number) => (state: MissionState) =>
    state.economy!.stockpiles.push(...stockpiles(amount, "lifebloom"));
  const totals = (simulation: { economy?: EconomyView; playerOwner: string }) =>
    ["player", "rival"].map((owner) => [
      balance(simulation, "materials", owner),
      balance(simulation, "lifebloom", owner),
    ]);

  test("sharing allies pool each resource type and divide it when sharing ends", () => {
    const { simulation } = fixture({
      explored: true,
      buildings: [
        {
          actorId: "cc",
          definitionId: "arc-command-center-prototype",
          origin: { x: 2, z: 10 },
          owner: "player",
        },
      ],
      events: [at(1, [sharing]), at(3, [rivals("allied")])],
      edit: lifebloom(31),
    });
    expect(totals(simulation)).toEqual([
      [1000, 31],
      [1000, 0],
    ]);
    advanceSeconds(simulation, 1);
    expect(simulation.economy!.stockpiles).toEqual([
      { resource: "materials", owners: ["player", "rival"], amount: 2000 },
      { resource: "lifebloom", owners: ["player", "rival"], amount: 31 },
    ]);
    simulation.submitCommand({
      kind: "place-actor",
      actorId: "barracks",
      definitionId: "arc-field-barracks",
      origin: { x: 6, z: 10 },
    });
    simulation.tick();
    expect(totals(simulation)).toEqual([
      [1900, 31],
      [1900, 31],
    ]);
    const restored = fixture(
      { events: [at(1, [sharing]), at(3, [rivals("allied")])] },
      JSON.parse(JSON.stringify(simulation.snapshot())),
    ).simulation;
    for (const current of [simulation, restored]) {
      untilSeconds(current, () => current.economy!.stockpiles.length === 4, 3);
      // Earlier owner IDs take indivisible remainders.
      expect(totals(current)).toEqual([
        [950, 16],
        [950, 15],
      ]);
      expect(current.relations.relationship("player", "rival")).toBe("allied");
    }
  });

  test("ending the alliance separates its pools", () => {
    const { simulation } = fixture({
      events: [at(1, [sharing]), at(2, [rivals("hostile")])],
    });
    advanceSeconds(simulation, 1.5);
    expect(simulation.economy!.stockpiles).toHaveLength(1);
    advanceSeconds(simulation, 1);
    expect(totals(simulation)).toEqual([
      [1000, 0],
      [1000, 0],
    ]);
  });

  test("pools join owners through shared allies and split by member shares", () => {
    const owners = ["a", "b", "c"];
    const economy = {
      stockpiles: [
        { resource: "materials" as const, owners: ["a"], amount: 10 },
        { resource: "materials" as const, owners: ["c"], amount: 5 },
        { resource: "lifebloom" as const, owners: ["b"], amount: 7 },
      ],
    } as EconomyState;
    const linked = (pairs: string[]) => (left: string, right: string) =>
      left === right ||
      pairs.includes(`${left}${right}`) ||
      pairs.includes(`${right}${left}`);
    regroupStockpiles(economy, owners, linked(["ab", "bc"]));
    expect(economy.stockpiles).toEqual([
      { resource: "materials", owners: ["a", "b", "c"], amount: 15 },
      { resource: "lifebloom", owners: ["a", "b", "c"], amount: 7 },
    ]);
    regroupStockpiles(economy, owners, linked(["ab"]));
    expect(economy.stockpiles).toEqual([
      { resource: "materials", owners: ["a", "b"], amount: 10 },
      { resource: "materials", owners: ["c"], amount: 5 },
      { resource: "lifebloom", owners: ["a", "b"], amount: 5 },
      { resource: "lifebloom", owners: ["c"], amount: 2 },
    ]);
  });

  test("owners that start sharing start pooled; saves must match sharing", () => {
    const { simulation } = fixture({
      relationships: [
        {
          owners: ["player", "rival"],
          relationship: "allied",
          sharesResources: true,
        },
      ],
    });
    expect(simulation.economy!.stockpiles).toEqual([
      { resource: "materials", owners: ["player", "rival"], amount: 2000 },
    ]);
    expect(() =>
      fixture({
        edit: (state) => {
          state.economy!.stockpiles = [
            { resource: "materials", owners: ["player", "rival"], amount: 1 },
          ];
        },
      }),
    ).toThrow("invalid economy state");
  });
});

describe("command authority", () => {
  const bases = [
    {
      actorId: "cc",
      definitionId: "arc-command-center-prototype",
      origin: { x: 2, z: 2 },
    },
    {
      actorId: "rival-cc",
      definitionId: "arc-command-center-prototype",
      origin: { x: 40, z: 2 },
      owner: "rival",
    },
    {
      actorId: "rival-refinery",
      definitionId: "arc-materials-refinery",
      origin: { x: 46, z: 2 },
      owner: "rival",
    },
  ];
  const authorityFixture = (setup: Setup = {}) =>
    fixture({
      units: [
        unit("trooper", 4),
        unit("scout", 6),
        unit("rival-trooper", 44, "rival"),
      ],
      buildings: bases,
      ...setup,
    }).simulation;
  const move = (actorId: string, x = 20) => ({
    kind: "move" as const,
    actorId,
    target: contentMap.tileCenter(x, 12),
  });
  const barracks = (actorId: string) => ({
    kind: "place-actor" as const,
    actorId,
    definitionId: "arc-field-barracks",
    origin: { x: 44, z: 6 },
  });
  const rival = { owner: "rival" };

  test("owners command only their own actors, including a same-faction rival's", () => {
    const simulation = authorityFixture();
    for (const command of [
      move("rival-trooper"),
      { kind: "stop" as const, actorId: "rival-trooper" },
      { kind: "sell-actor" as const, actorId: "rival-cc" },
      {
        kind: "set-rally-point" as const,
        actorId: "rival-refinery",
        target: contentMap.tileCenter(46, 8),
      },
      {
        kind: "train-unit" as const,
        actorId: "stolen",
        producerId: "rival-refinery",
        definitionId: "arc-harvester",
      },
    ])
      simulation.submitCommand(command);
    simulation.submitCommand({
      kind: "group-move",
      actorIds: ["trooper", "rival-trooper"],
      target: contentMap.tileCenter(20, 12),
    });
    const outcomes = simulation.tick();
    expect(outcomes.map(({ accepted, reason }) => [accepted, reason])).toEqual([
      ...Array(5).fill([false, "unauthorized"]),
      [false, "unauthorized"],
      [true, undefined],
    ]);
    expect(outcomes[outcomes.length - 2]!.command).toMatchObject({
      actorId: "rival-trooper",
    });
    expect(simulation.actorById("rival-trooper")!.movement).toBeUndefined();
    expect(simulation.actorById("rival-cc")).toBeDefined();
    expect(simulation.economy!.production).toEqual([]);
    expect(balance(simulation, "materials", "rival")).toBe(1000);

    simulation.submitCommand(move("rival-trooper"), rival);
    simulation.submitCommand(move("trooper"), rival);
    expect(
      simulation.tick().map(({ accepted, issuer }) => [accepted, issuer]),
    ).toEqual([
      [true, rival],
      [false, rival],
    ]);
  });

  test("placement builds for the issuing owner within that owner's knowledge", () => {
    const simulation = authorityFixture();
    const placement = barracks("rival-barracks");
    expect(simulation.fog!.isExplored(44, 6)).toBe(false);
    expect(simulation.evaluatePlacement(placement)).toMatchObject({
      accepted: false,
      reason: "unexplored",
    });
    expect(simulation.evaluatePlacement(placement, "rival").accepted).toBe(
      true,
    );
    simulation.submitCommand(placement);
    simulation.submitCommand(barracks("rival-barracks"), rival);
    expect(simulation.tick()).toMatchObject([
      { accepted: false, reason: "unexplored", issuer: { owner: "player" } },
      { accepted: true, issuer: rival },
    ]);
    expect(simulation.actorById("rival-barracks")!.owner).toBe("rival");
    expect(balance(simulation)).toBe(1000);
    expect(balance(simulation, "materials", "rival")).toBe(900);
  });

  test("shared resources and headquarters do not grant production authority", () => {
    const simulation = authorityFixture({
      relationships: [
        {
          owners: ["player", "rival"],
          relationship: "allied",
          sharesResources: true,
          sharesSupport: true,
          sharesHeadquarters: true,
        },
      ],
      scriptControl: [{ owner: "rival", actorIds: ["rival-trooper"] }],
    });
    simulation.submitCommand(
      {
        kind: "train-unit",
        actorId: "paid-worker",
        producerId: "rival-refinery",
        definitionId: "arc-harvester",
      },
      rival,
    );
    const cancel = {
      kind: "cancel-production" as const,
      actorId: "paid-worker",
    };
    simulation.submitCommand(cancel);
    simulation.submitCommand(cancel, { script: true, owner: "rival" });
    expect(simulation.tick()).toMatchObject([
      { accepted: true },
      { accepted: false, reason: "unauthorized" },
      { accepted: false, reason: "unauthorized" },
    ]);
    expect(
      simulation.economy!.production.map(({ actorId }) => actorId),
    ).toEqual(["paid-worker"]);
    const paid = simulation.economy!.production[0]!.paidCost;
    expect(balance(simulation)).toBe(2000 - paid);
    simulation.submitCommand(cancel, rival);
    expect(simulation.tick()[0]!.accepted).toBe(true);
    expect(simulation.economy!.production).toEqual([]);
    expect(balance(simulation)).toBe(2000);
  });

  test.each(["group-move", "group-attack-move"] as const)(
    "%s excludes unauthorized members from destinations and queued orders",
    (kind) => {
      const simulation = authorityFixture();
      const reference = authorityFixture();
      for (const current of [simulation, reference]) {
        current.submitCommand(move("rival-trooper", 50), rival);
        current.submitCommand(
          { ...move("rival-trooper", 52), queued: true },
          rival,
        );
        current.tick();
      }
      const orders = simulation.actorById("rival-trooper")!.orders;
      const target = contentMap.tileCenter(20, 12);
      simulation.submitCommand({
        kind,
        actorIds: ["trooper", "rival-trooper", "trooper"],
        target,
        queued: true,
      });
      reference.submitCommand({
        kind,
        actorIds: ["trooper"],
        target,
        queued: true,
      });
      expect(simulation.tick()).toMatchObject([
        { accepted: false, reason: "unauthorized" },
        { accepted: true },
      ]);
      reference.tick();
      expect(simulation.actors).toEqual(reference.actors);
      expect(simulation.actorById("rival-trooper")!.orders).toEqual(orders);
    },
  );

  test("rally points use the producer owner's knowledge", () => {
    const simulation = authorityFixture();
    const target = contentMap.tileCenter(46, 8);
    const hidden = contentMap.tileCenter(8, 8);
    expect(simulation.fog!.isExplored(46, 8)).toBe(false);
    expect(simulation.fog!.isExplored(8, 8)).toBe(true);
    expect(simulation.evaluateRallyPoint("rival-refinery", target)).toBe(true);
    expect(simulation.evaluateRallyPoint("rival-refinery", hidden)).toBe(false);
    for (const point of [target, hidden])
      simulation.submitCommand(
        {
          kind: "set-rally-point",
          actorId: "rival-refinery",
          target: point,
        },
        rival,
      );
    expect(simulation.tick()).toMatchObject([
      { accepted: true },
      { accepted: false },
    ]);
    expect(simulation.actorById("rival-refinery")!.rallyPoint).toEqual(target);
  });

  test("scripts command only the owners and actors the scenario permits", () => {
    const simulation = authorityFixture({
      scriptControl: [
        { owner: "rival" },
        { owner: "player", actorIds: ["scout"] },
      ],
    });
    const script = (owner?: string) => ({ script: true as const, owner });
    const water = {
      kind: "terrain" as const,
      tiles: [{ x: 30, z: 18, terrain: { typeId: "water" } }],
    };
    for (const [command, issuer] of [
      [move("rival-trooper"), script("rival")],
      [move("scout"), script("player")],
      [move("trooper"), script("player")],
      [move("rival-trooper"), script()],
      [barracks("scripted-barracks"), script("rival")],
      [water, { owner: "player" }],
      [water, script()],
    ] as const)
      simulation.submitCommand(command, issuer);
    expect(simulation.tick().map(({ accepted }) => accepted)).toEqual([
      true,
      true,
      false,
      false,
      true,
      false,
      true,
    ]);
    expect(simulation.actorById("scripted-barracks")!.owner).toBe("rival");
    expect(() =>
      simulation.submitCommand(move("scout"), { owner: "nobody" }),
    ).toThrow("invalid issuer");
  });

  test("an undefined script flag keeps owner authority through saves", () => {
    const { simulation, content } = fixture({ units: [unit("trooper", 4)] });
    const issuer = { owner: "player", script: undefined };
    simulation.submitCommand(move("trooper"), issuer);
    simulation.submitCommand({ kind: "terrain" }, issuer);
    const file = parseMission(
      serializeMission(content, simulation.snapshot(), TICK_SECONDS),
      TICK_SECONDS,
    );
    const restored = fixture({}, file.state).simulation;
    const expected = [
      { accepted: true },
      { accepted: false, reason: "unauthorized" },
    ];
    expect(simulation.tick()).toMatchObject(expected);
    expect(restored.tick()).toMatchObject(expected);
    expect(restored.snapshot()).toEqual(simulation.snapshot());
  });

  test("script issuers and permissions survive saves", () => {
    const scriptControl = [{ owner: "rival" }];
    const { simulation, content } = fixture({
      units: [unit("rival-trooper", 44, "rival")],
      scriptControl,
    });
    const scenario = { ...content, emergencyHeadquarters: true };
    simulation.submitCommand(move("rival-trooper"), {
      script: true,
      owner: "rival",
    });
    const file = parseMission(
      serializeMission(scenario, simulation.snapshot(), TICK_SECONDS),
      TICK_SECONDS,
    );
    expect(file.scenario).toMatchObject({
      scriptControl,
      emergencyHeadquarters: true,
    });
    expect(file.state.commands[0]!.issuer).toEqual({
      script: true,
      owner: "rival",
    });
    const restored = fixture(
      { units: [unit("rival-trooper", 44, "rival")], scriptControl },
      file.state,
    ).simulation;
    expect(restored.tick()).toEqual(simulation.tick());
    advanceSeconds(restored, 2);
    advanceSeconds(simulation, 2);
    expect(restored.snapshot()).toEqual(simulation.snapshot());
  });

  test.each(
    [
      [{ owner: "nobody" }],
      [{ owner: "rival" }, { owner: "rival" }],
      [{ owner: "rival", actorIds: [] }],
      [{ owner: "rival", actorIds: Array(1) }],
      [{ owner: "player", actorId: "scout" }],
      Array(1),
    ].map((control) => [control]),
  )("script control must name each known owner once: %j", (scriptControl) => {
    expect(() => fixture({ scriptControl })).toThrow("invalid script control");
  });
});
