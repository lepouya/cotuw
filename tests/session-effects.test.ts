import { describe, expect, test } from "vitest";

import {
  actorAnimationState,
  extractHealthAndDamageEffects,
  extractServiceEffects,
  extractWorkerBadges,
  shotEnds,
  UNIT_BAR_CLEARANCE,
} from "../src/render/session-effects";
import { TerrainMap } from "../src/map";
import { createActor } from "../src/simulation/actor";

import type { ActorDefinition } from "../src/simulation/actor";
import type { ActorPresentation } from "../src/content/presentation";
import type { ActorAppearance } from "../src/render/actor";

describe("session effects extraction", () => {
  const map = new TerrainMap({
    width: 10,
    height: 10,
    tileSize: 2,
    createHeight: () => 5,
  });

  const definitions = new Map<string, ActorDefinition>([
    [
      "trooper",
      {
        id: "trooper",
        behaviorId: "idle",
        health: 100,
        weapon: {
          damage: 10,
          damageType: "kinetic",
          range: 4,
          cooldownSeconds: 1,
        },
      },
    ],
    [
      "barracks",
      {
        id: "barracks",
        behaviorId: "idle",
        health: 500,
        footprint: {
          layer: "surface",
          blocksMovement: true,
          occupiedTiles: [
            { x: 0, z: 0 },
            { x: 1, z: 0 },
          ],
        },
      },
    ],
  ]);

  const presentations = new Map<string, ActorPresentation>([
    [
      "trooper",
      {
        name: "Trooper",
        description: "ARC rifle infantry.",
        damageEffect: "biological",
        regenerationEffect: true,
      },
    ],
    [
      "barracks",
      {
        name: "Barracks",
        description: "Infantry training facility.",
        damageEffect: "mechanical",
      },
    ],
  ]);

  const context = (selectedActorIds: string[]) => ({
    definitions,
    appearances: new Map([
      ["trooper", { bounds: { radius: 0.5, height: 1.2 } } as ActorAppearance],
    ]),
    presentationOf: (id: string) => presentations.get(id),
    groundPositionOf: () => undefined,
    buildingTopHeightOf: () => undefined,
    map,
    completedTicks: 10,
    tickSeconds: 0.25,
    selectedActorIds,
  });

  test("extracts health bars and damage effects for damaged actors", () => {
    const actor = createActor({
      id: "unit-1",
      definitionId: "trooper",
      owner: "player",
      worldPosition: { x: 2, z: 2 },
    });
    actor.health = 40;

    const { bars, damaged, regenerating } = extractHealthAndDamageEffects(
      [actor],
      context(["unit-1"]),
    );

    expect(bars).toHaveLength(1);
    expect(bars[0].actorId).toBe("unit-1");
    expect(bars[0].fraction).toBe(0.4);
    expect(bars[0].height).toBeCloseTo(1.2 + UNIT_BAR_CLEARANCE);

    expect(damaged).toHaveLength(1);
    expect(damaged[0].id).toBe("unit-1");
    expect(damaged[0].style).toBe("biological");

    expect(regenerating).toHaveLength(0);
  });

  test("extracts regenerating effect when territory mode is regenerating", () => {
    const actor = createActor({
      id: "unit-2",
      definitionId: "trooper",
      owner: "player",
      worldPosition: { x: 4, z: 4 },
    });
    actor.health = 80;
    actor.territory = { mode: "regenerating", home: { x: 4, z: 4 } };

    const { regenerating } = extractHealthAndDamageEffects(
      [actor],
      context([]),
    );
    expect(regenerating).toHaveLength(1);
    expect(regenerating[0].id).toBe("unit-2");
  });
});

