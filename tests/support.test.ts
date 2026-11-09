import { describe, expect, test } from "vitest";

import { ARC_ACTOR_DEFINITIONS } from "./helpers/content";
import {
  actorIn,
  advanceTicks,
  balance,
  command,
  exploredScenarioState,
  playerOwners,
  savedState,
  setBalance,
  startMission,
  stockpiles,
} from "./helpers/scenario";
import {
  createSupportNetwork,
  createSupportResolver,
  supportForOwner,
  supportsPosition,
} from "../src/simulation/support";
import { defineScenario } from "../src/simulation/scenario";
import { TerrainGrid } from "../src/simulation/terrain";
import { createTilePlacedActor } from "../src/simulation/placement";
import { createActor } from "../src/simulation/actor";
import { createRelations } from "../src/simulation/ownership";

import type { SupportView } from "../src/simulation/support";
import type {
  MissionState,
  MissionSimulation,
} from "../src/simulation/mission";
import type { Actor } from "../src/simulation/actor";
import type { MissionCommand } from "../src/simulation/command";

const arcPlayer = { owner: "player", faction: "arc" };
const sameOwner = (left: string, right: string) => left === right;
const definitions = new Map(
  ARC_ACTOR_DEFINITIONS.map((definition) => [definition.id, definition]),
);
const mapOptions = {
  width: 64,
  height: 24,
  tileSize: 1,
  terrainTypeIds: ["plain", "path", "rough", "water"],
};
const contentMap = new TerrainGrid(mapOptions);
const scenario = defineScenario({
  id: "support-test",
  ...playerOwners("arc"),
  tileSize: 1,
  terrainTypeIds: mapOptions.terrainTypeIds,
  terrain: contentMap.terrainState(),
  stockpiles: stockpiles(2000),
  sites: [],
  loot: [],
  buildings: [
    {
      actorId: "cc",
      definitionId: "arc-command-center-prototype",
      origin: { x: 2, z: 10 },
    },
    {
      actorId: "bridge",
      definitionId: "arc-field-barracks",
      origin: { x: 13, z: 10 },
    },
    {
      actorId: "remote",
      definitionId: "arc-materials-refinery",
      origin: { x: 18, z: 10 },
    },
  ],
});
const initial = () => exploredScenarioState(scenario, ARC_ACTOR_DEFINITIONS);
function fixture(state = initial(), emergencyHeadquarters = false) {
  return startMission(new TerrainGrid(mapOptions), {
    state,
    emergencyHeadquarters,
    definitions: ARC_ACTOR_DEFINITIONS,
    tickSeconds: 1,
  });
}
const isConnected = (network: Pick<SupportView, "nodes">, actorId: string) =>
  network.nodes.find((node) => node.actorId === actorId)!.connected;
function building(id: string, x: number, z: number): Actor {
  return createTilePlacedActor(
    contentMap,
    definitions.get("arc-field-barracks")!,
    { actorId: id, origin: { x, z } },
    "player",
  );
}
function blueprint(id: string, x: number, z: number): Actor {
  return {
    ...building(id, x, z),
    construction: { paidCost: 100, completedTicks: 2, totalTicks: 8 },
  };
}

