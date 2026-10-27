import {
  Color3,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
} from "@babylonjs/core";
import { createLifetime } from "../lifetime";
import { createMeshAppearance, DEFAULT_ACTOR_COLOR } from "./actor";
import {
  BUILTIN_ACTOR_MODELS,
  BUILTIN_BUILDING_DETAILS,
} from "./builtin-models";
import { withFrameEffects } from "./frame-effects";
import { loadModelAsset, modelBuildingDetails } from "./glb-model";
import { loadSkinnedActorAppearance } from "./skinned-actor-appearance";

import type { Scene } from "@babylonjs/core";
import type { ContentPack, PropId } from "../content/content-pack";
import type { ActorGraphics, ModelGraphics } from "../content/presentation";
import type { ActorDefinition } from "../simulation/actor";
import type { ActorAppearance } from "./actor";
import type { FrameEffectsView } from "./frame-effects";
import type { ModelAsset } from "./glb-model";
import type { TilePlacedActorAppearance } from "./tile-placed-actor-view";

export type SessionAssetOptions = {
  scene: Scene;
  content: ContentPack;
  definitions: readonly ActorDefinition[];
  reducedMotion: () => boolean;
  frameEffects: FrameEffectsView;
};

export type SessionAssetCallbacks = {
  onBuildingUpdated?: (ids: readonly string[]) => void;
  onActorAppearanceUpdated?: (id: string) => void;
  onPropLoaded?: (id: PropId, asset: ModelAsset) => void;
  onModelsReady?: () => void;
};

export type SessionAssets = {
  appearances: ReadonlyMap<string, ActorAppearance>;
  buildingAppearances: ReadonlyMap<string, TilePlacedActorAppearance>;
  propAssets: ReadonlyMap<PropId, ModelAsset>;
  buildingModelTops: ReadonlyMap<string, number>;
  /** Starts loading once consumers exist; repeated calls share completion. */
  load: (callbacks?: SessionAssetCallbacks) => Promise<void>;
  dispose: () => void;
};

/** Boxes in each model's color stand in while its GLB loads. */
export function standInAppearances(
  scene: Scene,
  models: readonly (readonly [string, ActorGraphics])[],
): Map<string, ActorAppearance> {
  return new Map(
    models.map(([id, graphics]) => {
      const { radius, height } = graphics.bounds;
      const mesh = MeshBuilder.CreateBox(
        `actor-template-${id}`,
        { width: radius * 1.4, height, depth: radius * 1.4 },
        scene,
      );
      const root = new TransformNode(`actor-template-${id}-root`, scene);
      mesh.parent = root;
      mesh.position.y = height / 2;
      const material = new StandardMaterial(
        `actor-template-${id}-material`,
        scene,
      );
      material.diffuseColor = new Color3(
        ...(graphics.minimapColor ?? DEFAULT_ACTOR_COLOR),
      );
      material.specularColor = new Color3(0.12, 0.12, 0.12);
      mesh.material = material;
      return [
        id,
        createMeshAppearance(root, graphics.bounds, graphics.minimapColor),
      ];
    }),
  );
}

/** Waits for environment texture decode before releasing the engine. */
export async function waitForEnvironmentReady(scene: Scene): Promise<void> {
  while (
    !scene.isDisposed &&
    scene.environmentBRDFTexture &&
    !scene.environmentBRDFTexture.loadingError &&
    !scene.environmentBRDFTexture.isReady()
  )
    await new Promise((resolve) => setTimeout(resolve, 16));
}

