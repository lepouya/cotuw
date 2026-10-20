import { NullEngine, Scene } from "@babylonjs/core";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  createSessionAssets,
  standInAppearances,
} from "../src/render/session-assets";
import { createLifetime } from "../src/lifetime";
import { createFrameEffectsView } from "../src/render/frame-effects";
import { loadModelAsset } from "../src/render/glb-model";
import { loadSkinnedActorAppearance } from "../src/render/skinned-actor-appearance";
import { BASE_CONTENT } from "./helpers/content";

import type { ContentPack } from "../src/content/content-pack";
import type { ActorAppearance } from "../src/render/actor";
import type { ModelAsset } from "../src/render/glb-model";
import type { ActorDefinition } from "../src/simulation/actor";

vi.mock("../src/render/glb-model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/render/glb-model")>()),
  loadModelAsset: vi.fn(),
}));
vi.mock("../src/render/skinned-actor-appearance", () => ({
  loadSkinnedActorAppearance: vi.fn(),
}));

let resources = createLifetime();
beforeEach(() => {
  resources = createLifetime();
  vi.resetAllMocks();
});
afterEach(() => {
  try {
    resources.dispose();
  } finally {
    vi.restoreAllMocks();
  }
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function pendingAssets() {
  const engine = resources.own(new NullEngine());
  const scene = new Scene(engine);
  const frameEffects = resources.own(
    createFrameEffectsView(scene, {}, () => false),
  );
  const content: ContentPack = {
    ...BASE_CONTENT,
    props: { foundation: { url: "foundation.glb" } },
    presentation: {
      trooper: {
        name: "Trooper",
        description: "Infantry",
        model: {
          glb: {
            url: "trooper.glb",
            clips: { idle: "idle", locomotion: "walk" },
            cycleDistance: 1,
            bounds: { radius: 0.5, height: 1.2 },
          },
        },
      },
      barracks: {
        name: "Barracks",
        description: "Production building",
        building: {
          height: 2,
          color: [0.3, 0.4, 0.3],
          details: "barracks",
          glb: { url: "barracks.glb" },
        },
      },
    },
  };
  const definitions: ActorDefinition[] = [
    { id: "trooper", behaviorId: "idle" },
    { id: "barracks", behaviorId: "idle" },
  ];
  const actorLoad = deferred<ActorAppearance>();
  const propLoad = deferred<ModelAsset>();
  const buildingLoad = deferred<ModelAsset>();
  vi.mocked(loadSkinnedActorAppearance).mockReturnValue(actorLoad.promise);
  vi.mocked(loadModelAsset).mockImplementation((_, { url }) =>
    url === "foundation.glb" ? propLoad.promise : buildingLoad.promise,
  );
  const actor: ActorAppearance = {
    bounds: { radius: 0.6, height: 1.4 },
    instantiate: vi.fn(),
    dispose: vi.fn(),
  };
  const prop: ModelAsset = { instantiate: vi.fn(), dispose: vi.fn() };
  const building: ModelAsset = {
    topHeight: 3,
    instantiate: vi.fn(),
    dispose: vi.fn(),
  };
  const callbacks = {
    onActorAppearanceUpdated: vi.fn(),
    onBuildingUpdated: vi.fn(),
    onPropLoaded: vi.fn(),
    onModelsReady: vi.fn(),
  };
  const assets = resources.own(
    createSessionAssets({
      scene,
      content,
      definitions,
      reducedMotion: () => false,
      frameEffects,
    }),
  );
  const resolve = () => {
    actorLoad.resolve(actor);
    propLoad.resolve(prop);
    buildingLoad.resolve(building);
  };
  const reject = () => {
    actorLoad.reject(new Error("actor load failed"));
    propLoad.reject(new Error("prop load failed"));
    buildingLoad.reject(new Error("building load failed"));
  };
  return { scene, assets, actor, prop, building, callbacks, resolve, reject };
}

describe("session assets", () => {
  test("creates stand-in appearances with box meshes and bounds", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);

    const appearances = standInAppearances(scene, [
      [
        "arc-trooper",
        {
          url: "trooper.glb",
          clips: { idle: "idle", locomotion: "walk" },
          cycleDistance: 1,
          bounds: { radius: 0.5, height: 1.2 },
          minimapColor: [0.2, 0.5, 0.8],
        },
      ],
    ]);

    expect(appearances.has("arc-trooper")).toBe(true);
    const appearance = appearances.get("arc-trooper")!;
    expect(appearance.bounds).toEqual({ radius: 0.5, height: 1.2 });
    expect(appearance.minimapColor).toEqual([0.2, 0.5, 0.8]);

    appearance.dispose();
    scene.dispose();
    engine.dispose();
  });

  test("prepares procedural building details without loading models", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const frameEffects = createFrameEffectsView(scene, {}, () => false);

    const content: ContentPack = {
      ...BASE_CONTENT,
      props: {},
      presentation: {
        barracks: {
          name: "Barracks",
          description: "Barracks building",
          building: {
            height: 2,
            color: [0.3, 0.4, 0.3],
            minimapColor: [0.5, 0.5, 0.5],
            details: "barracks",
          },
        },
      },
    };

    const definitions = [
      {
        id: "barracks",
        behaviorId: "idle",
        footprint: {
          layer: "surface" as const,
          blocksMovement: true,
          occupiedTiles: [{ x: 0, z: 0 }],
        },
      },
    ];

    let readyCalled = false;
    const assets = createSessionAssets({
      scene,
      content,
      definitions,
      reducedMotion: () => false,
      frameEffects,
    });

    expect(assets.buildingAppearances.has("barracks")).toBe(true);
    const building = assets.buildingAppearances.get("barracks")!;
    expect(building.height).toBe(2);
    expect(building.createDetails).toBeDefined();

    await assets.load({
      onModelsReady: () => {
        readyCalled = true;
      },
    });
    expect(readyCalled).toBe(true);

    assets.dispose();
    frameEffects.dispose();
    scene.dispose();
    engine.dispose();
  });

  test("waits for consumers, then loads once and replaces stand-ins", async () => {
    const { assets, actor, prop, building, callbacks, resolve } =
      pendingAssets();
    const previous = assets.appearances.get("trooper")!;
    const previousDetails =
      assets.buildingAppearances.get("barracks")?.createDetails;
    const releasePrevious = vi.spyOn(previous, "dispose");
    let observedAppearance: ActorAppearance | undefined;
    let releasesDuringUpdate: number | undefined;
    callbacks.onActorAppearanceUpdated.mockImplementation((id) => {
      observedAppearance = assets.appearances.get(id);
      releasesDuringUpdate = releasePrevious.mock.calls.length;
    });
    expect(loadModelAsset).not.toHaveBeenCalled();
    expect(loadSkinnedActorAppearance).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(callbacks.onModelsReady).not.toHaveBeenCalled();

    const ready = assets.load(callbacks);
    expect(assets.load()).toBe(ready);
    expect(loadModelAsset).toHaveBeenCalledTimes(2);
    expect(loadSkinnedActorAppearance).toHaveBeenCalledOnce();
    expect(assets.appearances.get("trooper")).toBe(previous);
    resolve();
    await ready;

    expect(callbacks.onActorAppearanceUpdated).toHaveBeenCalledOnce();
    expect(callbacks.onActorAppearanceUpdated).toHaveBeenCalledWith("trooper");
    expect(observedAppearance).toBe(actor);
    expect(releasesDuringUpdate).toBe(0);
    expect(releasePrevious).toHaveBeenCalledOnce();
    expect(assets.propAssets.get("foundation")).toBe(prop);
    expect(callbacks.onPropLoaded).toHaveBeenCalledWith("foundation", prop);
    expect(assets.buildingAppearances.get("barracks")?.foundation).toBe(prop);
    expect(assets.buildingModelTops.get("barracks")).toBe(3);
    expect(assets.buildingAppearances.get("barracks")?.createDetails).not.toBe(
      previousDetails,
    );
    expect(callbacks.onBuildingUpdated).toHaveBeenCalledTimes(2);
    expect(callbacks.onModelsReady).toHaveBeenCalledOnce();
    assets.dispose();
    assets.dispose();
    for (const asset of [actor, prop, building])
      expect(asset.dispose).toHaveBeenCalledOnce();
  });

  test("failed loads keep stand-ins and still finish readiness", async () => {
    const { assets, callbacks, reject } = pendingAssets();
    const previous = assets.appearances.get("trooper");
    const building = assets.buildingAppearances.get("barracks");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const ready = assets.load(callbacks);
    reject();
    await ready;

    expect(assets.appearances.get("trooper")).toBe(previous);
    expect(assets.buildingAppearances.get("barracks")).toBe(building);
    expect(assets.propAssets.size).toBe(0);
    expect(callbacks.onActorAppearanceUpdated).not.toHaveBeenCalled();
    expect(callbacks.onBuildingUpdated).not.toHaveBeenCalled();
    expect(callbacks.onPropLoaded).not.toHaveBeenCalled();
    expect(callbacks.onModelsReady).toHaveBeenCalledOnce();
    expect(errors).toHaveBeenCalledTimes(3);
  });

  test.each(["loader", "scene", "failed cleanup"])(
    "late assets release without publication after %s disposal",
    async (disposal) => {
      const { scene, assets, actor, prop, building, callbacks, resolve } =
        pendingAssets();
      const previous = assets.appearances.get("trooper");
      const buildingAppearance = assets.buildingAppearances.get("barracks");
      const ready = assets.load(callbacks);
      if (disposal === "scene") scene.dispose();
      else if (disposal === "failed cleanup") {
        vi.spyOn(previous!, "dispose").mockImplementationOnce(() => {
          throw new Error("cleanup failed");
        });
        expect(() => assets.dispose()).toThrow("cleanup failed");
      } else assets.dispose();
      resolve();
      await ready;

      expect(scene.isDisposed).toBe(disposal === "scene");
      expect(assets.appearances.get("trooper")).toBe(previous);
      expect(assets.buildingAppearances.get("barracks")).toBe(
        buildingAppearance,
      );
      expect(assets.propAssets.size).toBe(0);
      expect(assets.buildingModelTops.size).toBe(0);
      for (const callback of Object.values(callbacks))
        expect(callback).not.toHaveBeenCalled();
      for (const asset of [actor, prop, building])
        expect(asset.dispose).toHaveBeenCalledOnce();
    },
  );

  test("disposal before loading starts no requests or callbacks", async () => {
    const { assets, callbacks } = pendingAssets();
    assets.dispose();
    await assets.load(callbacks);

    expect(loadModelAsset).not.toHaveBeenCalled();
    expect(loadSkinnedActorAppearance).not.toHaveBeenCalled();
    for (const callback of Object.values(callbacks))
      expect(callback).not.toHaveBeenCalled();
  });

  test("failed pending loads stay silent after disposal", async () => {
    const { assets, callbacks, reject } = pendingAssets();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const ready = assets.load(callbacks);
    assets.dispose();
    reject();
    await ready;

    expect(errors).not.toHaveBeenCalled();
    for (const callback of Object.values(callbacks))
      expect(callback).not.toHaveBeenCalled();
  });

  test("a failing replacement callback still releases the stand-in", async () => {
    const { assets, callbacks, resolve } = pendingAssets();
    const previous = assets.appearances.get("trooper")!;
    const releasePrevious = vi.spyOn(previous, "dispose");
    vi.spyOn(console, "error").mockImplementation(() => {});
    callbacks.onActorAppearanceUpdated.mockImplementation(() => {
      throw new Error("view update failed");
    });
    const ready = assets.load(callbacks);
    resolve();
    await ready;

    expect(releasePrevious).toHaveBeenCalledOnce();
  });
});
