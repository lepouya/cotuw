// Per-owner copies of the materials that models reserve for owner colors.
import { Color3, StandardMaterial } from "@babylonjs/core";
import { createMaterialCopies } from "./material-copies";

import type { AbstractMesh } from "@babylonjs/core";
import type { Rgb } from "../content/presentation";

/** Generated models name the materials that show their owner's color. */
export const isOwnerMaterial = (name: string) =>
  name === "owner" || name.endsWith("-owner");

export type OwnerMaterials = {
  /** Gives each mesh with an owner material its owner's copy. */
  apply: (meshes: readonly AbstractMesh[], owner: string) => void;
  /** Releases the copies; the source materials stay with their models. */
  dispose: () => void;
};

/** Copies are shared by source material and owner, so views can batch. */
export function createOwnerMaterials(
  colors: ReadonlyMap<string, Rgb>,
): OwnerMaterials {
  const copies = new Map<string, ReturnType<typeof createMaterialCopies>>();
  return {
    apply: (meshes, owner) => {
      const color = colors.get(owner);
      if (!color) return;
      let materials = copies.get(owner);
      if (!materials)
        copies.set(owner, (materials = createMaterialCopies(owner)));
      materials.edit(
        meshes.filter((mesh) => isOwnerMaterial(mesh.material?.name ?? "")),
        "owner",
        (tinted) => {
          // Loaded models use PBR materials, whose colors are linear.
          if (tinted instanceof StandardMaterial)
            tinted.diffuseColor = new Color3(...color);
          else tinted.albedoColor = new Color3(...color).toLinearSpace();
        },
      );
    },
    dispose: () => {
      for (const materials of copies.values()) materials.dispose();
      copies.clear();
    },
  };
}