describe("construction support", () => {
  test("ownership does not make another faction's support compatible", () => {
    const foreignRoot = {
      ...definitions.get("arc-command-center-prototype")!,
      id: "foreign-root",
      faction: "other",
    };
    const catalog = new Map([...definitions, [foreignRoot.id, foreignRoot]]);
    const root = createTilePlacedActor(
      contentMap,
      foreignRoot,
      { actorId: "root", origin: { x: 2, z: 10 } },
      "player",
    );
    const network = createSupportNetwork(
      [root, building("barracks", 13, 10)],
      catalog,
      sameOwner,
    );
    expect(isConnected(network, "barracks")).toBe(false);
    expect(
      supportsPosition(network, root.worldPosition, arcPlayer, sameOwner),
    ).toBe(false);
  });

  test("shared relays cannot lend another owner's root to a third owner", () => {
    const root = createTilePlacedActor(
      contentMap,
      definitions.get("arc-command-center-prototype")!,
      { actorId: "root", origin: { x: 2, z: 10 } },
      "root-owner",
    );
    const relay = { ...building("relay", 13, 10), owner: "middle" };
    const { sharesSupport } = createRelations(
      ["root-owner", "player"].map((owner) => ({
        owners: ["middle", owner],
        relationship: "allied",
        sharesSupport: true,
      })),
    );
    const point = building("prospective", 18, 10).worldPosition;
    const network = createSupportNetwork(
      [root, relay],
      definitions,
      sharesSupport,
    );
    expect(network.nodes.every((node) => node.connected)).toBe(true);
    expect(supportsPosition(network, point, arcPlayer, sharesSupport)).toBe(
      false,
    );
    expect(
      supportForOwner(network, "player", sharesSupport).nodes,
    ).toMatchObject([{ actorId: "relay", connected: false }]);
    const unfinished = createSupportNetwork(
      [root, relay, blueprint("growth", 18, 10)],
      definitions,
      sharesSupport,
    );
    expect(isConnected(unfinished, "growth")).toBe(false);
    const sharedRoot = createTilePlacedActor(
      contentMap,
      definitions.get("arc-command-center-prototype")!,
      { actorId: "middle-root", origin: { x: 3, z: 2 } },
      "middle",
    );
    const supplied = createSupportNetwork(
      [root, relay, sharedRoot],
      definitions,
      sharesSupport,
    );
    expect(supportsPosition(supplied, point, arcPlayer, sharesSupport)).toBe(
      true,
    );
    expect(
      supportForOwner(supplied, "player", sharesSupport).nodes.every(
        (node) => node.connected,
      ),
    ).toBe(true);
  });

  test("disconnected relays cannot bridge two branches of a shared network", () => {
    const root = createTilePlacedActor(
      contentMap,
      definitions.get("arc-command-center-prototype")!,
      { actorId: "root", origin: { x: 2, z: 10 } },
      "root-owner",
    );
    const actors = [
      root,
      { ...building("near", 13, 10), owner: "middle" },
      { ...building("bridge", 18, 10), owner: "outsider" },
      { ...building("far", 23, 10), owner: "middle" },
    ];
    const { sharesSupport } = createRelations(
      ["root-owner", "outsider"].map((owner) => ({
        owners: ["middle", owner],
        relationship: "allied",
        sharesSupport: true,
      })),
    );
    const network = createSupportNetwork(actors, definitions, sharesSupport);
    expect(isConnected(network, "near")).toBe(true);
    expect(isConnected(network, "bridge")).toBe(false);
    expect(isConnected(network, "far")).toBe(false);
  });

  test("another ARC owner's root cannot power buildings or authorize placement", () => {
    const state = initial();
    state.owners.push({ id: "rival", faction: "arc" });
    actorIn(state, "cc").owner = "rival";
    state.actors.push(blueprint("construction", 7, 10));
    const { simulation } = fixture(state);
    expect(simulation.support!.links).toEqual([
      { from: "bridge", to: "remote", active: false },
    ]);
    expect(
      simulation
        .support!.nodes.filter(({ connected }) => connected)
        .map(({ actorId }) => actorId),
    ).toEqual(["cc"]);
    expect(
      simulation.viewOf(simulation.playerOwner).evaluatePlacement({
        actorId: "new",
        definitionId: "arc-field-barracks",
        origin: { x: 8, z: 14 },
      }),
    ).toMatchObject({ accepted: false, reason: "outside-support" });
    const before = simulation.actorById("construction")!.construction;
    simulation.tick();
    expect(simulation.actorById("construction")!.construction).toEqual(before);
  });

  test("a legally built branch depends on its bridge and can gain a redundant path", () => {
    const state = initial();
    state.actors = state.actors.filter((actor) => actor.id === "cc");
    const { simulation } = fixture(state);
    const place = (id: string, x: number, z: number) => {
      expect(
        command(simulation, {
          kind: "place-actor",
          actorId: id,
          definitionId: "arc-field-barracks",
          origin: { x, z },
        }).accepted,
      ).toBe(true);
      advanceTicks(simulation, 8);
      expect(simulation.actorById(id)!.construction).toBeUndefined();
    };
    place("built-bridge", 13, 10);
    place("built-remote", 18, 10);
    command(simulation, { kind: "sell-actor", actorId: "built-bridge" });
    expect(isConnected(simulation.support!, "built-remote")).toBe(false);
    place("replacement", 13, 10);
    place("backup", 13, 12);
    command(simulation, { kind: "sell-actor", actorId: "replacement" });
    expect(simulation.support!.nodes.every((node) => node.connected)).toBe(
      true,
    );
  });

  test("support views survive unrelated changes and invalidate staged topology", () => {
    const { simulation } = fixture();
    const first = simulation.support;
    expect(simulation.support).toBe(first);
    simulation.tick();
    expect(simulation.support).toBe(first);
    command(simulation, {
      kind: "set-rally-point",
      actorId: "bridge",
      target: contentMap.tileCenter(15, 14),
    });
    expect(simulation.support).toBe(first);
    command(simulation, {
      kind: "place-actor",
      actorId: "site",
      definitionId: "arc-field-barracks",
      origin: { x: 23, z: 10 },
    });
    const unfinished = simulation.support;
    advanceTicks(simulation, 2);
    expect(simulation.support).toBe(unfinished);
    advanceTicks(simulation, 6);
    expect(simulation.support).not.toBe(unfinished);
    expect(
      simulation.support!.nodes.find((node) => node.actorId === "site")!
        .complete,
    ).toBe(true);

    const resolve = createSupportResolver(definitions);
    const actors = initial().actors;
    const before = resolve(actors, sameOwner);
    actors.splice(
      actors.findIndex((actor) => actor.id === "bridge"),
      1,
    );
    expect(resolve(actors, sameOwner)).not.toBe(before);
    expect(isConnected(resolve(actors, sameOwner), "remote")).toBe(false);
  });

  test("overlap alone does not connect completed centers", () => {
    const actors = initial().actors;
    actors[1] = building("bridge", 18, 10);
    actors.pop();
    const network = createSupportNetwork(actors, definitions, sameOwner);
    expect(network.links).toEqual([]);
    expect(isConnected(network, "bridge")).toBe(false);
  });

  test("covered completed centers connect to roots with stable redundant edges", () => {
    const state = initial();
    const network = createSupportNetwork(state.actors, definitions, sameOwner);
    expect(network.nodes.every((node) => node.connected)).toBe(true);
    expect(
      supportsPosition(
        network,
        contentMap.tileCenter(23, 10),
        arcPlayer,
        sameOwner,
      ),
    ).toBe(true);
    expect(
      supportsPosition(
        network,
        contentMap.tileCenter(50, 10),
        arcPlayer,
        sameOwner,
      ),
    ).toBe(false);
    expect(
      createSupportNetwork([...state.actors].reverse(), definitions, sameOwner),
    ).toEqual(network);
    state.actors.push(building("backup", 13, 12));
    const redundant = createSupportNetwork(
      state.actors.filter((actor) => actor.id !== "bridge"),
      definitions,
      sameOwner,
    );
    expect(redundant.nodes.every((node) => node.connected)).toBe(true);
    expect(redundant.links.every((link) => link.active)).toBe(true);
  });

  test("blueprints never relay and rootless clusters stay disconnected", () => {
    const state = initial();
    state.actors[1] = blueprint("bridge", 13, 10);
    const network = createSupportNetwork(state.actors, definitions, sameOwner);
    expect(isConnected(network, "remote")).toBe(false);
    expect(
      supportsPosition(
        network,
        contentMap.tileCenter(18, 10),
        arcPlayer,
        sameOwner,
      ),
    ).toBe(false);
    expect(
      createSupportNetwork(
        state.actors.filter((actor) => actor.id !== "cc"),
        definitions,
        sameOwner,
      ).nodes.every((node) => !node.connected),
    ).toBe(true);
  });

  test("placement requires live coverage and rejected orders spend nothing", () => {
    const { simulation } = fixture();
    const before = balance(simulation);
    expect(
      command(simulation, {
        kind: "place-actor",
        actorId: "far",
        definitionId: "arc-field-barracks",
        origin: { x: 50, z: 10 },
      }),
    ).toMatchObject({ accepted: false, reason: "outside-support" });
    expect(balance(simulation)).toBe(before);
    simulation.submitCommand({ kind: "sell-actor", actorId: "bridge" });
    simulation.submitCommand({
      kind: "place-actor",
      actorId: "new",
      definitionId: "arc-field-barracks",
      origin: { x: 34, z: 12 },
    });
    expect(simulation.tick().map((outcome) => outcome.accepted)).toEqual([
      true,
      false,
    ]);
    expect(isConnected(simulation.support!, "remote")).toBe(false);
  });

  test("disconnected production preserves paid queues, cargo, and save continuation", () => {
    const { simulation, map } = fixture();
    command(simulation, {
      kind: "set-rally-point",
      actorId: "remote",
      target: map.tileCenter(34, 12),
    });
    command(simulation, {
      kind: "train-unit",
      actorId: "worker",
      producerId: "remote",
      definitionId: "arc-harvester",
    });
    command(simulation, { kind: "sell-actor", actorId: "bridge" });
    const job = structuredClone(simulation.economy!.production[0]);
    advanceTicks(simulation, 20);
    expect(simulation.economy!.production[0]).toEqual(job);
    expect(
      simulation.viewOf(simulation.playerOwner).evaluateTraining({
        kind: "train-unit",
        actorId: "other",
        producerId: "remote",
        definitionId: "arc-harvester",
      }),
    ).toMatchObject({ accepted: false, reason: "disconnected" });
    const restored = fixture(savedState(scenario, simulation)).simulation;
    for (const current of [simulation, restored]) {
      current.spawnActor(building("restored-bridge", 13, 10));
      advanceTicks(current, 6);
      expect(current.actorById("worker")).toBeDefined();
    }
    expect(restored.snapshot()).toEqual(simulation.snapshot());
    expect(restored.economy!.harvesters[0]).toMatchObject({
      cargo: 0,
      refineryId: "remote",
      phase: "idle",
    });
  });

  test("paused blueprints yield the slot, resume automatically, and refund fully", () => {
    const state = initial();
    state.actors.push(
      blueprint("remote-work", 22, 13),
      blueprint("local-work", 7, 10),
    );
    const { simulation } = fixture(state);
    command(simulation, { kind: "sell-actor", actorId: "bridge" });
    const paused = simulation.actorById("remote-work")!.construction;
    advanceTicks(simulation, 8);
    expect(simulation.actorById("remote-work")!.construction).toEqual(paused);
    expect(simulation.actorById("local-work")!.construction).toBeUndefined();
    simulation.spawnActor(building("replacement", 13, 10));
    simulation.tick();
    expect(
      simulation.actorById("remote-work")!.construction!.completedTicks,
    ).toBe(3);
    const materials = balance(simulation);
    expect(
      command(simulation, {
        kind: "cancel-construction",
        actorId: "remote-work",
      }).accepted,
    ).toBe(true);
    expect(balance(simulation)).toBe(materials + 100);
  });

  test("a disconnected Refinery holds delivered cargo until reconnection", () => {
    const state = initial();
    state.actors = state.actors.filter((actor) => actor.id !== "bridge");
    state.actors.push({
      id: "worker",
      definitionId: "arc-harvester",
      owner: "player",
      worldPosition: contentMap.tileCenter(19, 12),
      facing: 0,
      occupancyLayer: "surface",
    });
    state.economy!.sites.push({
      id: "site",
      name: "Site",
      tile: { x: 2, z: 2 },
      initialMaterials: 37,
      remainingMaterials: 37,
    });
    state.economy!.harvesters.push({
      actorId: "worker",
      refineryId: "remote",
      cargo: 50,
      cargoSources: [{ siteId: "site", amount: 50_000 }],
      gatherProgress: 0,
      phase: "returning",
    });
    const { simulation } = fixture(state);
    const materials = balance(simulation);
    advanceTicks(simulation, 20);
    expect(simulation.economy!.harvesters[0]).toMatchObject({
      cargo: 50,
      phase: "returning",
    });
    expect(balance(simulation)).toBe(materials);
    simulation.spawnActor(building("replacement", 13, 10));
    advanceTicks(simulation, 2);
    expect(balance(simulation)).toBe(materials + 50);
    expect(simulation.economy!.harvesters[0].cargo).toBe(0);
  });

  test("a rival owner's network trains units that inherit its ownership", () => {
    const state = initial();
    state.owners.push({ id: "rival", faction: "arc" });
    for (const actor of state.actors) actor.owner = "rival";
    setBalance(state, 100, "materials", "rival");
    const { simulation } = fixture(state);
    expect(
      command(
        simulation,
        {
          kind: "train-unit",
          actorId: "rival-trooper",
          producerId: "bridge",
          definitionId: "arc-trooper",
        },
        { owner: "rival" },
      ).accepted,
    ).toBe(true);
    advanceTicks(simulation, 30);
    expect(simulation.actorById("rival-trooper")!.owner).toBe("rival");
  });

  test("harvesters work only with their own owner's Refinery", () => {
    const rivalRefinery = (state: MissionState) => {
      state.owners.push({ id: "rival", faction: "arc" });
      actorIn(state, "remote").owner = "rival";
      state.actors.push(
        createActor({
          id: "worker",
          definitionId: "arc-harvester",
          owner: "player",
          worldPosition: contentMap.tileCenter(19, 12),
        }),
      );
      state.economy!.harvesters.push({
        actorId: "worker",
        cargo: 0,
        gatherProgress: 0,
        phase: "unassigned",
      });
      return state;
    };
    const { simulation } = fixture(rivalRefinery(initial()));
    expect(
      command(simulation, {
        kind: "assign-refinery",
        actorId: "worker",
        refineryId: "remote",
      }),
    ).toMatchObject({ accepted: false, reason: "missing-refinery" });
    const saved = rivalRefinery(initial());
    saved.economy!.harvesters[0]!.refineryId = "remote";
    saved.economy!.harvesters[0]!.phase = "idle";
    expect(() => fixture(saved)).toThrow("invalid economy state");
  });
});

