import { TransformNode } from "@babylonjs/core";
import { stableUnit } from "./actor";
import { createViewRegistry } from "./view-registry";
import { hierarchyMeshes } from "./glb-model";
import type { Scene, Vector3 } from "@babylonjs/core";
import type { ModelAsset } from "./glb-model";

export type RegeneratingActor = {
  id: string;
  position: Vector3;
  radius: number;
};

/** Only visible, actively healing actors retain a renderer-owned effect. */
export function createRegenerationEffectsView(
  scene: Scene,
  assetFor: () => ModelAsset | undefined,
  reducedMotion: () => boolean,
) {
  const clocks = new Map<string, number>();
  const effects = createViewRegistry({
    keyFor: () => assetFor(),
    sameKey: (left, right) => left === right,
    create: (actor: RegeneratingActor, asset) => {
      const root = new TransformNode(`regeneration-${actor.id}`, scene);
      const model = asset?.instantiate(`${root.name}-model`);
      if (model) {
        model.root.parent = root;
        for (const mesh of hierarchyMeshes(model.root)) mesh.isPickable = false;
      }
      return {
        update: (actor: RegeneratingActor, seconds: number) => {
          root.position.copyFrom(actor.position);
          root.scaling.setAll(actor.radius * 2);
          model?.pose(
            seconds + stableUnit(actor.id) * (asset?.loopSeconds ?? 0),
          );
        },
        dispose: () => {
          model?.dispose();
          root.dispose();
        },
      };
    },
    onRemove: (id) => clocks.delete(id),
  });
  return {
    update: (actors: readonly RegeneratingActor[], seconds: number) => {
      effects.sync(actors);
      for (const actor of actors) {
        const time =
          (clocks.get(actor.id) ?? 0) + (reducedMotion() ? 0 : seconds);
        clocks.set(actor.id, time);
        effects.get(actor.id)!.update(actor, time);
      }
    },
    dispose: () => effects.dispose(),
  };
}