describe("actorAnimationState", () => {
  const map = new TerrainMap({
    width: 10,
    height: 10,
    tileSize: 2,
    createHeight: () => 0,
  });

  const definitions = new Map<string, ActorDefinition>([
    [
      "trooper",
      {
        id: "trooper",
        behaviorId: "idle",
        weapon: {
          damage: 10,
          damageType: "kinetic",
          range: 5,
          cooldownSeconds: 1,
        },
      },
    ],
  ]);

  test("identifies working, running, and aiming states", () => {
    const attacker = createActor({
      id: "trooper-1",
      definitionId: "trooper",
      owner: "player",
      worldPosition: { x: 0, z: 0 },
    });
    attacker.combat = {
      attack: { targetId: "wolf-1", lastKnown: { x: 3, z: 0 } },
    };
    attacker.territory = { mode: "pursuing", home: { x: 0, z: 0 } };

    const target = createActor({
      id: "wolf-1",
      definitionId: "trooper",
      owner: "player",
      worldPosition: { x: 3, z: 0 },
    });

    const state = actorAnimationState(
      attacker,
      new Set(["trooper-1"]),
      definitions,
      target,
      map,
    );

    expect(state.working).toBe(true);
    expect(state.running).toBe(true);
    expect(state.aiming).toBe(true);
  });

  test("reports damage severity from health for authored damage stages", () => {
    const ram = createActor({
      id: "ram",
      definitionId: "ram",
      owner: "player",
      worldPosition: { x: 0, z: 0 },
    });
    const withRam = new Map([
      ...definitions,
      ["ram", { id: "ram", behaviorId: "idle", health: 100 }],
    ]);
    const at = (health: number | undefined) =>
      actorAnimationState(
        { ...ram, health },
        new Set(),
        withRam,
        undefined,
        map,
      ).damage;
    expect(at(undefined)).toBeUndefined();
    expect(at(80)).toBeUndefined();
    expect(at(60)).toBe("moderate");
    expect(at(30)).toBe("critical");
  });

  test("aiming is false when target is not visible or out of range", () => {
    const attacker = createActor({
      id: "trooper-1",
      definitionId: "trooper",
      owner: "player",
      worldPosition: { x: 0, z: 0 },
    });
    attacker.combat = {
      attack: { targetId: "target-far", lastKnown: { x: 20, z: 20 } },
    };

    const farTarget = createActor({
      id: "target-far",
      definitionId: "trooper",
      owner: "player",
      worldPosition: { x: 20, z: 20 },
    });

    const stateFar = actorAnimationState(
      attacker,
      new Set(),
      definitions,
      farTarget,
      map,
    );
    expect(stateFar.aiming).toBe(false);

    const stateHidden = actorAnimationState(
      attacker,
      new Set(),
      definitions,
      undefined,
      map,
    );
    expect(stateHidden.aiming).toBe(false);
  });
});

