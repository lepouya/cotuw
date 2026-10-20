import { describe, expect, test } from "vitest";
import {
  actorAnimationState,
  extractHealthAndDamageEffects,
  UNIT_BAR_CLEARANCE,
} from "../src/render/session-effects";
import { TerrainMap } from "../src/map";
import { createActor } from "../src/simulation/actor";

import type { ActorDefinition } from "../src/simulation/actor";
import type { ActorPresentation } from "../src/content/content-pack";

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

  test("extracts health bars and damage effects for damaged actors", () => {
    const actor = createActor({
      id: "unit-1",
      definitionId: "trooper",
      worldPosition: { x: 2, z: 2 },
    });
    actor.health = 40;

    const context = {
      definitions,
      appearances: new Map([
        ["trooper", { bounds: { radius: 0.5, height: 1.2 } } as any],
      ]),
      presentationOf: (id: string) => presentations.get(id),
      shows: () => true,
      groundPositionOf: () => undefined,
      buildingTopHeightOf: () => undefined,
      map,
      completedTicks: 10,
      tickSeconds: 0.25,
      selectedActorIds: ["unit-1"],
    };

    const { bars, damaged, regenerating } = extractHealthAndDamageEffects(
      [actor],
      context,
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
      worldPosition: { x: 4, z: 4 },
    });
    actor.health = 80;
    actor.territory = { mode: "regenerating", home: { x: 4, z: 4 } };

    const context = {
      definitions,
      appearances: new Map([
        ["trooper", { bounds: { radius: 0.5, height: 1.2 } } as any],
      ]),
      presentationOf: (id: string) => presentations.get(id),
      shows: () => true,
      groundPositionOf: () => undefined,
      buildingTopHeightOf: () => undefined,
      map,
      completedTicks: 10,
      tickSeconds: 0.25,
      selectedActorIds: [],
    };

    const { regenerating } = extractHealthAndDamageEffects([actor], context);
    expect(regenerating).toHaveLength(1);
    expect(regenerating[0].id).toBe("unit-2");
  });

  test("skips hidden actors", () => {
    const actor = createActor({
      id: "unit-3",
      definitionId: "trooper",
      worldPosition: { x: 4, z: 4 },
    });
    actor.health = 10;

    const context = {
      definitions,
      appearances: new Map(),
      presentationOf: (id: string) => presentations.get(id),
      shows: () => false,
      groundPositionOf: () => undefined,
      buildingTopHeightOf: () => undefined,
      map,
      completedTicks: 10,
      tickSeconds: 0.25,
      selectedActorIds: ["unit-3"],
    };

    const { bars, damaged } = extractHealthAndDamageEffects([actor], context);
    expect(bars).toHaveLength(0);
    expect(damaged).toHaveLength(0);
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
      worldPosition: { x: 0, z: 0 },
    });
    attacker.combat = {
      attack: { targetId: "wolf-1", lastKnown: { x: 3, z: 0 } },
    };
    attacker.territory = { mode: "pursuing", home: { x: 0, z: 0 } };

    const target = createActor({
      id: "wolf-1",
      definitionId: "trooper",
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

  test("aiming is false when target is not visible or out of range", () => {
    const attacker = createActor({
      id: "trooper-1",
      definitionId: "trooper",
      worldPosition: { x: 0, z: 0 },
    });
    attacker.combat = {
      attack: { targetId: "target-far", lastKnown: { x: 20, z: 20 } },
    };

    const farTarget = createActor({
      id: "target-far",
      definitionId: "trooper",
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
