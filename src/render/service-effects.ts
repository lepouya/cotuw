import { MeshBuilder, TransformNode, Vector3 } from "@babylonjs/core";
import { createBarMaterial } from "./screen-bar";
import { createSymbolMesh, SERVICE_COLORS, SERVICE_SYMBOLS } from "./symbols";
import { createViewRegistry } from "./view-registry";

import type { Scene, StandardMaterial } from "@babylonjs/core";
import type { ServiceEffectStyle } from "../content/presentation";
import type { TerrainMap } from "../map";
import type { WorldPosition } from "../simulation/world";

export type ServiceEffect = {
  /** The provider's ID; each provider services one target. */
  id: string;
  position: Readonly<WorldPosition>;
  height: number;
  style: ServiceEffectStyle;
};

/** Small target symbols exist only while a visible provider is doing work. */
export function createServiceEffectsView(
  scene: Scene,
  map: TerrainMap,
  reducedMotion: () => boolean,
) {
  const materials = Object.fromEntries(
    Object.entries(SERVICE_COLORS).map(([style, color]) => {
      const material = createBarMaterial(scene, `service-${style}`, color);
      material.backFaceCulling = false;
      return [style, material];
    }),
  ) as Record<ServiceEffectStyle, StandardMaterial>;
  const views = createViewRegistry({
    keyFor: (entry: ServiceEffect) => entry.style,
    create: (entry, style) => {
      const root = new TransformNode(`service-effect-${entry.id}`, scene);
      root.billboardMode = TransformNode.BILLBOARDMODE_ALL;
      const symbol = new TransformNode(`${root.name}-symbol`, scene);
      symbol.parent = root;
      symbol.position.y = 0.65;
      const mark = createSymbolMesh(
        `${root.name}-mark`,
        SERVICE_SYMBOLS[style],
        0.27,
        0.07,
        scene,
      );
      mark.parent = symbol;
      mark.material = materials[style];
      mark.renderingGroupId = 1;
      const ring = MeshBuilder.CreateLines(
        `${root.name}-ring`,
        {
          points: Array.from({ length: 25 }, (_, index) => {
            const angle = (index / 24) * Math.PI * 2;
            return new Vector3(
              Math.cos(angle) * 0.32,
              Math.sin(angle) * 0.32,
              0.01,
            );
          }),
        },
        scene,
      );
      ring.parent = symbol;
      ring.color = materials[style].emissiveColor;
      ring.isPickable = false;
      ring.renderingGroupId = 1;
      let time = 0;
      return {
        update: (entry: ServiceEffect, seconds: number) => {
          time += reducedMotion() ? 0 : seconds;
          const { x, z } = entry.position;
          root.position.set(
            x,
            map.heightAtWorldPosition(x, z) + entry.height,
            z,
          );
          const pulse = reducedMotion()
            ? 1
            : 0.85 + 0.15 * Math.cos(time * Math.PI * 2);
          symbol.scaling.setAll(pulse);
          ring.alpha = reducedMotion() ? 0.65 : 0.4 + pulse * 0.25;
        },
        dispose: () => root.dispose(),
      };
    },
  });
  return {
    update: (entries: readonly ServiceEffect[], seconds: number) => {
      views.sync(entries);
      for (const entry of entries) views.get(entry.id)!.update(entry, seconds);
    },
    dispose: () => {
      views.dispose();
      for (const material of Object.values(materials)) material.dispose();
    },
  };
}