describe("shot and service placement", () => {
  const map = new TerrainMap({
    width: 10,
    height: 10,
    tileSize: 2,
    createHeight: () => 5,
  });
  const presentations = new Map<string, ActorPresentation>([
    [
      "launcher",
      {
        name: "Launcher",
        description: "",
        frameEffects: {
          attack: {
            clip: "flash",
            url: "flash.png",
            size: 1,
            anchor: [1, 2, 3],
          },
        },
      },
    ],
    ["sentry", { name: "Sentry", description: "", attackAnchor: [0, 1, 1] }],
    ["medic", { name: "Medic", description: "", serviceEffect: "medical" }],
    ["ram", { name: "Ram", description: "", attackEffect: "strike" }],
  ]);
  const context = {
    definitions: new Map<string, ActorDefinition>([
      [
        "sentry",
        {
          id: "sentry",
          behaviorId: "idle",
          footprint: {
            layer: "surface",
            occupiedTiles: [{ x: 0, z: 0 }],
            blocksMovement: true,
          },
        },
      ],
    ]),
    appearances: new Map([
      ["trooper", { bounds: { radius: 0.5, height: 1.2 } } as ActorAppearance],
    ]),
    presentationOf: (id: string) => presentations.get(id),
    groundPositionOf: (id: string) =>
      id === "patient" ? { x: 4, z: 4 } : undefined,
    buildingTopHeightOf: () => 9,
    roofHeightOf: () => 6,
    map,
  };
  const hit = (attackerDefinitionId: string) => ({
    attackerId: "a",
    attackerDefinitionId,
    targetId: "t",
    from: { x: 2, z: 2 },
    to: { x: 8, z: 2 },
    damage: 1,
    damageType: "kinetic" as const,
  });
  const unit = (id: string, definitionId: string, facing = 0) => ({
    ...createActor({
      id,
      definitionId,
      owner: "player",
      worldPosition: { x: 2, z: 2 },
    }),
    facing,
  });

  test("anchors turn with the attacker and shots land halfway up targets", () => {
    const attacker = unit("a", "launcher", Math.PI / 2);
    const target = unit("t", "trooper");
    const { from, to } = shotEnds(hit("launcher"), attacker, target, context);
    expect(from!.x).toBeCloseTo(5);
    expect(from!.y).toBeCloseTo(7);
    expect(from!.z).toBeCloseTo(1);
    expect(to!.asArray()).toEqual([8, 5.6, 2]);
    expect(shotEnds(hit("launcher"), undefined, undefined, context)).toEqual({
      from: undefined,
      to: undefined,
    });
  });

  test("building anchors use tile units above the roof and follow aim", () => {
    const sentry = {
      ...unit("a", "sentry"),
      tilePlacement: { origin: { x: 0, z: 0 }, quarterTurns: 0 },
      combat: { aimFacing: Math.PI },
    };
    const { from } = shotEnds(hit("sentry"), sentry, undefined, context);
    expect(from!.x).toBeCloseTo(2);
    expect(from!.y).toBeCloseTo(8);
    expect(from!.z).toBeCloseTo(0);
  });

  test("lethal building hits keep their model height through shown remains", () => {
    const remains = {
      id: "t",
      definitionId: "sentry",
      facing: 0,
      tilePlacement: { origin: { x: 0, z: 0 }, quarterTurns: 0 },
    };
    const { to } = shotEnds(hit("launcher"), undefined, remains, context);
    expect(to!.asArray()).toEqual([8, 7, 2]);
  });

  test("melee splinters land at the building edge for a visible striker", () => {
    const attacker = unit("a", "ram");
    const remains = {
      id: "t",
      definitionId: "sentry",
      tilePlacement: { origin: { x: 6, z: 5 }, quarterTurns: 0 },
    };
    const strike = { ...hit("ram"), from: { x: 0, z: 1 }, to: { x: 3, z: 1 } };
    expect(shotEnds(strike, attacker, remains, context).to?.asArray()).toEqual([
      2, 7, 1,
    ]);
    expect(shotEnds(strike, undefined, remains, context).to?.asArray()).toEqual(
      [3, 7, 1],
    );
  });

  test.each(["builtin", "glb"])(
    "%s attack anchors follow the mobile model scale",
    (kind) => {
      const model: ActorPresentation["model"] =
        kind === "builtin"
          ? { builtin: "wolf", scale: 2 }
          : {
              glb: {
                url: "model.glb",
                scale: 2,
                bounds: { radius: 1, height: 2 },
                clips: { idle: "idle", locomotion: "walk" },
                cycleDistance: 1,
              },
            };
      const { from } = shotEnds(
        hit("launcher"),
        unit("a", "launcher", Math.PI / 2),
        undefined,
        {
          ...context,
          presentationOf: () => ({ ...presentations.get("launcher")!, model }),
        },
      );
      expect(from!.x).toBeCloseTo(8);
      expect(from!.y).toBeCloseTo(9);
      expect(from!.z).toBeCloseTo(0);
    },
  );

  test("service symbols follow drawn targets of styled providers", () => {
    const actors = new Map(
      [unit("medic", "medic"), unit("patient", "trooper"), unit("x", "x")].map(
        (actor) => [actor.id, actor],
      ),
    );
    expect(
      extractServiceEffects(
        [
          { providerId: "medic", targetId: "patient" },
          { providerId: "x", targetId: "patient" },
        ],
        (id) => actors.get(id),
        context,
      ),
    ).toEqual([
      {
        id: "medic",
        style: "medical",
        position: { x: 4, z: 4 },
        height: 1.2 + UNIT_BAR_CLEARANCE,
      },
    ]);
  });
});

test("worker badges mark waiting, undeliverable, and blocked Cultivators only", () => {
  const worker = (id: string, blocked = false) => ({
    ...createActor({
      id,
      owner: "player",
      definitionId: "cultivator",
      worldPosition: { x: 1, z: 2 },
    }),
    ...(blocked && { movement: { target: { x: 4, z: 4 }, blocked: true } }),
  });
  const badges = extractWorkerBadges(
    [
      { actorId: "waiting", phase: "waiting" },
      { actorId: "stranded", phase: "no-dropoff" },
      { actorId: "blocked", phase: "blocked" },
      { actorId: "tending", phase: "tending", tendingBlocked: true },
      { actorId: "gathering", phase: "gathering" },
      { actorId: "moving", phase: "idle" },
      { actorId: "hidden", phase: "waiting" },
    ],
    [
      worker("waiting"),
      worker("stranded"),
      worker("blocked"),
      worker("tending"),
      worker("gathering"),
      worker("moving", true),
    ],
    {
      appearances: new Map(),
      groundPositionOf: (id) => (id === "waiting" ? { x: 3, z: 3 } : undefined),
    },
  );
  expect(
    badges.map(({ id, kind, worldPosition }) => [id, kind, worldPosition]),
  ).toEqual([
    ["waiting", "waiting", { x: 3, z: 3 }],
    ["stranded", "undeliverable", { x: 1, z: 2 }],
    ["blocked", "blocked", { x: 1, z: 2 }],
    ["tending", "blocked", { x: 1, z: 2 }],
  ]);
});
