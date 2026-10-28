import { describe, expect, test } from "vitest";

import {
  ATTACK_ALERT_SECONDS,
  createAlertTracker,
} from "../src/ui/mission-alerts";

import type { AlertObservation } from "../src/ui/mission-alerts";
import type { ActorRenderState } from "../src/simulation/actor";
import type { AttackEvent } from "../src/simulation/combat";
import type { ObjectiveView } from "../src/simulation/objectives";
import type { SupportView } from "../src/simulation/support";

const TICK_SECONDS = 0.5;

const actor = (
  id: string,
  definitionId: string,
  extra: Partial<ActorRenderState> = {},
): ActorRenderState => ({
  id,
  definitionId,
  owner: definitionId === "wolf" ? "wildlife" : "player",
  worldPosition: { x: 1, z: 2 },
  facing: 0,
  occupancyLayer: "surface",
  ...extra,
});

const hit = (targetId: string): AttackEvent => ({
  attackerId: "wolf",
  attackerDefinitionId: "wolf",
  targetId,
  from: { x: 0, z: 0 },
  to: { x: 1, z: 2 },
  damage: 1,
  damageType: "bite",
});

const objective = (status: ObjectiveView["status"]): ObjectiveView => ({
  id: "den",
  label: "Clear the den",
  directive: "",
  status,
});

function tracker() {
  const alerts = createAlertTracker({
    owns: ({ owner }) => owner === "player",
    nameOf: (id) => id[0]!.toUpperCase() + id.slice(1),
  });
  let tick = 0;
  return (state: Partial<AlertObservation> = {}) =>
    alerts.observe({
      tick: tick++,
      tickSeconds: TICK_SECONDS,
      actors: [],
      attacks: [],
      wrecks: [],
      objectives: [],
      workerIds: [],
      ...state,
    });
}