/** Prepares stand-ins and owns model assets loaded for a session. */
export function createSessionAssets(
  options: SessionAssetOptions,
): SessionAssets {
  const { scene, content, definitions, reducedMotion, frameEffects } = options;

  const lifetime = createLifetime();
  let disposed = false;
  let loading: Promise<void> | undefined;
  const active = () => !disposed && !scene.isDisposed;
  const presentationOf = (id: string) => content.presentation[id];

  const buildingAppearances = new Map<string, TilePlacedActorAppearance>(
    definitions.flatMap(({ id }) => {
      const building = presentationOf(id)?.building;
      if (!building) return [];
      const { details, glb: _glb, ...appearance } = building;
      return [
        [
          id,
          {
            ...appearance,
            createDetails: details
              ? BUILTIN_BUILDING_DETAILS[details]
              : undefined,
          },
        ],
      ];
    }),
  );

  const propAssets = new Map<PropId, ModelAsset>();
  const buildingModelTops = new Map<string, number>();
  const modelAssets = lifetime.own(createLifetime());

  const models = definitions.flatMap(({ id }) => {
    const model = presentationOf(id)?.model;
    return model ? [[id, model] as const] : [];
  });
  const glbModels = models.flatMap(([id, model]) =>
    "glb" in model ? [[id, model.glb] as const] : [],
  );

  const appearances = new Map<string, ActorAppearance>();
  lifetime.defer(() => {
    const cleanup = createLifetime();
    for (const appearance of appearances.values()) cleanup.own(appearance);
    cleanup.dispose();
  });

  const setAppearance = (id: string, appearance: ActorAppearance) => {
    const effects = presentationOf(id)?.frameEffects;
    if (effects) frameEffects.prepare(effects);
    appearances.set(
      id,
      effects
        ? withFrameEffects(appearance, effects, frameEffects)
        : appearance,
    );
  };

  for (const [id, appearance] of standInAppearances(scene, glbModels))
    setAppearance(id, appearance);

  for (const [id, model] of models)
    if ("builtin" in model)
      setAppearance(
        id,
        BUILTIN_ACTOR_MODELS[model.builtin](scene, {
          scale: model.scale,
          reducedMotion,
        }),
      );

  const load = ({
    onBuildingUpdated,
    onActorAppearanceUpdated,
    onPropLoaded,
    onModelsReady,
  }: SessionAssetCallbacks = {}): Promise<void> => {
    if (loading) return loading;
    if (!active()) return (loading = Promise.resolve());
    const setBuildings = (
      ids: Iterable<string>,
      change: Partial<TilePlacedActorAppearance>,
    ) => {
      const updated: string[] = [];
      for (const id of ids) {
        buildingAppearances.set(id, {
          ...buildingAppearances.get(id)!,
          ...change,
        });
        updated.push(id);
      }
      onBuildingUpdated?.(updated);
    };

    const propHandlers: Partial<Record<PropId, (asset: ModelAsset) => void>> = {
      foundation: (asset) =>
        setBuildings(
          definitions
            .filter((definition) => !definition.growth)
            .map(({ id }) => id),
          { foundation: asset },
        ),
      scaffold: (asset) =>
        setBuildings([...buildingAppearances.keys()], { scaffold: asset }),
    };

    const loadAsset = async <T extends { dispose: () => void }>(
      label: string,
      load: () => Promise<T>,
      use: (asset: T) => void,
    ) => {
      try {
        const asset = await load();
        if (!active()) asset.dispose();
        else use(asset);
      } catch (error) {
        if (active())
          console.error(
            `${label} failed to load and keeps its stand-in.`,
            error,
          );
      }
    };

    const loadModel = (
      label: string,
      graphics: ModelGraphics,
      use: (asset: ModelAsset) => void,
    ) =>
      loadAsset(
        label,
        () => loadModelAsset(scene, graphics),
        (asset) => {
          modelAssets.own(asset);
          use(asset);
        },
      );

    loading = Promise.all([
      ...(Object.entries(content.props ?? {}) as [PropId, ModelGraphics][]).map(
        ([id, graphics]) =>
          loadModel(`Prop ${id}`, graphics, (asset) => {
            propAssets.set(id, asset);
            propHandlers[id]?.(asset);
            if (active()) onPropLoaded?.(id, asset);
          }),
      ),
      ...definitions.flatMap(({ id }) => {
        const graphics = presentationOf(id)?.building?.glb;
        return graphics
          ? [
              loadModel(`Building ${id}`, graphics, (asset) => {
                if (asset.topHeight !== undefined)
                  buildingModelTops.set(id, asset.topHeight);
                setBuildings([id], {
                  createDetails: modelBuildingDetails(asset),
                });
              }),
            ]
          : [];
      }),
      ...glbModels.map(([id, graphics]) =>
        loadAsset(
          `Actor ${id}`,
          () =>
            loadSkinnedActorAppearance(scene, graphics, {
              reducedMotion,
            }),
          (appearance) => {
            const previous = appearances.get(id);
            setAppearance(id, appearance);
            try {
              onActorAppearanceUpdated?.(id);
            } finally {
              previous?.dispose();
            }
          },
        ),
      ),
    ]).then(() => {
      if (active()) onModelsReady?.();
    });

    return loading;
  };

  return {
    appearances,
    buildingAppearances,
    propAssets,
    buildingModelTops,
    load,
    dispose: () => {
      disposed = true;
      lifetime.dispose();
    },
  };
}
