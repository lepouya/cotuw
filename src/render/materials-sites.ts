import {
  Color3,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
} from "@babylonjs/core";
import { stableUnit } from "./actor";
import type { Scene } from "@babylonjs/core";
import type { TerrainMap } from "../map";
import type { EconomyView } from "../simulation/economy";

/** Depletion changes presentation without changing terrain or navigation. */
export function createMaterialsSitesView(
  scene: Scene,
  map: TerrainMap,
  initial: EconomyView,
) {
  const material = new StandardMaterial("materials-site", scene);
  material.diffuseColor = new Color3(0.3, 0.66, 0.75);
  material.emissiveColor = new Color3(0.04, 0.12, 0.15);
  const giftMaterial = new StandardMaterial("materials-gift", scene);
  giftMaterial.diffuseColor = new Color3(1, 0.72, 0.2);
  giftMaterial.emissiveColor = new Color3(0.18, 0.09, 0.01);
  const ribbonMaterial = new StandardMaterial("materials-gift-ribbon", scene);
  ribbonMaterial.diffuseColor = new Color3(0.8, 0.13, 0.24);
  const sites = new Map(
    initial.sites.map((site) => {
      const mesh = MeshBuilder.CreateCylinder(
        `materials-${site.id}`,
        {
          diameterTop: 0.25,
          diameterBottom: 0.85,
          height: 0.9,
          tessellation: 5,
        },
        scene,
      );
      const point = map.tileCenter(site.tile.x, site.tile.z);
      mesh.position.set(
        point.x,
        map.heightAtWorldPosition(point.x, point.z) + 0.45,
        point.z,
      );
      mesh.isPickable = false;
      mesh.material = material;
      return [site.id, mesh] as const;
    }),
  );
  const loot = new Map(
    initial.loot.map((cache) => {
      const root = new TransformNode(`materials-${cache.id}-gift`, scene);
      const point = map.tileCenter(cache.tile.x, cache.tile.z);
      const ground = map.heightAtWorldPosition(point.x, point.z);
      root.position.set(point.x, ground + 0.8, point.z);
      const box = (
        part: string,
        width: number,
        height: number,
        depth: number,
        y: number,
        ribbon = false,
      ) => {
        const mesh = MeshBuilder.CreateBox(
          `${root.name}-${part}`,
          { width, height, depth },
          scene,
        );
        mesh.parent = root;
        mesh.position.y = y;
        mesh.material = ribbon ? ribbonMaterial : giftMaterial;
      };
      box("box", 0.65, 0.55, 0.65, 0);
      box("lid", 0.72, 0.12, 0.72, 0.3);
      box("ribbon-x", 0.13, 0.69, 0.735, 0.035, true);
      box("ribbon-z", 0.735, 0.69, 0.13, 0.035, true);
      for (const side of [-1, 1]) {
        const bow = MeshBuilder.CreateTorus(
          `${root.name}-bow-${side}`,
          {
            diameter: 0.24,
            thickness: 0.055,
            tessellation: 12,
          },
          scene,
        );
        bow.parent = root;
        bow.position.set(side * 0.12, 0.43, 0);
        bow.rotation.z = (side * Math.PI) / 4;
        bow.material = ribbonMaterial;
      }
      // Terrain under the gift receives contextual commands.
      for (const mesh of root.getChildMeshes()) mesh.isPickable = false;
      return [
        cache.id,
        { root, ground, phase: stableUnit(cache.id) * Math.PI * 2 },
      ] as const;
    }),
  );
  return {
    update: (economy: EconomyView) => {
      for (const site of economy.sites) {
        const mesh = sites.get(site.id)!;
        mesh.setEnabled(site.remainingMaterials > 0);
        const stage =
          Math.ceil((4 * site.remainingMaterials) / site.initialMaterials) / 4;
        mesh.scaling.setAll(0.35 + 0.65 * stage);
      }
      for (const cache of economy.loot)
        loot.get(cache.id)!.root.setEnabled(!cache.collected);
    },
    animate: (seconds: number) => {
      for (const { root, ground, phase } of loot.values()) {
        root.position.y = ground + 0.8 + Math.sin(seconds * 2 + phase) * 0.12;
        root.rotation.y = phase + seconds * 0.8;
      }
    },
    dispose: () => {
      for (const mesh of sites.values()) mesh.dispose();
      for (const { root } of loot.values()) root.dispose();
      material.dispose();
      giftMaterial.dispose();
      ribbonMaterial.dispose();
    },
  };
}
