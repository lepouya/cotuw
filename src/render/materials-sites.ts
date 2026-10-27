import {
  Color3,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
} from "@babylonjs/core";
import { stableUnit } from "./actor";
import { hierarchyMeshes, staticInstance } from "./glb-model";
import { DEFAULT_MATERIALS_STAGES } from "../content/presentation";
import type { MaterialsStage } from "../content/presentation";
import type { AbstractMesh, Mesh, Scene } from "@babylonjs/core";
import type { TerrainMap, TileCoord } from "../map";
import type { EconomyView } from "../simulation/economy";
import type { ModelAsset, ModelInstance } from "./glb-model";

// Generated mound and salvage models share these colors.
export const MATERIALS_COLOR = new Color3(0.3, 0.66, 0.75);
export const SALVAGE_COLOR = new Color3(1, 0.72, 0.2);

type Marker = { root: TransformNode; model: ModelInstance };

/** Depletion changes presentation without changing terrain or navigation. */
export function createMaterialsSitesView(
  scene: Scene,
  map: TerrainMap,
  initial: EconomyView,
  stages: readonly MaterialsStage[] = DEFAULT_MATERIALS_STAGES,
) {
  const groundAt = (node: TransformNode) =>
    map.heightAtWorldPosition(node.position.x, node.position.z);
  const rootAt = (name: string, tile: TileCoord) => {
    const root = new TransformNode(name, scene);
    const point = map.tileCenter(tile.x, tile.z);
    root.position.set(point.x, 0, point.z);
    root.position.y = groundAt(root);
    return root;
  };
  const standInMaterial = (name: string, color: Color3) => {
    const material = new StandardMaterial(name, scene);
    material.diffuseColor = color.clone();
    return material;
  };
  const siteMaterial = standInMaterial(
    "materials-site-fallback",
    MATERIALS_COLOR,
  );
  const giftMaterial = standInMaterial(
    "materials-gift-fallback",
    SALVAGE_COLOR,
  );
  // Plain shapes stand in until the pack's models load, or without them.
  const standIn = (mesh: Mesh, material: StandardMaterial, y: number) => {
    const root = new TransformNode(`${mesh.name}-fallback`, scene);
    mesh.parent = root;
    mesh.position.y = y;
    mesh.material = material;
    return staticInstance(root);
  };
  const lootTiles = new WeakMap<AbstractMesh, TileCoord>();
  const showSite = (site: Marker) => {
    for (const mesh of hierarchyMeshes(site.model.root))
      mesh.isPickable = false;
  };
  const showGift = (gift: Marker & { tile: TileCoord; phase: number }) => {
    for (const mesh of hierarchyMeshes(gift.model.root))
      lootTiles.set(mesh, gift.tile);
    gift.model.pose(gift.phase);
  };
  const attach = <T extends Marker>(marker: T, show: (marker: T) => void) => {
    marker.model.root.parent = marker.root;
    show(marker);
  };
  const swap = <T extends Marker>(
    markers: ReadonlyMap<string, T>,
    asset: ModelAsset,
    show: (marker: T) => void,
  ) => {
    for (const [id, marker] of markers) {
      marker.model.dispose();
      marker.model = asset.instantiate(`materials-${id}-model`);
      attach(marker, show);
    }
  };
  const sites = new Map(
    initial.sites.map((site) => {
      const name = `materials-${site.id}`;
      const marker = {
        root: rootAt(name, site.tile),
        model: standIn(
          MeshBuilder.CreateCylinder(
            `${name}-marker`,
            {
              diameterTop: 0.25,
              diameterBottom: 0.85,
              height: 0.9,
              tessellation: 5,
            },
            scene,
          ),
          siteMaterial,
          0.45,
        ),
      };
      attach(marker, showSite);
      return [site.id, marker] as const;
    }),
  );
  const cultivation = new Map(
    (initial.cultivation?.sites ?? []).map((site) => {
      const name = `cultivation-${site.id}`;
      const marker = {
        root: rootAt(name, site.tile),
        model: standIn(
          MeshBuilder.CreateSphere(
            `${name}-bloom`,
            { diameter: 0.8, segments: 6 },
            scene,
          ),
          giftMaterial,
          0.4,
        ),
      };
      attach(marker, showSite);
      return [site.id, marker] as const;
    }),
  );
  const loot = new Map(
    initial.loot.map((cache) => {
      const root = rootAt(`materials-${cache.id}-gift`, cache.tile);
      const marker = {
        root,
        tile: cache.tile,
        ground: root.position.y,
        phase: stableUnit(cache.id) * 8,
        model: standIn(
          MeshBuilder.CreateBox(
            `materials-${cache.id}-box`,
            { size: 0.65 },
            scene,
          ),
          giftMaterial,
          0,
        ),
      };
      attach(marker, showGift);
      return [cache.id, marker] as const;
    }),
  );
  const terrainObserver = map.onChangedObservable.add(() => {
    for (const { root } of [...sites.values(), ...cultivation.values()])
      root.position.y = groundAt(root);
    for (const gift of loot.values()) gift.ground = groundAt(gift.root);
  });
  return {
    setCultivation: (asset: ModelAsset) => swap(cultivation, asset, showSite),
    setMound: (mound: ModelAsset) => swap(sites, mound, showSite),
    setSalvage: (salvage: ModelAsset) => swap(loot, salvage, showGift),
    lootTileForMesh: (mesh: AbstractMesh | null) =>
      mesh?.isEnabled() ? lootTiles.get(mesh) : undefined,
    /** Hides resources on tiles the player has not explored. */
    update: (economy: EconomyView, explored: (tile: TileCoord) => boolean) => {
      for (const site of economy.sites) {
        const { root } = sites.get(site.id)!;
        root.setEnabled(site.remainingMaterials > 0 && explored(site.tile));
        const fraction = site.remainingMaterials / site.initialMaterials;
        const stage = stages.find(({ above }) => fraction > above);
        root.scaling.setAll(stage?.scale ?? 0);
      }
      for (const site of economy.cultivation?.sites ?? []) {
        const marker = cultivation.get(site.id)!;
        marker.root.setEnabled(explored(site.tile));
        marker.root.scaling.setAll(
          site.dormant ? 0.65 : 0.8 + (0.2 * site.reserve) / site.capacity,
        );
        for (const mesh of hierarchyMeshes(marker.model.root))
          mesh.visibility = site.dormant ? 0.45 : 1;
      }
      for (const cache of economy.loot)
        loot
          .get(cache.id)!
          .root.setEnabled(!cache.collected && explored(cache.tile));
    },
    animate: (seconds: number) => {
      for (const { root, model } of cultivation.values())
        if (root.isEnabled()) model.pose(seconds);
      for (const { root, ground, phase, model } of loot.values()) {
        if (!root.isEnabled()) continue;
        root.position.y = ground + 0.8;
        model.pose(seconds + phase);
      }
    },
    dispose: () => {
      map.onChangedObservable.remove(terrainObserver);
      for (const { root, model } of [
        ...sites.values(),
        ...cultivation.values(),
        ...loot.values(),
      ]) {
        model.dispose();
        root.dispose();
      }
      siteMaterial.dispose();
      giftMaterial.dispose();
    },
  };
}
