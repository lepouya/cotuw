import { Color3, MeshBuilder, Vector3 } from "@babylonjs/core";
import { groundCross, groundPoint, groundRing } from "./ground-marker";
import { hierarchyMeshes } from "./glb-model";
import { createLifetime } from "../lifetime";

import type { AttackEffectStyle } from "../content/presentation";
import type { AbstractMesh, LinesMesh, Scene } from "@babylonjs/core";
import type { TerrainMap } from "../map";
import type { AttackEvent } from "../simulation/combat";
import type { WorldPosition } from "../simulation/world";
import type { ModelAsset } from "./glb-model";

const MUZZLE_HEIGHT = 1.2;
const HIT_HEIGHT = 0.6;
// Generated effect models share these colors.
export const TRACER_COLOR = new Color3(1, 0.92, 0.55);
export const BOLT_COLOR = new Color3(0.72, 0.38, 1);
export const BITE_COLOR = new Color3(1, 0.3, 0.22);
const TARGET_COLOR = new Color3(0.95, 0.18, 0.15);
const TARGET_LIFE = 0.6;
/**
 * Beams stretch from the muzzle to the target; strikes sit at the target.
 * Fallback lines stand in until an effect's model loads.
 */
const ATTACK_EFFECTS: Record<
  AttackEffectStyle,
  { life: number; color: Color3; beam: boolean }
> = {
  tracer: { life: 0.12, color: TRACER_COLOR, beam: true },
  bolt: { life: 0.3, color: BOLT_COLOR, beam: true },
  bite: { life: 0.3, color: BITE_COLOR, beam: false },
};
/** Catch-up ticks must not accumulate an unbounded number of effect models. */
export const COMBAT_EFFECT_LIMIT = 64;

/** Short-lived, presentation-only shot, strike, and attack-order markers. */
export function createCombatEffectsView(
  scene: Scene,
  map: TerrainMap,
  assetFor: (style: AttackEffectStyle) => ModelAsset | undefined = () =>
    undefined,
  reducedMotion: () => boolean = () => false,
) {
  const effects: {
    fade: (opacity: number) => void;
    dispose: () => void;
    expires: number;
    life: number;
    animate?: (seconds: number) => void;
  }[] = [];
  let now = 0;
  let disposed = false;
  const track = (
    meshes: readonly AbstractMesh[],
    life: number,
    fade: (opacity: number) => void,
    dispose: () => void,
    animate?: (seconds: number) => void,
  ) => {
    for (const mesh of meshes) {
      mesh.isPickable = false;
      mesh.renderingGroupId = 1;
    }
    effects.push({ fade, dispose, expires: now + life, life, animate });
    if (effects.length > COMBAT_EFFECT_LIMIT) effects.shift()!.dispose();
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
      if (disposed) return;
      const from = above(event.from, MUZZLE_HEIGHT);
      const to = above(event.to, HIT_HEIGHT);
      // Shots start at the muzzle rather than the shooter's center.
      const start = from.add(to.subtract(from).normalize().scale(0.35));
      const heading = Math.atan2(
        event.to.x - event.from.x,
        event.to.z - event.from.z,
      );
      const { life, color, beam } = ATTACK_EFFECTS[style];
      const asset = assetFor(style);
      const model = asset?.instantiate(style);
      if (model) {
        const { root } = model;
        if (beam) {
          root.position.copyFrom(start);
          root.lookAt(to);
          root.scaling.z = Vector3.Distance(start, to);
        } else {
          root.position.copyFrom(to);
          root.rotation.y = heading;
        }
        const meshes = hierarchyMeshes(root);
        track(
          meshes,
          life,
          (opacity) => {
            for (const mesh of meshes) mesh.visibility = opacity;
          },
          model.dispose,
          asset?.loopSeconds
            ? (seconds) => model.pose(reducedMotion() ? 0 : seconds)
            : undefined,
        );
        return;
      }
      if (beam) {
        add(
          MeshBuilder.CreateLines(style, { points: [start, to] }, scene),
          color,
          life,
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
      add(MeshBuilder.CreateLineSystem(style, { lines }, scene), color, life);
    },
    /** Acknowledges an accepted attack order at its target. */
    markTarget: (point: Readonly<WorldPosition>) => {
      if (disposed) return;
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
        TARGET_LIFE,
      );
    },
    /** Advances effect lifetimes by real, not simulated, time. */
    update: (seconds: number) => {
      if (disposed) return;
      now += seconds;
      for (let index = effects.length - 1; index >= 0; index -= 1) {
        const effect = effects[index]!;
        const remaining = effect.expires - now;
        if (remaining <= 0) {
          effects.splice(index, 1);
          effect.dispose();
        } else {
          effect.animate?.(effect.life - remaining);
          effect.fade(Math.min(1, (remaining / effect.life) * 2));
        }
      }
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      const cleanup = createLifetime();
      for (const effect of effects) cleanup.defer(effect.dispose);
      effects.length = 0;
      cleanup.dispose();
    },
  };
}
