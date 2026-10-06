import { PBRMaterial, StandardMaterial } from "@babylonjs/core";

import type { AbstractMesh } from "@babylonjs/core";

type EditableMaterial = StandardMaterial | PBRMaterial;

/**
 * Per-view copies of shared materials, so one view can change how its meshes
 * look. Disposing releases only the copies.
 */
export function createMaterialCopies(prefix: string) {
  const copies = new Map<EditableMaterial, EditableMaterial>();
  const owned = new Set<EditableMaterial>();
  return {
    /** Gives each mesh a copy of its material and edits each copy once. */
    edit: (
      meshes: readonly AbstractMesh[],
      suffix: string,
      edit: (material: EditableMaterial) => void,
    ) => {
      const edited = new Set<EditableMaterial>();
      for (const mesh of meshes) {
        const material = mesh.material;
        if (!(
          material instanceof StandardMaterial ||
          material instanceof PBRMaterial
        ))
          continue;
        // Copies change in place, since cloning drops their clip plane.
        let copy = owned.has(material) ? material : copies.get(material);
        if (!copy) {
          copy = material.clone(`${prefix}-${suffix}-${material.name}`);
          copies.set(material, copy);
          owned.add(copy);
        }
        if (!edited.has(copy)) edit(copy);
        edited.add(copy);
        mesh.material = copy;
      }
    },
    dispose: () => {
      for (const copy of copies.values()) copy.dispose();
      copies.clear();
      owned.clear();
    },
  };
}