describe("mission alerts", () => {
  test("the first observation records a baseline", () => {
    const observe = tracker();
    expect(
      observe({
        actors: [actor("t1", "trooper")],
        attacks: [hit("t1")],
        objectives: [objective("complete")],
      }),
    ).toEqual([]);
  });

  test("groups repeated attacks and pulses Harvester danger", () => {
    const observe = tracker();
    const actors = [actor("h1", "harvester"), actor("t1", "trooper")];
    observe({ actors });
    const first = observe({
      actors,
      attacks: [hit("h1"), hit("t1"), hit("t1")],
      workerIds: ["h1"],
    });
    expect(first.map(({ text, pulse }) => [text, !!pulse])).toEqual([
      ["Harvester under attack", true],
      ["Units under attack", false],
    ]);
    expect(first.every(({ priority }) => priority === "high")).toBe(true);
    for (let tick = 0; tick < ATTACK_ALERT_SECONDS / TICK_SECONDS; tick++)
      expect(
        observe({ actors, attacks: [hit("t1")], workerIds: ["h1"] }),
      ).toEqual([]);
    for (let tick = 0; tick <= ATTACK_ALERT_SECONDS / TICK_SECONDS; tick++)
      observe({ actors });
    expect(observe({ actors, attacks: [hit("t1")] })).toHaveLength(1);
  });

  test("a lethal Harvester hit retains its attack category and location", () => {
    const observe = tracker();
    const worker = actor("h1", "harvester");
    observe({ actors: [worker], workerIds: [worker.id] });
    const alerts = observe({
      actors: [],
      workerIds: [],
      attacks: [hit(worker.id)],
    });
    expect(alerts).toEqual([
      {
        priority: "high",
        text: "Harvester under attack",
        pulse: true,
        position: worker.worldPosition,
      },
    ]);
  });

  test("instant construction reports completion without alerting on blueprints", () => {
    const observe = tracker();
    observe();
    const tilePlacement = { origin: { x: 0, z: 0 }, quarterTurns: 0 };
    expect(
      observe({
        actors: [
          actor("b1", "barracks", { tilePlacement }),
          actor("b2", "barracks", {
            tilePlacement,
            construction: {
              paidCost: 1,
              completedTicks: 0,
              totalTicks: 2,
            },
          }),
        ],
      }).map(({ text }) => text),
    ).toEqual(["Barracks complete"]);
  });

  test("reports completion, training, losses, and blocked routes", () => {
    const observe = tracker();
    observe({
      actors: [
        actor("b1", "barracks", {
          tilePlacement: { origin: { x: 0, z: 0 }, quarterTurns: 0 },
          construction: { paidCost: 1, completedTicks: 0, totalTicks: 2 },
        }),
        actor("t1", "trooper"),
        actor("s1", "scout", { movement: { target: { x: 4, z: 4 } } }),
        actor("w1", "wolf"),
      ],
    });
    const alerts = observe({
      actors: [
        actor("b1", "barracks", {
          tilePlacement: { origin: { x: 0, z: 0 }, quarterTurns: 0 },
        }),
        actor("s1", "scout", {
          movement: { target: { x: 4, z: 4 }, blocked: true },
        }),
        actor("t2", "trooper"),
        actor("t3", "trooper"),
      ],
      wrecks: [
        {
          actorId: "t1",
          definitionId: "trooper",
          owner: "player",
          worldPosition: { x: 1, z: 2 },
          facing: 0,
          tick: 1,
        },
        {
          actorId: "w1",
          definitionId: "wolf",
          owner: "wildlife",
          worldPosition: { x: 1, z: 2 },
          facing: 0,
          tick: 1,
        },
      ] as AlertObservation["wrecks"],
    });
    expect(alerts.map(({ text, priority }) => [text, priority])).toEqual([
      ["Trooper lost", "high"],
      ["Barracks complete", "normal"],
      ["2 units ready", "normal"],
      ["Scout cannot reach the destination", "normal"],
    ]);
  });

  test("groups network changes and reports objective results", () => {
    const observe = tracker();
    const actors = ["a", "b", "c"].map((id) => actor(id, "refinery"));
    const network = (connected: Record<string, boolean>): SupportView => ({
      nodes: actors.map(({ id }) => ({
        actorId: id,
        owner: "player",
        center: { x: 0, z: 0 },
        radius: 6,
        complete: true,
        root: false,
        connected: connected[id]!,
        rootOwners: connected[id] ? ["player"] : [],
        rootIds: connected[id] ? ["root"] : [],
      })),
      links: [],
    });
    observe({
      actors,
      support: network({ a: true, b: true, c: false }),
      objectives: [objective("active")],
    });
    expect(
      observe({
        actors,
        support: network({ a: false, b: false, c: true }),
        objectives: [objective("complete")],
      }).map(({ text }) => text),
    ).toEqual([
      "2 buildings disconnected",
      "1 building reconnected",
      "Objective complete: Clear the den",
    ]);
  });

  test("other owners' attacks, losses, production, routes, and outages stay silent", () => {
    const observe = tracker();
    const tilePlacement = { origin: { x: 0, z: 0 }, quarterTurns: 0 };
    const node = (actorId: string, owner: string, connected: boolean) => ({
      actorId,
      owner,
      center: { x: 0, z: 0 },
      radius: 6,
      complete: true,
      root: false,
      connected,
      rootOwners: connected ? [owner] : [],
      rootIds: connected ? ["root"] : [],
    });
    const before = ["rival", "ally"].flatMap((owner) => [
      actor(`${owner}-worker`, "harvester", { owner }),
      actor(`${owner}-unit`, "trooper", { owner }),
      actor(`${owner}-scout`, "scout", {
        owner,
        movement: { target: { x: 4, z: 4 } },
      }),
      actor(`${owner}-site`, "barracks", {
        owner,
        tilePlacement,
        construction: { paidCost: 1, completedTicks: 0, totalTicks: 2 },
      }),
      actor(`${owner}-relay`, "refinery", { owner, tilePlacement }),
    ]);
    const workerIds = ["rival-worker", "ally-worker"];
    observe({
      actors: before,
      workerIds,
      support: {
        nodes: ["rival", "ally"].map((owner) =>
          node(`${owner}-relay`, owner, true),
        ),
        links: [],
      },
    });
    const after = ["rival", "ally"].flatMap((owner) => [
      actor(`${owner}-worker`, "harvester", { owner }),
      actor(`${owner}-scout`, "scout", {
        owner,
        movement: { target: { x: 4, z: 4 }, blocked: true },
      }),
      actor(`${owner}-site`, "barracks", { owner, tilePlacement }),
      actor(`${owner}-relay`, "refinery", { owner, tilePlacement }),
      actor(`${owner}-recruit`, "trooper", { owner }),
    ]);
    const alerts = observe({
      actors: [...after, actor("t1", "trooper")],
      workerIds,
      attacks: ["worker", "site", "scout"].flatMap((id) => [
        hit(`rival-${id}`),
        hit(`ally-${id}`),
      ]),
      wrecks: ["rival", "ally"].map((owner) => ({
        actorId: `${owner}-unit`,
        definitionId: "trooper",
        owner,
        worldPosition: { x: 1, z: 2 },
        facing: 0,
        tick: 1,
      })) as AlertObservation["wrecks"],
      support: {
        nodes: ["rival", "ally"].map((owner) =>
          node(`${owner}-relay`, owner, false),
        ),
        links: [],
      },
    });
    expect(alerts.map(({ text, pulse }) => [text, !!pulse])).toEqual([
      ["Trooper ready", false],
    ]);
  });

  test("announces a site only when an explored site falls dormant", () => {
    const observe = tracker();
    const site = (dormant: boolean) => ({
      id: "grove",
      name: "Near Lifebloom",
      dormant,
      reopensAt: 60,
      position: { x: 3, z: 4 },
    });
    observe({ sites: [] });
    expect(observe({ sites: [site(true)] })).toEqual([]);
    observe({ sites: [site(false)] });
    expect(observe({ sites: [site(true)] })).toEqual([
      {
        priority: "normal",
        text: "Near Lifebloom is dormant. Workers deliver cargo and wait for recovery to 60%.",
        position: { x: 3, z: 4 },
      },
    ]);
    expect(observe({ sites: [site(true)] })).toEqual([]);
  });
});