describe("Command Center infrastructure queues", () => {
  function commandCenter(id: string, x: number, z: number, owner = "player") {
    return createTilePlacedActor(
      contentMap,
      definitions.get("arc-command-center-prototype")!,
      { actorId: id, origin: { x, z } },
      owner,
    );
  }
  const place = (
    actorId: string,
    x: number,
    z: number,
    definitionId = "arc-field-barracks",
  ): MissionCommand => ({
    kind: "place-actor",
    actorId,
    definitionId,
    origin: { x, z },
  });
  const work = (simulation: MissionSimulation, id: string) => {
    const actor = simulation.actorById(id)!;
    return (
      actor.construction && {
        ...actor.construction,
        headquartersId: actor.headquartersId,
      }
    );
  };

  test("each Command Center supplies an independent queue", () => {
    const state = initial();
    state.actors.push(commandCenter("east-cc", 50, 10));
    const { simulation } = fixture(state);
    for (const order of [
      place("west-1", 5, 14),
      place("east-1", 46, 14),
      place("west-2", 5, 17),
    ])
      expect(command(simulation, order).accepted).toBe(true);
    expect(work(simulation, "west-1")).toMatchObject({
      headquartersId: "cc",
      active: true,
    });
    expect(work(simulation, "east-1")).toMatchObject({
      headquartersId: "east-cc",
      active: true,
    });
    expect(work(simulation, "west-2")).toMatchObject({ headquartersId: "cc" });
    expect(work(simulation, "west-2")!.active).toBeUndefined();
  });

  test("a completed headquarters adds a queue without moving existing work", () => {
    const { simulation } = fixture();
    expect(
      command(simulation, place("new-cc", 8, 4, "arc-command-center-prototype"))
        .accepted,
    ).toBe(true);
    expect(command(simulation, place("queued", 10, 8)).accepted).toBe(true);
    expect(work(simulation, "new-cc")!.headquartersId).toBe("cc");
    expect(work(simulation, "queued")!.active).toBeUndefined();
    advanceTicks(simulation, 12);
    expect(simulation.actorById("new-cc")!.construction).toBeUndefined();
    expect(work(simulation, "queued")).toMatchObject({
      headquartersId: "cc",
      active: true,
    });
    expect(command(simulation, place("fresh", 12, 1)).accepted).toBe(true);
    expect(work(simulation, "fresh")).toMatchObject({
      headquartersId: "new-cc",
      active: true,
    });
  });

  test("completed buildings retain their base through completion, new roots, and saves", () => {
    const { simulation } = fixture();
    expect(simulation.actorById("bridge")!.headquartersId).toBe("cc");
    expect(command(simulation, place("built", 10, 8)).accepted).toBe(true);
    advanceTicks(simulation, 8);
    expect(simulation.actorById("built")!).toMatchObject({
      headquartersId: "cc",
    });
    expect(work(simulation, "built")).toBeUndefined();
    expect(
      command(simulation, place("closer", 8, 4, "arc-command-center-prototype"))
        .accepted,
    ).toBe(true);
    advanceTicks(simulation, 12);
    expect(simulation.actorById("closer")!.headquartersId).toBe("closer");
    for (const id of ["bridge", "built"])
      expect(simulation.actorById(id)!.headquartersId).toBe("cc");
    const restored = fixture(savedState(scenario, simulation)).simulation;
    expect(restored.snapshot()).toEqual(simulation.snapshot());
    for (const current of [simulation, restored]) {
      current.removeActor("cc");
      current.tick();
      for (const id of ["bridge", "built"])
        expect(current.actorById(id)!.headquartersId).toBe("closer");
      current.removeActor("closer");
      current.tick();
      for (const id of ["bridge", "built"])
        expect(current.actorById(id)!.headquartersId).toBeUndefined();
    }
    expect(restored.snapshot()).toEqual(simulation.snapshot());
  });

  test.each(["missing", "bridge", "", null])(
    "invalid saved base affiliations are rejected (%s)",
    (headquartersId) => {
      const state = initial();
      Object.assign(actorIn(state, "remote"), { headquartersId });
      expect(() => fixture(state)).toThrow("invalid infrastructure state");
    },
  );

  test("losing a headquarters moves paid work by priority, or pauses it", () => {
    const state = initial();
    state.actors.push(commandCenter("second-cc", 12, 4));
    const { simulation } = fixture(state);
    for (const order of [
      place("a", 6, 7),
      place("b1", 16, 2),
      place("b2", 16, 6),
    ])
      expect(command(simulation, order).accepted).toBe(true);
    advanceTicks(simulation, 2);
    expect(work(simulation, "a")).toMatchObject({
      headquartersId: "cc",
      active: true,
    });
    command(simulation, {
      kind: "train-unit",
      actorId: "trooper",
      producerId: "bridge",
      definitionId: "arc-trooper",
    });
    const before = balance(simulation);
    const progress = work(simulation, "a")!.completedTicks;
    simulation.removeActor("cc");
    simulation.tick();
    // Training stays on its producer.
    expect(simulation.economy!.production).toMatchObject([
      { actorId: "trooper", producerId: "bridge", completedTicks: 2 },
    ]);
    expect(work(simulation, "a")).toMatchObject({
      headquartersId: "second-cc",
      paidCost: 100,
      completedTicks: progress,
    });
    // Reassigned work waits rather than preempting the receiving queue.
    expect(work(simulation, "a")!.active).toBeUndefined();
    expect(work(simulation, "b1")!.active).toBe(true);
    for (let tick = 0; work(simulation, "b1") && tick < 10; tick++)
      simulation.tick();
    simulation.tick();
    expect(work(simulation, "a")!.active).toBe(true);
    expect(work(simulation, "b2")!.active).toBeUndefined();
    simulation.removeActor("second-cc");
    simulation.tick();
    const paused = work(simulation, "a")!;
    expect(paused.headquartersId).toBeUndefined();
    advanceTicks(simulation, 3);
    expect(work(simulation, "a")).toEqual(paused);
    expect(balance(simulation)).toBe(before);
  });

  test.each([
    { sharesHeadquarters: false, headquartersId: undefined },
    { sharesHeadquarters: true, headquartersId: "rival-cc" },
  ])(
    "an ally's Command Center hosts work only when it shares headquarters (%o)",
    ({ sharesHeadquarters, headquartersId }) => {
      const state = initial();
      state.owners.push({ id: "rival", faction: "arc" });
      state.relationships.push({
        owners: ["player", "rival"],
        relationship: "allied",
        sharesSupport: true,
        ...(sharesHeadquarters && { sharesHeadquarters: true as const }),
      });
      // Out of link range, so only the ally's root powers the outpost.
      state.actors.push(commandCenter("rival-cc", 30, 2, "rival"));
      const { simulation } = fixture(state);
      expect(command(simulation, place("outpost", 34, 6)).accepted).toBe(true);
      simulation.tick();
      expect(simulation.actorById("outpost")!.owner).toBe("player");
      expect(work(simulation, "outpost")!.headquartersId).toBe(headquartersId);
      expect(work(simulation, "outpost")!.active).toBe(
        sharesHeadquarters || undefined,
      );
    },
  );

  describe("emergency headquarters", () => {
    const replacement = (actorId: string, x: number, z: number) =>
      place(actorId, x, z, "arc-command-center-prototype");
    const emergencyFixture = () => {
      const { simulation } = fixture(initial(), true);
      expect(command(simulation, place("pending", 5, 14)).accepted).toBe(true);
      simulation.removeActor("cc");
      simulation.tick();
      return simulation;
    };

    test("an emergency replacement does not wait for an allied queue", () => {
      const state = initial();
      state.actors = state.actors.filter(({ id }) => id !== "cc");
      for (const actor of state.actors) delete actor.headquartersId;
      state.owners.push({ id: "ally", faction: "arc" });
      state.relationships.push({
        owners: ["player", "ally"],
        relationship: "allied",
        sharesSupport: true,
        sharesHeadquarters: true,
      });
      const alliedWork = blueprint("allied-work", 6, 7);
      alliedWork.owner = "ally";
      state.actors.push(commandCenter("ally-cc", 2, 10, "ally"), alliedWork);
      const { simulation } = fixture(state, true);
      simulation.tick();
      expect(work(simulation, "allied-work")!.active).toBe(true);
      expect(command(simulation, replacement("new-cc", 8, 4)).accepted).toBe(
        true,
      );
      expect(work(simulation, "new-cc")).toMatchObject({
        active: true,
        completedTicks: 1,
      });
      expect(simulation.actorById("new-cc")!.headquartersId).toBeUndefined();
      expect(work(simulation, "allied-work")).toMatchObject({
        active: true,
        headquartersId: "ally-cc",
      });
      const restored = fixture(
        JSON.parse(JSON.stringify(simulation.snapshot())),
        true,
      ).simulation;
      advanceTicks(simulation, 12);
      advanceTicks(restored, 12);
      expect(simulation.actorById("new-cc")!.construction).toBeUndefined();
      expect(simulation.actorById("new-cc")!.headquartersId).toBe("new-cc");
      expect(restored.snapshot()).toEqual(simulation.snapshot());
    });

    test("without the rule, losing every Command Center prevents recovery", () => {
      const { simulation } = fixture();
      simulation.removeActor("cc");
      expect(command(simulation, replacement("new-cc", 17, 13))).toMatchObject({
        accepted: false,
        reason: "outside-support",
      });
    });

    test("one disconnected replacement runs while other work pauses", () => {
      const simulation = emergencyFixture();
      expect(work(simulation, "pending")!.headquartersId).toBeUndefined();
      expect(command(simulation, replacement("far-cc", 40, 14))).toMatchObject({
        accepted: false,
        reason: "outside-support",
      });
      const before = balance(simulation);
      for (const order of [
        replacement("new-cc", 17, 13),
        replacement("spare-cc", 12, 14),
      ])
        expect(command(simulation, order).accepted).toBe(true);
      expect(balance(simulation)).toBe(before - 600);
      expect(simulation.support!.nodes).toContainEqual(
        expect.objectContaining({ actorId: "new-cc", connected: false }),
      );
      expect(work(simulation, "new-cc")).toMatchObject({
        active: true,
        totalTicks: 12,
      });
      expect(work(simulation, "spare-cc")!.active).toBeUndefined();
      expect(work(simulation, "pending")!.active).toBeUndefined();
      while (work(simulation, "new-cc")) simulation.tick();
      simulation.tick();
      // Normal queues resume in placement order.
      expect(work(simulation, "pending")).toMatchObject({
        headquartersId: "new-cc",
        active: true,
      });
      expect(work(simulation, "spare-cc")).toMatchObject({
        headquartersId: "new-cc",
      });
      expect(work(simulation, "spare-cc")!.active).toBeUndefined();
    });
  });
});
