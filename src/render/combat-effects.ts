import { Color3, MeshBuilder, Vector3 } from "@babylonjs/core";
import { groundCross, groundPoint, groundRing } from "./ground-marker";

import type { AttackEffectStyle } from "../content/presentation";
import type { AbstractMesh, LinesMesh, Scene } from "@babylonjs/core";
import type { TerrainMap } from "../map";
import type { AttackEvent } from "../simulation/combat";
import type { WorldPosition } from "../simulation/world";
import type { ModelAsset } from "./glb-model";

const LIFETIMES: Record<AttackEffectStyle | "target", number> = {
  tracer: 0.12,
  bite: 0.3,
  target: 0.6,
};
const MUZZLE_HEIGHT = 1.2;
const HIT_HEIGHT = 0.6;
// Generated tracer and bite models share these colors.
export const TRACER_COLOR = new Color3(1, 0.92, 0.55);
export const BITE_COLOR = new Color3(1, 0.3, 0.22);
const TARGET_COLOR = new Color3(0.95, 0.18, 0.15);

/** Short-lived, presentation-only shot, strike, and attack-order markers. */
export function createCombatEffectsView(
  scene: Scene,
  map: TerrainMap,
  assetFor: (style: AttackEffectStyle) => ModelAsset | undefined = () =>
    undefined,
) {
  const effects: {
    fade: (opacity: number) => void;
    dispose: () => void;
    expires: number;
    life: number;
  }[] = [];
  let now = 0;
  const track = (
    meshes: readonly AbstractMesh[],
    life: number,
    fade: (opacity: number) => void,
    dispose: () => void,
  ) => {
    for (const mesh of meshes) {
      mesh.isPickable = false;
      mesh.renderingGroupId = 1;
    }
    effects.push({ fade, dispose, expires: now + life, life });
  };
  const add = (mesh: LinesMesh, color: Color3, life: number) => {
    mesh.color = color;
    track(
      [mesh],
      life,
      (opacity) => {
        mesh.alpha = opacity;
      },
      () => mesh.dispose(),
    );
  };
  const above = (point: Readonly<WorldPosition>, height: number) =>
    groundPoint(map, point, height);
  return {
    /** Draws a hit; `style` comes from the attacker's presentation. */
    hit: (event: AttackEvent, style: AttackEffectStyle) => {
      const from = above(event.from, MUZZLE_HEIGHT);
      const to = above(event.to, HIT_HEIGHT);
      // Shots start at the muzzle rather than the shooter's center.
      const start = from.add(to.subtract(from).normalize().scale(0.35));
      const heading = Math.atan2(
        event.to.x - event.from.x,
        event.to.z - event.from.z,
      );
      const model = assetFor(style)?.instantiate(style);
      if (model) {
        const { root } = model;
        if (style === "tracer") {
          root.position.copyFrom(start);
          root.lookAt(to);
          root.scaling.z = Vector3.Distance(start, to);
        } else {
          root.position.copyFrom(to);
          root.rotation.y = heading;
        }
        const meshes = root.getChildMeshes();
        track(
          meshes,
          LIFETIMES[style],
          (opacity) => {
            for (const mesh of meshes) mesh.visibility = opacity;
          },
          model.dispose,
        );
        return;
      }
      if (style === "tracer") {
        add(
          MeshBuilder.CreateLines("tracer", { points: [start, to] }, scene),
          TRACER_COLOR,
          LIFETIMES.tracer,
        );
        return;
      }
      const side = new Vector3(Math.cos(heading), 0, -Math.sin(heading));
      // Three slanted claw marks across the strike direction.
      const lines = [-1, 0, 1].map((offset) => {
        const middle = to.add(side.scale(offset * 0.12));
        return [
          middle.add(new Vector3(0, 0.22, 0)).add(side.scale(0.12)),
          middle.add(new Vector3(0, -0.22, 0)).subtract(side.scale(0.12)),
        ];
      });
      add(
        MeshBuilder.CreateLineSystem("bite", { lines }, scene),
        BITE_COLOR,
        LIFETIMES.bite,
      );
    },
    /** Acknowledges an accepted attack order at its target. */
    markTarget: (point: Readonly<WorldPosition>) => {
      const sample = (ground: Readonly<WorldPosition>) =>
        groundPoint(map, ground, 0.12);
      add(
        MeshBuilder.CreateLineSystem(
          "attack-target",
          {
            lines: [
              groundRing(point, 0.7, 32, sample),
              ...groundCross(point, 0.5, sample),
            ],
          },
          scene,
        ),
        TARGET_COLOR,
        LIFETIMES.target,
      );
    },
    /** Advances effect lifetimes by real, not simulated, time. */
    update: (seconds: number) => {
      now += seconds;
      for (let index = effects.length - 1; index >= 0; index -= 1) {
        const effect = effects[index]!;
        const remaining = effect.expires - now;
        if (remaining <= 0) {
          effect.dispose();
          effects.splice(index, 1);
        } else {
          effect.fade(Math.min(1, (remaining / effect.life) * 2));
        }
      }
    },
    dispose: () => {
      for (const effect of effects) effect.dispose();
      effects.length = 0;
    },
  };
}
