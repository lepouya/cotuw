import { Color3, MeshBuilder, StandardMaterial } from "@babylonjs/core";
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
  const salvageMaterial = new StandardMaterial("materials-salvage", scene);
  salvageMaterial.diffuseColor = new Color3(0.88, 0.65, 0.2);
  const create = (
    id: string,
    tile: { x: number; z: number },
    salvage: boolean,
  ) => {
    const mesh = salvage
      ? MeshBuilder.CreateBox(
          `materials-${id}`,
          { width: 0.65, depth: 0.65, height: 0.4 },
          scene,
        )
      : MeshBuilder.CreateCylinder(
          `materials-${id}`,
          {
            diameterTop: 0.25,
            diameterBottom: 0.85,
            height: 0.9,
            tessellation: 5,
          },
          scene,
        );
    const point = map.tileCenter(tile.x, tile.z);
    mesh.position.set(
      point.x,
      map.heightAtWorldPosition(point.x, point.z) + (salvage ? 0.2 : 0.45),
      point.z,
    );
    // Terrain under the marker receives contextual commands.
    mesh.isPickable = false;
    mesh.material = salvage ? salvageMaterial : material;
    return mesh;
  };
  const sites = new Map(
    initial.sites.map((site) => [site.id, create(site.id, site.tile, false)]),
  );
  const loot = new Map(
    initial.loot.map((cache) => [cache.id, create(cache.id, cache.tile, true)]),
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
        loot.get(cache.id)!.setEnabled(!cache.collected);
    },
    dispose: () => {
      for (const mesh of [...sites.values(), ...loot.values()]) mesh.dispose();
      material.dispose();
      salvageMaterial.dispose();
    },
  };
}
